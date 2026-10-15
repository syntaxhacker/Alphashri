"""The adapter hub must keep ONE connection per broker and route ticks by symbol.

Regression context: a per-tab adapter opened a second Fyers socket, and because
the SDK shares socket state the two feeds cross-delivered payloads. RAYMOND's
50-level depth arrived paired with RELIANCE's ltp/volume/cp, which the UI showed
as "Day +25%" and a ~13M-share CVD. These tests pin the invariants that make
that impossible.
"""

import pytest

from api.orderflow_adapter_hub import AdapterHub


class FakeAdapter:
    """Records connect/subscribe calls and exposes a manual tick injector."""

    name = "fake"
    max_symbols_per_connection = 5

    def __init__(self):
        self.connected_symbols: list[str] = []
        self.added: list[str] = []
        self.disconnected = 0
        self.on_tick = None
        self.on_error = None

    def connect(self, symbols, on_tick, on_error=None):
        self.connected_symbols = list(symbols)
        self.on_tick = on_tick
        self.on_error = on_error

    def subscribe_symbol(self, symbol):
        self.added.append(symbol)
        return True

    def disconnect(self):
        self.disconnected += 1

    def emit(self, broker_symbol, tick):
        self.on_tick(broker_symbol, tick)

    def fail(self, error):
        if self.on_error:
            self.on_error(error)


@pytest.fixture
def harness():
    """(hub, adapters_by_broker, factory) with one adapter per broker name."""
    created: dict[str, FakeAdapter] = {}

    def factory(broker, token):
        adapter = FakeAdapter()
        created[broker] = adapter
        return adapter

    hub = AdapterHub(adapter_factory=factory)
    return hub, created


class TestSingleConnection:
    def test_two_symbols_share_one_connection(self, harness):
        hub, created = harness
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "RELIANCE", on_tick=lambda s, t: None)

        assert len(created) == 1, "a second socket is the bug we are preventing"
        adapter = created["fyers_tbt"]
        assert adapter.connected_symbols == ["RAYMOND"]
        assert adapter.added == ["RELIANCE"]

    def test_second_subscriber_for_same_symbol_reuses_connection(self, harness):
        hub, created = harness
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)

        assert len(created) == 1
        assert created["fyers_tbt"].added == []
        assert hub.subscriber_count("fyers_tbt") == 2

    def test_different_brokers_get_separate_connections(self, harness):
        hub, created = harness
        hub.subscribe("fyers", "tok", "RAYMOND", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)

        assert set(created) == {"fyers", "fyers_tbt"}


class TestSymbolRouting:
    def test_ticks_reach_only_the_matching_symbol(self, harness):
        hub, created = harness
        raymond, reliance = [], []
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: raymond.append(t))
        hub.subscribe("fyers_tbt", "tok", "RELIANCE", on_tick=lambda s, t: reliance.append(t))

        adapter = created["fyers_tbt"]
        adapter.emit("NSE:RAYMOND-EQ", {"ltp": 981.0})
        adapter.emit("NSE:RELIANCE-EQ", {"ltp": 1249.4})

        assert raymond == [{"ltp": 981.0}]
        assert reliance == [{"ltp": 1249.4}]

    def test_listener_receives_app_symbol_not_broker_symbol(self, harness):
        hub, created = harness
        seen = []
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: seen.append(s))

        created["fyers_tbt"].emit("NSE:RAYMOND-EQ", {"ltp": 981.0})

        assert seen == ["RAYMOND"]

    def test_unknown_symbol_is_not_delivered(self, harness):
        hub, created = harness
        seen = []
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: seen.append(t))

        created["fyers_tbt"].emit("NSE:ITALY-EQ", {"ltp": 1.0})

        assert seen == []

    def test_lowercase_lookup_still_routes(self, harness):
        hub, created = harness
        seen = []
        hub.subscribe("fyers_tbt", "tok", "raymond", on_tick=lambda s, t: seen.append(t))

        created["fyers_tbt"].emit("NSE:RAYMOND-EQ", {"ltp": 981.0})

        assert seen == [{"ltp": 981.0}]


class TestLifecycle:
    def test_release_last_subscriber_closes_connection(self, harness):
        hub, created = harness
        sub = hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)
        sub.release()

        assert created["fyers_tbt"].disconnected == 1
        assert hub.active_brokers() == []

    def test_connection_stays_open_while_other_symbols_remain(self, harness):
        hub, created = harness
        first = hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "RELIANCE", on_tick=lambda s, t: None)

        first.release()

        assert created["fyers_tbt"].disconnected == 0
        assert hub.subscriber_count("fyers_tbt") == 1

    def test_release_is_idempotent(self, harness):
        hub, created = harness
        sub = hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)
        sub.release()
        sub.release()

        assert created["fyers_tbt"].disconnected == 1

    def test_released_listener_stops_receiving(self, harness):
        hub, created = harness
        seen = []
        sub = hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: seen.append(t))

        created["fyers_tbt"].emit("NSE:RAYMOND-EQ", {"ltp": 1.0})
        sub.release()
        created["fyers_tbt"].emit("NSE:RAYMOND-EQ", {"ltp": 2.0})

        assert seen == [{"ltp": 1.0}]

    def test_shutdown_closes_everything(self, harness):
        hub, created = harness
        hub.subscribe("fyers", "tok", "RAYMOND", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)

        hub.shutdown()

        assert created["fyers"].disconnected == 1
        assert created["fyers_tbt"].disconnected == 1
        assert hub.active_brokers() == []


class TestFailureHandling:
    def test_connect_failure_rolls_back_the_entry(self, harness):
        created = {}

        def factory(broker, token):
            adapter = FakeAdapter()

            def boom(*_a, **_k):
                raise RuntimeError("token expired")

            adapter.connect = boom
            created[broker] = adapter
            return adapter

        hub = AdapterHub(adapter_factory=factory)
        with pytest.raises(RuntimeError):
            hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)

        assert hub.active_brokers() == [], "a failed connect must not leave a ghost entry"
        assert hub.subscriber_count("fyers_tbt") == 0

    def test_grow_failure_reports_to_subscriber_and_drops_it(self, harness):
        hub, created = harness
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None)

        adapter = created["fyers_tbt"]

        def boom(_symbol):
            raise RuntimeError("channel limit")

        adapter.subscribe_symbol = boom
        errors = []
        hub.subscribe(
            "fyers_tbt", "tok", "RELIANCE",
            on_tick=lambda s, t: None,
            on_error=errors.append,
        )

        assert len(errors) == 1 and "channel limit" in str(errors[0])
        assert hub.subscriber_count("fyers_tbt") == 1

    def test_adapter_errors_fan_out_to_all_listeners(self, harness):
        hub, created = harness
        first, second = [], []
        hub.subscribe("fyers_tbt", "tok", "RAYMOND", on_tick=lambda s, t: None, on_error=first.append)
        hub.subscribe("fyers_tbt", "tok", "RELIANCE", on_tick=lambda s, t: None, on_error=second.append)

        created["fyers_tbt"].fail("socket dropped")

        assert first == ["socket dropped"]
        assert second == ["socket dropped"]

    def test_missing_broker_name_is_rejected(self, harness):
        hub, _ = harness
        with pytest.raises(ValueError):
            hub.subscribe("", "tok", "RAYMOND", on_tick=lambda s, t: None)

    def test_missing_symbol_is_rejected(self, harness):
        hub, _ = harness
        with pytest.raises(ValueError):
            hub.subscribe("fyers_tbt", "tok", "   ", on_tick=lambda s, t: None)


class TestConnectionSymbolLimit:
    """One connection has a hard symbol ceiling (Fyers TBT: 5).

    Exceeding it makes the broker drop subscriptions, so the hub must refuse
    instead of silently streaming fewer symbols than were asked for.
    """

    def _hub_with_limit(self, limit):
        created = {}

        def factory(broker, token):
            adapter = FakeAdapter()
            adapter.max_symbols_per_connection = limit
            created[broker] = adapter
            return adapter

        return AdapterHub(adapter_factory=factory), created

    def test_symbols_up_to_the_limit_are_accepted(self):
        hub, created = self._hub_with_limit(3)
        for symbol in ("A", "B", "C"):
            hub.subscribe("fyers_tbt", "tok", symbol, on_tick=lambda s, t: None)

        assert created["fyers_tbt"].added == ["B", "C"]
        assert hub.subscriber_count("fyers_tbt") == 3

    def test_symbol_beyond_the_limit_is_rejected(self):
        hub, created = self._hub_with_limit(2)
        errors = []
        hub.subscribe("fyers_tbt", "tok", "A", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "B", on_tick=lambda s, t: None)
        hub.subscribe("fyers_tbt", "tok", "C", on_tick=lambda s, t: None, on_error=errors.append)

        assert len(errors) == 1
        assert "allows 2 symbols per connection" in str(errors[0])
        assert created["fyers_tbt"].added == ["B"], "C must never reach the adapter"
        assert hub.subscriber_count("fyers_tbt") == 2, "rejected listener must be dropped"

    def test_extra_subscriber_for_an_existing_symbol_is_not_blocked(self):
        hub, created = self._hub_with_limit(1)
        hub.subscribe("fyers_tbt", "tok", "A", on_tick=lambda s, t: None)
        # Same symbol, second tab: reuses the existing subscription, no new symbol.
        hub.subscribe("fyers_tbt", "tok", "A", on_tick=lambda s, t: None)

        assert created["fyers_tbt"].added == []
        assert hub.subscriber_count("fyers_tbt") == 2

    def test_raise_when_no_error_handler_supplied(self):
        hub, created = self._hub_with_limit(1)
        hub.subscribe("fyers_tbt", "tok", "A", on_tick=lambda s, t: None)

        with pytest.raises(RuntimeError):
            hub.subscribe("fyers_tbt", "tok", "B", on_tick=lambda s, t: None)
        assert hub.subscriber_count("fyers_tbt") == 1

    def test_unlimited_adapter_is_unaffected(self):
        created = {}

        def factory(broker, token):
            adapter = FakeAdapter()
            adapter.max_symbols_per_connection = None
            created[broker] = adapter
            return adapter

        hub = AdapterHub(adapter_factory=factory)
        for symbol in ("A", "B", "C", "D", "E", "F", "G"):
            hub.subscribe("fyers_tbt", "tok", symbol, on_tick=lambda s, t: None)

        assert hub.subscriber_count("fyers_tbt") == 7
