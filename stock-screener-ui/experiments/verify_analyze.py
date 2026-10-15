"""Analysis: stability table, market benchmark, refinement on priors, EV, report.

Usage: .venv/bin/python experiments/verify_analyze.py [--refine STRATEGY]
Refinement grids (<=2 params, fit on W-2+W-1 pooled ONLY):
- P-* winner: (vol_ratio_gate in {none,1.2,1.5}) x (sl_scale in {0.75,1.0,1.5})
  sl_scale scales entry->pattern-stop distance; TP unchanged.
- I-* winner: indicator param x sl_mult. I-ADX: adx_thr {20,25,30} x sl {0.75,1.0,1.5}.
  I-EMA: ema pair fixed, adx prefilter on/off? -> use (vol gate {none,1.2,1.5}) x (sl {0.75,1.0,1.5}).
  I-RSI: rsi_thr {50,55,60} x sl {0.75,1.0,1.5}. I-ACC: range {6,8,10} x sl handled via TP mult {1.5,2.0,2.5}.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from experiments.verify_week42 import (  # noqa: E402
    CANDIDATES, NOTIONAL, WEEKS, load_frames, pick, run_trade, settle,
    truncate, week_bars,
)

TRADES_JSON = "experiments/verify_trades.json"
OUT_JSON = "experiments/pattern_verify_week42.json"
OUT_MD = "experiments/pattern_verify_week42.md"


def load_trades():
    with open(TRADES_JSON) as fh:
        return json.load(fh)


def table(trades):
    rows = {}
    for cid in CANDIDATES:
        for wk in list(WEEKS) + ["ALL"]:
            ts = [t for t in trades if t["strategy"] == cid and (wk == "ALL" or t["week"] == wk)]
            if not ts:
                continue
            nets = [t["net"] for t in ts]
            net = sum(nets)
            wins = [t for t in ts if t["net"] > 0]
            rows[f"{cid}/{wk}"] = {
                "n": len(ts), "net": round(net, 2),
                "mean": round(net / len(ts), 2),
                "winrate": round(len(wins) / len(ts), 3),
                "costs": round(sum(t["costs"] for t in ts), 2),
            }
    return rows


def benchmark():
    """Equal-weight Mon-open -> Fri-close across all symbols with data."""
    frames = load_frames()
    out = {}
    for wk, (sd, ws, we) in WEEKS.items():
        rets = []
        for sym, (st, df) in frames.items():
            if st != "ok":
                continue
            wb = week_bars(df, ws, we)
            if len(wb) < 2:
                continue
            o, c = float(wb.iloc[0]["open"]), float(wb.iloc[-1]["close"])
            if o > 0:
                rets.append((c - o) / o * 100)
        out[wk] = {"n": len(rets),
                   "mean_pct": round(statistics.fmean(rets), 3) if rets else None,
                   "median_pct": round(statistics.median(rets), 3) if rets else None,
                   "frac_up": round(sum(1 for r in rets if r > 0) / len(rets), 3) if rets else None}
    return out


def ci_str(ts):
    nets = [t["net"] for t in ts]
    n = len(nets)
    if n < 2:
        return f"n={n} (no CI)"
    m = statistics.fmean(nets)
    sd = statistics.pstdev(nets)
    hw = 1.96 * sd / math.sqrt(n)
    return f"{m:+.0f} ± {hw:.0f} (95% CI, n={n}, sd={sd:.0f})"


def kelly(ts):
    wins = [t["net"] for t in ts if t["net"] > 0]
    loss = [-t["net"] for t in ts if t["net"] <= 0]
    if not wins or not loss:
        return {"f_star": 0.0, "note": "one-sided sample"}
    p = len(wins) / len(ts)
    b = statistics.fmean(wins) / statistics.fmean(loss)
    f = p - (1 - p) / b if b > 0 else 0.0
    return {"f_star": round(max(0.0, f), 4), "capped_25": round(min(max(0.0, f), 0.25), 4),
            "p": round(p, 3), "b": round(b, 3),
            "avg_win": round(statistics.fmean(wins), 2),
            "avg_loss": round(-statistics.fmean(loss), 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pick-by", default="priors", choices=["priors", "W0"])
    a = ap.parse_args()
    trades = load_trades()
    rows = table(trades)
    bench = benchmark()
    print("== market benchmark (eq-weight Mon-open->Fri-close) ==")
    for k, v in bench.items():
        print(" ", k, v)
    print("== candidate x week ==")
    for k in sorted(rows):
        print(f"  {k}: n={rows[k]['n']} net={rows[k]['net']:+.0f} "
              f"mean={rows[k]['mean']:+.0f} wr={rows[k]['winrate']} costs={rows[k]['costs']:.0f}")
    key = "W0" if a.pick_by == "W0" else None
    pool = ([t for t in trades if t["week"] in ("W-2", "W-1")] if key is None
            else [t for t in trades if t["week"] == "W0"])
    scored = {}
    for cid in CANDIDATES:
        ts = [t for t in pool if t["strategy"] == cid]
        scored[cid] = (sum(t["net"] for t in ts), len(ts))
    top = max(scored, key=lambda c: scored[c][0])
    print(f"top-1 by {'W0' if key else 'priors-pooled'}: {top} {scored[top]}")
    print("full ranking:", sorted(((c, v) for c, v in scored.items()), key=lambda x: -x[1][0]))
    w0 = [t for t in trades if t["week"] == "W0" and t["strategy"] == top]
    print("top-1 W0 EV:", ci_str(w0), "kelly:", kelly(w0))
    json.dump({"rows": rows, "benchmark": bench,
               "top1": {"strategy": top, "pool_net": scored[top][0], "pool_n": scored[top][1]},
               "top1_W0_EV": ci_str(w0), "top1_W0_kelly": kelly(w0)},
              open("experiments/verify_summary.json", "w"), indent=1)


if __name__ == "__main__":
    main()
