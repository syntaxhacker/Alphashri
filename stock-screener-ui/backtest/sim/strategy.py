"""Pure-Python strategy base, config class factory, order factory and paper cache."""

from __future__ import annotations

from typing import Any, Dict, List

from .model import InstrumentId, OrderSide, Quantity

__all__ = [
    "StrategyConfig",
    "Strategy",
    "OrderFactory",
    "MarketOrder",
    "SimCache",
    "SimPosition",
]


class StrategyConfig:
    """Dataclass-like config base supporting ``class X(StrategyConfig, kw_only=True)``.

    Annotated class attributes become keyword-only constructor fields; a default
    is taken from the class attribute when present.  Real nautilus uses
    ``msgspec.Struct`` here, which is where the ``kw_only=`` class keyword comes
    from in the strategy modules.
    """

    def __init__(self, **values: Any) -> None:
        for key, value in values.items():
            setattr(self, key, value)

    def __init_subclass__(cls, *, kw_only: bool = False, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)

        fields: Dict[str, Any] = {}
        for base in reversed(cls.__mro__[1:]):
            fields.update(getattr(base, "__sim_fields__", {}))
        fields.update(cls.__dict__.get("__annotations__", {}))

        required: List[str] = []
        defaults: Dict[str, Any] = {}
        for name in fields:
            if hasattr(cls, name):
                defaults[name] = getattr(cls, name)
            else:
                required.append(name)

        cls.__sim_fields__ = fields
        cls.__sim_required__ = tuple(required)
        cls.__sim_defaults__ = defaults

        def __init__(self, **values: Any) -> None:
            unknown = sorted(set(values) - set(fields))
            if unknown:
                raise TypeError(
                    f"{type(self).__name__}() got unexpected keyword argument(s): "
                    f"{', '.join(unknown)}"
                )
            missing = [name for name in required if name not in values]
            if missing:
                raise TypeError(
                    f"{type(self).__name__}() missing required keyword argument(s): "
                    f"{', '.join(missing)}"
                )
            for name, default in defaults.items():
                setattr(self, name, values.get(name, default))
            for name, value in values.items():
                setattr(self, name, value)

        __init__.__qualname__ = f"{cls.__name__}.__init__"
        cls.__init__ = __init__


def _instrument_key(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, InstrumentId):
        return str(value)
    return str(value)


class SimPosition:
    __slots__ = ("instrument_id", "quantity", "side", "entry_price", "trades")

    def __init__(
        self,
        instrument_id: Any = None,
        quantity: Any = None,
        side: Any = None,
        entry_price: float = 0.0,
        trades: Any = None,
    ) -> None:
        self.instrument_id = instrument_id
        self.quantity = quantity if isinstance(quantity, Quantity) else Quantity.from_str(str(quantity or 0))
        self.side = side
        self.entry_price = float(entry_price)
        self.trades: List[Any] = list(trades) if trades is not None else []

    def __repr__(self) -> str:
        return (
            f"SimPosition(instrument_id={self.instrument_id!s}, quantity={self.quantity!s}, "
            f"side={getattr(self.side, 'value', self.side)!s})"
        )


class SimCache:
    __slots__ = ("_positions",)

    def __init__(self) -> None:
        self._positions: List[SimPosition] = []

    def positions_open(self, instrument_id: Any = None) -> List[SimPosition]:
        if instrument_id is None:
            return list(self._positions)
        key = _instrument_key(instrument_id)
        return [p for p in self._positions if _instrument_key(p.instrument_id) == key]

    def _add(self, position: SimPosition) -> None:
        self._positions.append(position)

    def _remove(self, position: SimPosition) -> None:
        self._positions = [p for p in self._positions if p is not position]

    def close_all(self, instrument_id: Any = None) -> None:
        if instrument_id is None:
            self._positions = []
            return
        key = _instrument_key(instrument_id)
        self._positions = [p for p in self._positions if _instrument_key(p.instrument_id) != key]


class MarketOrder:
    __slots__ = ("instrument_id", "order_side", "quantity")

    def __init__(self, instrument_id: Any, order_side: Any, quantity: Any) -> None:
        self.instrument_id = instrument_id
        self.order_side = order_side
        self.quantity = quantity if isinstance(quantity, Quantity) else Quantity.from_str(str(quantity))

    def __repr__(self) -> str:
        return (
            f"MarketOrder(instrument_id={self.instrument_id!s}, "
            f"order_side={getattr(self.order_side, 'value', self.order_side)!s}, "
            f"quantity={self.quantity!s})"
        )


class OrderFactory:
    __slots__ = ()

    def market(
        self,
        instrument_id: Any = None,
        order_side: Any = None,
        quantity: Any = None,
        **kwargs: Any,
    ) -> MarketOrder:
        return MarketOrder(instrument_id=instrument_id, order_side=order_side, quantity=quantity)


class Strategy:
    """Base strategy with the small surface the repo's strategies actually use."""

    def __init__(self, config: Any = None) -> None:
        self.config = config
        self.params = config
        self.cache = SimCache()
        self.order_factory = OrderFactory()
        self._subscriptions: List[Any] = []
        self._sim_bar: Any = None
        self._sim_engine: Any = None

    def on_start(self) -> None:
        return None

    def on_bar(self, bar: Any) -> None:
        return None

    def on_stop(self) -> None:
        return None

    def on_reset(self) -> None:
        return None

    def subscribe_bars(self, bar_type: Any) -> None:
        self._subscriptions.append(bar_type)

    def submit_order(self, order: Any) -> None:
        engine = getattr(self, "_sim_engine", None)
        if engine is not None:
            engine._fill_order(self, order)

    def close_all_positions(self, instrument_id: Any = None, **kwargs: Any) -> None:
        self.cache.close_all(instrument_id=instrument_id)
