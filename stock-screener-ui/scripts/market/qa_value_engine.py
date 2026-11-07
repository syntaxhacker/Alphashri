#!/usr/bin/env python3
"""QA: run the Deep Value scoring engine against the LIVE TradingView universe.

Uses the repo's own scanner client (scripts/market/tv_client.py) and the
production scoring module (api/value_scan/scoring.py + filters.py) so the
ranking can be sanity-checked against known names.

Run:
    .venv/bin/python scripts/market/qa_value_engine.py --market usa
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from market.tv_client import scanner_frame  # noqa: E402
from api.value_scan import filters as vf  # noqa: E402
from api.value_scan import scoring as vs  # noqa: E402

COLUMNS = [
    "name", "description", "type", "sector", "industry", "exchange", "currency",
    "close", "change", "volume", "relative_volume_10d_calc", "market_cap_basic",
    "total_revenue", "net_income", "total_debt", "free_cash_flow_ttm",
    "price_earnings_ttm", "price_sales_ratio", "price_book_fq",
    "return_on_equity_fq", "gross_margin_ttm", "operating_margin_ttm",
    "return_on_assets_fq", "debt_to_equity_fq", "current_ratio", "quick_ratio",
    "total_revenue_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_ttm",
    "earnings_per_share_diluted_ttm", "revenue_per_share_ttm",
    "dividends_yield_current", "SMA20", "SMA50", "SMA100", "SMA200", "EMA20", "EMA50",
    "RSI", "Recommend.All", "Recommend.MA", "ADX", "ATR", "beta_1_year", "Volatility.D",
    "Perf.W", "Perf.1M", "Perf.3M", "Perf.Y", "price_52_week_high", "price_52_week_low",
]

MARKETS = {
    "india": ("india", {"NSE", "BSE"}),
    "usa": ("america", {"NASDAQ", "NYSE", "AMEX"}),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", default="usa", choices=sorted(MARKETS))
    ap.add_argument("--preset", default="SERIOUS")
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--limit", type=int, default=1500)
    args = ap.parse_args()

    tv_market, exchanges = MARKETS[args.market]
    df = scanner_frame(
        tv_market,
        columns=COLUMNS,
        filters=[{"left": "market_cap_basic", "operation": "greater", "right": 1_000_000_000}],
        sort="market_cap_basic",
        order="desc",
        limit=args.limit,
    )
    if df.empty:
        print("empty frame", file=sys.stderr)
        return 1
    df = df[(df["type"] == "stock") & (df["exchange"].isin(exchanges))]
    rows = df.to_dict("records")
    print(f"frame: {len(rows)} names ({tv_market})", file=sys.stderr)

    peers = vs.peer_medians(rows)
    scored = []
    for r in rows:
        try:
            scored.append(vs.score_row(r, peers))
        except Exception as exc:  # noqa: BLE001
            print(f"score_row failed for {r.get('name')}: {exc}", file=sys.stderr)
    print(f"scored: {len(scored)}", file=sys.stderr)

    preset = vf.PRESETS[args.preset]
    kept = vf.apply_filters(scored, preset)
    kept.sort(key=lambda r: r.get("score", 0), reverse=True)

    out = pd.DataFrame([{
        "sym": r.get("sym") or r.get("name", "").split(":")[-1],
        "name": r.get("description", "")[:26],
        "exch": r.get("exchange"),
        "px": round(r["close"], 2) if r.get("close") is not None else None,
        "mcap_bn": round((r.get("market_cap_basic") or 0) / 1e9, 1),
        "pe": r.get("price_earnings_ttm"),
        "ps": r.get("price_sales_ratio"),
        "pb": r.get("price_book_fq"),
        "fcf%": r.get("derived", {}).get("fcf_yield"),
        "roe%": r.get("return_on_equity_fq"),
        "rev%": r.get("total_revenue_yoy_growth_ttm"),
        "eps%": r.get("earnings_per_share_diluted_yoy_growth_ttm"),
        "vs200%": r.get("derived", {}).get("vs_200dma"),
        "score": r.get("score"),
        "V": r.get("subscores", {}).get("value"),
        "Q": r.get("subscores", {}).get("quality"),
        "G": r.get("subscores", {}).get("growth"),
        "H": r.get("subscores", {}).get("health"),
        "bucket": r.get("peer", {}).get("bucket"),
        "flags": ",".join(r.get("flags", [])[:3]),
    } for r in kept[: args.top]])
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    print(f"\n=== {args.market.upper()} | preset {args.preset} | {len(kept)} of {len(scored)} passed ===")
    print(out.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
