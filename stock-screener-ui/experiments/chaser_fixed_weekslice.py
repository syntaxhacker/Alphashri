"""Last-week slice (Oct 5-9 2026) for FIXED 52W Chaser gates.

Signal date: mission says "Fri Oct 3 close" but 2026-10-03 is a Saturday
(2026-10-02 Gandhi Jayanti NSE holiday). Assumption: signal = last session
strictly before 2026-10-05 present in the frame (expected 2026-10-01).

Fixed-gate signal on signal date (mirrors Week52ChaserSignalGenerator with
enable_filters=True and canonical defaults CHASER_ADX_MIN=25, CHASER_RSI_HI=75,
CHASER_VOLUME_MULT=1.8, min_avg_volume=50000, band [0.5, 3.0]%):
  - high_52w = max high of up-to-252 sessions strictly before 2026-10-05
    (SAME window as chaser_outcome; includes the signal bar, so a signal is a
    breakout close above a high set before the signal date)
  - 0.5 <= (signal_close - high_52w)/high_52w*100 <= 3.0
  - ADX(signal) >= 25, RSI(signal) <= 75, vol(signal) >= 1.8*avg20 where
    avg20 = mean volume of 20 sessions before the signal bar (excludes the
    signal bar itself, mirroring the fixed backtest shift(1) baseline);
    avg20 >= 50000; NaN/missing vetoes (fail closed)
  - NO days_since/recent-touch gate: under daily-close semantics it degenerates
    (any band entry sets a new high -> days_since=0 -> veto-all, proven by a
    0-signal trial run); the nautilus backtest itself has no such check and
    chaser_outcome scenario-C (band-only) sets the precedent.

Trade: enter Oct-05 OPEN, qty = floor(100000/entry). Exit: 2% SL (chaser
default sl_pct) checked on daily lows Oct 05..09 (entry-day low counts since
entry is at the open) else Fri Oct-09 close. Costs via
backtest/costs.py:calculate_trading_costs (mirrors chaser_outcome math).

Universe: all_equity. Writes experiments/chaser_fixed_weekslice.json.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

OUT = Path("experiments/chaser_fixed_weekslice.json")
WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
FRIDAY = "2026-10-09"
CUT = "2026-10-05"
CAPITAL = 100_000.0
SL_PCT = 2.0
MIN_PCT, MAX_PCT = 0.5, 3.0
ADX_MIN, RSI_HI, VOL_MULT, MIN_AVG_VOL = 25.0, 75.0, 1.8, 50000.0


def save(obj):
    tmp = str(OUT) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, OUT)


def main():
    sys.path.insert(0, ".")
    import pandas as pd
    from chart_patterns.universes import get_universe
    from chart_patterns.candles import fetch_for_timeframe
    from trading.indicators import adx as _adx, rsi as _rsi
    from backtest.costs import calculate_trading_costs

    symbols = sorted(get_universe("all_equity"))
    print(f"universe={len(symbols)} week={WEEK[0]}..{WEEK[-1]}", flush=True)

    def to_ist_daily(df):
        out = df.copy()
        try:
            if out.index.tz is None:
                ist = out.index.tz_localize("UTC").tz_convert("Asia/Kolkata")
            else:
                ist = out.index.tz_convert("Asia/Kolkata")
        except Exception:
            ist = out.index
        out.index = ist
        out["session"] = ist.strftime("%Y-%m-%d")
        out = out.groupby("session", as_index=False).last()
        return out.set_index("session").sort_index()

    signals, no_data, friday_missing, no_entry = [], [], [], []
    for i, sym in enumerate(symbols):
        try:
            df = fetch_for_timeframe(sym, "1D")
        except Exception as e:
            no_data.append({"symbol": sym, "err": str(e)[:100]})
            continue
        if df is None or df.empty:
            no_data.append({"symbol": sym, "err": "empty"})
            continue
        d = to_ist_daily(df)
        prior = d[d.index < CUT]
        if len(prior) < 60:
            no_data.append({"symbol": sym, "err": f"only {len(prior)} prior bars"})
            continue
        if FRIDAY not in d.index or "2026-10-05" not in d.index:
            friday_missing.append(sym)
            continue
        sig_date = str(prior.index[-1])
        sig = prior.iloc[-1]
        strictly_before = prior.iloc[:-1]
        if len(strictly_before) < 20:
            no_data.append({"symbol": sym, "err": "no baseline"})
            continue
        # SAME 52W window as chaser_outcome: max high strictly before Oct 5
        # (includes the signal bar itself).
        high_52w = float(prior["high"].tail(252).max())
        sig_close = float(sig["close"])
        pct_above = (sig_close - high_52w) / high_52w * 100 if high_52w > 0 else -999
        avg20 = float(strictly_before["volume"].tail(20).mean())
        # causal indicators at signal bar
        close_s = prior["close"]
        try:
            rsi_s = _rsi(close_s)
            rsi_v = float(rsi_s.iloc[-1])
        except Exception:
            rsi_v = float("nan")
        try:
            adx_s = _adx(prior["high"], prior["low"], prior["close"])
            adx_v = float(adx_s.iloc[-1])
        except Exception:
            adx_v = float("nan")
        vol_v = float(sig["volume"])
        import math
        veto = None
        if not (avg20 >= MIN_AVG_VOL):
            veto = f"avg20 {avg20:.0f} < {MIN_AVG_VOL:.0f}"
        elif not (MIN_PCT <= pct_above <= MAX_PCT):
            veto = f"pct_above {pct_above:.2f}% outside [0.5,3.0]"
        elif rsi_v != rsi_v:
            veto = "rsi NaN"
        elif rsi_v > RSI_HI:
            veto = f"rsi {rsi_v:.1f} > 75"
        elif adx_v != adx_v:
            veto = "adx NaN"
        elif adx_v < ADX_MIN:
            veto = f"adx {adx_v:.1f} < 25"
        elif not (avg20 > 0) or vol_v != vol_v:
            veto = "volume NaN"
        elif vol_v < avg20 * VOL_MULT:
            veto = f"vol {vol_v:.0f} < 1.8x avg {avg20:.0f}"
        if veto is not None:
            continue
        entry = float(d.loc["2026-10-05"]["open"])
        if not (entry > 0):
            no_entry.append({"symbol": sym, "err": "bad Oct5 open"})
            continue
        qty = int(CAPITAL // entry)
        if qty <= 0:
            no_entry.append({"symbol": sym, "err": "qty 0"})
            continue
        sl = entry * (1 - SL_PCT / 100)
        exit_px, exit_day, stopped = None, None, False
        for s in WEEK:
            if float(d.loc[s]["low"]) <= sl:
                exit_px, exit_day, stopped = sl, s, True
                break
        if exit_px is None:
            exit_px, exit_day = float(d.loc[FRIDAY]["close"]), FRIDAY
        gross = (exit_px - entry) * qty
        costs = calculate_trading_costs(entry, exit_px, qty)["total_costs"]
        signals.append({
            "symbol": sym, "signal_date": sig_date,
            "high_52w_sig": round(high_52w, 2),
            "sig_close": round(sig_close, 2), "pct_above": round(pct_above, 3),
            "adx": round(adx_v, 2), "rsi": round(rsi_v, 2),
            "vol": int(vol_v), "avg20": round(avg20, 1),
            "vol_ratio": round(vol_v / avg20, 2),
            "entry_day": "2026-10-05", "entry": round(entry, 2), "qty": qty,
            "sl": round(sl, 2), "exit_day": exit_day,
            "exit": round(exit_px, 2), "stopped": stopped,
            "gross": round(gross, 2), "costs": costs,
            "net": round(gross - costs, 2),
        })
        print(f"[{i+1}/{len(symbols)}] SIGNAL {sym} sig={sig_date} "
              f"pct={pct_above:.2f}% adx={adx_v:.0f} rsi={rsi_v:.0f} "
              f"entry={entry:.2f} exit={exit_px:.2f} stopped={stopped}", flush=True)
        if (i + 1) % 200 == 0:
            print(f"... {i+1}/{len(symbols)} signals={len(signals)}", flush=True)

    signals.sort(key=lambda r: r["symbol"])
    trades = [s for s in signals if s.get("qty")]
    total = {"n": len(trades),
             "gross": round(sum(t["gross"] for t in trades), 2),
             "costs": round(sum(t["costs"] for t in trades), 2),
             "net": round(sum(t["net"] for t in trades), 2),
             "wins": sum(1 for t in trades if t["net"] > 0),
             "losses": sum(1 for t in trades if t["net"] <= 0),
             "stopped": sum(1 for t in trades if t["stopped"])}
    print(f"signals={len(signals)} total=" + json.dumps(total), flush=True)
    out = {"meta": {
        "week": WEEK, "universe": "all_equity", "universe_n": len(symbols),
        "signal_date_rule": "last session strictly before 2026-10-05 "
                            "(mission 'Fri Oct 3' is a Saturday; Oct 2 NSE holiday)",
        "gates": "fixed chaser gates: band [0.5,3.0]% vs 52W high (same window as "
                 "chaser_outcome), ADX>=25, RSI<=75, vol>=1.8x avg20 excl signal bar, "
                 "avg20>=50000, NaN fails closed; no recent-touch gate (see header)",
        "entry": "Oct-05 open", "exit": "2% SL on daily lows Oct05-09 else Oct-09 close",
        "capital_per_trade": CAPITAL, "costs": "backtest/costs.py:calculate_trading_costs",
        "generated_at": datetime.now().isoformat(),
        "no_data": no_data, "friday_missing": friday_missing, "no_entry": no_entry},
        "total": total, "signals": signals}
    save(out)
    print(f"wrote {OUT} signals={len(signals)}", flush=True)


if __name__ == "__main__":
    main()
