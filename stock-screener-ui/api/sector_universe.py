"""Canonical sector index/ETF universe shared by history and correlation APIs.

Each :class:`SectorDescriptor` is a frozen ``(display, upstox_key, yf_symbol)``
record.  The display name is the public/UI key; the Upstox instrument key is
the canonical exchange identifier (never derive it from the display name -- the
NSE names for ``NIFTY FIN_SERVICE`` and ``NIFTY CONSUMPTION`` differ from the
display aliases); ``yf_symbol`` is the yfinance fallback ticker.

``NIFTY_SECTOR_INDICES`` / ``US_SECTOR_ETFS`` are derived from the descriptors
so legacy consumers (``api/sector.py``) keep their exact tuple shape without
having to import this module.
"""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Dict, Optional, Tuple


@dataclass(frozen=True, slots=True)
class SectorDescriptor:
    """One tradable sector proxy: display name, Upstox key, yfinance symbol."""

    display: str
    upstox_key: Optional[str]
    yf_symbol: Optional[str]


NIFTY_SECTOR_DESCRIPTORS: Tuple[SectorDescriptor, ...] = (
    SectorDescriptor("NIFTY 50", "NSE_INDEX|Nifty 50", "^NSEI"),
    SectorDescriptor("NIFTY BANK", "NSE_INDEX|Nifty Bank", "^NSEBANK"),
    SectorDescriptor("NIFTY IT", "NSE_INDEX|Nifty IT", "^CNXIT"),
    SectorDescriptor("NIFTY FMCG", "NSE_INDEX|Nifty FMCG", "^CNXFMCG"),
    SectorDescriptor("NIFTY PHARMA", "NSE_INDEX|Nifty Pharma", "^CNXPHARMA"),
    SectorDescriptor("NIFTY AUTO", "NSE_INDEX|Nifty Auto", "^CNXAUTO"),
    SectorDescriptor("NIFTY ENERGY", "NSE_INDEX|Nifty Energy", "^CNXENERGY"),
    SectorDescriptor("NIFTY REALTY", "NSE_INDEX|Nifty Realty", "^CNXREALTY"),
    SectorDescriptor("NIFTY METAL", "NSE_INDEX|Nifty Metal", "^CNXMETAL"),
    # The display names are UI aliases; the NSE/Upstox instrument names are
    # "Nifty Consumption" and "Nifty Fin Service" (not the long-form aliases).
    SectorDescriptor("NIFTY CONSUMPTION", "NSE_INDEX|Nifty Consumption", "^CNXCONSUM"),
    SectorDescriptor("NIFTY FIN_SERVICE", "NSE_INDEX|Nifty Fin Service", "^CNXFIN"),
)

US_SECTOR_DESCRIPTORS: Tuple[SectorDescriptor, ...] = (
    SectorDescriptor("SPY", None, "SPY"),
    SectorDescriptor("XLK", None, "XLK"),
    SectorDescriptor("XLF", None, "XLF"),
    SectorDescriptor("XLE", None, "XLE"),
    SectorDescriptor("XLV", None, "XLV"),
    SectorDescriptor("XLY", None, "XLY"),
    SectorDescriptor("XLC", None, "XLC"),
    SectorDescriptor("XLI", None, "XLI"),
    SectorDescriptor("XLB", None, "XLB"),
    SectorDescriptor("XLU", None, "XLU"),
    SectorDescriptor("XLP", None, "XLP"),
)

DESCRIPTORS_BY_MARKET = MappingProxyType(
    {
        "india": NIFTY_SECTOR_DESCRIPTORS,
        "america": US_SECTOR_DESCRIPTORS,
    }
)

#: Explicit benchmark proxy per market. Never rely on list order.
BENCHMARK_BY_MARKET = MappingProxyType(
    {
        "india": "NIFTY 50",
        "america": "SPY",
    }
)

#: display -> yfinance fallback ticker.
YF_FALLBACK_BY_MARKET: Dict[str, Dict[str, str]] = {
    market: {
        descriptor.display: descriptor.yf_symbol
        for descriptor in descriptors
        if descriptor.yf_symbol
    }
    for market, descriptors in DESCRIPTORS_BY_MARKET.items()
}


def _legacy_pairs(descriptors: Tuple[SectorDescriptor, ...], field: str):
    pairs = []
    for descriptor in descriptors:
        value = getattr(descriptor, field)
        if value:
            pairs.append((descriptor.display, value))
    return pairs


# Legacy list shapes imported by api/sector.py and older tests/callers.
NIFTY_SECTOR_INDICES = _legacy_pairs(NIFTY_SECTOR_DESCRIPTORS, "upstox_key")
US_SECTOR_ETFS = _legacy_pairs(US_SECTOR_DESCRIPTORS, "yf_symbol")

#: Backwards-compatible alias used by api.sector_history before the split.
NIFTY_YF_FALLBACK = dict(YF_FALLBACK_BY_MARKET["india"])
