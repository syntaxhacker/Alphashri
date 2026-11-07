#!/usr/bin/env python3
"""Mid-cap / Small-cap India stock snapshot (TV scanner).

Universes by market cap (NSE):
  Mid-cap   : ₹5,000 cr – ₹20,000 cr
  Small-cap : < ₹5,000 cr

Outputs breadth, momentum/weakness lists, sector rotation, RSI flags.

Run:
    .venv/bin/python scripts/market/mid_smallcap_scan.py
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
now = dt.datetime.now(IST)

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)
pd.set_option("display.max_rows", 200)

print(f"INDIA MID / SMALL-CAP STOCK SNAPSHOT — {now:%a %d %b %Y %H:%M} IST\n")

MIDCAP_MIN = 5_000_000_000   # ₹5,000 cr
MIDCAP_MAX = 20_000_000_000  # ₹20,000 cr
SMALLCAP_MAX = 5_000_000_000 # ₹5,000 cr

STOCK_COLS = ["name", "description", "close", "change", "volume",
              "relative_volume_10d_calc", "market_cap_basic", "sector",
              "RSI", "ADX", "ATR", "EMA20", "EMA50", "SMA200",
              "price_52_week_high", "price_52_week_low", "gap", "Perf.W", "Perf.1M"]

def mcap_cr(df):
    return (df["market_cap_basic"] / 1e7).round(0)

def add_tech(df):
    df = df.copy()
    df["mcap_cr"] = mcap_cr(df)
    df["vs_sma20_pct"] = (df["close"] / df["EMA20"] - 1) * 100
    df["vs_sma200_pct"] = (df["close"] / df["SMA200"] - 1) * 100
    return df

def breadth(df, label):
    up = int((df["change"] > 0).sum())
    dn = len(df) - up
    print(f"\n{label} universe: {len(df)} stocks  |  BREADTH: {up} up / {dn} down  |  "
          f"avg {df['change'].mean():+.2f}%  |  median {df['change'].median():+.2f}%")
    return up, dn

def show_movers(df, label, n=15):
    print(f"\n-- {label} TOP MOMENTUM (gainers) --")
    print(df.sort_values("change", ascending=False)[
        ["sym", "close", "change", "volume", "relative_volume_10d_calc", "RSI", "ADX",
         "vs_sma20_pct", "vs_sma200_pct", "mcap_cr", "sector"]].head(n).to_string(index=False))

    print(f"\n-- {label} WEAKEST (losers) --")
    print(df.sort_values("change", ascending=True)[
        ["sym", "close", "change", "volume", "relative_volume_10d_calc", "RSI", "ADX",
         "vs_sma20_pct", "vs_sma200_pct", "mcap_cr", "sector"]].head(n).to_string(index=False))

def sector_rotation(df, label):
    print(f"\n=== SECTOR ROTATION — {label} (mcap-weighted change) ===")
    sec = df.dropna(subset=["sector", "change", "market_cap_basic"]).copy()
    sec["w"] = sec["market_cap_basic"] * sec["change"]
    rot = (sec.groupby("sector")
           .apply(lambda x: pd.Series({
               "n": len(x),
               "w_chg%": round(x["w"].sum() / x["market_cap_basic"].sum(), 2),
               "lead": x.loc[x["change"].idxmax(), "sym"],
               "lead%": round(x["change"].max(), 2),
               "lag": x.loc[x["change"].idxmin(), "sym"],
               "lag%": round(x["change"].min(), 2)}))
           .sort_values("w_chg%"))
    print(rot.to_string())

def rsi_flags(df, label):
    ob = df[(df["RSI"] > 70)].sort_values("RSI", ascending=False)
    os_ = df[(df["RSI"] < 30)].sort_values("RSI", ascending=True)
    print(f"\n-- {label} OVERBOUGHT (RSI>70): {len(ob)} --")
    print(ob[["sym", "close", "change", "RSI", "vs_sma20_pct", "mcap_cr", "sector"]]
          .head(10).to_string(index=False))
    print(f"-- {label} OVERSOLD (RSI<30): {len(os_)} --")
    print(os_[["sym", "close", "change", "RSI", "vs_sma20_pct", "mcap_cr", "sector"]]
          .head(10).to_string(index=False))

# ===========================================================================
# MID-CAP
# ===========================================================================
print("=" * 70)
print("MID-CAP STOCKS (₹5,000 – ₹20,000 cr mcap)")
print("=" * 70)
mid = scanner_frame("india", columns=STOCK_COLS,
                    filters=[
                        {"left": "market_cap_basic", "operation": "greater", "right": MIDCAP_MIN},
                        {"left": "market_cap_basic", "operation": "less", "right": MIDCAP_MAX},
                        {"left": "volume", "operation": "greater", "right": 100_000},
                    ],
                    sort="market_cap_basic", order="desc", limit=500)
mid = add_tech(mid.dropna(subset=["close", "change"]))
breadth(mid, "MID-CAP")
show_movers(mid, "MID-CAP")
sector_rotation(mid, "MID-CAP")
rsi_flags(mid, "MID-CAP")

# ===========================================================================
# SMALL-CAP
# ===========================================================================
print("\n\n" + "=" * 70)
print("SMALL-CAP STOCKS (<₹5,000 cr mcap)")
print("=" * 70)
small = scanner_frame("india", columns=STOCK_COLS,
                      filters=[
                          {"left": "market_cap_basic", "operation": "less", "right": SMALLCAP_MAX},
                          {"left": "volume", "operation": "greater", "right": 100_000},
                      ],
                      sort="market_cap_basic", order="desc", limit=500)
small = add_tech(small.dropna(subset=["close", "change"]))
breadth(small, "SMALL-CAP")
show_movers(small, "SMALL-CAP")
sector_rotation(small, "SMALL-CAP")
rsi_flags(small, "SMALL-CAP")

print("\nDone.")
