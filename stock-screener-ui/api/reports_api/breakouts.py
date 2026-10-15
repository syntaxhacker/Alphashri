"""Daily breakout / breakdown report across the whole universe.

Uses OUR OWN 1D candles from disk cache (``chart_patterns.candles``) — never
TradingView. For each symbol in the requested universe the last daily bar
(today's in-progress bar included) is tested against prior highs/lows:

* ``52w_high`` / ``52w_low`` — close beyond the prior 252-bar extreme.
* ``base_20`` / ``base_50`` / ``base_100`` — close beyond the prior N-bar
  high; only the smallest qualifying N is reported. The prior N bars must be
  a real (tight) base: ``range_pct <= 25``.
* ``gap`` — open gapped >=3% above the prior 20-bar high and held it.
* Breakdowns mirror the above (``break_20/50/100`` + ``52w_low``).

Every signal needs ``volume_ratio >= 1.5``. Fan-out is threads-only via
``chart_patterns.parallel.run_symbols`` (never fork inside a request).

Caching: today's report lives in a 60 s in-process dict; a past ``date`` is
an immutable JSON file under ``experiments/data/reports/breakouts/``.
Everything is fail-soft — errors yield empty sections, never a 500.
"""

from __future__ import annotations

import json
import math
import time
from collections import Counter
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

import config as root_config
from chart_patterns.candles import fetch_for_timeframe, frame_last_date
from chart_patterns.parallel import max_workers, run_symbols
from chart_patterns.universes import get_universe

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORT_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "experiments"
    / "data"
    / "reports"
    / "breakouts"
)

VOLUME_MIN = 1.5
BASE_RANGE_MAX_PCT = 25.0
GAP_PCT = 1.03
LOOKBACK_52W = 252
BASE_WINDOWS = (20, 50, 100)
MIN_BARS = 21  # today + prior 20 (volume baseline / base_20)
_TODAY_TTL = 60.0
_TODAY_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}

_BREAKOUT_ORDER = ("52w_high", "gap", "base_20", "base_50", "base_100")
_BREAKDOWN_ORDER = ("52w_low", "break_20", "break_50", "break_100")


def clear_today_cache() -> None:
    """Drop the in-process today cache (tests / admin). Never raises."""
    try:
        _TODAY_CACHE.clear()
    except Exception:
        pass


def _now_iso() -> str:
    try:
        return datetime.now(root_config.IST).isoformat()
    except Exception:
        return datetime.now().astimezone().isoformat()


def _today_str() -> str:
    try:
        return datetime.now(root_config.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().astimezone().strftime("%Y-%m-%d")


def _f(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(out):
        return default
    return out


def _normalize_spark(values: list[float], n: int = 30) -> list[float]:
    """Last ``n`` closes normalized to 0..1 (flat series -> 0.5)."""
    tail = [float(v) for v in (values or [])][-n:]
    if not tail:
        return []
    lo, hi = min(tail), max(tail)
    if hi <= lo:
        return [0.5] * len(tail)
    span = hi - lo
    return [round((v - lo) / span, 4) for v in tail]


def _base_ok(highs: list[float], lows: list[float], closes: list[float]) -> bool:
    """Tight-base gate: ``(max high - min low) / mean close * 100 <= 25``."""
    try:
        if not highs or not lows or not closes:
            return False
        mean_c = sum(closes) / len(closes)
        if mean_c <= 0:
            return False
        return (max(highs) - min(lows)) / mean_c * 100.0 <= BASE_RANGE_MAX_PCT
    except Exception:
        return False


def _name_map() -> dict[str, str]:
    """Symbol -> company name from the already-loaded instruments cache.

    No DB hit: when the cache was never loaded (tests, fresh boot) every
    symbol simply falls back to its own ticker.
    """
    try:
        from api import symbols as symbols_mod

        if not getattr(symbols_mod, "_instruments_loaded", False):
            return {}
        out: dict[str, str] = {}
        for inst in getattr(symbols_mod, "_instruments_cache", None) or []:
            if isinstance(inst, dict):
                sym = str(inst.get("trading_symbol") or "").upper()
                if sym:
                    out[sym] = inst.get("name") or sym
        return out
    except Exception:
        return {}


def analyze_frame(df, *, symbol: str = "") -> Optional[dict]:
    """Classify the last bar of a 1D frame.

    Returns ``{side, type, level, close, pct_above, volume_ratio, change,
    to_52w_high, spark}`` or ``None`` when there is no signal (or the frame
    is unusable). Never raises.
    """
    try:
        if df is None or getattr(df, "empty", True) or len(df) < MIN_BARS:
            return None
        last = df.iloc[-1]
        prior = df.iloc[:-1]
        if len(prior) < 20:
            return None
        close = _f(last.get("close"))
        open_ = _f(last.get("open"))
        vol = _f(last.get("volume"))
        if close <= 0 or open_ <= 0:
            return None
        highs = [_f(v) for v in prior["high"].tolist()]
        lows = [_f(v) for v in prior["low"].tolist()]
        closes = [_f(v) for v in prior["close"].tolist()]
        vols = [_f(v) for v in prior["volume"].tolist()]
        if any(v <= 0 for v in highs[-20:]) or any(v <= 0 for v in closes[-20:]):
            return None
        mean_vol = sum(vols[-20:]) / 20.0
        if mean_vol <= 0:
            return None
        volume_ratio = vol / mean_vol
        if volume_ratio < VOLUME_MIN:
            return None
        prev_close = closes[-1]
        change = (close - prev_close) / prev_close * 100.0 if prev_close > 0 else 0.0
        full_highs = [_f(v) for v in df["high"].tolist()]
        full_closes = [_f(v) for v in df["close"].tolist()]
        to_52w_high: Optional[float] = None
        if len(df) >= LOOKBACK_52W:
            h52 = max(full_highs[-LOOKBACK_52W:])
            if h52 > 0:
                to_52w_high = (close - h52) / h52 * 100.0
        spark = _normalize_spark(full_closes)

        n_prior = len(prior)
        has_52w = n_prior >= LOOKBACK_52W
        w52_high = max(highs[-LOOKBACK_52W:]) if has_52w else None
        w52_low = min(lows[-LOOKBACK_52W:]) if has_52w else None
        ph20 = max(highs[-20:])

        kind: Optional[str] = None
        level: Optional[float] = None
        side: Optional[str] = None
        # --- upside: 52w first, then gap, then smallest qualifying base ---
        if has_52w and w52_high is not None and close > w52_high:
            kind, level, side = "52w_high", w52_high, "up"
        elif open_ >= ph20 * GAP_PCT and close > ph20:
            kind, level, side = "gap", ph20, "up"
        else:
            for n in BASE_WINDOWS:
                if n_prior < n:
                    continue
                lvl = max(highs[-n:])
                if close > lvl and _base_ok(highs[-n:], lows[-n:], closes[-n:]):
                    kind, level, side = f"base_{n}", lvl, "up"
                    break
        # --- downside mirror ---
        if kind is None:
            if has_52w and w52_low is not None and close < w52_low:
                kind, level, side = "52w_low", w52_low, "down"
            else:
                for n in BASE_WINDOWS:
                    if n_prior < n:
                        continue
                    lvl = min(lows[-n:])
                    if close < lvl and _base_ok(highs[-n:], lows[-n:], closes[-n:]):
                        kind, level, side = f"break_{n}", lvl, "down"
                        break
        if kind is None or level is None or level <= 0:
            return None
        pct_above = (close - level) / level * 100.0
        return {
            "side": side,
            "type": kind,
            "level": level,
            "close": close,
            "pct_above": pct_above,
            "volume_ratio": volume_ratio,
            "change": change,
            "to_52w_high": to_52w_high,
            "spark": spark,
        }
    except Exception:
        return None


def _scan_one(
    symbol: str, *, date_str: str, is_today: bool, names: dict
) -> Optional[dict]:
    """Fetch one symbol's 1D frame and classify it.

    Top-level function (thread-pool safe). Never raises — failures are None.
    """
    try:
        sym = str(symbol).upper()
        if is_today:
            df = fetch_for_timeframe(sym, "1D", include_partial_today=True)
        else:
            df = fetch_for_timeframe(sym, "1D", as_of_date=date_str)
            if df is not None and not getattr(df, "empty", True):
                # A past date pins the window end; if the frame's last bar is
                # not that session (holiday / thin history) there is nothing
                # to evaluate for the requested date.
                if frame_last_date(df) != date_str:
                    return None
        sig = analyze_frame(df, symbol=sym)
        if sig is None:
            return None
        return {
            "symbol": sym,
            "name": (names or {}).get(sym) or sym,
            "type": sig["type"],
            "level": round(sig["level"], 4),
            "close": round(sig["close"], 4),
            "pct_above": round(sig["pct_above"], 4),
            "volume_ratio": round(sig["volume_ratio"], 4),
            "change": round(sig["change"], 4),
            "to_52w_high": (
                None
                if sig["to_52w_high"] is None
                else round(sig["to_52w_high"], 4)
            ),
            "sector": None,
            "spark": sig["spark"],
            "_side": sig["side"],
            "_score": abs(sig["pct_above"]) * min(sig["volume_ratio"], 5.0),
        }
    except Exception:
        return None


def _empty_payload(date_str: str, universe: str, scanned: int = 0) -> dict:
    return {
        "date": date_str,
        "universe": universe,
        "as_of": _now_iso(),
        "cached": False,
        "scanned": scanned,
        "breakouts": {"count": 0, "by_type": {}, "rows": []},
        "breakdowns": {"count": 0, "by_type": {}, "rows": []},
    }


def _section(rows: list[dict], order: tuple[str, ...]) -> dict:
    counts = Counter(r.get("type") for r in rows)
    return {
        "count": len(rows),
        "by_type": {t: counts[t] for t in order if counts.get(t)},
        "rows": rows,
    }


def compute_report(date_str: str, universe: str) -> dict:
    """Scan the universe; returns the payload with ``cached=False``.

    Fail-soft (never raises): unknown universes and scan errors yield empty
    sections.
    """
    try:
        today = _today_str()
        is_today = date_str == today
        try:
            symbols = get_universe(universe)
        except Exception:
            return _empty_payload(date_str, universe, scanned=0)
        symbols = [str(s) for s in (symbols or [])]
        names = _name_map()
        fn = partial(_scan_one, date_str=date_str, is_today=is_today, names=names)
        try:
            workers = max_workers()
        except Exception:
            workers = 4
        try:
            # Threads only — never fork inside a request.
            results = run_symbols(fn, symbols, workers=workers, use_processes=False)
        except Exception:
            results = []
        up: list[dict] = []
        down: list[dict] = []
        for r in results or []:
            if not isinstance(r, dict):
                continue
            side = r.pop("_side", None)
            (up if side == "up" else down).append(r)
        for bucket in (up, down):
            # Breakdowns store a negative pct_above; sort by magnitude so the
            # strongest move leads (same formula as the upside otherwise).
            bucket.sort(key=lambda r: r.get("_score", 0.0), reverse=True)
            for r in bucket:
                r.pop("_score", None)
                r.pop("_side", None)
        return {
            "date": date_str,
            "universe": universe,
            "as_of": _now_iso(),
            "cached": False,
            "scanned": len(symbols),
            "breakouts": _section(up, _BREAKOUT_ORDER),
            "breakdowns": _section(down, _BREAKDOWN_ORDER),
        }
    except Exception:
        try:
            return _empty_payload(date_str, universe, scanned=0)
        except Exception:
            return _empty_payload("", "", scanned=0)


def _disk_path(date_str: str, universe: str) -> Path:
    safe_u = "".join(c for c in universe if c.isalnum() or c in ("-", "_"))
    return REPORT_DIR / f"{date_str}_{safe_u or 'universe'}.json"


def serve_report(date_str: str, universe: str) -> dict:
    """Serve a report with caching.

    Today -> 60 s in-process dict; a past date -> immutable disk JSON.
    Never raises (falls back to a fresh compute, then to empty).
    """
    try:
        if date_str == _today_str():
            key = (date_str, universe)
            hit = _TODAY_CACHE.get(key)
            if hit is not None:
                try:
                    if time.time() - hit[0] < _TODAY_TTL:
                        payload = dict(hit[1])
                        payload["cached"] = True
                        payload["as_of"] = _now_iso()
                        return payload
                except Exception:
                    pass
            payload = compute_report(date_str, universe)
            try:
                _TODAY_CACHE[key] = (time.time(), payload)
            except Exception:
                pass
            return payload
        path = _disk_path(date_str, universe)
        try:
            if path.exists():
                payload = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    payload["cached"] = True
                    return payload
        except Exception:
            pass
        payload = compute_report(date_str, universe)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload), encoding="utf-8")
        except Exception:
            pass
        return payload
    except Exception:
        try:
            return compute_report(date_str, universe)
        except Exception:
            return _empty_payload(date_str, universe, scanned=0)


@router.get("/breakouts")
def get_breakouts(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD, default today IST"),
    universe: str = Query(default="nifty500"),
):
    """Daily breakouts/breakdowns across the universe (own 1D candles)."""
    try:
        today = _today_str()
        raw = (date or "").strip()
        date_str = raw or today
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except (ValueError, TypeError):
            return _empty_payload(str(date), universe or "nifty500", scanned=0)
        try:
            # Clamp any date beyond the last completed session (today on a
            # weekend/holiday, or a future date) back to it: there is no tape
            # beyond the last session, and scanning it would fan out hundreds
            # of pointless intraday fetches. Explicit past dates are honored
            # literally.
            from chart_patterns.candles import _last_completed_session

            last_done = _last_completed_session().isoformat()
        except Exception:
            last_done = today
        if date_str > last_done:
            date_str = last_done
        univ = (universe or "").strip().lower() or "nifty500"
        return serve_report(date_str, univ)
    except Exception:
        try:
            return _empty_payload(str(date or ""), str(universe or ""), scanned=0)
        except Exception:
            return {"date": "", "universe": "", "as_of": "", "cached": False,
                    "scanned": 0,
                    "breakouts": {"count": 0, "by_type": {}, "rows": []},
                    "breakdowns": {"count": 0, "by_type": {}, "rows": []}}
