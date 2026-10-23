#!/usr/bin/env python3
"""Correlation + beta matrix for a basket of tickers (6-month daily returns).

Used to check whether a new idea actually diversifies the book, or just adds
the same factor. The two numbers that matter:

  * corr vs <reference>  - >= 0.6 = same trade, < 0.2 = real diversification,
                           negative = genuine hedge
  * beta vs QQQ          - how much it moves per 1% of the index

Usage:
    python scripts/market/correlations.py --tickers MU,ARM,BMY,NEM --ref MU
    python scripts/market/correlations.py --tickers MU,ARM,AU,DLO,BMY,MDT
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def returns_matrix(tickers: list[str], period: str) -> pd.DataFrame:
    data = yf.download(tickers, period=period, interval="1d", auto_adjust=True,
                       progress=False, threads=True)
    close = data["Close"] if isinstance(data.columns, pd.MultiIndex) else data
    if isinstance(close, pd.Series):
        close = close.to_frame(tickers[0])
    return close.pct_change().dropna(how="all")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tickers", required=True, help="comma-separated list")
    ap.add_argument("--ref", default=None, help="reference ticker (default: first in list)")
    ap.add_argument("--bench", default="QQQ", help="benchmark for beta (default QQQ)")
    ap.add_argument("--period", default="6mo")
    args = ap.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    bench = args.bench.upper()
    ref = (args.ref or tickers[0]).upper()
    need = list(dict.fromkeys(tickers + [bench] + ([ref] if ref not in tickers else [])))

    rets = returns_matrix(need, args.period)
    missing = [t for t in need if t not in rets.columns]
    if missing:
        print(f"missing data (skipped): {', '.join(missing)}", file=sys.stderr)

    pd.set_option("display.width", 200)
    print(f"\n=== {args.period} daily-return correlations (reference = {ref}, benchmark = {bench}) ===")
    print(f"{'ticker':<8s}{'corr vs ref':>13s}{'corr vs bench':>15s}{'ann. vol':>10s}{'beta vs bench':>15s}")
    rows = []
    for t in tickers:
        if t not in rets.columns:
            continue
        r = rets[t].dropna()
        c_ref = rets[ref].corr(r) if ref in rets.columns else float("nan")
        c_bench = rets[bench].corr(r)
        vol = r.std() * np.sqrt(252) * 100
        var = rets[bench].var()
        beta = np.cov(r, rets[bench])[0, 1] / var if var else float("nan")
        rows.append({"ticker": t, "corr_ref": c_ref, "corr_bench": c_bench,
                     "ann_vol": vol, "beta": beta})
        print(f"{t:<8s}{c_ref:>13.2f}{c_bench:>15.2f}{vol:>9.1f}%{beta:>15.2f}")

    if rows:
        df = pd.DataFrame(rows)
        div = df[(df.corr_ref < 0.2) & (df.ticker != ref)]
        if not div.empty:
            print("\nbest diversifiers (corr < 0.20 to the reference):")
            for _, r in div.sort_values("corr_ref").iterrows():
                print(f"  {r.ticker:<6s} corr {r.corr_ref:+.2f}  beta {r.beta:+.2f}  vol {r.ann_vol:.0f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
