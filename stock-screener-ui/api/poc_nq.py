import json
import time

from fastapi import APIRouter, Query, Request

from trading.replay import registry
from trading.replay.contract import ReplayContext

router = APIRouter(prefix="/api/poc", tags=["poc"])

_cache: dict = {}
_TTL = 300
_CACHE_MAX = 200


def _cache_put(key, data):
    if len(_cache) >= _CACHE_MAX:  # evict oldest entries first
        for k in sorted(_cache, key=lambda k: _cache[k]["ts"])[: len(_cache) - _CACHE_MAX + 1]:
            del _cache[k]
    _cache[key] = {"ts": time.time(), "data": data}


def _basis_median(basis):
    return basis.get("median") if isinstance(basis, dict) else None


def _basis_method(basis):
    return basis.get("method") if isinstance(basis, dict) else None


def _load_replay_data(date: str, hist_hours: int = 0):
    """Shared loader for replay endpoints: sorted ticks, 1m bars, optional overnight history.

    Imports are resolved at call time so tests can patch ``scripts.nq_ticks`` /
    ``scripts.smc_tick_eval`` exactly like the legacy endpoints did.
    """
    from scripts.nq_ticks import fetch_nq_ticks
    from scripts.smc_tick_eval import build_1m_bars

    ticks, basis = fetch_nq_ticks(date)
    ticks = sorted(ticks, key=lambda t: t["timestamp"])  # single order for fills, subs, VWAP
    bars = build_1m_bars(ticks)
    hist_bars = []
    if hist_hours and hist_hours > 0 and bars:
        from datetime import datetime, timedelta

        from scripts.smc_tick_eval import fetch_ticks

        prev = (datetime.fromisoformat(date) - timedelta(days=1)).date().isoformat()
        try:
            pticks = fetch_ticks(prev)
            cut = bars[0]["time"] - hist_hours * 3600
            hist_bars = [b for b in build_1m_bars(pticks) if b["time"] >= cut and b["time"] < bars[0]["time"]]
        except Exception:
            hist_bars = []
    return ticks, bars, hist_bars, basis


def _parse_replay_params(strategy, request) -> dict:
    """ParamSpec defaults overlaid with query params, parsed/validated per type.

    Unknown query keys are ignored. Invalid values fall back to the default.
    """
    params = {p.name: p.default for p in strategy.params}
    specs = {p.name: p for p in strategy.params}
    for key, raw in (getattr(request, "query_params", {}) or {}).items():
        spec = specs.get(key)
        if spec is None:
            continue
        try:
            if spec.type == "int":
                val = int(float(raw))
                if spec.min is not None:
                    val = max(int(spec.min), val)
                if spec.max is not None:
                    val = min(int(spec.max), val)
            elif spec.type == "float":
                val = float(raw)
                if spec.min is not None:
                    val = max(float(spec.min), val)
                if spec.max is not None:
                    val = min(float(spec.max), val)
            elif spec.type == "bool":
                val = str(raw).lower() in ("1", "true", "yes", "on")
            elif spec.type == "select":
                val = raw if raw in (spec.options or [raw]) else spec.default
            else:
                val = raw if raw != "" else spec.default
        except Exception:
            val = spec.default
        params[key] = val
    return params

@router.get("/nq")
def get_nq(
    period: str = Query(default="5d"),
    interval: str = Query(default="15m"),
    date: str | None = Query(default=None, description="YYYY-MM-DD for single day"),
):
    key = f"{period}:{interval}:{date or ''}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < _TTL:
        return _cache[key]["data"]
    try:
        import yfinance as yf
        import pandas as pd
        if date:
            # Single day: use start/end for that date
            start = date
            end = (pd.to_datetime(date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            df = yf.download("NQ=F", start=start, end=end, interval=interval, progress=False, auto_adjust=True)
        else:
            df = yf.download("NQ=F", period=period, interval=interval, progress=False, auto_adjust=True)
        if df.empty:
            return {"symbol": "NQ=F", "interval": interval, "bars": [], "error": "empty from yfinance"}
        # yfinance with single ticker returns MultiIndex columns; flatten
        if hasattr(df.columns, "levels"):
            df.columns = df.columns.droplevel(1) if df.columns.nlevels > 1 else df.columns
        bars = []
        for ts, row in df.iterrows():
            try:
                t = int(ts.timestamp())
                o = float(row["Open"]) if "Open" in row else float(row["open"])
                h = float(row["High"]) if "High" in row else float(row["high"])
                l = float(row["Low"]) if "Low" in row else float(row["low"])
                c = float(row["Close"]) if "Close" in row else float(row["close"])
                v = int(row["Volume"]) if "Volume" in row else 0
                if not all(map(lambda x: x == x, [o, h, l, c])):  # NaN check
                    continue
                bars.append({"time": t, "open": round(o, 2), "high": round(h, 2), "low": round(l, 2), "close": round(c, 2), "volume": v})
            except Exception:
                continue
        data = {"symbol": "NQ=F", "interval": interval, "count": len(bars), "bars": bars}
        _cache[key] = {"ts": now, "data": data}
        return data
    except Exception as e:
        return {"symbol": "NQ=F", "interval": interval, "bars": [], "error": str(e)}


def detect_smc_signals(bars: list, warmup: int = 30) -> list:
    """Run the real SMCSignalGenerator (trading/smc_signals.py) bar-by-bar over a session's 1m bars.

    History-only, no lookahead: at each bar the generator sees only bars up to that point.
    Returns raw signals (no outcome) — caller evaluates SL/TP against its own data
    (1m bars for the UI, Dukascopy ticks for tick-accurate evaluation).
    """
    from datetime import datetime
    from config import IST
    from trading.smc_signals import SMCSignalGenerator

    gen = SMCSignalGenerator({})
    signals: list = []
    for idx in range(len(bars)):
        if idx < warmup:  # strategy needs >= 30-bar warmup (HTF EMA20 + range filters)
            continue
        b = bars[idx]
        ts = datetime.fromtimestamp(b["time"], tz=IST)
        candles = [{"open": x["open"], "high": x["high"], "low": x["low"], "close": x["close"]} for x in bars[: idx + 1]]
        try:
            sig = gen.check_entry("NQ=F", {"current_price": b["close"], "candles": candles, "timestamp": ts})
        except Exception:
            sig = None
        if sig:
            signals.append({
                "time": b["time"], "entry_idx": idx,
                "side": "LONG" if "LONG" in str(sig.signal_type) else "SHORT",
                "entry": round(float(sig.price), 2), "sl": float(sig.stop_loss), "tp": float(sig.take_profit),
                "note": sig.notes or "",
            })
    return signals


@router.get("/smc-trades")
def get_smc_trades(date: str = Query(..., description="YYYY-MM-DD")):
    """Real SMCSignalGenerator signals on real 1m data, outcomes evaluated on real 1m bars."""
    key = f"smc-trades:{date}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < _TTL:
        return _cache[key]["data"]
    try:
        from trading.smc_signals import SMCSignalGenerator  # noqa: F401 — availability check
    except Exception as e:
        return {"date": date, "bars": [], "trades": [], "error": f"import failed: {e}"}

    resp = get_nq(period="1d", interval="1m", date=date)
    bars = resp.get("bars") or []
    if len(bars) < 30:
        out = {"date": date, "bars": bars, "trades": []}
        if resp.get("error"):
            out["error"] = resp["error"]
        return out

    trades: list = []
    open_trade = None
    sig_iter = iter(detect_smc_signals(bars))
    next_sig = next(sig_iter, None)
    for idx in range(len(bars)):
        b = bars[idx]
        if open_trade is None and next_sig is not None and next_sig["entry_idx"] == idx:
            open_trade = dict(next_sig)
            next_sig = next(sig_iter, None)
            continue
        if open_trade is None:
            continue
        # manage open trade against real subsequent bars — SL first (conservative)
        t = open_trade
        is_long = t["side"] == "LONG"
        hit_sl = b["low"] <= t["sl"] if is_long else b["high"] >= t["sl"]
        hit_tp = b["high"] >= t["tp"] if is_long else b["low"] <= t["tp"]
        if hit_sl:
            t.update(result="SL", pnl=round(t["sl"] - t["entry"], 2), exit_time=b["time"], held_bars=idx - t["entry_idx"])
            trades.append(t); open_trade = None
        elif hit_tp:
            t.update(result="TP", pnl=round(t["tp"] - t["entry"], 2), exit_time=b["time"], held_bars=idx - t["entry_idx"])
            trades.append(t); open_trade = None
    if open_trade is not None:
        last = bars[-1]
        t = open_trade
        t.update(result="EOD", pnl=round(last["close"] - t["entry"], 2), exit_time=last["time"], held_bars=len(bars) - 1 - t["entry_idx"])
        trades.append(t)

    data = {"date": date, "count": len(trades), "bars": bars, "trades": trades}
    _cache[key] = {"ts": now, "data": data}
    return data


@router.get("/tick-replay")
def get_tick_replay(
    date: str = Query(...),
    secs: int = Query(default=2, description="candle seconds for tick chart"),
    orb: int = Query(default=15, description="opening-range minutes (1m bars)"),
    hist: int = Query(default=8, description="overnight history hours for structure"),
):
    """Thin adapter over the ``vwap-orb`` replay engine (legacy response shape)."""
    try:
        from datetime import datetime
        datetime.fromisoformat(date)  # validate early: malformed date -> error envelope, not 500
    except Exception:
        return {"date": date, "candles": [], "trades": [], "error": f"bad date: {date!r}, want YYYY-MM-DD"}
    orb = max(1, min(int(orb), 120))
    sub_s = max(1, min(int(secs), 60))
    key = f"tick-replay:v5:{date}:{sub_s}:{orb}:{hist}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < 3600:
        return _cache[key]["data"]
    try:
        ticks, bars, hist_bars, basis = _load_replay_data(date, hist)
    except Exception as e:
        return {"date": date, "candles": [], "trades": [], "error": f"tick fetch failed: {e}"}
    ctx = ReplayContext(date=date, symbol="NQ=F", params={"secs": sub_s, "orb": orb, "hist": hist},
                        ticks=ticks, bars=bars, hist_bars=hist_bars or None, basis=_basis_median(basis))
    result = registry.get("vwap-orb").run(ctx)
    out = result.trades
    basis_med = _basis_median(basis)
    data = {"date": date, "count": len(out), "candles": result.extras["candles"],
            "subs": result.extras["subs"], "vwap": result.extras["vwap"],
            "or_high": result.extras["or_high"], "or_low": result.extras["or_low"],
            "or_minutes": result.extras["or_minutes"], "or_end": result.extras["or_end"],
            "trades": out, "basis": basis_med, "basis_method": _basis_method(basis), "symbol": "NQ=F",
            "hist_bars": result.extras["hist_bars"], "sub_secs": result.extras["sub_secs"],
            **({"error": "no NQ basis available"} if basis_med is None else {})}
    _cache_put(key, data)
    return data


@router.get("/smc-ifvg")
def get_smc_ifvg(
    date: str = Query(..., description="YYYY-MM-DD"),
    from_ist: str | None = Query(default=None, description="filter trades entered at/after HH:MM IST"),
    to_ist: str | None = Query(default=None, description="filter trades entered at/before HH:MM IST"),
    entries: str = Query(default="both", description="inv | retest | both — divided stacks or legacy coupled"),
    flip: float | None = Query(default=None, description="inv_flip_margin: strong inversions flip bias (experimental)"),
):
    """Thin adapter over the ``smc-ifvg`` replay engine (legacy response shape)."""
    key = f"smc-ifvg:{date}:{from_ist or ''}:{to_ist or ''}:{entries}:{flip}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < 3600:
        return _cache[key]["data"]
    try:
        ticks, bars, _hist_bars, basis = _load_replay_data(date, 0)
    except Exception as e:
        return {"date": date, "bars": [], "trades": [], "error": f"tick fetch failed: {e}"}
    ctx = ReplayContext(date=date, symbol="NQ=F",
                        params={"entries": entries, "flip": flip, "from_ist": from_ist, "to_ist": to_ist},
                        ticks=ticks, bars=bars, hist_bars=None, basis=_basis_median(basis))
    result = registry.get("smc-ifvg").run(ctx)
    out = result.trades
    data = {"date": date, "count": len(out), "bars": bars, "trades": out,
            "basis": basis["median"], "basis_method": basis["method"], "symbol": "NQ=F"}
    _cache[key] = {"ts": now, "data": data}
    return data


@router.get("/replay/{strategy_id}")
def get_replay(strategy_id: str, request: Request):
    """Generic replay endpoint: any registered strategy, one envelope."""
    strategy = registry.get(strategy_id)
    if strategy is None:
        return {"error": f"unknown strategy: {strategy_id}"}

    params = _parse_replay_params(strategy, request)
    date = (getattr(request, "query_params", {}) or {}).get("date")
    if not date:
        return {"strategy_id": strategy_id, "date": date, "candles": [], "bars": [],
                "trades": [], "error": f"bad date: {date!r}, want YYYY-MM-DD"}
    try:
        from datetime import datetime
        datetime.fromisoformat(date)
    except Exception:
        return {"strategy_id": strategy_id, "date": date, "candles": [], "bars": [],
                "trades": [], "error": f"bad date: {date!r}, want YYYY-MM-DD"}

    key = f"replay:v1:{strategy_id}:{json.dumps(sorted(params.items()))}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < 3600:
        return _cache[key]["data"]

    try:
        hist_hours = int(params.get("hist") or 0) if "hist" in params else 0
        ticks, bars, hist_bars, basis = _load_replay_data(date, hist_hours)
        ctx = ReplayContext(date=date, symbol="NQ=F", params=params, ticks=ticks, bars=bars,
                            hist_bars=hist_bars or None, basis=_basis_median(basis))
        result = strategy.run(ctx)
    except Exception as e:
        return {"strategy_id": strategy_id, "date": date, "candles": [], "bars": [],
                "trades": [], "error": str(e)}

    data = {
        "strategy_id": strategy_id,
        "label": strategy.label,
        "date": date,
        "params": params,
        "count": len(result.trades),
        "trades": result.trades,
        "zones": result.zones,
        "trends": result.trends,
        "levels": result.levels,
        "kpis": result.kpis,
        "symbol": "NQ=F",
        "basis": _basis_median(basis),
        "basis_method": _basis_method(basis),
        **result.extras,
    }
    _cache_put(key, data)
    return data
