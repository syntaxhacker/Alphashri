"""TradingView field sets and market constants.

One definition per field group; call sites compose the columns they need
instead of re-listing scanner fields.
"""

from __future__ import annotations

from typing import Iterable

#: Known scanner field drift: legacy/consumer spelling -> canonical TV field.
#:
#: Targets were checked against the TradingView stock-field catalogue and the
#: field sets already in use by ``api/market_screen`` and ``api/screener_api``:
#: ``price_book_fq`` (Price/Book MRQ), ``return_on_equity_fq`` (ROE FQ),
#: ``relative_volume_10d_calc`` (Relative Volume) and ``dividend_yield_recent``
#: (Dividend Yield Forward). The drifted keys are still emitted by older
#: consumers; this map lets a caller resolve them without rewriting every
#: consumer's field list at once. Missing names pass through unchanged.
FIELD_ALIASES: dict[str, str] = {
    "price_book_ratio": "price_book_fq",
    "return_on_equity": "return_on_equity_fq",
    "relative_volume": "relative_volume_10d_calc",
    "dividends_yield_current": "dividend_yield_recent",
}


def canonical_field(name: str) -> str:
    """Return the canonical TradingView field for a (possibly drifted) name.

    Matching is exact after stripping surrounding whitespace — TV field names
    are case-sensitive (``RSI``, ``Recommend.All``), so this never lowercases.
    Unknown names, including canonical ones, pass through unchanged.
    """
    text = str(name).strip() if name is not None else ""
    return FIELD_ALIASES.get(text, text)


def canonicalize_fields(names: Iterable[str]) -> list[str]:
    """Resolve an iterable of field names, preserving order and duplicates."""
    return [canonical_field(name) for name in names]


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
