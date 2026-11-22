#!/usr/bin/env python
"""Out-of-sample check on 2023 NQ sessions (Dukascopy mirror, M1).

The live Dukascopy datafeed is blocked from this host (TCP timeout / WAF 403),
so this uses a public mirror of the same instrument id (`USATECHIDXUSD`, 1-minute,
2023-02-07 .. 2023-09-11) and runs the FROZEN configs with no retuning.

Caveat: the mirror has no real volume (Volume is a constant 1), so VWAP
degenerates to TWAP. Leg A never touches VWAP, so its test is clean; leg B is
reported as a TWAP-proxy result only.

  .venv/bin/python scripts/research/double_vwap/holdout_random_days.py [--sample 60]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S

OUT = os.path.join(S.OUTDIR, "holdout_2023.json")
DEFAULT_CSV = "/tmp/opencode/nqhold/USATECH_M1.csv"


def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", sep="\t")
    df.columns = [c.strip().lstrip("\ufeff").lower() for c in df.columns]
    t = pd.to_datetime(df["time"], utc=True)
    df = df.set_index(t).sort_index()
    df = df.rename(columns={"open": "o", "high": "h", "low": "l", "close": "c"})
    df["vol"] = df["volume"].astype(float) if "volume" in df else 1.0
    df = df[~df.index.duplicated(keep="last")]
    return df[["o", "h", "l", "c", "vol"]]


def describe(trades, n_days):
    if not trades:
        return dict(n=0, avgR=0.0, win=0.0, PF=0.0, t=0.0)
    R = np.array([t["R"] for t in trades], float)
    pos, neg = R[R > 0].sum(), R[R <= 0].sum()
    sd = R.std(ddof=1)
    return dict(n=int(len(R)), avgR=round(float(R.mean()), 4),
                win=round(100 * float((R > 0).mean()), 1),
                PF=round(float(pos / -neg), 2) if neg < 0 else 99.0,
                t=round(float(R.mean() / (sd / np.sqrt(len(R)) + 1e-12)), 2) if len(R) > 2 else 0.0,
                tpd=round(len(R) / max(n_days, 1), 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=DEFAULT_CSV)
    ap.add_argument("--sample", type=int, default=60,
                    help="random sessions to draw (0 = all eligible)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--cost", type=float, default=1.1)
    args = ap.parse_args()

    df = load_csv(args.csv)
    all_days = S.build_days(df)
    print(f"rows={len(df):,}  sessions={len(all_days)}  "
          f"{all_days[0].date} -> {all_days[-1].date}")

    rng = np.random.default_rng(args.seed)
    idx = np.arange(len(all_days))
    if args.sample and args.sample < len(all_days):
        pick = np.sort(rng.choice(idx, size=args.sample, replace=False))
        days = [all_days[i] for i in pick]
    else:
        days = all_days
    print(f"random sample: {len(days)} sessions (seed {args.seed}), "
          f"{days[0].date} -> {days[-1].date}")

    cfgs = {
        "A_or30_frozen": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                    stop_buf=30.0, target_a="rr1.75", sess_end=13 * 60),
        "A_on_frozen": S.base_cfg(range_src="on", legs="A", stop_src="sigext",
                                  stop_buf=30.0, target_a="rr1.75", sess_end=13 * 60),
        "A_or30_buf20": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                   stop_buf=20.0, target_a="rr1.75", sess_end=13 * 60),
        "A_or30_buf40": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                   stop_buf=40.0, target_a="rr1.75", sess_end=13 * 60),
        "A_or30_rr1.5": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                   stop_buf=30.0, target_a="rr1.5", sess_end=13 * 60),
        "A_or30_rr2": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                 stop_buf=30.0, target_a="rr2.0", sess_end=13 * 60),
        "B_on_twap_proxy": S.base_cfg(range_src="on", legs="B", stop_src="range",
                                      stop_buf=30.0, target_b="onvwap", sess_end=13 * 60),
        "AB_on": S.base_cfg(range_src="on", legs="AB", stop_src="range", stop_buf=30.0,
                            target_a="rr1.75", target_b="onvwap", sess_end=13 * 60),
    }

    rows = {}
    for name, cfg in cfgs.items():
        tr = S.collect(days, cfg, args.cost)
        rows[name] = describe(tr, len(days))
    print(f"\n{'config':18s} {'n':>4s} {'avgR':>7s} {'win':>5s} {'PF':>5s} {'t':>6s} {'/day':>5s}")
    for name, st in rows.items():
        print(f"{name:18s} {st['n']:4d} {st['avgR']:+7.3f} {st['win']:5.1f} "
              f"{st['PF']:5.2f} {st['t']:+6.2f} {st['tpd']:5.2f}")

    # confirm the frozen config still reproduces on the original 2026 cache
    base_df = S.load()
    base_days = S.build_days(base_df)
    base_tr = S.collect(base_days, cfgs["A_or30_frozen"], args.cost)
    base = describe(base_tr, len(base_days))
    print(f"\nreference (2026 cache): n={base['n']} avgR={base['avgR']:+.3f} "
          f"t={base['t']:+.2f}")

    out = dict(sample_sessions=len(days), seed=args.seed, cost=args.cost,
               period=[str(days[0].date), str(days[-1].date)],
               results=rows, reference_2026=base,
               caveat="mirror volume is constant 1 -> VWAP is a TWAP proxy; leg A does not use VWAP")
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())
