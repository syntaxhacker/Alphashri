"""52W Chaser entry logic frozen at the last completed session as of 2026-10-03.

Freeze: Sat 2026-10-03 wall clock -> Fri 2026-10-02 was an NSE trading
holiday (Gandhi Jayanti, market_holidays table) -> last completed session
is Thu 2026-10-01 (verified via BOTH trading.calendar.last_completed_session
and chart_patterns.candles._last_completed_session).

Method (no-peek): every symbol's daily frame is fetched with
to_date=2026-10-01, then hard-sliced to IST date <= 2026-10-01 and asserted.
All indicators are computed on the sliced frame only; gate values are read
at the freeze bar (last row), mirroring
backtest/strategies/week52_chaser.py::_should_enter + _check_entry_filters.

Reads:  experiments/target_universe_symbols.json (227 symbols)
Writes: experiments/chaser_asof_progress.json (resume, tmp+replace)
        experiments/chaser_asof.json (final gate matrix + kill counts)
        experiments/chaser_asof.md  (report; written by --report step below)
"""

import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FREEZE = "2026-10-01"   # last completed session as of wall 2026-10-03
FROM = "2024-06-01"     # covers 252d lookback + MA200 + indicator warmup
ENTRY_THRESHOLD_PCT = 3.0  # Week52ChaserStrategy.get_params default + run_single default
# NOTE: Week52ChaserConfig (Nautilus) defaults entry_threshold_pct=2.0;
# distance_pct is recorded raw so either threshold is derivable; proximity_2pct included.

UNI = "experiments/target_universe_symbols.json"
PROG = "experiments/chaser_asof_progress.json"
OUT_JSON = "experiments/chaser_asof.json"


def save_prog(prog):
    tmp = PROG + ".tmp"
    with open(tmp, "w") as f:
        json.dump(prog, f, indent=1)
    os.replace(tmp, PROG)


def evaluate(symbol, api):
    """Mirror of _should_enter + _check_entry_filters at the freeze bar."""
    from market_data.market_data import fetch_candles_for_timeframe
    from trading.week52_utils import calculate_52w_high
    from trading.indicators import adx as _adx, rsi as _rsi
    import pandas as pd

    df = fetch_candles_for_timeframe(
        symbol, "1D", from_date=FROM, to_date=FREEZE, api_client=api)
    if df is None or df.empty:
        return {"symbol": symbol, "status": "no_data"}

    # ---- hard freeze slice (never peek past FREEZE) ----
    idx_ist = df.index.tz_convert("Asia/Kolkata")
    dates = idx_ist.date
    freeze_d = datetime.strptime(FREEZE, "%Y-%m-%d").date()
    mask = dates <= freeze_d
    if not mask.any():
        return {"symbol": symbol, "status": "no_data_through_freeze"}
    df = df[mask]
    idx_ist = idx_ist[mask]
    data_through = idx_ist[-1].strftime("%Y-%m-%d")
    # hard assertion: nothing beyond freeze
    assert all(d <= freeze_d for d in dates[mask]), f"PEEK {symbol}"

    n = len(df)
    close = float(df["close"].iloc[-1])
    vol = float(df["volume"].iloc[-1])
    highs = df["high"].astype(float).tolist()

    # ---- sufficiency gate (on_bar: len>=20 and 52w not None) ----
    high52w = calculate_52w_high(highs, period=252, exclude_current=True)
    if n < 20 or high52w is None:
        return {"symbol": symbol, "status": "insufficient_data",
                "n_bars": n, "data_through": data_through}

    # ---- proximity gate (_should_enter) ----
    dist = ((high52w - close) / close) * 100 if close else float("nan")
    prox_ok = bool(dist <= ENTRY_THRESHOLD_PCT)
    prox2_ok = bool(dist <= 2.0)

    # ---- filter gates (_check_entry_filters; NaN -> pass, mirrored exactly) ----
    adx_s = _adx(df["high"], df["low"], df["close"], 14)
    rsi_s = _rsi(df["close"], 14)
    ma50_s = df["close"].rolling(window=50).mean()
    ma200_s = df["close"].rolling(window=200).mean()
    volavg_s = df["volume"].rolling(window=20).mean()

    def f(x):
        v = float(x)
        return None if pd.isna(v) else v

    adx_v, rsi_v = f(adx_s.iloc[-1]), f(rsi_s.iloc[-1])
    ma50_v, ma200_v, volavg_v = f(ma50_s.iloc[-1]), f(ma200_s.iloc[-1]), f(volavg_s.iloc[-1])

    adx_ok = True if adx_v is None else bool(adx_v >= 25)
    rsi_ok = True if rsi_v is None else bool(50 <= rsi_v <= 70)
    vol_ok = True if (volavg_v is None) else bool(vol >= volavg_v * 1.5)
    ma50_ok = True if ma50_v is None else bool(close >= ma50_v)
    ma200_ok = True if ma200_v is None else bool(close >= ma200_v)
    ma_ok = bool(ma50_ok and ma200_ok)

    signal = bool(prox_ok and adx_ok and rsi_ok and vol_ok and ma_ok)
    stale = data_through != FREEZE

    return {
        "symbol": symbol, "status": "stale" if stale else "ok",
        "data_through": data_through, "n_bars": n,
        "close": round(close, 2), "high52w": round(float(high52w), 2),
        "dist_pct": round(float(dist), 3),
        "adx": None if adx_v is None else round(adx_v, 2),
        "rsi": None if rsi_v is None else round(rsi_v, 2),
        "ma50": None if ma50_v is None else round(ma50_v, 2),
        "ma200": None if ma200_v is None else round(ma200_v, 2),
        "vol": int(vol), "vol_avg20": None if volavg_v is None else int(volavg_v),
        "vol_ratio": None if volavg_v is None else round(vol / volavg_v, 3),
        "proximity_ok": prox_ok, "proximity_2pct_ok": prox2_ok,
        "adx_ok": adx_ok, "rsi_ok": rsi_ok, "vol_ok": vol_ok,
        "ma50_ok": ma50_ok, "ma200_ok": ma200_ok, "ma_ok": ma_ok,
        "signal": signal,
    }


def main():
    with open(UNI) as f:
        symbols = json.load(f)["symbols"]
    if os.path.exists(PROG):
        with open(PROG) as f:
            prog = json.load(f)
    else:
        prog = {"freeze": FREEZE, "threshold": ENTRY_THRESHOLD_PCT,
                "started_at": datetime.now().isoformat(), "rows": {}}
    rows = prog["rows"]
    todo = [s for s in symbols if s not in rows]
    print(f"universe={len(symbols)} done={len(rows)} todo={len(todo)} freeze={FREEZE}", flush=True)

    from market_data.market_data import get_api_client
    api = get_api_client()
    if api is None:
        print("FATAL: no Upstox API client", flush=True)
        sys.exit(1)

    for i, sym in enumerate(todo):
        try:
            rows[sym] = evaluate(sym, api)
        except Exception as e:
            rows[sym] = {"symbol": sym, "status": f"error: {e}"}
        if (i + 1) % 10 == 0 or (i + 1) == len(todo):
            save_prog(prog)
            ok = sum(1 for r in rows.values() if r.get("status") in ("ok", "stale"))
            sig = sum(1 for r in rows.values() if r.get("signal") is True)
            print(f"[{len(rows)}/{len(symbols)}] evaluated={ok} signals={sig} last={sym}", flush=True)
        time.sleep(0.25)

    save_prog(prog)

    # ---- kill attribution over fresh rows only ----
    fresh = [r for r in rows.values() if r.get("status") == "ok"]
    gates = ["proximity_ok", "adx_ok", "rsi_ok", "vol_ok", "ma_ok", "ma50_ok", "ma200_ok"]
    kills = {g: sum(1 for r in fresh if r.get(g) is False) for g in gates}
    overlap = {}
    for a in gates:
        for b in gates:
            if a != b:
                overlap[f"{a}_X_{b}"] = sum(
                    1 for r in fresh if r.get(a) is False and r.get(b) is False)
    # sequential funnel in chaser check order: proximity, adx, rsi, vol, ma
    funnel_order = ["proximity_ok", "adx_ok", "rsi_ok", "vol_ok", "ma_ok"]
    funnel, alive = {}, list(fresh)
    for g in funnel_order:
        killed = sum(1 for r in alive if r.get(g) is False)
        funnel[g] = {"alive_in": len(alive), "killed": killed}
        alive = [r for r in alive if r.get(g) is not False]
    funnel["signal_pass"] = len(alive)

    out = {
        "freeze": FREEZE,
        "wall_asof": "2026-10-03",
        "freeze_reason": "2026-10-03 is Saturday; 2026-10-02 Friday was NSE trading holiday "
                         "(Gandhi Jayanti, market_holidays); last completed session = 2026-10-01 "
                         "(trading.calendar + chart_patterns.candles agree)",
        "entry_threshold_pct": ENTRY_THRESHOLD_PCT,
        "entry_threshold_note": "backtest wrapper default 3.0 (get_params/run_single); "
                                "Nautilus Week52ChaserConfig defaults 2.0; proximity_2pct_ok recorded per symbol",
        "universe": len(symbols),
        "n_fresh": len(fresh),
        "n_stale": sum(1 for r in rows.values() if r.get("status") == "stale"),
        "n_bad": sum(1 for r in rows.values() if r.get("status") not in ("ok", "stale")),
        "n_signals": sum(1 for r in fresh if r.get("signal") is True),
        "pass_symbols": sorted(r["symbol"] for r in fresh if r.get("signal") is True),
        "kills": kills,
        "overlap": overlap,
        "funnel": funnel,
        "rows": [rows[s] for s in symbols if s in rows],
    }
    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1)
    os.replace(tmp, OUT_JSON)
    print(f"DONE fresh={len(fresh)} signals={out['n_signals']} kills={kills}", flush=True)


if __name__ == "__main__":
    main()
