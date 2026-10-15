"""Market specs for the TV-backed edge scanner (India + US).

Mirrors edge-scanner's session constants (scanner/timing.py, scanner/state.py
_RTH_OPEN_MIN/_RTH_CLOSE_MIN) but adds the NSE session. All session math uses
stdlib zoneinfo so there is no pytz dependency.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class MarketSpec:
    key: str                  # CLI key: 'india' | 'america'
    tv_market: str            # tradingview_screener set_markets() value
    tz_name: str              # IANA tz for the session clock
    open_min: int             # session open, minutes since midnight local
    close_min: int            # session close, minutes since midnight local
    currency: str             # display currency
    index_symbol: str         # benchmark for relative strength (TV name)
    yf_suffix: str = ""       # appended to bare symbols for yfinance history
    tv_prefix: str = ""       # exchange prefix seen in TV ticker fields

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.tz_name)

    def minutes_since_open(self, now: datetime | None = None) -> int | None:
        """Minutes elapsed since today's open, or None if outside session."""
        now = now or datetime.now(self.tz)
        local = now.astimezone(self.tz)
        mins = local.hour * 60 + local.minute
        if self.open_min <= mins < self.close_min:
            return mins - self.open_min
        return None

    def is_open(self, now: datetime | None = None) -> bool:
        return self.minutes_since_open(now) is not None


INDIA = MarketSpec(
    key="india",
    tv_market="india",
    tz_name="Asia/Kolkata",
    open_min=9 * 60 + 15,
    close_min=15 * 60 + 30,
    currency="INR",
    index_symbol="NIFTY",
    yf_suffix=".NS",
    tv_prefix="NSE:",
)

AMERICA = MarketSpec(
    key="america",
    tv_market="america",
    tz_name="America/New_York",
    open_min=9 * 60 + 30,
    close_min=16 * 60,
    currency="USD",
    index_symbol="SPY",
    yf_suffix="",
    tv_prefix="",
)

MARKETS: dict[str, MarketSpec] = {"india": INDIA, "america": AMERICA}


def resolve_markets(key: str) -> list[MarketSpec]:
    """Resolve CLI --market flag ('india' | 'america' | 'both')."""
    key = key.lower().strip()
    if key == "both":
        return [INDIA, AMERICA]
    if key in MARKETS:
        return [MARKETS[key]]
    raise ValueError(f"unknown market {key!r}; expected one of: india, america, both")


def to_yf_symbol(symbol: str, market: MarketSpec) -> str:
    """Map a bare scanner symbol to its yfinance ticker (NSE needs .NS)."""
    symbol = symbol.strip().upper()
    if market.yf_suffix and not symbol.endswith(market.yf_suffix):
        # Already-qualified tickers (e.g. 'RELIANCE.NS') pass through untouched.
        if "." not in symbol:
            return symbol + market.yf_suffix
    return symbol


def strip_tv_prefix(ticker: str, market: MarketSpec) -> str:
    """Turn a TV ticker ('NSE:RELIANCE') into a bare scanner symbol."""
    ticker = (ticker or "").strip().upper()
    if market.tv_prefix and ticker.startswith(market.tv_prefix):
        return ticker[len(market.tv_prefix):]
    if ":" in ticker:
        return ticker.split(":")[-1]
    return ticker


def normalize_symbol(symbol: str) -> str:
    """Bare-symbol normalizer shared by universe + feed (handles BAJAJ-AUTO)."""
    return (symbol or "").strip().upper().replace("-", "_")
