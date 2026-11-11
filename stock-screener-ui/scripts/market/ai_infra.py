#!/usr/bin/env python3
"""AI-infrastructure panel: neoclouds, GPU miners, networking, power, REITs.

Neoclouds are the most levered expression of the AI-capex theme: they borrow to
buy GPUs and rent compute. They almost always have NEGATIVE free cash flow and
no P/E - so this panel shows FCF yield and debt instead, and never pretends a
low P/S means "cheap".

Usage:
    python scripts/market/ai_infra.py
    python scripts/market/ai_infra.py --group neoclouds
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

GROUPS: dict[str, list[str]] = {
    "neoclouds": ["CRWV", "NBIS", "IREN", "APLD", "CIFR", "HUT", "WULF", "CORZ", "GLXY", "BTDR",
                   "BTBT", "HIVE", "SLNH", "WYFI"],
    "networking": ["ANET", "CRDO", "ALAB", "MRVL", "AVGO", "CSCO", "CIEN", "LITE", "COHR", "FN"],
    "power": ["VRT", "GEV", "ETN", "PWR", "CEG", "VST", "TLN", "NRG", "OKLO", "BE", "NEE"],
    "storage": ["MU", "WDC", "SNDK", "STX", "PSTG", "NTAP"],
    "reits": ["EQIX", "DLR", "AMT", "CCI", "SBAC", "IRM"],
    "servers": ["SMCI", "DELL", "HPE"],
}

COLUMNS = ["name", "description", "close", "change", "market_cap_basic", "price_earnings_ttm",
           "price_sales_ratio", "total_revenue", "total_revenue_yoy_growth_ttm",
           "free_cash_flow_ttm", "total_debt", "return_on_equity_fq", "gross_margin_ttm",
           "SMA200", "RSI", "beta_1_year", "price_52_week_high", "Perf.1M", "Perf.3M",
           "average_volume_10d_calc"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--group", choices=sorted(GROUPS), help="only one group")
    ap.add_argument("--top", type=int, default=40)
    args = ap.parse_args()

    groups = {args.group: GROUPS[args.group]} if args.group else GROUPS
    universe = sorted({s for names in groups.values() for s in names})
    bucket = {s: g for g, names in groups.items() for s in names}

    df = scanner_frame("america", columns=COLUMNS,
                       tickers=[f"NASDAQ:{s}" for s in universe] + [f"NYSE:{s}" for s in universe],
                       limit=120)
    if df.empty:
        print("no scanner data", file=sys.stderr)
        return 1
    df = df[df["sym"].isin(universe)].drop_duplicates("sym", keep="first")
    df["group"] = df["sym"].map(bucket)
    df["mcap_bn"] = (df["market_cap_basic"] / 1e9).round(1)
    df["rev_bn"] = (df["total_revenue"] / 1e9).round(2)
    df["fcf_y%"] = (df["free_cash_flow_ttm"] / df["market_cap_basic"] * 100).round(1)
    df["off52%"] = ((df["close"] / df["price_52_week_high"] - 1) * 100).round(1)
    df["vs200%"] = ((df["close"] / df["SMA200"] - 1) * 100).round(1)
    df["$vol_m"] = ((df["average_volume_10d_calc"].fillna(df["volume"] if "volume" in df else 0)
                     * df["close"]) / 1e6).round(0)

    pd.set_option("display.width", 280)
    pd.set_option("display.max_columns", 40)
    df = df.sort_values(["group", "mcap_bn"], ascending=[True, False])
    cols = ["sym", "group", "mcap_bn", "close", "change", "rev_bn", "total_revenue_yoy_growth_ttm",
            "price_sales_ratio", "price_earnings_ttm", "fcf_y%", "total_debt", "off52%", "vs200%",
            "RSI", "beta_1_year", "Perf.1M", "Perf.3M", "$vol_m"]
    print("\n=== AI INFRASTRUCTURE PANEL (live) ===")
    print(df[cols].head(args.top).to_string(index=False))
    print("\nNOTE: neoclouds are usually unprofitable (P/E n/a) and cash-burning (FCF negative).")
    print("      A low P/S is NOT value here - check FCF and debt before calling anything cheap.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
