"""US symbol normalization for vendor-specific share-class notation."""

from __future__ import annotations

import re

_EXCHANGE_PREFIX = re.compile(r"^(NASDAQ|NYSE|AMEX)\s*:\s*", re.IGNORECASE)


class NormalizedSymbol(str):
    """Vendor-ready symbol; ``display_symbol`` keeps the caller's original."""

    __slots__ = ("display_symbol",)

    def __new__(cls, symbol: str, display_symbol: str) -> "NormalizedSymbol":
        obj = super().__new__(cls, symbol)
        obj.display_symbol = display_symbol
        return obj


def normalize_us_symbol(raw: str) -> NormalizedSymbol:
    """`BRK.B` -> `BRK-B`, `NASDAQ:aapl` -> `AAPL`.

    Yahoo (and most US vendors) use a dash for share classes, while screener
    rows use a dot. The original string is preserved for display/URLs.
    """
    if raw is None or not str(raw).strip():
        raise ValueError("empty US symbol")
    display = str(raw).strip()
    symbol = _EXCHANGE_PREFIX.sub("", display).strip().upper().replace(".", "-")
    if not symbol:
        raise ValueError("empty US symbol after exchange-prefix stripping")
    return NormalizedSymbol(symbol, display)
