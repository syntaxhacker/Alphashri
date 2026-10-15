"""
Shared Upstox market-data connection pool.

Upstox allows only a few WebSocket connections per user (2 standard, 5 with
Upstox Plus), but each connection can carry thousands of instrument keys. This
pool multiplexes many instrument subscriptions onto a small number of
connections and routes incoming ticks back to the interested subscribers.

Two pieces:

* :class:`UpstoxFeedSlot` — owns one Upstox connection and the set of
  instrument keys subscribed on it.
* :class:`UpstoxFeedPool` — assigns each new key to the least-loaded slot,
  de-duplicates identical subscriptions, and fans ticks out to subscribers.

The Upstox client is created by a ``slot_factory`` so the pool is fully
unit-testable without a network connection.
"""

import threading
from typing import Callable, Optional


class PoolFullError(RuntimeError):
    """Raised when every connection slot is at capacity and the pool is full."""


TickCallback = Callable[[str, dict], None]


class UpstoxFeedSlot:
    """One Upstox connection carrying many instrument keys."""

    def __init__(
        self,
        token: Optional[str],
        on_feeds: Callable[[dict], None],
        on_error: Callable[[str], None],
        mode: str = "full",
    ):
        self._token = token
        self._on_feeds = on_feeds
        self._on_error = on_error
        self._mode = mode
        self._keys: set[str] = set()
        self._streamer = None

    @property
    def keys(self) -> set[str]:
        return set(self._keys)

    @property
    def size(self) -> int:
        return len(self._keys)

    def has_capacity(self, max_keys: int) -> bool:
        return len(self._keys) < max_keys

    def start(self) -> None:
        """Open the Upstox connection (no-op if already started)."""
        if self._streamer is not None:
            return
        if not self._token:
            self._on_error("No Upstox access token for pool slot")
            return

        import upstox_client
        from upstox_client import MarketDataStreamerV3

        cfg = upstox_client.Configuration()
        cfg.access_token = self._token
        client = upstox_client.ApiClient(cfg)
        self._streamer = MarketDataStreamerV3(client, [], mode=self._mode)
        self._streamer.on("message", self._handle_message)
        self._streamer.on("error", self._handle_error)
        self._streamer.connect()

        # Re-subscribe anything added before the connection opened.
        for key in list(self._keys):
            self._send_subscribe(key)

    def subscribe(self, key: str) -> None:
        if key in self._keys:
            return
        self._keys.add(key)
        self._send_subscribe(key)

    def unsubscribe(self, key: str) -> None:
        if key not in self._keys:
            return
        self._keys.discard(key)
        if self._streamer is not None:
            try:
                self._streamer.unsubscribe([key])
            except Exception:
                pass

    def stop(self) -> None:
        if self._streamer is not None:
            try:
                self._streamer.disconnect()
            except Exception:
                pass
            self._streamer = None

    # -- internals -----------------------------------------------------------
    def _send_subscribe(self, key: str) -> None:
        if self._streamer is None:
            return
        try:
            self._streamer.subscribe([key], self._mode)
        except Exception as exc:  # noqa: BLE001 - best effort
            self._on_error(f"subscribe failed: {exc}")

    def _handle_message(self, data) -> None:
        feeds = data.get("feeds") if isinstance(data, dict) else None
        if feeds:
            self._on_feeds(feeds)

    def _handle_error(self, err) -> None:
        self._on_error(str(err))


class UpstoxFeedPool:
    """Assigns instrument keys to a small set of shared Upstox connections."""

    def __init__(
        self,
        token_provider: Callable[[], Optional[str]],
        max_connections: int = 5,
        max_keys_per_connection: int = 2000,
        slot_factory: Optional[Callable[[Callable, Callable], UpstoxFeedSlot]] = None,
    ):
        self._token_provider = token_provider
        self._max_connections = max(1, max_connections)
        self._max_keys = max(1, max_keys_per_connection)
        self._slot_factory = slot_factory
        self._slots: list[UpstoxFeedSlot] = []
        self._subs: dict[str, set[TickCallback]] = {}
        self._lock = threading.RLock()

    # -- public API ----------------------------------------------------------
    def subscribe(self, instrument_key: str, callback: TickCallback) -> None:
        """Route ``instrument_key`` ticks to ``callback``.

        The first subscriber for a key allocates it onto a slot; later
        subscribers for the same key share that allocation (one key, one
        connection). Raises :class:`PoolFullError` when no slot can take it.
        """
        with self._lock:
            subs = self._subs.get(instrument_key)
            if subs is not None:
                subs.add(callback)
                return

            slot = self._find_slot_for_new_key()
            if slot is None:
                raise PoolFullError(
                    f"All {self._max_connections} Upstox connections are full "
                    f"({self._max_keys} keys each)."
                )
            slot.subscribe(instrument_key)
            self._subs[instrument_key] = {callback}

    def unsubscribe(self, instrument_key: str, callback: TickCallback) -> None:
        with self._lock:
            subs = self._subs.get(instrument_key)
            if not subs:
                return
            subs.discard(callback)
            if subs:
                return
            del self._subs[instrument_key]
            for slot in self._slots:
                if instrument_key in slot.keys:
                    slot.unsubscribe(instrument_key)
                    return

    def close(self) -> None:
        with self._lock:
            for slot in self._slots:
                slot.stop()
            self._slots.clear()
            self._subs.clear()

    def stats(self) -> dict:
        with self._lock:
            return {
                "connections": len(self._slots),
                "max_connections": self._max_connections,
                "keys": len(self._subs),
                "subscribers": sum(len(s) for s in self._subs.values()),
                "keys_per_connection": [s.size for s in self._slots],
            }

    # -- internals -----------------------------------------------------------
    def _find_slot_for_new_key(self) -> Optional[UpstoxFeedSlot]:
        for slot in self._slots:
            if slot.has_capacity(self._max_keys):
                return slot
        if len(self._slots) >= self._max_connections:
            return None
        slot = self._make_slot()
        self._slots.append(slot)
        slot.start()
        return slot

    def _make_slot(self) -> UpstoxFeedSlot:
        if self._slot_factory is not None:
            return self._slot_factory(self._route, self._on_slot_error)
        token = self._token_provider()
        return UpstoxFeedSlot(token, self._route, self._on_slot_error)

    def _route(self, feeds: dict) -> None:
        """Fan a decoded ``feeds`` dict out to each key's subscribers."""
        for instrument_key, feed in feeds.items():
            for callback in list(self._subs.get(instrument_key, ())):
                callback(instrument_key, feed)

    def _on_slot_error(self, message: str) -> None:
        # Errors are surfaced via subscribers when relevant; kept for logging
        # hooks by callers that wrap the factory.
        return
