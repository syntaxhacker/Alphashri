#!/usr/bin/env python3
"""Earnings-quality + relative-value scorecard for US large caps.

For every symbol it pulls:
  * fundamentals      (TradingView scanner): multiples, margins, growth, cash, dividend
  * earnings history  (Yahoo Finance): beat rate, average surprise, day-1 reaction,
                       post-print drift
  * peer context      : each name is bucketed, and its multiples/growth are compared
                       with the median of its own peer bucket

It then prints a ranked scorecard. Deliberately **no price/technical/gap inputs** --
this scores business quality, earnings quality and relative value only.

Usage:
    python scripts/market/us_scorecard.py
    python scripts/market/us_scorecard.py --symbols TSLA,META,QCOM,ARM
    python scripts/market/us_scorecard.py --peer-bucket "AI software" --top 20
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

FUND_COLUMNS = [
    "name", "description", "close", "market_cap_basic", "sector", "industry",
    "price_earnings_ttm", "price_sales_ratio", "price_book_fq",
    "total_revenue", "net_income", "free_cash_flow_ttm", "total_cash", "total_debt",
    "return_on_equity_fq", "gross_margin_ttm", "operating_margin_ttm",
    "total_revenue_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_ttm",
    "earnings_per_share_diluted_ttm", "dividends_yield_current",
]

PEERS: dict[str, list[str]] = {
    "AI semis / memory": ["NVDA", "AMD", "MU", "AVGO", "TSM", "INTC", "QCOM", "ARM", "MRVL",
                           "SWKS", "NXPI", "ADI", "TXN", "MCHP", "ON"],
    "Semicap equipment": ["LRCX", "AMAT", "KLAC", "TER", "ONTO", "AEIS", "CAMT", "FORM",
                          "ENTG", "ACMR", "ICHR"],
    "AI software": ["CRM", "ADBE", "PLTR", "NOW", "SNOW", "MDB", "AI", "APP", "PATH", "RBRK"],
    "Hyperscaler / platform": ["MSFT", "GOOGL", "AMZN", "META", "ORCL", "NFLX", "AAPL"],
    "AI hardware & infra": ["VRT", "ANET", "SMCI", "DELL", "HPE", "APH", "GLW", "COHR", "LITE"],
    "Financials": ["JPM", "GS", "BAC", "MS", "BLK", "SCHW", "WFC", "MA", "V", "SPGI"],
    "Health care": ["LLY", "JNJ", "PFE", "MRK", "ELV", "TMO", "ABT", "UNH", "ISRG"],
    "Industrials / defense": ["LMT", "RTX", "HON", "GE", "CAT", "ETN", "DE", "NOC"],
    "Energy": ["XOM", "CVX", "SLB", "OXY", "COP", "MPC"],
    "Consumer / travel": ["WMT", "COST", "SBUX", "UAL", "LUV", "DAL", "EXPE", "ABNB",
                           "BKNG", "NKE", "TMO"],
    "Comms / media": ["NFLX", "T", "VZ", "TMUS", "DIS", "CMCSA", "WBD", "LYV"],
    "REITs / infra": ["AMT", "CCI", "EQIX", "DLR", "SBAC", "PLD"],
}

DEFAULT_UNIVERSE = sorted({s for names in PEERS.values() for s in names})


def peer_of(symbol: str) -> str:
    for bucket, names in PEERS.items():
        if symbol in names:
            return bucket
    return "Other"


def fetch_fundamentals(symbols: Sequence[str]) -> pd.DataFrame:
    """Fundamentals for every symbol, from the TradingView scanner (2 batched calls)."""
    frames = []
    for i in range(0, len(symbols), 40):
        chunk = symbols[i:i + 40]
        tickers = []
        for s in chunk:
            tickers += [f"NASDAQ:{s}", f"NYSE:{s}"]
        df = scanner_frame("america", columns=FUND_COLUMNS, tickers=tickers, limit=120)
        if df.empty:
            continue
        df = df[df["sym"].isin(chunk)].sort_values("market_cap_basic", ascending=False)
        frames.append(df.drop_duplicates("sym", keep="first"))
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    out["mcap_bn"] = (out["market_cap_basic"] / 1e9).round(1)
    out["rev_bn"] = (out["total_revenue"] / 1e9).round(1)
    out["fcf_yield%"] = (out["free_cash_flow_ttm"] / out["market_cap_basic"] * 100).round(1)
    out["net_cash_bn"] = ((out["total_cash"] - out["total_debt"]) / 1e9).round(1)
    out["ey%"] = (100 / out["price_earnings_ttm"]).round(1)
    out["peer"] = out["sym"].map(peer_of)
    return out


def earnings_history(symbol: str, n_events: int = 8) -> dict[str, Any]:
    """Beat rate, average surprise, day-1 reaction and 20d drift over recent prints."""
    import yfinance as yf

    out: dict[str, Any] = {"sym": symbol, "n_events": 0, "beat_rate": np.nan,
                            "avg_surprise%": np.nan, "avg_day1%": np.nan,
                            "drift20d%": np.nan, "last_surprise%": np.nan}
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
        surprises, day1, drifts = [], [], []
        for _, r in ed.iterrows():
            if pd.notna(r.get("Surprise(%)")):
                surprises.append(float(r["Surprise(%)"]))
            day = r["_d"].date()
            idx = d.index[d.index.date >= day]
            if not len(idx):
                continue
            i = d.index.get_loc(idx[0])
            if i == 0:
                continue
            day1.append(float(ret.iloc[i]))
            if i + 20 < len(d):
                drifts.append(float(d["Close"].iloc[i + 20] / d["Close"].iloc[i] - 1) * 100)
        out["n_events"] = len(surprises)
        if surprises:
            out["avg_surprise%"] = round(float(np.mean(surprises)), 2)
            out["beat_rate"] = round(float(np.mean([s > 0 for s in surprises])), 2)
            out["last_surprise%"] = round(surprises[0], 2)
        if day1:
            out["avg_day1%"] = round(float(np.mean(day1)), 2)
        if drifts:
            out["drift20d%"] = round(float(np.mean(drifts)), 2)
    except Exception:
        pass
    return out


def build_scorecard(fund: pd.DataFrame, hist: pd.DataFrame) -> pd.DataFrame:
    """Merge fundamentals + earnings history and score business/earnings/relative value."""
    df = fund.merge(hist, on="sym", how="left")

    # peer-relative medians (per bucket)
    for col in ["price_earnings_ttm", "price_sales_ratio", "return_on_equity_fq",
                "total_revenue_yoy_growth_ttm", "fcf_yield%"]:
        df[f"peer_{col}"] = df.groupby("peer")[col].transform("median")
    df["pe_vs_peer"] = (df["price_earnings_ttm"] / df["peer_price_earnings_ttm"]).round(2)
    df["ps_vs_peer"] = (df["price_sales_ratio"] / df["peer_price_sales_ratio"]).round(2)
    df["roe_vs_peer"] = (df["return_on_equity_fq"] / df["peer_return_on_equity_fq"]).round(2)
    df["g_vs_peer"] = (df["total_revenue_yoy_growth_ttm"]
                       / df["peer_total_revenue_yoy_growth_ttm"]).round(2)

    # --- component scores (0-100 each) ---
    df["s_earnings"] = (
        (df["beat_rate"].fillna(0.5) * 30)
        + df["avg_surprise%"].fillna(0).clip(-10, 20) * 0.8
        + df["last_surprise%"].fillna(0).clip(-30, 30) * 0.4
    ).clip(0, 60)
    df["s_reaction"] = (
        df["avg_day1%"].fillna(0).clip(-8, 8) * 2.5
        + df["drift20d%"].fillna(0).clip(-20, 20) * 0.5
    ).clip(0, 30)
    df["s_value"] = (
        (1 / df["pe_vs_peer"].replace(0, np.nan)).fillna(0).clip(0, 2.5) * 12
        + (1 / df["ps_vs_peer"].replace(0, np.nan)).fillna(0).clip(0, 2.5) * 8
    ).clip(0, 30)
    df["s_quality"] = (
        df["roe_vs_peer"].fillna(1).clip(0, 3) * 8
        + df["gross_margin_ttm"].fillna(0).clip(0, 90) / 10
        + df["fcf_yield%"].fillna(0).clip(0, 12) * 0.8
        + df["net_cash_bn"].fillna(0).clip(0, 100) / 25
        + df["dividends_yield_current"].fillna(0).clip(0, 6) * 0.8
    ).clip(0, 40)
    df["s_growth"] = (
        df["g_vs_peer"].fillna(1).clip(0, 3) * 10
        + df["total_revenue_yoy_growth_ttm"].fillna(0).clip(-20, 80) / 8
    ).clip(0, 30)
    df["total_score"] = (df["s_earnings"] + df["s_reaction"] + df["s_value"]
                         + df["s_quality"] + df["s_growth"]).round(1)

    cols = ["sym", "peer", "mcap_bn", "rev_bn", "price_earnings_ttm", "pe_vs_peer",
            "price_sales_ratio", "ps_vs_peer", "ey%", "fcf_yield%", "net_cash_bn",
            "return_on_equity_fq", "roe_vs_peer", "gross_margin_ttm", "operating_margin_ttm",
            "total_revenue_yoy_growth_ttm", "g_vs_peer",
            "earnings_per_share_diluted_yoy_growth_ttm", "dividends_yield_current",
            "beat_rate", "avg_surprise%", "last_surprise%", "avg_day1%", "drift20d%",
            "s_earnings", "s_reaction", "s_value", "s_quality", "s_growth", "total_score"]
    return df[[c for c in cols if c in df.columns]]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbols", help="comma-separated tickers (default: full peer universe)")
    ap.add_argument("--peer-bucket", help="restrict output to one peer bucket")
    ap.add_argument("--top", type=int, default=30, help="how many rows to print")
    ap.add_argument("--events", type=int, default=8, help="earnings events per symbol")
    args = ap.parse_args()

    symbols = ([s.strip().upper() for s in args.symbols.split(",") if s.strip()]
               if args.symbols else DEFAULT_UNIVERSE)
    # Always pull the full peer universe: peer medians must be computed against the
    # whole bucket, otherwise a filtered run scores every name against itself.
    fetch = sorted(set(symbols) | set(DEFAULT_UNIVERSE)) if args.symbols else DEFAULT_UNIVERSE
    print(f"Fetching fundamentals for {len(fetch)} symbols ...", file=sys.stderr)
    fund = fetch_fundamentals(fetch)
    if fund.empty:
        print("no scanner data returned", file=sys.stderr)
        return 1

    print(f"Fetching earnings history ({args.events} events each) ...", file=sys.stderr)
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=10) as ex:
        hist = pd.DataFrame(list(ex.map(lambda s: earnings_history(s, args.events), fetch)))

    card = build_scorecard(fund, hist)
    if args.symbols:
        card = card[card["sym"].isin(symbols)]
    if args.peer_bucket:
        card = card[card["peer"] == args.peer_bucket]
    card = card.sort_values("total_score", ascending=False)

    pd.set_option("display.width", 300)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.max_rows", 300)
    print()
    print("=" * 250)
    print("US SCORECARD — business quality + earnings quality + relative value (no price/technical inputs)")
    print(f"built {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    print("=" * 250)
    print(card.head(args.top).to_string(index=False))
    print()
    print("components: s_earnings(60) s_reaction(30) s_value(30) s_quality(40) s_growth(30) -> total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
