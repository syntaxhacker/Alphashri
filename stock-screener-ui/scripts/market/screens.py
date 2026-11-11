#!/usr/bin/env python3
"""The three composite screens used for the "seriously undervalued" work.

Modes
-----
quality      (default) quality-at-a-discount: cheap + profitable + growing +
             decent trend. Optional --universe sp500 (mcap >= $15bn proxy).
ai-resilient AI-proof value: excludes industries where generative AI is a direct
             substitute (software, IT services, content, staffing...), then ranks
             the physical/regulated/patent-protected survivors.
tradable     liquid + volatile + sold off: high $ volume, high ATR, deep drawdown,
             still cheap. This is the "moves good" screen.

All modes score with percentiles so the ranking is relative to the frame, not to
absolute thresholds (absolute P/E gates do not travel across markets or regimes).

Usage:
    python scripts/market/screens.py --mode quality --top 20
    python scripts/market/screens.py --mode quality --universe sp500
    python scripts/market/screens.py --mode ai-resilient
    python scripts/market/screens.py --mode tradable
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

# Industries where generative AI is a direct substitute for the work itself.
AI_FRAGILE = {
    "Packaged Software", "Internet Software/Services", "Information Technology Services",
    "Financial Publishing/Services", "Miscellaneous Commercial Services",
    "Data Processing Services", "Internet Retail", "Advertising/Marketing Services",
    "Personnel Services", "Publishing: Books/Magazines",
}


def _pct(series: pd.Series, invert: bool = False) -> pd.Series:
    p = series.rank(pct=True, na_option="keep")
    return 1 - p if invert else p


def build() -> pd.DataFrame:
    """One scanner request, flattened into the columns every mode needs."""
    df = scanner_frame("america", columns=[
        "name", "description", "type", "exchange", "industry", "sector", "close", "change", "volume",
        "average_volume_10d_calc", "market_cap_basic", "price_earnings_ttm",
        "price_sales_ratio", "price_book_fq", "free_cash_flow_ttm", "total_debt",
        "return_on_equity_fq", "gross_margin_ttm", "operating_margin_ttm",
        "total_revenue", "total_revenue_yoy_growth_ttm",
        "earnings_per_share_diluted_yoy_growth_ttm", "dividends_yield_current",
        "SMA200", "ATR", "RSI", "beta_1_year", "price_52_week_high",
        "Perf.1M", "Perf.3M",
    ], filters=[{"left": "market_cap_basic", "operation": "greater", "right": 1_000_000_000}],
        sort="market_cap_basic", limit=4000)
    if "type" in df:
        df = df[df["type"].eq("stock")]
    if "exchange" in df:
        # the `america` market also carries OTC/foreign listings; keep the US venues
        df = df[df["exchange"].isin({"NASDAQ", "NYSE", "AMEX"})]
    df["mcap_bn"] = df["market_cap_basic"] / 1e9
    df["fcf_y"] = df["free_cash_flow_ttm"] / df["market_cap_basic"] * 100
    df["off52"] = (df["close"] / df["price_52_week_high"] - 1) * 100
    df["vs200"] = (df["close"] / df["SMA200"] - 1) * 100
    df["atr_pct"] = df["ATR"] / df["close"] * 100
    df["dollar_vol_m"] = (df["average_volume_10d_calc"].fillna(df["volume"]) * df["close"]) / 1e6
    df["rev_w"] = df["total_revenue_yoy_growth_ttm"].clip(-50, 100)
    df["eps_w"] = df["earnings_per_share_diluted_yoy_growth_ttm"].clip(-50, 100)
    df["ai_fragile"] = df["industry"].isin(AI_FRAGILE)
    return df


def score(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["q"] = np.nanmean(np.vstack([
        _pct(df["return_on_equity_fq"]), _pct(df["fcf_y"]),
        _pct(df["gross_margin_ttm"].fillna(df["gross_margin_ttm"].median())),
        _pct(df["rev_w"]), _pct(df["eps_w"]),
    ]), axis=0)
    df["combo"] = (df["q"] * 0.45 + _pct(df["price_earnings_ttm"], invert=True) * 0.25
                   + _pct(df["off52"], invert=True) * 0.15 + _pct(df["vs200"]) * 0.15).round(3)
    return df


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", default="quality", choices=["quality", "ai-resilient", "tradable"])
    ap.add_argument("--universe", default="all", choices=["all", "sp500"])
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--max-price", type=float, default=0, help="optional price cap (0 = none)")
    args = ap.parse_args()

    df = score(build())
    if args.universe == "sp500":
        df = df[df["mcap_bn"] >= 15]          # S&P 500 proxy: >$15bn
    if args.max_price:
        df = df[df["close"] <= args.max_price]

    if args.mode == "quality":
        c = df[(df["price_earnings_ttm"] > 0) & (df["price_earnings_ttm"] < 40) & df["return_on_equity_fq"].notna()]
        c = c.sort_values("combo", ascending=False)
        cols = ["sym", "industry", "close", "mcap_bn", "beta_1_year", "price_earnings_ttm",
                "return_on_equity_fq", "fcf_y", "total_revenue_yoy_growth_ttm",
                "dividends_yield_current", "off52", "vs200", "combo"]
        title = f"QUALITY-AT-A-DISCOUNT ({args.universe})"
    elif args.mode == "ai-resilient":
        c = df[(~df["ai_fragile"]) & (df["mcap_bn"] >= 15)
               & (df["price_earnings_ttm"] > 3) & (df["price_earnings_ttm"] < 25)
               & (df["return_on_equity_fq"] > 12) & (df["fcf_y"] > 3)
               & (df["total_revenue_yoy_growth_ttm"] > 0) & (df["vs200"] > 0)]
        c = c.sort_values("combo", ascending=False)
        cols = ["sym", "industry", "close", "price_earnings_ttm", "return_on_equity_fq", "fcf_y",
                "total_revenue_yoy_growth_ttm", "dividends_yield_current", "off52", "vs200",
                "beta_1_year", "combo"]
        title = "AI-RESILIENT VALUE (AI-fragile industries excluded)"
    else:
        c = df[(df["close"] <= (args.max_price or 420)) & (df["dollar_vol_m"] >= 50)
               & (df["beta_1_year"] >= 1.3) & (df["atr_pct"] >= 3)
               & (df["price_earnings_ttm"] > 0) & (df["price_earnings_ttm"] < 25)
               & (df["return_on_equity_fq"] > 10) & (df["fcf_y"] > 0) & (df["off52"] <= -25)]
        c["trade"] = (_pct(c["dollar_vol_m"]) * 0.30 + _pct(c["atr_pct"]) * 0.30
                      + _pct(c["off52"], invert=True) * 0.20
                      + _pct(c["price_earnings_ttm"], invert=True) * 0.20).round(3)
        c = c.sort_values("trade", ascending=False)
        cols = ["sym", "industry", "close", "beta_1_year", "atr_pct", "dollar_vol_m",
                "price_earnings_ttm", "return_on_equity_fq", "fcf_y", "off52", "vs200",
                "Perf.1M", "RSI", "trade"]
        title = "TRADABLE: LIQUID + VOLATILE + SOLD OFF"

    pd.set_option("display.width", 300)
    pd.set_option("display.max_columns", 40)
    print(f"\n=== {title} — {len(c)} names ===")
    print(c[cols].head(args.top).to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
