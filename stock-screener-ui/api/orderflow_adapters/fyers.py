"""Fyers order-flow adapter.

Uses the Fyers v3 data socket (``fyers_apiv3.FyersWebsocket.data_ws``) with
``DepthUpdate`` (5-level depth incl. per-level resting order counts) and falls
back to ``SymbolUpdate`` quote fields when a message carries no depth. The
``fyers_apiv3`` SDK is imported lazily inside :meth:`FyersAdapter.connect` so
this module imports (and registers) even when the SDK is not installed.

The 50-level TBT (protobuf) feed is a different endpoint/envelope and is
represented by :class:`FyersTbtAdapter`; see :mod:`api.orderflow_adapters.base`
for the normalized tick contract.

Fyers symbol format is ``"NSE:SBIN-EQ"``; indices are ``"NSE:NIFTY50-INDEX"``.
Because a bare name cannot be reliably classified as equity vs index, pass
indices already in ``NSE:<NAME>-INDEX`` form (see :meth:`FyersAdapter.fyers_symbol`).
"""

import os
from typing import Callable, Optional

from api.orderflow_adapters.base import OrderFlowAdapter, make_depth, register_adapter

_DEPTH_TYPE = "dp"
_QUOTE_TYPE = "sf"
_NON_MARKET_TYPES = frozenset({"cn", "sub", "if"})

SocketFactory = Callable[..., object]


def _default_socket_factory(
    access_token: str,
    on_connect: Callable,
    on_message: Callable,
    on_error: Callable,
    on_close: Callable,
):
    """Construct a real Fyers data socket; raises a clear error if SDK missing."""
    try:
        from fyers_apiv3.FyersWebsocket import data_ws
    except ImportError as exc:
        raise RuntimeError(
            "fyers_apiv3 is required for the Fyers order-flow adapter; "
            "install it with `uv pip install fyers-apiv3`."
        ) from exc

    return data_ws.FyersDataSocket(
        access_token=access_token,
        litemode=False,
        write_to_file=False,
        reconnect=True,
        on_connect=on_connect,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )


def _f(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _has(value) -> bool:
    return value is not None and value != ""


@register_adapter
class FyersAdapter(OrderFlowAdapter):
    """Fyers v3 data socket, ``DepthUpdate`` mode (5-level depth + order counts)."""

    name = "fyers"
    depth_levels = 5
    max_symbols_per_connection = 5000
    max_connections = 3
    has_order_counts = True

    def __init__(self, access_token: Optional[str] = None):
        self.access_token = access_token
        self._socket = None

    def fyers_symbol(self, symbol: str) -> str:
        """Map ``"RELIANCE"`` → ``"NSE:RELIANCE-EQ"``; pass through ``NSE:...``."""
        text = (symbol or "").strip().upper()
        if ":" in text:
            return text
        return f"NSE:{text}-EQ"

    def normalize(self, raw: dict) -> list[tuple[str, dict]]:
        if not isinstance(raw, dict):
            return []
        msg_type = raw.get("type")
        if msg_type in _NON_MARKET_TYPES or msg_type not in (_DEPTH_TYPE, _QUOTE_TYPE):
            return []
        symbol = raw.get("symbol")
        if not symbol:
            return []

        ltp = _f(raw.get("ltp"))
        ltt_sec = _f(raw.get("last_traded_time"))
        tick = {
            "ltp": ltp,
            "volume": _f(raw.get("vol_traded_today")),
            "vwap": _f(raw.get("avg_trade_price")),
            "ltt": int(ltt_sec * 1000) if ltt_sec > 0 else 0,
            "ltq": _f(raw.get("last_traded_qty")),
            "cp": _f(raw.get("prev_close_price")),
            "tbq": _f(raw.get("tot_buy_qty")),
            "tsq": _f(raw.get("tot_sell_qty")),
            "oi": 0.0,
            "iv": 0.0,
            "greeks": None,
            "day": self._day(raw, ltp),
            "depth": self._depth(raw),
        }
        return [(str(symbol), tick)]

    def _day(self, raw: dict, ltp: float) -> Optional[dict]:
        if not any(
            _has(raw.get(k))
            for k in ("open_price", "high_price", "low_price", "vol_traded_today")
        ):
            return None
        return {
            "open": _f(raw.get("open_price")),
            "high": _f(raw.get("high_price")),
            "low": _f(raw.get("low_price")),
            "close": ltp,
            "volume": _f(raw.get("vol_traded_today")),
        }

    def _depth(self, raw: dict) -> dict:
        return {"buy": self._side(raw, "bid"), "sell": self._side(raw, "ask")}

    def _side(self, raw: dict, prefix: str) -> list[dict]:
        levels = [
            {
                "price": raw.get(f"{prefix}_price{i}"),
                "quantity": raw.get(f"{prefix}_size{i}"),
                "orders": raw.get(f"{prefix}_order{i}"),
            }
            for i in range(1, self.depth_levels + 1)
        ]
        built = make_depth(levels)
        if built:
            return built
        best = {
            "price": raw.get(f"{prefix}_price"),
            "quantity": raw.get(f"{prefix}_size"),
            "orders": raw.get(f"{prefix}_order"),
        }
        return make_depth([best])

    def connect(
        self,
        symbols,
        on_tick: Callable[[str, dict], None],
        on_error=None,
        socket_factory: Optional[SocketFactory] = None,
    ) -> None:
        token = self.access_token or os.getenv("FYERS_ACCESS_TOKEN")
        if not token:
            raise ValueError(
                "Fyers access_token is required, formatted '<APP_ID>:<ACCESS_TOKEN>'"
            )

        factory = socket_factory or _default_socket_factory
        fyers_symbols = [self.fyers_symbol(s) for s in symbols]

        def _on_message(message):
            for symbol, tick in self.normalize(message):
                on_tick(symbol, tick)

        def _on_error(error):
            if on_error is not None:
                on_error(error)

        self._socket = factory(
            access_token=token,
            on_connect=lambda *a, **k: None,
            on_message=_on_message,
            on_error=_on_error,
            on_close=lambda *a, **k: None,
        )
        self._socket.subscribe(symbols=fyers_symbols, data_type="DepthUpdate")
        self._socket.keep_running()

    def disconnect(self) -> None:
        socket, self._socket = self._socket, None
        if socket is None:
            return
        close = getattr(socket, "close_connection", None) or getattr(socket, "close", None)
        if callable(close):
            close()


class FyersTbtAdapter(OrderFlowAdapter):
    """Fyers 50-level TBT feed (protobuf over ``wss://rtsocket-api.fyers.in/versova``).

    Not registered: it uses a distinct socket (3 connections/user, 5 symbols
    each, channels 1-50 via ``switchChannel(...)``) and requires a protobuf
    decoder, so :meth:`connect` is intentionally unimplemented.
    """

    name = "fyers_tbt"
    depth_levels = 50
    max_symbols_per_connection = 5
    max_connections = 3
    has_order_counts = True

    def __init__(self, access_token: Optional[str] = None):
        self.access_token = access_token
        self._socket = None

    def normalize(self, raw: dict) -> list[tuple[str, dict]]:
        raise NotImplementedError(
            "Fyers TBT messages are protobuf-encoded; decode them before normalize()"
        )

    def connect(self, symbols, on_tick, on_error=None) -> None:
        raise NotImplementedError(
            "Fyers TBT requires the protobuf TBT client and channel switching "
            "(wss://rtsocket-api.fyers.in/versova, 5 symbols/connection)"
        )
