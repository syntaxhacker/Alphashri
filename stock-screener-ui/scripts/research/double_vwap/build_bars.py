#!/usr/bin/env python
"""Build 1-minute bars from the cached Dukascopy NQ-proxy ticks.

Source: experiments/data/duka_cache/usatechidxusd_YYYY-MM-DD.json (one file per
UTC day, 04:00Z -> 04:00Z). Bars are built from the MID quote so VWAP/targets
are side-neutral; the half-spread is charged separately by the backtest.

Output: experiments/data/duka_cache/usatechidxusd_1m.parquet
  index  t (UTC, minute floor)
  cols   o h l c vol ticks spread_pts

Usage:
  .venv/bin/python scripts/research/double_vwap/build_bars.py [--workers 4]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.path.join(ROOT, "experiments", "data", "duka_cache")
OUT = os.path.join(CACHE, "usatechidxusd_1m.parquet")


def one_file(path: str) -> pd.DataFrame:
    with open(path, "r") as fh:
        ticks = json.load(fh)
    if not ticks:
        return pd.DataFrame()
    ts = np.fromiter((t["timestamp"] for t in ticks), dtype=np.int64, count=len(ticks))
    bid = np.fromiter((t["bidPrice"] for t in ticks), dtype=np.float64, count=len(ticks))
    ask = np.fromiter((t["askPrice"] for t in ticks), dtype=np.float64, count=len(ticks))
    bv = np.fromiter((t.get("bidVolume") or 0.0 for t in ticks), dtype=np.float64, count=len(ticks))
    av = np.fromiter((t.get("askVolume") or 0.0 for t in ticks), dtype=np.float64, count=len(ticks))
    mid = (bid + ask) / 2.0
    ok = np.isfinite(mid) & (mid > 0)
    ts, mid, spread = ts[ok], mid[ok], (ask - bid)[ok]
    vol = (bv + av)[ok]

    order = np.argsort(ts, kind="stable")
    ts, mid, spread, vol = ts[order], mid[order], spread[order], vol[order]
    keep = np.concatenate([[True], np.diff(ts) > 0])
    ts, mid, spread, vol = ts[keep], mid[keep], spread[keep], vol[keep]

    minute = (ts // 60_000) * 60_000
    df = pd.DataFrame({"t": minute, "mid": mid, "vol": vol, "spread": spread})
    g = df.groupby("t", sort=True)
    bars = pd.DataFrame({
        "o": g["mid"].first(),
        "h": g["mid"].max(),
        "l": g["mid"].min(),
        "c": g["mid"].last(),
        "vol": g["vol"].sum(),
        "ticks": g.size(),
        "spread_pts": g["spread"].mean(),
    })
    bars.index = pd.to_datetime(bars.index, unit="ms", utc=True)
    return bars


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(CACHE, "usatechidxusd_*.json")))
    files = [f for f in files if "1m" not in os.path.basename(f)]
    if not files:
        print("no tick files found", file=sys.stderr)
        return 1
    print(f"{len(files)} tick files")

    t0 = time.time()
    frames = []
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for i, bars in enumerate(ex.map(one_file, files, chunksize=2), 1):
            if len(bars):
                frames.append(bars)
            if i % 20 == 0 or i == len(files):
                print(f"  {i}/{len(files)}  {time.time() - t0:.0f}s", flush=True)

    out = pd.concat(frames).sort_index()
    out = out[~out.index.duplicated(keep="first")]
    out = out[(out[["o", "h", "l", "c"]] > 0).all(axis=1)]
    out.to_parquet(OUT)
    print(f"wrote {OUT}  rows={len(out):,}  "
          f"{out.index.min()} -> {out.index.max()}  "
          f"median spread {out['spread_pts'].median():.2f} pts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
