"""Pattern-profitability screener: "which patterns make money".

``GET /api/reports/profitability?weeks=4&universe=nifty500`` ->
``{weeks, universe, as_of, cached, strategies, top_signals}`` where each
strategy row is ``{id, label, trades, win_rate, net_pnl, expectancy,
profit_factor, max_dd, avg_hold_days}`` and each top signal is
``{symbol, strategy, entry_date, entry, exit, net}``.

Live table: for each of the six pattern strategies the last ``weeks``
completed weeks (``weeks`` clamped to 1..12) of daily bars are taken from
``chart_patterns.candles.fetch_for_timeframe`` (one 1D fetch per symbol,
threads only, universe capped at ``MAX_SYMBOLS``). Every signal is traded
long-only at the signal-bar close and exited ``hold_days`` sessions later
with a fixed Rs.1L notional; round-trip costs come from
``backtest/costs.py:calculate_trading_costs`` (flat-percentage fallback
when that module cannot be imported).

Experiment files (``experiments/pattern_profit_week42.json``,
``experiments/new_patterns_week42.json``) are read best-effort when present
and their signal-like entries supplement ``top_signals``; they never fail
the response.

Caching: per-(weeks, universe) 10-minute in-process dict. Fail-soft: any
error yields zeroed strategy rows + empty signals, never a 500.
"""

from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

import config as root_config

router = APIRouter(prefix="/api/reports", tags=["reports"])

#: strategy id -> {label, hold_days}. Hold varies per pattern so the table
#: reflects each pattern's natural horizon, not a single global exit.
STRATEGIES: dict[str, dict[str, Any]] = {
    "sr_breakout": {"label": "S/R Breakout", "hold_days": 5},
    "orb": {"label": "Opening Range Breakout", "hold_days": 2},
    "ema_cross": {"label": "EMA Cross", "hold_days": 5},
    "week52_chaser": {"label": "52W Chaser", "hold_days": 10},
    "accumulation_breakout": {"label": "Accumulation Breakout", "hold_days": 7},
    "gap_and_go": {"label": "Gap & Go", "hold_days": 2},
}

TRADE_NOTIONAL = 100_000.0
MAX_SYMBOLS = 60
MAX_WORKERS = 8
CACHE_TTL_SECONDS = 600
WEEKS_DEFAULT = 4
WEEKS_MAX = 12
TOP_SIGNALS_LIMIT = 10

EXPERIMENTS_DIR = (
    Path(__file__).resolve().parent.parent.parent / "experiments"
)
EXPERIMENT_FILES = [
    EXPERIMENTS_DIR / "pattern_profit_week42.json",
    EXPERIMENTS_DIR / "new_patterns_week42.json",
]

_cache: dict[str, tuple[float, dict]] = {}


def clear_cache() -> None:
    """Drop the in-process cache (tests / admin). Never raises."""
    try:
        _cache.clear()
    except Exception:
        pass


def _now_iso() -> str:
    try:
        return datetime.now(root_config.IST).isoformat()
    except Exception:
        return datetime.now().astimezone().isoformat()


def _finite(value: Any) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _round2(value: Any) -> float:
    fv = _finite(value)
    return round(fv, 2) if fv is not None else 0.0


def compute_metrics(nets: list[float]) -> dict:
    """Aggregate per-trade net P&L into table metrics. Never raises.

    ``win_rate`` is a 0..1 fraction; ``profit_factor`` is gross-profit /
    gross-loss (gross profit when there are no losers, 0.0 when flat);
    ``max_dd`` is peak-to-trough drawdown of the cumulative net curve.
    """
    try:
        clean = [_finite(n) or 0.0 for n in (nets or [])]
        trades = len(clean)
        if trades == 0:
            return {
                "trades": 0, "win_rate": 0.0, "net_pnl": 0.0,
                "expectancy": 0.0, "profit_factor": 0.0, "max_dd": 0.0,
            }
        wins = sum(1 for n in clean if n > 0)
        net = sum(clean)
        gross_profit = sum(n for n in clean if n > 0)
        gross_loss = -sum(n for n in clean if n < 0)
        if gross_loss > 0:
            pf = gross_profit / gross_loss
        else:
            pf = gross_profit if gross_profit > 0 else 0.0
        peak = 0.0
        running = 0.0
        max_dd = 0.0
        for n in clean:
            running += n
            if running > peak:
                peak = running
            dd = peak - running
            if dd > max_dd:
                max_dd = dd
        return {
            "trades": trades,
            "win_rate": round(wins / trades, 4),
            "net_pnl": round(net, 2),
            "expectancy": round(net / trades, 2),
            "profit_factor": round(pf, 2),
            "max_dd": round(max_dd, 2),
        }
    except Exception:
        return {
            "trades": 0, "win_rate": 0.0, "net_pnl": 0.0,
            "expectancy": 0.0, "profit_factor": 0.0, "max_dd": 0.0,
        }


def _trade_cost(entry: float, exit_: float, qty: int) -> float:
    """Round-trip cost via ``backtest/costs.py`` (flat fallback)."""
    try:
        from backtest.costs import calculate_trading_costs

        out = calculate_trading_costs(entry, exit_, qty)
        return float(out.get("total_costs", 0.0) or 0.0)
    except Exception:
        try:
            notional = (float(entry) + float(exit_)) * int(qty)
            return round(notional * 0.0006, 2)
        except Exception:
            return 0.0


def _ema_cross_series(closes: list[float]) -> tuple[list[float], list[float]]:
    """``(ema12, ema26)`` over the WHOLE close series - one pass.

    The EWM recursion only looks backwards, so the value at bar ``i`` is the
    same whether it is computed from ``closes[:i + 1]`` or from the full
    series. Rebuilding both EMAs per bar made the scan quadratic (and paid
    pandas' per-call overhead on every bar of every symbol).
    """
    import pandas as pd

    s = pd.Series(list(closes or []), dtype=float)
    return (
        s.ewm(span=12, adjust=False).mean().tolist(),
        s.ewm(span=26, adjust=False).mean().tolist(),
    )


def _signal_at(
    strategy_id: str,
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    vols: list[float],
    i: int,
    ema: Optional[tuple[list[float], list[float]]] = None,
) -> bool:
    """True when bar ``i`` fires ``strategy_id`` (needs ``i >= 26``)."""
    try:
        if i < 26 or i >= len(closes):
            return False
        o, h, lo, c = opens[i], highs[i], lows[i], closes[i]
        if not all(v > 0 for v in (o, h, lo, c)):
            return False
        prev = closes[i - 1]
        if prev <= 0:
            return False
        if strategy_id == "sr_breakout":
            return c > max(highs[i - 20:i])
        if strategy_id == "orb":
            body = (c - o) / o
            rng = (h - lo) / c
            return body >= 0.01 and rng >= 0.02 and c > prev
        if strategy_id == "ema_cross":
            if not ema:
                e12, e26 = _ema_cross_series(closes[: i + 1])
            else:
                e12, e26 = ema
            if i >= len(e12) or i < 1 or i >= len(e26):
                return False
            return e12[i] > e26[i] and e12[i - 1] <= e26[i - 1]
        if strategy_id == "week52_chaser":
            start = max(0, i - 252)
            hi252 = max(highs[start:i]) if i > start else 0.0
            return hi252 > 0 and c >= 0.97 * hi252 and c > prev
        if strategy_id == "accumulation_breakout":
            window = closes[i - 20:i]
            mean_c = sum(window) / len(window)
            if mean_c <= 0:
                return False
            tight = (max(window) - min(window)) / mean_c <= 0.08
            return tight and c > max(window)
        if strategy_id == "gap_and_go":
            return o >= prev * 1.015 and c > o
        return False
    except Exception:
        return False


def _frame_to_lists(df: Any) -> Optional[dict]:
    """Daily frame -> column lists + date labels. None when unusable."""
    try:
        if df is None or getattr(df, "empty", True):
            return None
        n = len(df)
        if n < 30:
            return None
        for col in ("open", "high", "low", "close"):
            if col not in df.columns:
                return None
        vols = df["volume"].tolist() if "volume" in df.columns else [0.0] * n
        try:
            dates = [
                d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]
                for d in df.index.tolist()
            ]
        except Exception:
            dates = ["" for _ in range(n)]
        return {
            "open": [float(v) for v in df["open"].tolist()],
            "high": [float(v) for v in df["high"].tolist()],
            "low": [float(v) for v in df["low"].tolist()],
            "close": [float(v) for v in df["close"].tolist()],
            "volume": [float(v or 0.0) for v in vols],
            "dates": dates,
        }
    except Exception:
        return None


def _extract_trades(
    symbol: str, lists: dict, strategy_id: str, hold_days: int, window_bars: int
) -> list[dict]:
    """Signal-bar trades inside the trailing ``window_bars`` window."""
    trades: list[dict] = []
    try:
        closes = lists["close"]
        n = len(closes)
        start = max(26, n - window_bars)
        ema = lists.get("ema")
        for i in range(start, n - hold_days):
            try:
                if not _signal_at(
                    strategy_id,
                    lists["open"], lists["high"], lists["low"],
                    closes, lists["volume"], i, ema=ema,
                ):
                    continue
                entry = closes[i]
                exit_ = closes[i + hold_days]
                if entry <= 0 or exit_ <= 0:
                    continue
                qty = max(1, int(TRADE_NOTIONAL / entry))
                gross = (exit_ - entry) * qty
                cost = _trade_cost(entry, exit_, qty)
                trades.append({
                    "symbol": symbol,
                    "strategy": strategy_id,
                    "entry_date": lists["dates"][i] if i < len(lists["dates"]) else "",
                    "entry": round(entry, 2),
                    "exit": round(exit_, 2),
                    "net": round(gross - cost, 2),
                    "hold_days": hold_days,
                })
            except Exception:
                continue
    except Exception:
        pass
    return trades


def _read_experiment_files() -> list[dict]:
    """Best-effort signal-like entries from experiment JSON files."""
    out: list[dict] = []
    try:
        files = list(EXPERIMENT_FILES or [])
    except Exception:
        return out
    for path in files:
        try:
            p = Path(str(path))
            if not p.exists():
                continue
            with open(p, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            continue
        try:
            candidates: list[Any] = []
            if isinstance(payload, list):
                candidates = payload
            elif isinstance(payload, dict):
                for key in ("signals", "top_signals", "trades", "results"):
                    val = payload.get(key)
                    if isinstance(val, list):
                        candidates.extend(val)
            for row in candidates:
                if not isinstance(row, dict):
                    continue
                sym = str(row.get("symbol") or "").strip().upper()
                if not sym:
                    continue
                net = _finite(row.get("net", row.get("net_pnl", row.get("pnl"))))
                if net is None:
                    continue
                out.append({
                    "symbol": sym,
                    "strategy": str(row.get("strategy") or row.get("pattern") or "experiment"),
                    "entry_date": str(row.get("entry_date") or row.get("date") or ""),
                    "entry": _round2(row.get("entry", 0.0)),
                    "exit": _round2(row.get("exit", 0.0)),
                    "net": round(net, 2),
                })
        except Exception:
            continue
    return out


def _empty_payload(weeks: int, universe: str) -> dict:
    strategies = [
        {
            "id": sid, "label": spec["label"], "trades": 0,
            "win_rate": 0.0, "net_pnl": 0.0, "expectancy": 0.0,
            "profit_factor": 0.0, "max_dd": 0.0, "avg_hold_days": 0.0,
        }
        for sid, spec in STRATEGIES.items()
    ]
    return {
        "weeks": weeks, "universe": universe, "as_of": _now_iso(),
        "cached": False, "strategies": strategies, "top_signals": [],
    }


def _scan_symbol(symbol: str, window_bars: int) -> list[dict]:
    """Fetch one symbol's 1D frame and extract all-strategy trades."""
    try:
        from chart_patterns.candles import fetch_for_timeframe

        sym = str(symbol).upper()
        df = fetch_for_timeframe(sym, "1D")
        lists = _frame_to_lists(df)
        if lists is None:
            return []
        # One EMA pass per symbol, reused by the ema_cross strategy.
        lists["ema"] = _ema_cross_series(lists["close"])
        trades: list[dict] = []
        for sid, spec in STRATEGIES.items():
            trades.extend(
                _extract_trades(sym, lists, sid, int(spec["hold_days"]), window_bars)
            )
        return trades
    except Exception:
        return []


def compute_report(weeks: int, universe: str) -> dict:
    """Build the payload (no cache). Fail-soft — never raises."""
    try:
        w = max(1, min(int(weeks), WEEKS_MAX))
    except Exception:
        w = WEEKS_DEFAULT
    uid = (universe or "nifty500").strip().lower() or "nifty500"
    try:
        from chart_patterns.universes import get_universe

        symbols = [str(s) for s in (get_universe(uid) or [])][:MAX_SYMBOLS]
    except Exception:
        return _empty_payload(w, uid)
    window_bars = w * 5
    all_trades: list[dict] = []
    try:
        workers = min(MAX_WORKERS, max(1, len(symbols)))
        if symbols:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                for trades in ex.map(lambda s: _scan_symbol(s, window_bars), symbols):
                    if trades:
                        all_trades.extend(trades)
    except Exception:
        pass
    try:
        file_signals = _read_experiment_files()
    except Exception:
        file_signals = []
    strategies: list[dict] = []
    live_signals: list[dict] = []
    for sid, spec in STRATEGIES.items():
        mine = [t for t in all_trades if t.get("strategy") == sid]
        m = compute_metrics([t.get("net", 0.0) for t in mine])
        holds = [t.get("hold_days", 0) for t in mine if isinstance(t.get("hold_days"), (int, float))]
        avg_hold = round(sum(holds) / len(holds), 1) if holds else 0.0
        strategies.append({
            "id": sid, "label": spec["label"], **m, "avg_hold_days": avg_hold,
        })
        live_signals.extend(mine)
    strategies.sort(key=lambda r: (r.get("net_pnl") or 0.0), reverse=True)
    pool = list(live_signals) + [s for s in (file_signals or []) if isinstance(s, dict)]
    pool.sort(key=lambda r: float(r.get("net") or 0.0), reverse=True)
    top_signals = [
        {
            "symbol": str(r.get("symbol") or ""),
            "strategy": str(r.get("strategy") or ""),
            "entry_date": str(r.get("entry_date") or ""),
            "entry": _round2(r.get("entry")),
            "exit": _round2(r.get("exit")),
            "net": _round2(r.get("net")),
        }
        for r in pool[:TOP_SIGNALS_LIMIT]
    ]
    return {
        "weeks": w, "universe": uid, "as_of": _now_iso(),
        "cached": False, "strategies": strategies, "top_signals": top_signals,
    }


@router.get("/profitability")
def get_profitability(
    weeks: int = Query(default=WEEKS_DEFAULT),
    universe: str = Query(default="nifty500"),
) -> dict:
    """Pattern-profitability table over the last ``weeks`` weeks."""
    try:
        w = max(1, min(int(weeks), WEEKS_MAX))
    except Exception:
        w = WEEKS_DEFAULT
    try:
        uid = (universe or "nifty500").strip().lower() or "nifty500"
    except Exception:
        uid = "nifty500"
    key = f"{w}|{uid}"
    try:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
            out = dict(hit[1])
            out["cached"] = True
            return out
    except Exception:
        pass
    try:
        payload = compute_report(w, uid)
    except Exception:
        payload = _empty_payload(w, uid)
    try:
        _cache[key] = (time.time(), payload)
    except Exception:
        pass
    return payload
