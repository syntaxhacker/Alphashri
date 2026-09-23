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

import logging
import os
from typing import Callable, Optional

from api.orderflow_adapters.base import (
    OrderFlowAdapter,
    make_depth,
    register_adapter,
    sanitize_adapter_error,
)
from api.orderflow_symbols import fyers_symbol  # noqa: F401  (re-exported)

logger = logging.getLogger(__name__)

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


def _circuit(raw: dict) -> Optional[dict]:
    """Circuit-limit band, when the broker supplies it."""
    if not (_has(raw.get("upper_ckt")) or _has(raw.get("lower_ckt"))):
        return None
    return {"upper": _f(raw.get("upper_ckt")), "lower": _f(raw.get("lower_ckt"))}


def _unwrap(value):
    """Unwrap protobuf scalar wrappers (``Int64Value`` et al expose ``.value``).

    Plain dicts, lists, strings and numbers pass through unchanged.
    """
    if value is None or isinstance(value, (dict, list, tuple, str, bytes, bool)):
        return value
    inner = getattr(value, "value", None)
    if isinstance(inner, (int, float)):
        return inner
    return value


def _field(obj, name):
    """Read ``name`` from a dict, a plain object, or a protobuf message."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return _unwrap(obj.get(name))
    return _unwrap(getattr(obj, name, None))


def _first_present(values):
    """First value that is neither ``None`` nor ``""`` (else ``None``)."""
    for value in values:
        unwrapped = _unwrap(value)
        if _has(unwrapped):
            return unwrapped
    return None


def _feed_oi(feed):
    """Open interest when the feed carries it, else ``None`` (never a default)."""
    quote = feed.get("quote") if isinstance(feed, dict) else getattr(feed, "quote", None)
    return _first_present(
        (
            _field(quote, "oi"),
            _field(feed, "oi"),
            _field(feed, "open_interest"),
            _field(feed, "OI"),
        )
    )


def _feed_52w(feed) -> dict:
    """52-week band from ExtendedQuote (``yh``/``yl``) or flat aliases.

    Returns ``{}`` when the feed carries neither bound, so callers can
    ``tick.update(...)`` without adding bogus defaults.
    """
    eq = feed.get("eq") if isinstance(feed, dict) else getattr(feed, "eq", None)
    out: dict = {}
    for key, candidates in (
        ("52w_high", (_field(eq, "yh"), _field(feed, "52w_high"), _field(feed, "Yhigh"))),
        ("52w_low", (_field(eq, "yl"), _field(feed, "52w_low"), _field(feed, "Ylow"))),
    ):
        value = _first_present(candidates)
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number > 0:
            out[key] = number
    return out


def _feed_ticksize(feed) -> Optional[float]:
    """Tick size from SymDetail (or a flat alias); ``None`` when absent."""
    sym = (
        feed.get("symdetail") if isinstance(feed, dict) else getattr(feed, "symdetail", None)
    )
    value = _first_present((_field(sym, "ticksize"), _field(feed, "ticksize")))
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _day_from_dq(dq, volume: float = 0.0) -> Optional[dict]:
    """Day OHLC from a DailyQuote (``do``/``dh``/``dl``/``dc``); ``None`` if absent."""
    if dq is None:
        return None
    vals = {key: _field(dq, key) for key in ("do", "dh", "dl", "dc")}
    if not any(_has(value) for value in vals.values()):
        return None
    return {
        "open": _f(vals["do"]),
        "high": _f(vals["dh"]),
        "low": _f(vals["dl"]),
        "close": _f(vals["dc"]),
        "volume": _f(volume),
    }


def _attach_num(filtered: list, raw_levels: list) -> list:
    """Re-attach optional per-level ``num`` after :func:`make_depth` filtering.

    ``make_depth`` normalizes to exactly ``{price, quantity, orders}``; this
    copies ``num`` back onto the surviving levels by filter order, so the
    filtering semantics stay in one place.
    """
    nums = []
    for level in raw_levels or []:
        try:
            get = level.get if isinstance(level, dict) else lambda k: _field(level, k)
            keep = float(get("price") or 0.0) > 0 and float(get("quantity") or 0.0) > 0
        except (TypeError, ValueError, AttributeError):
            keep = False
        if keep:
            nums.append(get("num"))
    for out, num in zip(filtered, nums):
        if num is None or num == "":
            continue
        try:
            out["num"] = int(num)
        except (TypeError, ValueError):
            continue
    return filtered


def _data_available() -> bool:
    try:
        import fyers_apiv3  # noqa: F401
        return True
    except ImportError:
        return False


def _default_tbt_socket_factory(
    access_token: str,
    on_depth_update: Callable,
    on_error: Callable,
    reconnect: bool = False,
):
    """Construct a real Fyers TBT socket; raises a clear error if SDK missing."""
    try:
        from fyers_apiv3.FyersWebsocket import tbt_ws
    except ImportError as exc:
        raise RuntimeError(
            "fyers_apiv3 is required for the Fyers TBT (50-level) adapter; "
            "install it with `uv pip install fyers-apiv3`."
        ) from exc
    return tbt_ws.FyersTbtSocket(
        access_token=access_token,
        log_path="",
        write_to_file=False,
        on_depth_update=on_depth_update,
        on_error=on_error,
        reconnect=reconnect,
        diff_only=False,
    )


def _tbt_depth_mode():
    try:
        from fyers_apiv3.FyersWebsocket.tbt_ws import SubscriptionModes
        return SubscriptionModes.DEPTH
    except Exception:  # noqa: BLE001 - fall back to the enum's value
        return "depth"


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
        return fyers_symbol(symbol)

    def broker_symbol(self, symbol: str) -> str:
        return fyers_symbol(symbol)

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
        feed_sec = _f(raw.get("exch_feed_time")) or ltt_sec
        depth = self._depth(raw)
        if not ltp:
            # DepthUpdate messages carry no LTP — derive it from the touch.
            bids, asks = depth.get("buy") or [], depth.get("sell") or []
            if bids and asks:
                ltp = (bids[0]["price"] + asks[0]["price"]) / 2.0
            elif bids:
                ltp = bids[0]["price"]
            elif asks:
                ltp = asks[0]["price"]
        oi_raw = _feed_oi(raw)
        tick = {
            "ltp": ltp,
            "volume": _f(raw.get("vol_traded_today")),
            "vwap": _f(raw.get("avg_trade_price")),
            "ltt": int(ltt_sec * 1000) if ltt_sec > 0 else 0,
            "ltq": _f(raw.get("last_traded_qty")),
            "cp": _f(raw.get("prev_close_price")),
            "tbq": _f(raw.get("tot_buy_qty")),
            "tsq": _f(raw.get("tot_sell_qty")),
            "oi": _f(oi_raw) if oi_raw is not None else 0.0,
            "iv": 0.0,
            "greeks": None,
            "day": self._day(raw, ltp),
            "depth": depth,
            "circuit": _circuit(raw),
            "feed_ts": int(feed_sec * 1000) if feed_sec > 0 else 0,
            "seq": None,
            "snapshot": None,
        }
        if tick["day"] is None:
            dq_day = _day_from_dq(raw.get("dq"), raw.get("vol_traded_today"))
            if dq_day is not None:
                tick["day"] = dq_day
        tick.update(_feed_52w(raw))
        ticksize = _feed_ticksize(raw)
        if ticksize is not None:
            tick["ticksize"] = ticksize
        return [(str(symbol), tick)]

    @staticmethod
    def _day(raw: dict, ltp: float) -> Optional[dict]:
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
                "num": raw.get(f"{prefix}_num{i}"),
            }
            for i in range(1, self.depth_levels + 1)
        ]
        built = make_depth(levels)
        if built:
            return _attach_num(built, levels)
        best = {
            "price": raw.get(f"{prefix}_price"),
            "quantity": raw.get(f"{prefix}_size"),
            "orders": raw.get(f"{prefix}_order"),
            "num": raw.get(f"{prefix}_num"),
        }
        return _attach_num(make_depth([best]), [best])

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
                on_error(sanitize_adapter_error(self.name, error))

        self._socket = factory(
            access_token=token,
            on_connect=lambda *a, **k: None,
            on_message=_on_message,
            on_error=_on_error,
            on_close=lambda *a, **k: None,
        )
        self._socket.connect()
        self._socket.subscribe(symbols=fyers_symbols, data_type="DepthUpdate")
        self._socket.keep_running()

    def disconnect(self) -> None:
        socket, self._socket = self._socket, None
        if socket is None:
            return
        close = getattr(socket, "close_connection", None) or getattr(socket, "close", None)
        if callable(close):
            close()

    def subscribe_symbol(self, symbol: str) -> bool:
        """Add one symbol to the existing socket (no second connection)."""
        if self._socket is None:
            raise RuntimeError("FyersAdapter.subscribe_symbol() before connect()")
        self._socket.subscribe(symbols=[self.fyers_symbol(symbol)], data_type="DepthUpdate")
        return True


@register_adapter
class FyersTbtAdapter(OrderFlowAdapter):
    """Fyers 50-level TBT feed, optionally merged with the quote socket.

    The TBT socket (protobuf over ``wss://rtsocket-api.fyers.in/versova``) ships
    a 50-level book only — no last price / volume / VWAP. To produce a tick the
    rest of the pipeline can use (journal + signal engine), this adapter also
    subscribes the data socket's quote updates and merges the two per symbol.

    Limits: TBT is 5 symbols per connection, 3 connections per user.
    """

    name = "fyers_tbt"
    depth_levels = 50
    max_symbols_per_connection = 5
    max_connections = 3
    has_order_counts = True
    persistent = True

    def __init__(self, access_token: Optional[str] = None):
        self.access_token = access_token
        self._tbt = None
        self._data = None
        self._tbt_alive = False
        self._quotes: dict[str, dict] = {}
        self._quote_symbols: list[str] = []
        self._subscribed: set[str] = set()

    # -- normalized depth ----------------------------------------------------
    @staticmethod
    def _get(obj, name):
        if isinstance(obj, dict):
            return obj.get(name)
        return getattr(obj, name, None)

    def _side(
        self, depth, price_key: str, qty_key: str, order_key: str, num_key: Optional[str] = None
    ) -> list[dict]:
        prices = self._get(depth, price_key) or []
        qtys = self._get(depth, qty_key) or []
        orders = self._get(depth, order_key) or []
        nums = self._get(depth, num_key) if num_key else None
        if prices or qtys or orders or nums:
            levels = []
            for i, (p, q, o) in enumerate(zip(prices, qtys, orders)):
                entry: dict = {"price": p, "quantity": q, "orders": o}
                if nums is not None and i < len(nums or []):
                    entry["num"] = nums[i]
                levels.append(entry)
            return _attach_num(make_depth(levels), levels)
        # Repeated ``MarketLevel`` shape (a raw protobuf book exposes `bids` /
        # `asks` instead of parallel arrays). The SDK divides wire prices by
        # 100 when building its Depth object, so do the same for non-dict
        # levels; plain-dict levels are already scaled.
        seq_attr = "bids" if price_key.startswith("bid") else "asks"
        seq = self._get(depth, seq_attr)
        if seq:
            levels = []
            for entry in seq:
                mapping = isinstance(entry, dict)
                price = _field(entry, "price")
                if not mapping and price is not None:
                    try:
                        price = float(price) / 100
                    except (TypeError, ValueError):
                        pass
                levels.append(
                    {
                        "price": price,
                        "quantity": _field(entry, "qty"),
                        "orders": _field(entry, "nord"),
                        "num": _field(entry, "num"),
                    }
                )
            return _attach_num(make_depth(levels), levels)
        return []

    @staticmethod
    def _split_feed(depth):
        """Split ``(book, feed)`` for MarketFeed-shaped input.

        The TBT SDK hands us its stripped ``Depth`` object, but callers may
        also pass the whole ``MarketFeed`` (dict or protobuf), which nests the
        book under ``depth`` next to ``quote``/``eq``/``dq``/``symdetail``.
        A plain book maps to ``(depth, depth)`` so sibling lookups find
        nothing and the previous tick shape is preserved.
        """
        inner = (
            depth.get("depth") if isinstance(depth, dict) else getattr(depth, "depth", None)
        )
        if inner is not None and inner is not depth:
            if isinstance(inner, dict):
                has_book = any(
                    k in inner
                    for k in ("bidprice", "askprice", "bidqty", "askqty", "bids", "asks")
                )
            else:
                has_book = any(
                    hasattr(inner, k)
                    for k in ("bidprice", "askprice", "bids", "asks")
                )
            if has_book:
                return inner, depth
        return depth, depth

    def normalize_depth(self, symbol: str, depth) -> tuple[str, dict]:
        """Map a TBT ``Depth`` (object or dict) to a normalized 50-level tick.

        Also accepts a MarketFeed-shaped envelope (dict or protobuf): the book
        is read from ``depth`` while ``quote``/``eq``/``dq``/``symdetail``
        supply OI, the 52-week band, day OHLC and tick size. Feed values win
        over the quote-socket merge; anything absent leaves the previous tick
        shape untouched.
        """
        book, feed = self._split_feed(depth)
        ltt = _first_present(
            (
                _field(book, "sendtime"),
                _field(book, "timestamp"),
                _field(feed, "send_time"),
                _field(feed, "feed_time"),
            )
        )
        try:
            ltt_ms = int(float(ltt) * 1000) if float(ltt) < 1e12 else int(float(ltt))
        except (TypeError, ValueError):
            ltt_ms = 0

        bids = self._side(book, "bidprice", "bidqty", "bidordn", "bidnum")
        asks = self._side(book, "askprice", "askqty", "askordn", "asknum")

        quote = self._quotes.get(symbol) or {}
        ltp = quote.get("ltp") or 0.0
        if not ltp and bids and asks:
            ltp = (bids[0]["price"] + asks[0]["price"]) / 2.0

        # The quote socket shares process-wide state, so its fields can belong to
        # a DIFFERENT instrument than the depth we just received (observed live:
        # NETWEB depth at 4770/4771 paired with ltp 143.7 and volume 117M, which
        # rendered as "Day -97.03%" and a 2.3-billion CVD). Depth is the trusted
        # anchor, so a quote that cannot belong to this book is discarded.
        if bids and asks and ltp:
            best_bid = bids[0]["price"]
            best_ask = asks[0]["price"]
            if not (best_bid * 0.90 <= ltp <= best_ask * 1.10):
                quote = {}
                ltp = (best_bid + best_ask) / 2.0

        oi_raw = _feed_oi(feed)
        day = quote.get("day")
        if day is None:
            dq_day = _day_from_dq(_field(feed, "dq"), quote.get("volume", 0.0))
            if dq_day is not None:
                day = dq_day

        tick = {
            "ltp": ltp,
            "volume": quote.get("volume", 0.0),
            "vwap": quote.get("vwap", 0.0),
            "ltt": ltt_ms or quote.get("ltt", 0),
            "ltq": quote.get("ltq", 0.0),
            "cp": quote.get("cp", 0.0),
            "tbq": float(_field(book, "tbq") or quote.get("tbq", 0.0)),
            "tsq": float(_field(book, "tsq") or quote.get("tsq", 0.0)),
            "oi": _f(oi_raw) if oi_raw is not None else quote.get("oi", 0.0),
            "iv": quote.get("iv", 0.0),
            "greeks": None,
            "day": day,
            "depth": {"buy": bids, "sell": asks},
            "circuit": quote.get("circuit"),
            "feed_ts": ltt_ms,
            "seq": int(_field(book, "seqNo") or 0) or None,
            "snapshot": bool(_field(book, "snapshot")),
        }
        tick.update(_feed_52w(feed))
        ticksize = _feed_ticksize(feed)
        if ticksize is not None:
            tick["ticksize"] = ticksize
        return str(symbol), tick

    def normalize(self, raw: dict) -> list[tuple[str, dict]]:
        """Base-contract entry: ``{"symbol": str, "depth": Depth|dict}``."""
        if not isinstance(raw, dict):
            return []
        symbol = raw.get("symbol")
        depth = raw.get("depth")
        if not symbol or depth is None:
            return []
        return [self.normalize_depth(str(symbol), depth)]

    def broker_symbol(self, symbol: str) -> str:
        return fyers_symbol(symbol)

    # -- quote merge ---------------------------------------------------------
    def remember_quote(self, message: dict) -> None:
        """Cache the tradable fields from a data-socket quote message."""
        if not isinstance(message, dict):
            return
        symbol = message.get("symbol")
        if not symbol:
            return
        ltt = _f(message.get("last_traded_time"))
        self._quotes[str(symbol)] = {
            "ltp": _f(message.get("ltp")),
            "volume": _f(message.get("vol_traded_today")),
            "vwap": _f(message.get("avg_trade_price")),
            "ltt": int(ltt * 1000) if ltt > 0 else 0,
            "ltq": _f(message.get("last_traded_qty")),
            "cp": _f(message.get("prev_close_price")),
            "tbq": _f(message.get("tot_buy_qty")),
            "tsq": _f(message.get("tot_sell_qty")),
            "circuit": _circuit(message),
            "day": {
                "open": _f(message.get("open_price")),
                "high": _f(message.get("high_price")),
                "low": _f(message.get("low_price")),
                "close": _f(message.get("ltp")),
                "volume": _f(message.get("vol_traded_today")),
            }
            if any(_has(message.get(k)) for k in ("open_price", "high_price", "low_price"))
            else None,
        }

    # -- lifecycle -----------------------------------------------------------
    def connect(
        self,
        symbols,
        on_tick: Callable[[str, dict], None],
        on_error=None,
        tbt_factory: Optional[Callable[..., object]] = None,
        data_factory: Optional[Callable[..., object]] = None,
    ) -> None:
        token = self.access_token or os.getenv("FYERS_ACCESS_TOKEN")
        if not token:
            raise ValueError("Fyers access_token is required ('<APP_ID>:<ACCESS_TOKEN>')")
        fyers_symbols = {fyers_symbol(s) for s in symbols}
        self._quote_symbols = sorted(fyers_symbols)
        self._subscribed = set(fyers_symbols)

        def _on_depth(symbol, depth):
            # The Fyers TBT SDK can mis-map symbols; only accept the ones we
            # actually subscribed to (the callback carries the symbol).
            if str(symbol) in self._subscribed:
                on_tick(*self.normalize_depth(symbol, depth))

        # quote socket (best-effort: gives ltp/volume/vwap). `keep_running()`
        # blocks, so it runs on a daemon thread and connect() stays non-blocking.
        if data_factory is not None or _data_available():
            factory = data_factory or _default_socket_factory
            try:
                self._data = factory(
                    access_token=token,
                    on_connect=self._subscribe_quotes,
                    on_message=self.remember_quote,
                    on_error=lambda *a, **k: None,
                    on_close=lambda *a, **k: None,
                )
                self._data.connect()
                self._data.keep_running()
            except Exception as exc:  # noqa: BLE001 - quotes are optional
                if on_error is not None:
                    on_error(sanitize_adapter_error(self.name, f"fyers quote socket unavailable: {exc}"))

        # TBT socket (50-level depth).
        # FyersTbtSocket is a process-wide singleton: constructing it again
        # returns the FIRST instance and re-runs __init__, which does not rebuild
        # the websocket or its reader thread. Reusing a disconnected singleton
        # made subscribe()/switchChannel() silent no-ops — no data, no error.
        # Drop a stale instance so this connect gets a real socket.
        try:
            from fyers_apiv3.FyersWebsocket.tbt_ws import FyersTbtSocket as _Tbt

            if _Tbt._instance is not None and not getattr(self, "_tbt_alive", False):
                _Tbt._instance = None
        except Exception:  # noqa: BLE001 - SDK optional / fake factories in tests
            pass
        tbt = tbt_factory or _default_tbt_socket_factory
        self._tbt = tbt(
            access_token=token,
            on_depth_update=_on_depth,
            on_error=(
                lambda *a: on_error(sanitize_adapter_error(self.name, " ".join(str(x) for x in a)))
            )
            if on_error
            else None,
            reconnect=False,
        )
        self._tbt.connect()
        self._tbt_alive = True
        for channel, symbol in enumerate(sorted(fyers_symbols), start=1):
            self._tbt.subscribe(
                symbol_tickers={symbol}, channelNo=str(channel), mode=_tbt_depth_mode()
            )
            self._tbt.switchChannel(resume_channels={str(channel)}, pause_channels=set())

    def _subscribe_quotes(self, *_args) -> None:
        if self._data is None:
            return
        try:
            self._data.subscribe(
                symbols=list(self._quote_symbols), data_type="SymbolUpdate"
            )
        except Exception:  # noqa: BLE001 - best effort
            pass

    def subscribe_symbol(self, symbol: str) -> bool:
        """Add one symbol to the existing TBT + quote sockets.

        A second adapter instance in the same process is what corrupts the feed
        (the Fyers SDK shares socket state), so growing the existing connection
        is the only safe way to serve another symbol.
        """
        broker_symbol = fyers_symbol(symbol)
        if broker_symbol in self._subscribed:
            return True
        if self._tbt is None:
            raise RuntimeError("FyersTbtAdapter.subscribe_symbol() before connect()")

        self._subscribed.add(broker_symbol)
        self._quote_symbols = sorted(self._subscribed)

        if self._data is not None:
            try:
                self._data.subscribe(symbols=[broker_symbol], data_type="SymbolUpdate")
            except Exception:  # noqa: BLE001 - quotes are best effort
                pass

        try:
            channel = str(len(self._quote_symbols))
            self._tbt.subscribe(
                symbol_tickers={broker_symbol},
                channelNo=channel,
                mode=_tbt_depth_mode(),
            )
            self._tbt.switchChannel(resume_channels={channel}, pause_channels=set())
        except Exception as exc:  # noqa: BLE001 - undo the bookkeeping on failure
            self._subscribed.discard(broker_symbol)
            self._quote_symbols = sorted(self._subscribed)
            raise RuntimeError(f"TBT subscribe failed for {broker_symbol}: {exc}") from exc
        return True

    def disconnect(self) -> None:
        for sock in (self._tbt, self._data):
            if sock is not None:
                close = getattr(sock, "close_connection", None)
                if callable(close):
                    try:
                        close()
                    except Exception:  # noqa: BLE001
                        pass
        self._tbt = None
        self._data = None
