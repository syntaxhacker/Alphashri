"""TradingView field sets and market constants.

One definition per field group; call sites compose the columns they need
instead of re-listing scanner fields.
"""

from __future__ import annotations

#: Scanner string columns (everything else is coerced to numeric).
TEXT_COLUMNS = {
    "name",
    "description",
    "type",
    "sector",
    "industry",
    "exchange",
    "country",
    "currency",
    "logoid",
    "update_mode",
}

#: Minimal price/liquidity frame.
PRICE_COLUMNS = [
    "name",
    "description",
    "close",
    "change",
    "volume",
    "relative_volume_10d_calc",
    "market_cap_basic",
    "update_mode",
]

#: Dashboard screener frame (exact current dashboard contract).
SCREENER_COLUMNS = [
    "name",
    "close",
    "change",
    "volume",
    "average_volume_10d_calc",
    "relative_volume_10d_calc",
    "market_cap_basic",
    "logoid",
    "gap",
    "price_52_week_high",
    "price_52_week_low",
    "ATR",
    "RSI",
    "VWAP",
    "high",
    "low",
    "Value.Traded",
    "sector",
    "industry",
]

#: Full fundamentals + technicals frame used by the Deep Value scan.
VALUE_COLUMNS = [
    "name", "description", "type", "sector", "industry", "exchange", "country",
    "currency", "close", "change", "open", "high", "low", "volume",
    "relative_volume_10d_calc", "market_cap_basic", "total_revenue",
    "net_income", "total_debt", "free_cash_flow_ttm", "price_earnings_ttm",
    "price_sales_ratio", "price_book_fq", "return_on_equity_fq",
    "gross_margin_ttm", "operating_margin_ttm", "return_on_assets_fq",
    "debt_to_equity_fq", "current_ratio", "quick_ratio",
    "total_revenue_yoy_growth_ttm",
    "earnings_per_share_diluted_yoy_growth_ttm",
    "earnings_per_share_diluted_ttm", "revenue_per_share_ttm",
    "dividends_yield_current", "SMA20", "SMA50", "SMA100", "SMA200",
    "EMA20", "EMA50", "RSI", "Recommend.All", "Recommend.MA", "ADX",
    "ATR", "beta_1_year", "Volatility.D", "Perf.W", "Perf.1M", "Perf.3M",
    "Perf.Y", "price_52_week_high", "price_52_week_low",
]

#: Numeric columns in the value frame.
NUMERIC_COLUMNS = [c for c in VALUE_COLUMNS if c not in TEXT_COLUMNS]

#: Fields used by frame_summary() to judge fundamentals completeness.
CORE_FIELDS = [
    "market_cap_basic", "price_earnings_ttm", "price_book_fq",
    "return_on_equity_fq", "free_cash_flow_ttm", "close",
]

#: Rotation period -> scanner field.
PERFORMANCE_FIELDS = {
    "1D": "change",
    "1W": "Perf.W",
    "1M": "Perf.1M",
    "3M": "Perf.3M",
    "6M": "Perf.6M",
    "YTD": "Perf.YTD",
    "1Y": "Perf.Y",
}

#: Reporting currency per market ("mixed" = per-row listing currency).
MARKET_CURRENCY: dict[str, str] = {
    "india": "INR",
    "usa": "USD",
    "global": "mixed",
}

#: Server-side market-cap pre-filter floors, in native units.
MCAP_FLOOR: dict[str, float] = {
    "india": 1e9,
    "usa": 2e9,
    "global": 1e9,
}

#: How many names a single request may pull back.
FRAME_LIMIT: dict[str, int] = {
    "india": 4000,
    "usa": 4000,
    "global": 12000,
}

#: Countries scanned for GLOBAL (there is no global STOCKS market).
GLOBAL_COUNTRIES = [
    "uk", "germany", "japan", "hongkong", "korea", "canada", "australia",
    "taiwan", "singapore", "france", "sweden", "spain", "italy",
    "netherlands", "switzerland", "brazil",
]

#: Allowed listing exchanges for the USA universe.
USA_EXCHANGES = {"NASDAQ", "NYSE", "AMEX"}

#: Domiciles excluded from GLOBAL (they belong to the USA tab).
NON_GLOBAL_COUNTRIES = {"united states"}

#: Preferred exchanges when deduping a multiply-listed global company.
EXCHANGE_PREFERENCE = [
    "NASDAQ", "NYSE", "AMEX", "LSE", "XETRA", "TSE", "TSX", "HKEX",
    "ASX", "EPA", "AMS", "SWX", "BME", "BIT", "KRX", "TWSE", "SGX",
]
