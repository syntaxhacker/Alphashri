
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


@dataclass(frozen=True)
class InstrumentSpec:

    symbol: str
    name: str
    underlying: str = ""
    venue: str = "NSE"
    currency: str = "INR"
    currency_symbol: str = "₹"
    price_decimals: int = 2
    strike_step: float = 50.0
    lot_size: int = 1
    is_index: bool = True
    oi_unit: str = "contracts"
    value_unit: str = "₹ Cr/pt"
    timezone: str = "Asia/Kolkata"
    session_open: str = "09:15"
    session_close: str = "15:30"
    expiry: Optional[str] = None
    #: Extra presentation metadata, e.g. ``{"tick_size": 0.05}``.
    meta: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def price_label(self) -> str:
        return f"{self.currency_symbol} {self.price_decimals}d"

    @property
    def strike_label(self) -> str:
        return f"{self.currency_symbol}{self.strike_step:g} ladder"

    def money(self, value: float | int | None, digits: int | None = None) -> str:
        if value is None:
            return "—"
        d = self.price_decimals if digits is None else digits
        return f"{self.currency_symbol}{value:,.{d}f}"

    def points(self, value: float | int | None, digits: int = 1) -> str:
        if value is None:
            return "—"
        return f"{value:+,.{digits}f}"
