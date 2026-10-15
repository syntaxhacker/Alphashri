"""Tests for the shared Upstox feed connection pool (api/orderflow_pool.py)."""

from unittest.mock import MagicMock

import pytest

from api.orderflow_pool import PoolFullError, UpstoxFeedPool, UpstoxFeedSlot


class FakeSlot:
    """In-memory stand-in for one Upstox connection."""

    def __init__(self, on_feeds, on_error):
        self.on_feeds = on_feeds
        self.on_error = on_error
        self._keys: set[str] = set()
        self.started = False
        self.stopped = False
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []

    @property
    def keys(self) -> set[str]:
        return set(self._keys)

    @property
    def size(self) -> int:
        return len(self._keys)

    def has_capacity(self, max_keys: int) -> bool:
        return len(self._keys) < max_keys

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True
        self._keys.clear()

    def subscribe(self, key: str) -> None:
        if key in self._keys:
            return
        self._keys.add(key)
        self.subscribed.append(key)

    def unsubscribe(self, key: str) -> None:
        self._keys.discard(key)
        self.unsubscribed.append(key)


def make_pool(slots, max_connections=2, max_keys=2):
    def factory(on_feeds, on_error):
        slot = FakeSlot(on_feeds, on_error)
        slots.append(slot)
        return slot

    return UpstoxFeedPool(
        token_provider=lambda: "tok",
        max_connections=max_connections,
        max_keys_per_connection=max_keys,
        slot_factory=factory,
    )


class TestSlotAssignment:
    def test_first_key_allocates_and_starts_a_slot(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        pool.subscribe("NSE_EQ|A", MagicMock())

        assert len(slots) == 1
        assert slots[0].started is True
        assert slots[0].keys == {"NSE_EQ|A"}
        assert pool.stats() == {
            "connections": 1,
            "max_connections": 2,
            "keys": 1,
            "subscribers": 1,
            "keys_per_connection": [1],
        }

    def test_second_key_reuses_the_same_slot(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        pool.subscribe("NSE_EQ|A", MagicMock())
        pool.subscribe("NSE_EQ|B", MagicMock())

        assert len(slots) == 1
        assert slots[0].keys == {"NSE_EQ|A", "NSE_EQ|B"}

    def test_new_slot_when_current_is_full(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots, max_keys=2)
        for key in ("A", "B", "C"):
            pool.subscribe(f"NSE_EQ|{key}", MagicMock())

        assert len(slots) == 2
        assert slots[1].keys == {"NSE_EQ|C"}
        assert slots[1].started is True

    def test_raises_when_pool_is_full(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots, max_connections=2, max_keys=2)
        for key in ("A", "B", "C", "D"):
            pool.subscribe(f"NSE_EQ|{key}", MagicMock())

        assert len(slots) == 2
        with pytest.raises(PoolFullError):
            pool.subscribe("NSE_EQ|E", MagicMock())

    def test_full_pool_does_not_register_the_rejected_subscriber(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots, max_connections=1, max_keys=1)
        pool.subscribe("NSE_EQ|A", MagicMock())
        with pytest.raises(PoolFullError):
            pool.subscribe("NSE_EQ|B", MagicMock())
        assert pool.stats()["keys"] == 1


class TestRouting:
    def test_same_key_dedupes_to_one_connection_and_fans_out(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        cb1, cb2 = MagicMock(), MagicMock()
        pool.subscribe("NSE_EQ|A", cb1)
        pool.subscribe("NSE_EQ|A", cb2)

        assert len(slots) == 1
        assert slots[0].keys == {"NSE_EQ|A"}
        assert slots[0].subscribed == ["NSE_EQ|A"]  # one wire subscription

        slots[0].on_feeds({"NSE_EQ|A": {"ltp": 1}})
        cb1.assert_called_once_with("NSE_EQ|A", {"ltp": 1})
        cb2.assert_called_once_with("NSE_EQ|A", {"ltp": 1})

    def test_ticks_only_reach_matching_key_subscribers(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        cb_a, cb_b = MagicMock(), MagicMock()
        pool.subscribe("NSE_EQ|A", cb_a)
        pool.subscribe("NSE_EQ|B", cb_b)

        slots[0].on_feeds({"NSE_EQ|B": {"ltp": 2}})
        cb_a.assert_not_called()
        cb_b.assert_called_once_with("NSE_EQ|B", {"ltp": 2})


class TestUnsubscribe:
    def test_key_released_only_when_last_subscriber_leaves(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        cb1, cb2 = MagicMock(), MagicMock()
        pool.subscribe("NSE_EQ|A", cb1)
        pool.subscribe("NSE_EQ|A", cb2)

        pool.unsubscribe("NSE_EQ|A", cb1)
        assert "NSE_EQ|A" in slots[0].keys

        pool.unsubscribe("NSE_EQ|A", cb2)
        assert "NSE_EQ|A" not in slots[0].keys
        assert "NSE_EQ|A" in slots[0].unsubscribed
        assert pool.stats()["keys"] == 0

    def test_unknown_key_is_a_noop(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        pool.unsubscribe("NOPE", MagicMock())  # must not raise
        assert pool.stats()["keys"] == 0


class TestLifecycle:
    def test_close_stops_every_slot(self):
        slots: list[FakeSlot] = []
        pool = make_pool(slots)
        pool.subscribe("NSE_EQ|A", MagicMock())
        pool.subscribe("NSE_EQ|B", MagicMock())
        pool.subscribe("NSE_EQ|C", MagicMock())  # second slot

        pool.close()
        assert all(slot.stopped for slot in slots)
        assert pool.stats()["connections"] == 0


class TestRealSlotWithoutNetwork:
    def test_start_without_token_reports_error(self):
        errors: list[str] = []
        slot = UpstoxFeedSlot(None, lambda feeds: None, errors.append)
        slot.start()
        assert errors == ["No Upstox access token for pool slot"]
        assert slot._streamer is None

    def test_subscribe_before_start_is_buffered(self):
        slot = UpstoxFeedSlot(None, lambda feeds: None, lambda err: None)
        slot.subscribe("NSE_EQ|A")
        assert slot.keys == {"NSE_EQ|A"}
        assert slot._streamer is None  # no wire subscription before start()

    def test_message_handler_emits_feeds_only(self):
        seen = []
        slot = UpstoxFeedSlot("tok", seen.append, lambda err: None)
        slot._handle_message({"type": "live_feed", "feeds": {"NSE_EQ|A": {"ltp": 5}}})
        slot._handle_message("not a dict")
        slot._handle_message({"type": "market_info"})  # no feeds
        assert seen == [{"NSE_EQ|A": {"ltp": 5}}]
