"""Pure-Python stand-ins for the slice of ``nautilus_trader.model`` used by backtests.

Only identities, the three numeric value objects, the enums and ``Equity`` are
modelled.  Numeric objects deliberately coerce to ``float`` so strategy code can
mix bar prices with ordinary Python floats without wrapping every expression.
"""

from __future__ import annotations

import enum
from numbers import Real
from typing import Any

__all__ = [
    "Symbol",
    "Venue",
    "TraderId",
    "InstrumentId",
    "BarType",
    "OrderSide",
    "AccountType",
    "OmsType",
    "Currency",
    "INR",
    "Price",
    "Quantity",
    "Money",
    "Equity",
]


class Symbol(str):
    __slots__ = ()

    def __new__(cls, value: Any) -> "Symbol":
        return super().__new__(cls, str(value))

    def __repr__(self) -> str:
        return f"Symbol({str.__str__(self)!r})"


class Venue(str):
    __slots__ = ()

    def __new__(cls, value: Any) -> "Venue":
        return super().__new__(cls, str(value))

    def __repr__(self) -> str:
        return f"Venue({str.__str__(self)!r})"


class TraderId(str):
    __slots__ = ()

    def __new__(cls, value: Any) -> "TraderId":
        return super().__new__(cls, str(value))

    def __repr__(self) -> str:
        return f"TraderId({str.__str__(self)!r})"


class InstrumentId:
    __slots__ = ("symbol", "venue", "_text")

    def __init__(self, symbol: Any, venue: Any) -> None:
        self.symbol = symbol if isinstance(symbol, Symbol) else Symbol(symbol)
        self.venue = venue if isinstance(venue, Venue) else Venue(venue)
        self._text = f"{self.symbol}.{self.venue}"

    @classmethod
    def from_str(cls, value: Any) -> "InstrumentId":
        text = str(value)
        if "." not in text:
            raise ValueError(f"Invalid instrument id {value!r}: expected SYMBOL.VENUE")
        symbol, venue = text.split(".", 1)
        return cls(Symbol(symbol), Venue(venue))

    def __str__(self) -> str:
        return self._text

    def __repr__(self) -> str:
        return f"InstrumentId({self._text!r})"

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, InstrumentId):
            return self._text == other._text
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self._text)


class BarType:
    __slots__ = ("_text", "instrument_id", "spec", "aggregation", "kind")

    def __init__(self, value: Any) -> None:
        self._text = str(value)
        parts = self._text.split("-")
        self.instrument_id = (
            InstrumentId.from_str(parts[0]) if parts and "." in parts[0] else None
        )
        self.spec = parts[1] if len(parts) > 1 else None
        self.aggregation = parts[2] if len(parts) > 2 else None
        self.kind = parts[3] if len(parts) > 3 else None

    @classmethod
    def from_str(cls, value: Any) -> "BarType":
        return cls(value)

    def __str__(self) -> str:
        return self._text

    def __repr__(self) -> str:
        return f"BarType({self._text!r})"

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, BarType):
            return self._text == other._text
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self._text)


class OrderSide(enum.Enum):
    BUY = "BUY"
    SELL = "SELL"


class AccountType(enum.Enum):
    CASH = "CASH"
    MARGIN = "MARGIN"


class OmsType(enum.Enum):
    NETTING = "NETTING"


class Currency:
    __slots__ = ("code",)

    def __init__(self, code: str) -> None:
        self.code = str(code)

    def __str__(self) -> str:
        return self.code

    def __repr__(self) -> str:
        return f"Currency({self.code!r})"

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, Currency):
            return self.code == other.code
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self.code)


INR = Currency("INR")


def _fmt(value: float) -> str:
    text = format(value, ".8f").rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


class _Number:
    __slots__ = ("_value",)

    def __init__(self, value: Any) -> None:
        self._value = float(value)

    @classmethod
    def from_str(cls, value: Any) -> "_Number":
        return cls(str(value).replace(",", "").strip())

    @property
    def value(self) -> float:
        return self._value

    def __float__(self) -> float:
        return self._value

    def __int__(self) -> int:
        return int(self._value)

    def __bool__(self) -> bool:
        return self._value != 0.0

    def __str__(self) -> str:
        return _fmt(self._value)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({str(self)!r})"

    @staticmethod
    def _coerce(other: Any):
        if isinstance(other, _Number):
            return other._value
        if isinstance(other, Real):
            return float(other)
        return NotImplemented

    def __eq__(self, other: Any) -> bool:
        value = self._coerce(other)
        return self._value == value if value is not NotImplemented else NotImplemented

    def __lt__(self, other: Any) -> bool:
        value = self._coerce(other)
        return self._value < value if value is not NotImplemented else NotImplemented

    def __le__(self, other: Any) -> bool:
        value = self._coerce(other)
        return self._value <= value if value is not NotImplemented else NotImplemented

    def __gt__(self, other: Any) -> bool:
        value = self._coerce(other)
        return self._value > value if value is not NotImplemented else NotImplemented

    def __ge__(self, other: Any) -> bool:
        value = self._coerce(other)
        return self._value >= value if value is not NotImplemented else NotImplemented

    def __add__(self, other: Any) -> float:
        value = self._coerce(other)
        return self._value + value if value is not NotImplemented else NotImplemented

    __radd__ = __add__

    def __sub__(self, other: Any) -> float:
        value = self._coerce(other)
        return self._value - value if value is not NotImplemented else NotImplemented

    def __rsub__(self, other: Any) -> float:
        value = self._coerce(other)
        return value - self._value if value is not NotImplemented else NotImplemented

    def __mul__(self, other: Any) -> float:
        value = self._coerce(other)
        return self._value * value if value is not NotImplemented else NotImplemented

    __rmul__ = __mul__

    def __truediv__(self, other: Any) -> float:
        value = self._coerce(other)
        return self._value / value if value is not NotImplemented else NotImplemented

    def __rtruediv__(self, other: Any) -> float:
        value = self._coerce(other)
        return value / self._value if value is not NotImplemented else NotImplemented

    def __neg__(self) -> float:
        return -self._value

    def __pos__(self) -> float:
        return self._value

    def __abs__(self) -> float:
        return abs(self._value)

    def __hash__(self) -> int:
        return hash(self._value)


class Price(_Number):
    __slots__ = ()


class Quantity(_Number):
    __slots__ = ()


class Money(_Number):
    __slots__ = ("currency",)

    def __init__(self, value: Any, currency: Any = None) -> None:
        super().__init__(value)
        self.currency = currency

    def __str__(self) -> str:
        base = super().__str__()
        return f"{base} {self.currency}" if self.currency is not None else base


class Equity:
    """Instrument descriptor.  All constructor keywords are retained as attributes."""

    def __init__(self, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)
        self.id = getattr(self, "instrument_id", None)

    def __repr__(self) -> str:
        return f"Equity(instrument_id={self.id!s}, raw_symbol={getattr(self, 'raw_symbol', None)!s})"
