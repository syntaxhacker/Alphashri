#!/usr/bin/env python
"""Price-to-book cycle for an NSE symbol.

The P/B cycle is what actually drives the big moves in Indian NBFC/PSU names
(IRFC traded 0.6x -> 5.6x -> 1.9x book in four years on flat earnings), so it
is worth reading next to the price legs.

Book value per share is not available from a free, script-friendly source
(stockanalysis blocks plain HTTP clients), so this script takes the quarterly
BVPS series you paste in and does the rest:

    date,bvps
    2026-09-30,46.39
    2026-06-30,43.46
    ...

Get it from the stockanalysis balance-sheet page (row "Book Value Per Share")
or from screener.in (shareholders' equity / shares), newest quarter first.

Usage:
    .venv/bin/python .prime/agent/skills/position-probability/scripts/pb_cycle.py \
        --symbol IRFC --bvps my_bvps.csv [--zigzag 30]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fetch_market_data as fmd  # noqa: E402
import lib_probability as lp  # noqa: E402


def load_bvps(path: str) -> pd.Series:
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    if not {"date", "bvps"} <= set(df.columns):
        raise SystemExit("bvps file needs columns: date,bvps")
    df["date"] = pd.to_datetime(df["date"])
    s = df.sort_values("date").set_index("date")["bvps"].astype(float)
    return s[~s.index.duplicated(keep="last")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--bvps", required=True, help="CSV with columns date,bvps")
    ap.add_argument("--from-date", default="2020-06-01")
    ap.add_argument("--zigzag", type=float, default=30.0)
    args = ap.parse_args()

    symbol = args.symbol.upper()
    bvps = load_bvps(args.bvps)

    px = fmd.upstox_daily(symbol, from_date=args.from_date)
    if px is None or px.empty:
        print(f"no Upstox data for {symbol}", file=sys.stderr)
        return 2
    session = fmd.upstox_intraday_session(symbol)
    if session:
        px = fmd.append_session(px, session)
    c = px["close"]

    def pb_at(ts):
        prior = bvps[bvps.index <= pd.Timestamp(ts).tz_localize(None)]
        return float(c.loc[:ts].iloc[-1] / prior.iloc[-1]) if len(prior) else None

    print(f"\n{symbol} — price / book cycle (price from Upstox, BVPS from {args.bvps})")
    print(f"latest: close {c.iloc[-1]:,.2f} | BVPS {bvps.iloc[-1]:,.2f} | P/B {pb_at(c.index[-1]):.2f}\n")

    legs = lp.swing_legs(lp.zigzag(c, args.zigzag), c)
    print(f"{'Leg':<6}{'From':<12}{'To':<12}{'Price from':>11}{'Price to':>11}{'Move':>9}"
          f"{'P/B from':>10}{'P/B to':>9}")
    for l in legs:
        p0, p1 = pb_at(l["start"]), pb_at(l["end"])
        print(f"{l['type']:<6}{str(l['start'].date()):<12}{str(l['end'].date()):<12}"
              f"{l['from']:>11,.2f}{l['to']:>11,.2f}{l['pct']:>8.1f}%"
              f"{(p0 or 0):>10.2f}{(p1 or 0):>9.2f}")

    print("\nYear-end P/B:")
    ye = c.resample("YE").last()
    for d in ye.index:
        pb = pb_at(d)
        print(f"  {d.year}: close {ye.loc[d]:>9,.2f}  P/B {pb:.2f}" if pb else f"  {d.year}: close {ye.loc[d]:>9,.2f}  P/B n/a")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
