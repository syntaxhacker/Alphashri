#!/usr/bin/env python3
"""Earnings prints: estimate vs reported, market reaction, and forward calendar.

Prints three blocks:
  1. RECENT PRINTS  - every symbol whose last print landed inside the lookback window
                      (estimate, reported EPS, surprise %, day-1 reaction, 20d drift)
  2. REACTION TALLY - the "beat but sold" pattern: how often beats were punished
  3. FORWARD        - the next scheduled prints plus the options-implied move for each

Usage:
    python scripts/market/us_earnings.py --days 4
    python scripts/market/us_earnings.py --symbols TSLA,META,QCOM,ARM --implied
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import earnings_table, implied_move  # noqa: E402

WATCHLIST = [
    # megacaps
    "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "NFLX", "QCOM", "AMD",
    "INTC", "MU", "ORCL", "CRM", "ADBE", "PLTR", "NOW", "IBM", "TXN", "AMAT", "LRCX", "KLAC",
    "VRT", "ANET", "ARM", "TSM", "ASML", "DIS", "UBER", "SHOP", "COIN", "SBUX", "PFE", "MRK",
    "LLY", "JNJ", "XOM", "CVX", "WFC", "JPM", "GS", "BAC", "MS", "BLK", "SCHW", "HON", "GE",
    "RTX", "LMT", "SPGI", "V", "MA", "CAT", "APP", "COIN", "MSTR", "TMO", "ELV", "TDY", "CCI",
    "LUV", "UAL", "NEE", "HAL", "SCCO", "GPC", "WFRD", "WAB", "NOW",
]


def reaction(symbol: str, n_events: int = 12) -> dict[str, Any]:
    """Estimate vs reported + day-1 / 5d / 20d reaction for the last ``n_events`` prints."""
    import yfinance as yf

    out: dict[str, Any] = {"sym": symbol, "rows": []}
    try:
        t = yf.Ticker(symbol)
        ed = t.get_earnings_dates(limit=n_events)
        if ed is None or ed.empty:
            return out
        ed = ed.reset_index()
        ed["_d"] = pd.to_datetime(ed["Earnings Date"], errors="coerce", utc=True).dt.tz_localize(None)
        d = t.history(period="2y", interval="1d", auto_adjust=False).dropna(subset=["Close"])
        if d.empty:
            return out
        ret = d["Close"].pct_change() * 100
        for _, r in ed.iterrows():
            day = r["_d"].date()
            idx = d.index[d.index.date >= day]
            if not len(idx):
                continue
            i = d.index.get_loc(idx[0])
            if i == 0:
                continue
            out["rows"].append(
                {
                    "sym": symbol,
                    "print": idx[0].date(),
                    "est": r.get("EPS Estimate"),
                    "rep": r.get("Reported EPS"),
                    "surp%": r.get("Surprise(%)"),
                    "d1%": round(float(ret.iloc[i]), 2),
                    "d5%": round(float(d["Close"].iloc[min(i + 5, len(d) - 1)] / d["Close"].iloc[i] - 1) * 100, 2),
                    "d20%": round(float(d["Close"].iloc[min(i + 20, len(d) - 1)] / d["Close"].iloc[i] - 1) * 100, 2),
                }
            )
    except Exception:
        pass
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbols", help="comma-separated tickers (default: built-in watchlist)")
    ap.add_argument("--days", type=int, default=4, help="lookback window in days")
    ap.add_argument("--events", type=int, default=12, help="earnings events per symbol")
    ap.add_argument("--implied", action="store_true", help="also price the forward calendar")
    ap.add_argument("--forward-days", type=int, default=21, help="forward window for implied moves")
    args = ap.parse_args()

    symbols = ([s.strip().upper() for s in args.symbols.split(",") if s.strip()]
               if args.symbols else sorted(set(WATCHLIST)))
    cutoff = dt.date.today() - dt.timedelta(days=args.days)

    print(f"Fetching earnings history for {len(symbols)} symbols ...", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(lambda s: reaction(s, args.events), symbols))
    rows = [r for res in results for r in res["rows"]]

    df = pd.DataFrame(rows)
    if df.empty:
        print("no earnings history found", file=sys.stderr)
        return 1
    df["print"] = pd.to_datetime(df["print"]).dt.date
    for col in ("est", "rep", "surp%", "d1%", "d5%", "d20%"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    pd.set_option("display.width", 220)
    pd.set_option("display.max_rows", 300)
    recent = df[df["print"] >= cutoff].sort_values("print", ascending=False)
    print("\n" + "=" * 120)
    print(f"RECENT PRINTS (last {args.days} days)")
    print("=" * 120)
    print(recent.to_string(index=False))

    print("\n" + "=" * 120)
    print("REACTION TALLY — is the market paying for beats? (all history in the sample)")
    print("=" * 120)
    with_surp = df.dropna(subset=["surp%"])
    if not with_surp.empty:
        beats = with_surp[with_surp["surp%"] > 0]
        misses = with_surp[with_surp["surp%"] <= 0]
        print(f"prints with a reported EPS: {len(with_surp)}")
        print(f"  beat rate           : {(with_surp['surp%'] > 0).mean() * 100:.0f}%")
        print(f"  avg surprise        : {with_surp['surp%'].mean():+.2f}%")
        print(f"  BEATS  -> avg d1    : {beats['d1%'].mean():+.2f}%   avg d20 {beats['d20%'].mean():+.2f}%")
        print(f"  MISSES -> avg d1    : {misses['d1%'].mean():+.2f}%   avg d20 {misses['d20%'].mean():+.2f}%")
        print(f"  up on d1            : {(df['d1%'] > 0).mean() * 100:.0f}%   "
              f"up on d20 {((df['d20%'] > 0).mean() * 100):.0f}%")

    per_symbol = (df.groupby("sym")
                    .agg(prints=("surp%", "size"), beat_rate=("surp%", lambda s: (s.dropna() > 0).mean()),
                         avg_surp=("surp%", "mean"), avg_d1=("d1%", "mean"),
                         avg_d5=("d5%", "mean"), avg_d20=("d20%", "mean"))
                    .round(2)
                    .query("prints >= 4")
                    .sort_values("avg_d20", ascending=False))
    print("\n" + "=" * 120)
    print("PER-NAME POST-EARNINGS DRIFT (min 4 prints) — who actually gets paid")
    print("=" * 120)
    print(per_symbol.to_string())

    if args.implied:
        fwd = earnings_table(symbols, lookback_days=1)
        upcoming = fwd[fwd["date"] <= str(dt.date.today() + dt.timedelta(days=args.forward_days))]
        print("\n" + "=" * 120)
        print("FORWARD CALENDAR + OPTIONS-IMPLIED MOVE")
        print("=" * 120)
        with ThreadPoolExecutor(max_workers=8) as ex:
            imps = list(ex.map(lambda r: implied_move(r["sym"], r["date"], args.forward_days),
                               upcoming.to_dict("records")))
        imps = [i for i in imps if i]
        if imps:
            print(pd.DataFrame([i.as_row() for i in imps]).sort_values("event").to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
