from fastapi import APIRouter, Query
import time

router = APIRouter(prefix="/api/poc", tags=["poc"])

_cache: dict = {}
_TTL = 300

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
):
    """Tick replay bundle: N-second candles from real ticks + VWAP+ORB trades + levels."""
    key = f"tick-replay:{date}:{secs}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < 3600:
        return _cache[key]["data"]
    try:
        from trading.vwap_orb import VWAPORBEngine, OR_BARS
        from scripts.smc_tick_eval import build_1m_bars
        from scripts.nq_ticks import fetch_nq_ticks
    except Exception as e:
        return {"date": date, "candles": [], "trades": [], "error": f"import failed: {e}"}
    try:
        ticks, basis = fetch_nq_ticks(date)
    except Exception as e:
        return {"date": date, "candles": [], "trades": [], "error": f"tick fetch failed: {e}"}
    bars = build_1m_bars(ticks)
    eng = VWAPORBEngine()
    trades = eng.run(bars, ticks)
    # N-second candles + session VWAP series
    seconds = max(1, min(secs, 60))
    buckets: dict = {}
    for t in ticks:
        k = int(t["timestamp"] // 1000 // seconds) * seconds
        bid = t["bidPrice"]
        b = buckets.get(k)
        if b is None:
            buckets[k] = {"time": k, "open": bid, "high": bid, "low": bid, "close": bid}
        else:
            b["high"] = max(b["high"], bid)
            b["low"] = min(b["low"], bid)
            b["close"] = bid
    candles = [buckets[k] for k in sorted(buckets)]
    # progressive session VWAP: value at each candle uses only ticks up to that candle
    vwap = []
    pv = vv = 0.0
    ti = 0
    ticks_sorted = sorted(ticks, key=lambda t: t["timestamp"])
    for c in candles:
        end_ms = (c["time"] + seconds) * 1000
        while ti < len(ticks_sorted) and ticks_sorted[ti]["timestamp"] < end_ms:
            t = ticks_sorted[ti]
            v = (t.get("askVolume") or 0) + (t.get("bidVolume") or 0)
            if v > 0:
                pv += ((t["askPrice"] + t["bidPrice"]) / 2.0) * v
                vv += v
            ti += 1
        vwap.append({"time": c["time"], "value": round(pv / vv, 2) if vv else c["close"]})
    out = []
    for t in trades:
        out.append({
            "time": int(t["t_in"] // (1000 * seconds)) * seconds,
            "exit_time": int(t["t_out"] // (1000 * seconds)) * seconds,
            "side": t["side"], "kind": "vwap-orb", "entry": t["entry"], "sl": t["sl"],
            "tp": t["tp"], "exit": t["exit"], "result": t["result"], "pnl": t["pnl"], "rr": t["rr"],
        })
    data = {"date": date, "count": len(out), "candles": candles, "vwap": vwap,
            "or_high": round(max((b["high"] for b in bars[:OR_BARS]), default=0), 2),
            "or_low": round(min((b["low"] for b in bars[:OR_BARS]), default=0), 2),
            "trades": out, "basis": basis["median"], "basis_method": basis["method"], "symbol": "NQ=F"}
    _cache[key] = {"ts": now, "data": data}
    return data


@router.get("/smc-ifvg")
def get_smc_ifvg(
    date: str = Query(..., description="YYYY-MM-DD"),
    from_ist: str | None = Query(default=None, description="filter trades entered at/after HH:MM IST"),
    to_ist: str | None = Query(default=None, description="filter trades entered at/before HH:MM IST"),
    entries: str = Query(default="both", description="inv | retest | both — divided stacks or legacy coupled"),
    flip: float | None = Query(default=None, description="inv_flip_margin: strong inversions flip bias (experimental)"),
):
    """SMCIFVGEngine (trading/smc_ifvg.py) on real NQ ticks — tick-accurate fills, no lookahead."""
    key = f"smc-ifvg:{date}:{from_ist or ''}:{to_ist or ''}:{entries}:{flip}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < 3600:
        return _cache[key]["data"]
    try:
        from datetime import datetime
        from config import IST
        from trading.smc_ifvg import SMCIFVGEngine
        from scripts.smc_tick_eval import build_1m_bars
        from scripts.nq_ticks import fetch_nq_ticks
    except Exception as e:
        return {"date": date, "bars": [], "trades": [], "error": f"import failed: {e}"}
    try:
        ticks, basis = fetch_nq_ticks(date)
    except Exception as e:
        return {"date": date, "bars": [], "trades": [], "error": f"tick fetch failed: {e}"}
    bars = build_1m_bars(ticks)
    trades = SMCIFVGEngine(entries=entries, **({"inv_flip_margin": flip} if flip else {})).run(bars, ticks)
    out = []
    for t in trades:
        tin = datetime.fromtimestamp(t["t_in"] / 1000, tz=IST).strftime("%H:%M")
        if from_ist and tin < from_ist:
            continue
        if to_ist and tin > to_ist:
            continue
        # floor to containing 1m bar — lightweight-charts markers reject non-bar times
        out.append({
            "time": int(t["t_in"] // 60000) * 60, "exit_time": int(t["t_out"] // 60000) * 60,
            "side": t["side"], "kind": t["kind"], "entry": t["entry"], "sl": t["sl"],
            "tp": t["tp"], "exit": t["exit"], "result": t["result"], "pnl": t["pnl"], "rr": t["rr"],
        })
    data = {"date": date, "count": len(out), "bars": bars, "trades": out,
            "basis": basis["median"], "basis_method": basis["method"], "symbol": "NQ=F"}
    _cache[key] = {"ts": now, "data": data}
    return data
