#!/usr/bin/env python3
"""STEP 0 — TradingView scanner field coverage per market.

Answers: which fundamental/technical columns does the public scanner actually
return for `india`, `america` and `global`? Everything downstream (the value
scoring engine) depends on this matrix.

Run:
    .venv/bin/python scripts/market/field_coverage.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import HEADERS, MARKETS  # noqa: E402

FIELDS = {
    "identity": ["name", "description", "type", "sector", "industry", "exchange", "currency"],
    "price": ["close", "change", "open", "high", "low", "volume", "relative_volume_10d_calc"],
    "size": ["market_cap_basic", "total_revenue", "net_income", "total_cash", "total_debt",
             "free_cash_flow_ttm", "total_cash_flow_ttm", "enterprise_value"],
    "valuation": ["price_earnings_ttm", "price_sales_ratio", "price_book_fq", "price_ebitda_ttm",
                  "price_enterprise_value_ebitda_ttm"],
    "profitability": ["return_on_equity_fq", "gross_margin_ttm", "operating_margin_ttm",
                      "return_on_assets_fq", "debt_to_equity_fq", "current_ratio", "quick_ratio"],
    "growth": ["total_revenue_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_ttm",
               "earnings_per_share_diluted_ttm", "revenue_per_share_ttm"],
    "shareholder": ["dividends_yield_current", "basic_average_shares", "price_target",
                    "analyst_rating", "total_analyst_opinions"],
    "trend": ["SMA20", "SMA50", "SMA100", "SMA200", "EMA20", "EMA50", "RSI", "Recommend.All",
              "Recommend.MA", "ADX", "ATR", "beta_1_year", "Volatility.D",
              "Perf.W", "Perf.1M", "Perf.3M", "Perf.Y", "price_52_week_high", "price_52_week_low"],
}

ALL_FIELDS = [f for group in FIELDS.values() for f in group]


def probe(market: str) -> dict[str, str]:
    """Return {field: 'ok'|'empty'|'null'} for one market."""
    url = MARKETS.get(market, "https://scanner.tradingview.com/{market}/scan").format(market=market)
    body = {
        "markets": [market],
        "symbols": {"tickers": [], "query": {"types": []}},
        "columns": ALL_FIELDS,
        "range": [0, 400],
        "ignore_unknown_fields": True,
    }
    resp = requests.post(url, json=body, headers=HEADERS, timeout=40)
    resp.raise_for_status()
    payload = resp.json()
    rows = payload.get("data", [])
    if not rows:
        return {f: "empty" for f in ALL_FIELDS}
    present = {f: 0 for f in ALL_FIELDS}
    non_null = {f: 0 for f in ALL_FIELDS}
    for row in rows:
        for field, value in zip(ALL_FIELDS, row.get("d", [])):
            if value is not None:
                present[field] += 1
                non_null[field] += 1
    total = len(rows)
    out = {}
    for field in ALL_FIELDS:
        if present[field] == 0:
            out[field] = "MISSING"
        elif non_null[field] == 0:
            out[field] = "all-null"
        elif non_null[field] / total < 0.25:
            out[field] = f"sparse({non_null[field]}/{total})"
        else:
            out[field] = "ok"
    return out


def main() -> int:
    results: dict[str, dict[str, str]] = {}
    for market in ("india", "america", "global"):
        try:
            results[market] = probe(market)
        except Exception as exc:  # noqa: BLE001 - report and continue
            results[market] = {f: f"ERROR {exc}" for f in ALL_FIELDS}
        print(f"probed {market}", file=sys.stderr)

    print("\n" + "=" * 118)
    print("TV SCANNER FIELD COVERAGE  (ok = present & mostly non-null | sparse = <25% non-null)")
    print("=" * 118)
    header = f"{'field':<48s} {'india':<22s} {'america':<22s} {'global':<22s}"
    print(header)
    print("-" * 118)
    for group, fields in FIELDS.items():
        print(f"-- {group}")
        for field in fields:
            cells = [results.get(m, {}).get(field, "-") for m in ("india", "america", "global")]
            print(f"   {field:<45s} {cells[0]:<22s} {cells[1]:<22s} {cells[2]:<22s}")

    print("\n" + "=" * 118)
    print("SUMMARY — usable columns per market (missing/all-null excluded)")
    print("=" * 118)
    for market in ("india", "america", "global"):
        usable = [f for f in ALL_FIELDS if results.get(market, {}).get(f) in ("ok",) or
                  str(results.get(market, {}).get(f, "")).startswith("sparse")]
        blocked = [f for f in ALL_FIELDS if results.get(market, {}).get(f) in ("MISSING", "all-null")]
        print(f"\n{market}: {len(usable)} usable, {len(blocked)} unusable")
        print(f"   usable  : {', '.join(usable)}")
        print(f"   blocked : {', '.join(blocked)}")

    out = Path(__file__).resolve().parent.parent / "docs" / "tv_field_coverage.json"
    out.write_text(json.dumps(results, indent=2))
    print(f"\nmatrix written to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
