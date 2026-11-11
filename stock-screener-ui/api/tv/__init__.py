"""Single entry point for TradingView scanner access.

Import from :mod:`api.tv` only — auth, markets, columns, query execution and
symbol normalisation live here so call sites cannot drift apart.
"""

from .auth import (
    clear_tv_cookie_cache,
    get_tv_cookies,
    refresh_tv_cookies,
    tv_auth_status,
)
from .client import (
    HEADERS,
    MARKETS,
    REQUEST_TIMEOUT,
    SCANNER_URL,
    add_symbol,
    coerce_numeric,
    get_scanner_data,
    resolve_market,
    scan_frame,
    scan_raw,
)
from .columns import (
    CORE_FIELDS,
    EXCHANGE_PREFERENCE,
    FRAME_LIMIT,
    GLOBAL_COUNTRIES,
    MARKET_CURRENCY,
    MCAP_FLOOR,
    NON_GLOBAL_COUNTRIES,
    NUMERIC_COLUMNS,
    PERFORMANCE_FIELDS,
    PRICE_COLUMNS,
    SCREENER_COLUMNS,
    TEXT_COLUMNS,
    USA_EXCHANGES,
    VALUE_COLUMNS,
)
from .status import note_update_mode, tv_feed_status
from .symbols import normalize_tv_symbol, strip_tv_prefix, to_tv_ticker, tv_name_to_symbol

__all__ = [
    "HEADERS",
    "MARKETS",
    "REQUEST_TIMEOUT",
    "SCANNER_URL",
    "add_symbol",
    "coerce_numeric",
    "get_scanner_data",
    "resolve_market",
    "scan_frame",
    "scan_raw",
    "get_tv_cookies",
    "refresh_tv_cookies",
    "clear_tv_cookie_cache",
    "tv_auth_status",
    "note_update_mode",
    "tv_feed_status",
    "normalize_tv_symbol",
    "strip_tv_prefix",
    "to_tv_ticker",
    "tv_name_to_symbol",
    "VALUE_COLUMNS",
    "SCREENER_COLUMNS",
    "PRICE_COLUMNS",
    "TEXT_COLUMNS",
    "NUMERIC_COLUMNS",
    "CORE_FIELDS",
    "MARKET_CURRENCY",
    "MCAP_FLOOR",
    "FRAME_LIMIT",
    "GLOBAL_COUNTRIES",
    "USA_EXCHANGES",
    "EXCHANGE_PREFERENCE",
    "NON_GLOBAL_COUNTRIES",
    "PERFORMANCE_FIELDS",
]
