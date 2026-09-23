"""
Process-wide adapter hub: one live broker connection, many subscribers.

Why this exists
---------------
The Fyers SDK keeps socket/callback state at module scope, so two adapter
instances in one process cross-deliver each other's messages. In practice a
second socket produced ticks whose ``ltp``/``volume``/``cp`` belonged to a
*different* instrument than the depth — e.g. RAYMOND's 50-level book paired with
RELIANCE's price and traded volume, which the UI then reported as
``Day +25%`` and a ~13M-share CVD. Opening a socket per browser tab made the
bridge non-deterministic.

The hub makes that impossible by construction: per broker there is exactly one
adapter instance and one connection, and additional subscribers *grow* that
connection via :meth:`OrderFlowAdapter.subscribe_symbol`. Ticks are routed back
to subscribers by app symbol, so a listener only ever sees its own instrument.

Usage::

    hub = get_hub()
    ticket = hub.subscribe("fyers_tbt", token, "RAYMOND", on_tick, on_error)
    ...
    hub.unsubscribe(ticket)
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable, Optional

from api.orderflow_symbols import from_broker_symbol, normalize_symbol

TickCallback = Callable[[str, dict], None]
ErrorCallback = Callable[[object], None]


@dataclass
class _Listener:
    on_tick: TickCallback
    on_error: Optional[ErrorCallback] = None


@dataclass
class Subscription:
    """Handle returned by :meth:`AdapterHub.subscribe`."""

    broker: str
    symbol: str
    on_tick: TickCallback
    hub: "AdapterHub"
    listener: "_Listener"
    released: bool = False

    def release(self) -> None:
        self.hub.unsubscribe(self)


@dataclass
class _Entry:
    """One broker connection shared by every subscriber for that broker."""

    adapter: object
    token: str
    #: app symbol -> listeners wanting that symbol
    listeners: dict[str, list[_Listener]] = field(default_factory=dict)

    def symbols(self) -> list[str]:
        return sorted(self.listeners)


class AdapterHub:
    """Reference-counted, single-connection broker adapter manager."""

    def __init__(self, adapter_factory: Optional[Callable[[str, str], object]] = None):
        self._lock = threading.RLock()
        self._entries: dict[str, _Entry] = {}
        self._factory = adapter_factory or _default_adapter_factory

    # -- public API ---------------------------------------------------------
    def subscribe(
        self,
        broker: str,
        token: str,
        symbol: str,
        on_tick: TickCallback,
        on_error: Optional[ErrorCallback] = None,
    ) -> Subscription:
        """Start streaming ``symbol`` for ``on_tick``, reusing the connection."""
        broker_key = (broker or "").strip().lower()
        app_symbol = normalize_symbol(symbol)
        if not broker_key:
            raise ValueError("broker is required")
        if not app_symbol:
            raise ValueError("symbol is required")

        listener = _Listener(on_tick=on_tick, on_error=on_error)
        sub = Subscription(
            broker=broker_key,
            symbol=app_symbol,
            on_tick=on_tick,
            hub=self,
            listener=listener,
        )

        with self._lock:
            entry = self._entries.get(broker_key)
            fresh = entry is None
            if entry is None:
                entry = _Entry(adapter=None, token=token)
                self._entries[broker_key] = entry

            entry.listeners.setdefault(app_symbol, []).append(listener)

            if fresh:
                entry.adapter = self._factory(broker_key, token)
                try:
                    entry.adapter.connect(
                        [app_symbol],
                        on_tick=self._make_sink(broker_key),
                        on_error=self._make_error_sink(broker_key),
                    )
                except BaseException:
                    # Roll the whole entry back so a retry starts clean.
                    self._entries.pop(broker_key, None)
                    raise
            else:
                self._grow(broker_key, entry, app_symbol, listener)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        """Drop one listener; closes the connection when the last one leaves."""
        if sub.released:
            return
        sub.released = True
        with self._lock:
            entry = self._entries.get(sub.broker)
            if entry is None:
                return
            listeners = entry.listeners.get(sub.symbol)
            if not listeners:
                return
            entry.listeners[sub.symbol] = [
                item for item in listeners if item is not sub.listener
            ]
            if not entry.listeners[sub.symbol]:
                entry.listeners.pop(sub.symbol, None)
            if not entry.listeners:
                self._teardown(sub.broker, entry)

    def active_brokers(self) -> list[str]:
        with self._lock:
            return sorted(self._entries)

    def subscriber_count(self, broker: str) -> int:
        with self._lock:
            entry = self._entries.get((broker or "").strip().lower())
            if entry is None:
                return 0
            return sum(len(v) for v in entry.listeners.values())

    def shutdown(self) -> None:
        """Close every connection (used by tests and on API shutdown)."""
        with self._lock:
            for broker in list(self._entries):
                self._teardown(broker, self._entries[broker], force=True)

    # -- internals ----------------------------------------------------------
    def _grow(self, broker: str, entry: _Entry, symbol: str, listener: _Listener) -> None:
        """Attach a new symbol to an existing connection.

        Adapters that cannot grow in place would need a second socket — exactly
        the failure this hub exists to prevent — so failing here is deliberate.
        """
        if len(entry.listeners[symbol]) > 1:
            return

        # One connection has a hard symbol ceiling (Fyers TBT: 5). Exceeding it
        # would make the broker drop subscriptions silently, so refuse loudly.
        # ``symbol`` is already in listeners at this point (and is the only entry
        # for it, since a repeat subscriber returned above).
        limit = getattr(entry.adapter, "max_symbols_per_connection", None)
        existing = len(entry.listeners) - 1
        if limit and existing >= limit:
            self._reject(
                listener,
                RuntimeError(
                    f"{broker} allows {limit} symbols per connection; "
                    f"cannot add {symbol}. Close another Order Flow tab."
                ),
                entry,
                symbol,
            )
            return

        try:
            entry.adapter.subscribe_symbol(symbol)
        except BaseException as exc:  # noqa: BLE001 - surface, don't leak a phantom subscriber
            self._reject(listener, exc, entry, symbol)
            return
        _ = broker  # reserved for per-broker routing policies

    @staticmethod
    def _reject(listener: _Listener, exc: BaseException, entry: _Entry, symbol: str) -> None:
        """Undo a listener's registration and hand it the failure."""
        entry.listeners[symbol] = [
            item for item in entry.listeners.get(symbol, []) if item is not listener
        ]
        if not entry.listeners[symbol]:
            entry.listeners.pop(symbol, None)
        sink = listener.on_error
        if callable(sink):
            sink(exc)
        else:
            raise exc

    def _make_sink(self, broker: str) -> TickCallback:
        def sink(broker_symbol, tick) -> None:
            self._dispatch(broker, broker_symbol, tick)

        return sink

    def _make_error_sink(self, broker: str) -> ErrorCallback:
        def sink(error) -> None:
            with self._lock:
                entry = self._entries.get(broker)
                targets = list(entry.listeners.values()) if entry else []
            for listeners in targets:
                for listener in listeners:
                    if callable(listener.on_error):
                        listener.on_error(error)

        return sink

    def _dispatch(self, broker: str, broker_symbol, tick) -> None:
        app_symbol = from_broker_symbol(broker, str(broker_symbol))
        with self._lock:
            entry = self._entries.get(broker)
            if entry is None:
                return
            listeners = list(entry.listeners.get(app_symbol) or ())
        for listener in listeners:
            listener.on_tick(app_symbol, tick)

    def _teardown(self, broker: str, entry: _Entry, force: bool = False) -> None:
        self._entries.pop(broker, None)
        adapter = entry.adapter
        if adapter is None:
            return
        if not force and getattr(adapter, "persistent", False):
            # Keep the connection up: its transport cannot be revived once
            # disconnected, so the next subscribe would get a dead object and
            # stream nothing. Ticks with no listeners are simply dropped.
            return
        try:
            adapter.disconnect()
        except Exception:  # noqa: BLE001 - best effort teardown
            pass


def _default_adapter_factory(broker: str, token: str):
    from api.orderflow_adapters import get_adapter

    adapter_cls = get_adapter(broker)
    if adapter_cls is None:
        raise ValueError(f"Unknown broker: {broker}")
    try:
        return adapter_cls(access_token=token)
    except TypeError:
        return adapter_cls()


_HUB: Optional[AdapterHub] = None
_HUB_LOCK = threading.Lock()


def get_hub() -> AdapterHub:
    """Process-wide hub singleton."""
    global _HUB
    if _HUB is None:
        with _HUB_LOCK:
            if _HUB is None:
                _HUB = AdapterHub()
    return _HUB


def reset_hub() -> None:
    """Drop the singleton (tests only)."""
    global _HUB
    with _HUB_LOCK:
        if _HUB is not None:
            _HUB.shutdown()
        _HUB = None
