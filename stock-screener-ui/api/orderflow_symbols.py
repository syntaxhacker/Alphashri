"""
Single source of truth for order-flow symbol mapping.

Every adapter (Upstox, Fyers, Fyers TBT) resolves symbols through this module so
an app-level symbol and a broker-level symbol can always be converted both ways.
The reverse direction matters as much as the forward one: the adapter hub routes
ticks to subscribers by broker symbol, and silently dropping the mapping is how
a feed ends up attributing another instrument's price to the wrong symbol.

Formats (verified against the brokers' own docs):

* Upstox — ``instrument_key``, ``SEGMENT|IDENTIFIER``::

      NSE_EQ|INE002A01018     # equity   -> ISIN
      NSE_INDEX|Nifty 50      # index    -> name
      NSE_FO|43919            # F&O      -> numeric exchange token

  Case is preserved: index names are case-sensitive and contain spaces.

* Fyers — ``EXCHANGE:SYMBOL-SUFFIX``::

      NSE:SBIN-EQ             # equity
      NSE:NIFTY50-INDEX       # index

  A bare name cannot be classified as equity vs index, so indices must be passed
  in already-qualified form (``NSE:NIFTY50-INDEX``).
"""

from typing import Optional

#: Exchanges we can build a Fyers symbol for.
_FYERS_EXCHANGES = frozenset({"NSE", "BSE", "MCX", "NFO", "BFO", "CDS"})

#: Canonical broker names that mean "plain Fyers data socket".
_FYERS_BROKERS = frozenset({"fyers"})
#: Canonical broker names that mean "Fyers 50-level TBT feed".
_FYERS_TBT_BROKERS = frozenset({"fyers_tbt"})


def normalize_symbol(symbol: Optional[str]) -> str:
    """Canonical app symbol: stripped and upper-cased.

    Instrument keys containing ``|`` keep their original case because Upstox
    index keys (``NSE_INDEX|Nifty 50``) are case-sensitive.
    """
    text = (symbol or "").strip()
    if "|" in text:
        return text
    return text.upper()


def is_fyers_broker(broker: Optional[str]) -> bool:
    """True for any Fyers-backed broker (``fyers`` or ``fyers_tbt``)."""
    name = (broker or "").strip().lower()
    return name in _FYERS_BROKERS or name in _FYERS_TBT_BROKERS


def fyers_symbol(symbol: str) -> str:
    """Map ``"RELIANCE"`` -> ``"NSE:RELIANCE-EQ"``; pass through ``NSE:...``.

    An already-qualified symbol (contains ``:``) is returned untouched so
    indices/futures keep their ``-INDEX`` / ``-FUT`` suffix.
    """
    text = normalize_symbol(symbol)
    if ":" in text:
        return text
    return f"NSE:{text}-EQ"


def upstox_symbol(symbol: str) -> str:
    """Upstox uses ``instrument_key`` verbatim (identity mapping)."""
    return normalize_symbol(symbol)


def to_broker_symbol(broker: Optional[str], symbol: str) -> str:
    """App symbol -> the broker's own symbol format."""
    name = (broker or "").strip().lower()
    if is_fyers_broker(name):
        return fyers_symbol(symbol)
    return upstox_symbol(symbol)


def from_broker_symbol(broker: Optional[str], broker_symbol: str) -> str:
    """Broker symbol -> app symbol (inverse of :func:`to_broker_symbol`).

    Unqualified input is returned as-is so callers never have to special-case a
    feed that already reports plain names.
    """
    name = (broker or "").strip().lower()
    text = (broker_symbol or "").strip()
    if not text:
        return ""
    if not is_fyers_broker(name):
        return normalize_symbol(text)
    if ":" not in text:
        return normalize_symbol(text)

    _, _, tail = text.partition(":")
    if tail.upper().endswith("-EQ"):
        tail = tail[: -len("-EQ")]
    return normalize_symbol(tail)


def is_qualified_fyers_symbol(symbol: str) -> bool:
    """True when ``symbol`` is already in ``EXCHANGE:...`` form."""
    text = (symbol or "").strip().upper()
    if ":" not in text:
        return False
    exchange = text.split(":", 1)[0]
    return exchange in _FYERS_EXCHANGES
