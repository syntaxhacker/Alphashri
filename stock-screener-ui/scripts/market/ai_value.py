#!/usr/bin/env python3
"""Value screen over the AI complex (compute, memory, networking, power, software).

Ranks AI names on valuation + quality + growth, and (optionally) prints the
"expensive end" so the contrast is explicit.

Usage:
    python scripts/market/ai_value.py
    python scripts/market/ai_value.py --bucket "AI memory/HBM"
    python scripts/market/ai_value.py --pe-max 30 --min-mcap 5
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

BUCKETS: dict[str, list[str]] = {
    "AI accelerators": ["NVDA", "AMD", "AVGO", "MRVL", "ALAB", "CRDO", "SMCI", "DELL", "HPE", "SUPER"],
    "AI data centres": ["IREN", "CRWV", "CORZ", "CLSK", "NBIS", "APLD", "HUT", "GLXY", "EQIX", "DLR", "AMT", "CCI"],
    "AI interconnect": ["APH", "ANET", "VRT", "ETN", "PWR", "CEG", "VST", "TLN", "GEV", "BE", "OKLO",
                         "COHR", "LITE", "AAOI", "CLS", "FN", "HIMX"],
    "AI memory/HBM": ["MU", "SNDK", "WDC", "STX", "PSTG"],
    "AI foundry": ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "TER", "ACMR", "ARM", "QCOM", "NXPI",
                   "MCHP", "ADI", "TXN", "ON", "SWKS", "INTC"],
    "AI software": ["PLTR", "CRM", "NOW", "SNOW", "DDOG", "MDB", "AI", "APP", "SOUN", "TEM",
                    "HUBS", "MNDT", "RBRK", "NET", "ADBE", "NFLX", "ESTC", "PATH"],
}

COLUMNS = [
    "name", "description", "close", "change", "market_cap_basic", "sector", "industry",
    "price_earnings_ttm", "price_sales_ratio", "price_book_fq", "free_cash_flow_ttm",
    "total_cash", "total_debt", "total_revenue", "net_income",
    "return_on_equity_fq", "gross_margin_ttm", "operating_margin_ttm",
    "total_revenue_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_ttm",
    "dividends_yield_current", "relative_volume_10d_calc",
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bucket", help="only this bucket (see BUCKETS)")
    ap.add_argument("--pe-max", type=float, default=80, help="exclude P/E above this")
    ap.add_argument("--min-mcap", type=float, default=2, help="min market cap in $bn")
    ap.add_argument("--top", type=int, default=30)
    args = ap.parse_args()

    universe = BUCKETS.get(args.bucket) if args.bucket else sorted({s for v in BUCKETS.values() for s in v})
    if not universe:
        print(f"unknown bucket {args.bucket}", file=sys.stderr)
        return 1

    tickers = [f"NASDAQ:{s}" for s in universe] + [f"NYSE:{s}" for s in universe]
    df = scanner_frame("america", columns=COLUMNS, tickers=tickers, limit=200)
    if df.empty:
        print("no scanner data", file=sys.stderr)
        return 1
    df = df[df["sym"].isin(universe)].drop_duplicates("sym", keep="first")
    df["bucket"] = df["sym"].map({s: b for b, names in BUCKETS.items() for s in names})
    df["mcap_bn"] = (df["market_cap_basic"] / 1e9).round(1)
    df["rev_bn"] = (df["total_revenue"] / 1e9).round(1)
    df["fcf_y%"] = (df["free_cash_flow_ttm"] / df["market_cap_basic"] * 100).round(1)
    df["net_cash_bn"] = ((df["total_cash"] - df["total_debt"]) / 1e9).round(1)
    df["ey%"] = (100 / df["price_earnings_ttm"]).round(1)

    df["score"] = (
        df["ey%"].fillna(0).clip(0, 20)
        + df["fcf_y%"].fillna(0).clip(-15, 25) * 0.6
        + df["total_revenue_yoy_growth_ttm"].fillna(0).clip(-20, 80) / 4
        + df["return_on_equity_fq"].fillna(0).clip(0, 60) / 8
        - df["price_sales_ratio"].fillna(0).clip(0, 40) / 4
    )

    pd.set_option("display.width", 260)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.max_rows", 200)
    cols = ["sym", "bucket", "close", "mcap_bn", "rev_bn", "price_earnings_ttm", "ey%",
            "price_sales_ratio", "fcf_y%", "net_cash_bn", "return_on_equity_fq", "gross_margin_ttm",
            "total_revenue_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_ttm",
            "dividends_yield_current", "score"]
    print("\nAI COMPLEX — VALUE SCORE (valuation + quality + growth)")
    print(df.sort_values("score", ascending=False)[cols].head(args.top).to_string(index=False))
    print("\nEXPENSIVE END (highest P/S) — for contrast")
    print(df.sort_values("price_sales_ratio", ascending=False)[cols].head(12).to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
