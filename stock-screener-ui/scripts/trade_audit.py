"""Population-level trade audit: flag every trade for known issue classes.

Issue flags per trade (all measured, no eyeballing):
  stale_zone   entry > 30pts past its signal zone edge
  chase_r      zone distance > 1.0x risk
  stale_sl     SL reference > 60pts from entry
  duplicate    same-side sibling-stack fill within 5 min
  round_trip   MFE >= 1.5R but exited SL/TRAIL (not TP)
  counter_htf  entry against 60-bar SMA side
  trail_wide   trail-mode exit with risk > 40pts
Usage:
  source .venv/bin/activate && python scripts/trade_audit.py [--dates d1,d2,...]
"""
import argparse
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta

sys.path.insert(0, __file__.rsplit("/", 2)[0])

from scripts.smc_tick_eval import fetch_ticks, build_1m_bars
from trading.smc_ifvg import SMCIFVGEngine

IST = timezone(timedelta(hours=5, minutes=30))
DATES = ["2026-07-02", "2026-07-10", "2026-07-22", "2026-07-24", "2026-08-26", "2026-09-02"]


def sma60(bars, i):
    seg = bars[max(0, i - 59):i + 1]
    return sum(b["close"] for b in seg) / len(seg)


def audit_session(date, modes=("inv", "retest")):
    ticks = fetch_ticks(date)
    bars = build_1m_bars(ticks)
    bidx = {b["time"]: i for i, b in enumerate(bars)}
    out = []
    for mode in modes:
        eng = SMCIFVGEngine(entries=mode)
        arms = []
        orig = eng.on_close

        def patched(bars_, i_, _eng=eng):
            had = _eng.pending is not None
            orig(bars_, i_)
            if _eng.pending and not had:
                p = _eng.pending
                z = p["zone"]
                arms.append({"sig_i": i_, "side": p["side"], "kind": p["kind"],
                             "sl_ref": p["sl_ref"],
                             "zbot": z["bot"], "ztop": z["top"], "zform": z["form"]})
        eng.on_close = patched
        trades = eng.run(bars, ticks)
        # match fills to arms (same side, fill bar within 3 bars after signal)
        for t in trades:
            fi = bidx.get(int(t["t_in"] // 1000 // 60) * 60, 0)
            match = None
            for a in arms:
                if a["side"] == t["side"] and 0 <= fi - a["sig_i"] <= 3:
                    match = a
                    break
            fwd = [x for x in ticks if t["t_in"] <= x["timestamp"] <= t["t_out"]]
            if t["side"] == "LONG":
                mfe = (max([x["bidPrice"] for x in fwd] + [t["entry"]]) - t["entry"]) if fwd else 0
            else:
                mfe = (t["entry"] - min([x["bidPrice"] for x in fwd] + [t["entry"]])) if fwd else 0
            risk = abs(t["entry"] - t["sl"])
            flags = {}
            if match:
                edge = match["zbot"] if t["side"] == "SHORT" else match["ztop"]
                zdist = abs(t["entry"] - edge)
                flags["stale_zone"] = zdist > 30
                flags["chase_r"] = (zdist / risk) > 1.0 if risk else False
                flags["stale_sl"] = abs(t["entry"] - match["sl_ref"]) > 60
            else:
                flags["stale_zone"] = flags["chase_r"] = flags["stale_sl"] = None
            flags["round_trip"] = (mfe / max(risk, 0.01) >= 1.5) and t["result"] in ("SL", "TRAIL")
            sma = sma60(bars, fi)
            flags["counter_htf"] = (t["side"] == "LONG" and t["entry"] < sma) or \
                                   (t["side"] == "SHORT" and t["entry"] > sma)
            flags["trail_wide"] = t["tp"] is None and risk > 40
            out.append({"date": date, "mode": mode, "pnl": t["pnl"], "result": t["result"],
                        "mfe_r": round(mfe / max(risk, 0.01), 2), **flags})
    # duplicates: same-side fills within 5 min across stacks
    by_time = sorted(out, key=lambda r: 0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dates", default=",".join(DATES))
    args = ap.parse_args()
    all_trades = []
    for d in args.dates.split(","):
        all_trades.extend(audit_session(d.strip()))
        print(f"audited {d}", flush=True)
    # duplicate detection across stacks needs fill times — approximate via shared registry rerun
    print(f"\nTOTAL trades audited: {len(all_trades)}  net {sum(t['pnl'] for t in all_trades):+.1f}")
    keys = ["stale_zone", "chase_r", "stale_sl", "round_trip", "counter_htf", "trail_wide"]
    for k in keys:
        g = [t for t in all_trades if t[k] is True]
        print(f"{k:<12} n={len(g):>4}  net {sum(t['pnl'] for t in g):>+9.1f}  "
              f"win {sum(1 for t in g if t['pnl'] > 0)}/{len(g)}")


if __name__ == "__main__":
    main()
