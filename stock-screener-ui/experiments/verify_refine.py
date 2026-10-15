"""Refinement: orb_proxy sl_pct x tp_pct grid on PRIORS only, lock best, eval W0 once.

Mirrors pattern_profit_week42.py orb_proxy branch exactly (same generator
class, same OR-range proxy, same finalize/simulate), only sl/tp vary.
Writes experiments/verify_refine.json
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import os
import sys
from pathlib import Path

EXP = Path(__file__).resolve().parent
sys.path.insert(0, str(EXP.parent))
spec = importlib.util.spec_from_file_location("pp42", EXP / "pattern_profit_week42.py")
pp42 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp42)

WM2 = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]
WM1 = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]
W0 = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]


def prepared(week):
    from chart_patterns.universes import get_universe

    data, _ = pp42.fetch_all(get_universe("nifty500"))
    prep = {}
    for sym, (df, last) in data.items():
        rows = pp42.bars_ist(df)
        bydate = {r["date"]: r for r in rows}
        if not all(d in bydate for d in week):
            continue
        hist = [r for r in rows if r["date"] < week[0]]
        if len(hist) < 60:
            continue
        prep[sym] = ([bydate[d] for d in week], hist)
    return prep


def orb_trades(prepared_map, sl_pct, tp_pct):
    from trading.orb_signals import ORBSignalGenerator
    from trading.orb_signals import SignalType

    gen = ORBSignalGenerator(sl_pct=sl_pct, tp_pct=tp_pct)
    trades = []
    for sym, (wb, hist) in prepared_map.items():
        allb = hist + wb
        base = len(hist)
        for k in range(len(wb) - 1):
            i = base + k
            prev = allb[i - 1]
            rng = prev["h"] - prev["l"]
            rng_pct = (rng / prev["c"] * 100) if prev["c"] else 0
            or_levels = {"or_high": prev["h"], "or_low": prev["l"],
                         "or_range": rng, "or_range_pct": rng_pct}
            sig = gen.check_breakout(sym, allb[i]["c"], or_levels)
            if sig is None or sig.signal_type != SignalType.LONG_ENTRY:
                continue
            t = pp42.finalize_signal("orb_proxy", sym, sig.notes, sig.price,
                                     sig.stop_loss, sig.take_profit, wb, k + 1)
            if t:
                trades.append(t)
    return trades


def main():
    pre2, pre1, pre0 = prepared(WM2), prepared(WM1), prepared(W0)
    print(f"usable W-2={len(pre2)} W-1={len(pre1)} W0={len(pre0)}", flush=True)
    grid = list(itertools.product([0.75, 1.0, 1.5], [1.0, 1.5, 2.0]))
    rows = []
    for sl, tp in grid:
        t2 = orb_trades(pre2, sl, tp)
        t1 = orb_trades(pre1, sl, tp)
        n = len(t2) + len(t1)
        net = sum(t["net"] for t in t2 + t1)
        m2, m1 = pp42.metrics(t2), pp42.metrics(t1)
        rows.append({"sl": sl, "tp": tp, "n_prior": n,
                     "net_prior": round(net, 2),
                     "w-2": {"n": m2["trades"], "net": m2["net_pnl"], "wr": m2["win_rate"]},
                     "w-1": {"n": m1["trades"], "net": m1["net_pnl"], "wr": m1["win_rate"]}})
        print(f"sl={sl} tp={tp}: priors n={n} net={net:.0f} "
              f"(W-2 {m2['net_pnl']:.0f} / W-1 {m1['net_pnl']:.0f})", flush=True)
    rows.sort(key=lambda r: r["net_prior"], reverse=True)
    best = rows[0]
    print("LOCKED:", best, flush=True)
    # sanity: baseline cell must reproduce crosscheck priors
    t0 = orb_trades(pre0, best["sl"], best["tp"])
    m0 = pp42.metrics(t0)
    locked = {"sl": best["sl"], "tp": best["tp"],
              "W0": {"n": m0["trades"], "net": m0["net_pnl"], "wr": m0["win_rate"],
                     "exp": m0["expectancy"], "pf": m0["profit_factor"]}}
    print("LOCKED on W0 (once):", locked, flush=True)
    json.dump({"grid": rows, "locked": locked}, open(EXP / "verify_refine.json", "w"), indent=1)


if __name__ == "__main__":
    main()
