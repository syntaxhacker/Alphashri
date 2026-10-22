"""LRL + highest-TF iFVG prototype check on cached Dukascopy ticks.

Strategy (from user spec):
  1. LRL = 3-4 stacked highs/lows where a clean trendline fits (stacked stops, not yet swept)
     - LRL below -> SHORT into it, LRL above -> LONG into it
  2. Entry on highest-TF iFVG swept in that leg (30s < 1m < 2m < 3m, take highest)
  3. SL beyond swing high/low (+6 buf like smc_ifvg), TP fixed 1R
  4. Prime window 9:30-10:00am EST = 19:00-19:30 IST

Usage:
  .venv/bin/python scripts/lrl_ifvg_check.py --date 2026-09-02
  .venv/bin/python scripts/lrl_ifvg_check.py --matrix --window prime
"""
import argparse
import os
import sys
from datetime import timezone, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config  # noqa: E402
from scripts.smc_tick_eval import fetch_ticks  # cached, no download

IST = config.IST
CACHE_NOTE = "experiments/data/duka_cache"
TF_ORDER = ["30s", "1m", "2m", "3m"]
TF_SEC = {"30s": 30, "1m": 60, "2m": 120, "3m": 180}


from scripts.indicators import (  # noqa: E402  (shared indicator math)
    atr_range as atr,
    build_bars,
    detect_fvg,
    detect_lrl,
    swing_pivots,
)


def run_date(date, gap_min=2.0, sl_buf=6.0, window="prime", verbose=True):
    ticks = fetch_ticks(date)
    tf_bars = {tf: build_bars(ticks, s) for tf, s in TF_SEC.items()}
    base = tf_bars["1m"]
    # per-TF FVG stores + last inversion events
    fvg_store = {tf: [] for tf in TF_ORDER}
    # index maps: for each 1m bar time, find corresponding tf bar index
    # simpler: walk 1m clock, advance each TF pointer
    ptr = {tf: 0 for tf in TF_ORDER}
    last_inv = {tf: None for tf in TF_ORDER}  # (dir LONG/SHORT, age_base_idx)
    trades = []
    in_pos = None
    # tick buckets per 1m bar for fast SL-first eval
    from collections import defaultdict
    by_min = defaultdict(list)
    for t in ticks:
        by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)

    def ist_hm(ts_sec):
        return datetime.fromtimestamp(ts_sec, tz=timezone.utc).astimezone(IST).strftime("%H:%M")

    for i, b in enumerate(base):
        t = b["time"]
        hm = ist_hm(t)
        # advance TFs: process all tf bars with time <= t (per-TF gap: 30s needs smaller)
        tf_gap = {"30s": 1.0, "1m": gap_min, "2m": gap_min * 1.5, "3m": gap_min * 2.0}
        for tf in TF_ORDER:
            bars = tf_bars[tf]
            while ptr[tf] < len(bars) and bars[ptr[tf]]["time"] <= t:
                j = ptr[tf]
                f = detect_fvg(bars, j, tf_gap[tf])
                if f:
                    fvg_store[tf].append(f)
                # check inversions of stored fvgs at this tf close
                cl = bars[j]["close"]
                for f in fvg_store[tf]:
                    if f.get("inv"):
                        continue
                    if f["type"] == "bull" and cl < f["bot"]:
                        f["inv"] = True
                        f["inv_dir"] = "SHORT"
                        last_inv[tf] = {"dir": "SHORT", "at": i, "f": f}
                    elif f["type"] == "bear" and cl > f["top"]:
                        f["inv"] = True
                        f["inv_dir"] = "LONG"
                        last_inv[tf] = {"dir": "LONG", "at": i, "f": f}
                ptr[tf] += 1
        # manage open position on ticks of this minute (SL first, TP 1R)
        if in_pos:
            for tk in by_min.get(t, []):
                bid, ask = tk["bidPrice"], tk["askPrice"]
                p = in_pos
                if p["side"] == "SHORT":
                    if ask >= p["sl"]:
                        p.update(exit=ask, result="SL", t_out=tk["timestamp"]); break
                    if bid <= p["tp"]:
                        p.update(exit=bid, result="TP", t_out=tk["timestamp"]); break
                else:
                    if bid <= p["sl"]:
                        p.update(exit=bid, result="SL", t_out=tk["timestamp"]); break
                    if ask >= p["tp"]:
                        p.update(exit=ask, result="TP", t_out=tk["timestamp"]); break
            if "exit" in in_pos:
                p = in_pos
                pnl = (p["entry"] - p["exit"]) if p["side"] == "SHORT" else (p["exit"] - p["entry"])
                p["pnl"] = round(pnl, 2)
                p["rr"] = round(pnl / p["risk"], 2) if p["risk"] else 0
                trades.append(p)
                in_pos = None
                continue
            # give up after 90 min
            if i - in_pos["i_in"] > 90:
                last = by_min.get(t, [None])[-1]
                px = (last["bidPrice"] if in_pos["side"] == "SHORT" else last["askPrice"]) if last else b["close"]
                in_pos.update(exit=px, result="TIME", t_out=t * 1000)
                pnl = (in_pos["entry"] - px) if in_pos["side"] == "SHORT" else (px - in_pos["entry"])
                in_pos["pnl"] = round(pnl, 2)
                in_pos["rr"] = round(pnl / in_pos["risk"], 2) if in_pos["risk"] else 0
                trades.append(in_pos)
                in_pos = None
            continue
        # entry logic
        prime = "19:00" <= hm <= "19:30"
        if window == "prime" and not prime:
            continue
        lrl = detect_lrl(base, i)
        if not lrl:
            continue
        want = "SHORT" if lrl["dir"] == "below" else "LONG"
        # highest TF inversion agreeing with want (per-TF lookback in 1m bars)
        allow = {"30s": 5, "1m": 5, "2m": 8, "3m": 12}
        pick = None
        for tf in reversed(TF_ORDER):  # 3m first
            ev = last_inv[tf]
            if ev and ev["dir"] == want and i - ev["at"] <= allow[tf]:
                pick = tf
                break
        if not pick:
            continue
        # SL beyond recent swing (5-bar fractal each side, fallback signal bar edge)
        swing_hi = swing_lo = None
        for k in range(max(0, i - 10), i):
            if k >= 4:
                w = base[k - 2:k + 3] if k + 3 <= len(base) else []
                if len(w) == 5:
                    if all(w[2]["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
                        swing_hi = w[2]["high"] if swing_hi is None else max(swing_hi, w[2]["high"])
                    if all(w[2]["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
                        swing_lo = w[2]["low"] if swing_lo is None else min(swing_lo, w[2]["low"])
        if want == "SHORT":
            sl_ref = swing_hi if swing_hi else b["high"]
            sl = sl_ref + sl_buf
            # entry next tick ask/bid: use next minute first tick bid (short)
            nxt = by_min.get(base[i + 1]["time"] if i + 1 < len(base) else t, [])
            entry = nxt[0]["bidPrice"] if nxt else b["close"]
            if entry > sl:
                continue
            risk = sl - entry
            if risk < 5:
                continue
            tp = entry - risk  # 1R
        else:
            sl_ref = swing_lo if swing_lo else b["low"]
            sl = sl_ref - sl_buf
            nxt = by_min.get(base[i + 1]["time"] if i + 1 < len(base) else t, [])
            entry = nxt[0]["askPrice"] if nxt else b["close"]
            if entry < sl:
                continue
            risk = entry - sl
            if risk < 5:
                continue
            tp = entry + risk
        in_pos = {"side": want, "entry": entry, "sl": sl, "tp": tp, "risk": risk,
                  "i_in": i, "t_in": t, "hm": hm, "tf": pick,
                  "lrl": lrl["dir"], "touches": lrl["touches"], "target": round(lrl["target"], 1)}
    if verbose:
        print(f"\n=== {date} window={window} — {len(base)} 1m bars — {len(trades)} LRL-iFVG trades ===")
        for tr in trades:
            print(f"  {tr['hm']} {tr['side']:<5} via {tr['tf']:<3} LRL-{tr['lrl']}x{tr['touches']} "
                  f"entry {tr['entry']:.1f} SL {tr['sl']:.1f} TP {tr['tp']:.1f} "
                  f"-> {tr['result']:<4} {tr['pnl']:+.1f} ({tr['rr']:+.2f}R)")
    return trades


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="2026-09-02")
    ap.add_argument("--matrix", action="store_true")
    ap.add_argument("--window", default="prime", choices=["prime", "all"])
    ap.add_argument("--dates", default="2026-09-02,2026-09-03,2026-09-04,2026-09-07,2026-09-08,2026-09-09")
    args = ap.parse_args()
    if args.matrix:
        tot, wn = [], 0
        for d in [x.strip() for x in args.dates.split(",")]:
            try:
                trs = run_date(d, window=args.window, verbose=True)
            except Exception as e:
                print(f"{d} SKIPPED: {e}")
                continue
            tot.extend(trs)
        n = len(tot)
        net = sum(t["pnl"] for t in tot)
        w = sum(1 for t in tot if t["pnl"] > 0)
        tps = sum(1 for t in tot if t["result"] == "TP")
        print(f"\nTOTAL window={args.window} {n} trades net {net:+.1f} win {w}/{n} TP {tps}/{n} "
              f"avg {net/max(1,n):+.2f}/trade (TP=+1R, SL=-1R by construction)")
    else:
        run_date(args.date, window=args.window)


if __name__ == "__main__":
    main()
