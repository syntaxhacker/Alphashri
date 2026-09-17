"""Tests for the headless order-flow recorder (api/orderflow_recorder.py)."""

import pytest

from api import orderflow_recorder
from api.orderflow_recorder import OrderFlowRecorder, recorder_symbols

import pytest as _pytest


@_pytest.fixture(autouse=True)
def _clean_broker_env(monkeypatch):
    monkeypatch.delenv("ORDERFLOW_BROKER", raising=False)
    monkeypatch.delenv("ORDERFLOW_RECORDER_BROKER", raising=False)
    monkeypatch.delenv("ORDERFLOW_RECORDER_IN_API", raising=False)
    yield


IKEY_RELIANCE = "NSE_EQ|INE002A01018"
IKEY_TCS = "NSE_EQ|INE467B01029"


class FakeStreamer:
    def __init__(self, token):
        self.token = token
        self.handlers = {}
        self.subscribed = []
        self.connected = False
        self.disconnected = False

    def on(self, event, handler):
        self.handlers[event] = handler

    def subscribe(self, keys, mode):
        self.subscribed.append((list(keys), mode))

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.disconnected = True


def _full_feed(
    ltp=100.0,
    ltt=1713345678000,
    vol=1000,
    bid=99.95,
    ask=100.0,
    tbq=500_000,
    tsq=100_000,
    vwap=99.0,
):
    return {
        "fullFeed": {
            "marketFF": {
                "ltpc": {"ltp": ltp, "ltt": str(ltt), "ltq": "10", "cp": 100.0},
                "marketLevel": {
                    "bidAskQuote": [
                        {"bidQ": "1000", "bidP": bid, "askQ": "1000", "askP": ask}
                    ]
                },
                "vtt": str(vol),
                "atp": vwap,
                "tbq": tbq,
                "tsq": tsq,
            }
        }
    }


def _resolver(mapping):
    return lambda symbol, exchange="NSE": mapping.get((symbol or "").upper())


@pytest.fixture
def capture_journal(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        orderflow_recorder.orderflow_journal,
        "append",
        lambda symbol, kind, payload, broker=None: calls.append((symbol, kind, payload, broker)),
    )
    return calls


# ---------------------------------------------------------------------------
# recorder_symbols
# ---------------------------------------------------------------------------

class TestRecorderSymbols:
    def test_default_includes_liquid_names_and_nifty_index(self, monkeypatch):
        monkeypatch.delenv("ORDERFLOW_RECORDER_SYMBOLS", raising=False)
        symbols = recorder_symbols()
        assert symbols[:5] == ["RELIANCE", "TCS", "INFY", "SBIN", "ICICIBANK"]
        assert "NSE_INDEX|Nifty 50" in symbols
        assert len(symbols) == len(set(symbols))

    def test_env_is_uppercased_deduped_and_trimmed(self, monkeypatch):
        monkeypatch.setenv(
            "ORDERFLOW_RECORDER_SYMBOLS", " reliance , tcs ,, RELIANCE "
        )
        assert recorder_symbols() == ["RELIANCE", "TCS"]

    def test_blank_env_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "   ")
        assert "NSE_INDEX|Nifty 50" in recorder_symbols()


# ---------------------------------------------------------------------------
# resolution
# ---------------------------------------------------------------------------

class TestResolution:
    def test_resolves_each_symbol_and_skips_unresolved(self, monkeypatch):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE, "TCS": IKEY_TCS}),
        )
        rec = OrderFlowRecorder(["RELIANCE", "TCS", "NOPE"], "tok", streamer_factory=FakeStreamer)
        assert rec._keys == {IKEY_RELIANCE: "RELIANCE", IKEY_TCS: "TCS"}
        assert set(rec._engines) == {"RELIANCE", "TCS"}

    def test_start_subscribes_all_resolved_keys(self, monkeypatch):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE, "TCS": IKEY_TCS}),
        )
        created = {}

        def factory(token):
            created["streamer"] = FakeStreamer(token)
            return created["streamer"]

        rec = OrderFlowRecorder(["RELIANCE", "TCS"], "tok", streamer_factory=factory)
        rec.start()

        streamer = created["streamer"]
        assert streamer.token == "tok"
        assert streamer.connected is True
        assert set(streamer.handlers) == {"open", "message", "error", "close", "reconnecting"}

        streamer.handlers["open"]()
        assert streamer.subscribed == [([IKEY_RELIANCE, IKEY_TCS], "full")]

        rec.stop()
        assert streamer.disconnected is True

    def test_start_without_resolved_keys_does_not_connect(self, monkeypatch):
        monkeypatch.setattr(orderflow_recorder, "_resolve_instrument_key", _resolver({}))
        created = {}
        rec = OrderFlowRecorder(["NOPE"], "tok", streamer_factory=lambda t: created.setdefault("s", FakeStreamer(t)))
        rec.start()
        assert "s" not in created


# ---------------------------------------------------------------------------
# message routing
# ---------------------------------------------------------------------------

class TestOnMessage:
    def test_routes_each_key_to_its_symbol_journal(self, monkeypatch, capture_journal):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE, "TCS": IKEY_TCS}),
        )
        rec = OrderFlowRecorder(["RELIANCE", "TCS"], "tok", streamer_factory=FakeStreamer)
        rec.on_message(
            {
                "feeds": {
                    IKEY_RELIANCE: _full_feed(ltp=101.0),
                    IKEY_TCS: _full_feed(ltp=202.0),
                }
            }
        )

        ticks = [c for c in capture_journal if c[1] == "tick"]
        assert {c[0] for c in ticks} == {"RELIANCE", "TCS"}
        assert {c[0]: c[2]["ltp"] for c in ticks} == {"RELIANCE": 101.0, "TCS": 202.0}

    def test_engine_emits_journaled_signal(self, monkeypatch, capture_journal):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE}),
        )
        rec = OrderFlowRecorder(["RELIANCE"], "tok", streamer_factory=FakeStreamer)

        for i in range(45):
            ts = 1000 + i
            ltp = 100.0 + i * 0.02
            rec.on_message(
                {
                    "feeds": {
                        IKEY_RELIANCE: _full_feed(
                            ltp=ltp,
                            ltt=ts * 1000,
                            vol=1000 * i,
                            bid=ltp - 0.05,
                            ask=ltp,
                        )
                    }
                }
            )

        signals = [c for c in capture_journal if c[1] == "signal"]
        assert signals, "expected the per-symbol engine to emit a signal"
        assert all(c[0] == "RELIANCE" for c in signals)
        assert signals[-1][2]["side"].endswith("BUY")

    def test_market_info_does_not_journal_a_tick(self, monkeypatch, capture_journal):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE}),
        )
        rec = OrderFlowRecorder(["RELIANCE"], "tok", streamer_factory=FakeStreamer)
        rec.on_message(
            {
                "type": "market_info",
                "currentTs": "1732775008661",
                "marketInfo": {"segmentStatus": {"NSE_EQ": "NORMAL_OPEN"}},
            }
        )
        assert capture_journal == []

    def test_unknown_key_is_ignored(self, monkeypatch, capture_journal):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE}),
        )
        rec = OrderFlowRecorder(["RELIANCE"], "tok", streamer_factory=FakeStreamer)
        rec.on_message({"feeds": {"NSE_EQ|UNKNOWN": _full_feed()}})
        assert capture_journal == []


class TestGaps:
    def test_check_gaps_warns_once_per_window(self, monkeypatch, caplog):
        monkeypatch.setattr(
            orderflow_recorder,
            "_resolve_instrument_key",
            _resolver({"RELIANCE": IKEY_RELIANCE}),
        )
        rec = OrderFlowRecorder(["RELIANCE"], "tok", streamer_factory=FakeStreamer)
        rec._last_tick["RELIANCE"] = 0.0
        rec._last_gap_warn["RELIANCE"] = 0.0

        with caplog.at_level("WARNING", logger="orderflow.recorder"):
            rec.check_gaps(now=1000.0)
            rec.check_gaps(now=1001.0)
        assert len([r for r in caplog.records if "no tick" in r.getMessage()]) == 1


class FakeAdapter:
    """Minimal order-flow adapter double for the recorder's adapter path."""

    name = "fake"

    def __init__(self, *args, **kwargs):
        self.connected_symbols = None
        self.on_tick = None
        self.disconnected = False

    def broker_symbol(self, symbol):
        return f"X:{symbol}"

    def connect(self, symbols, on_tick, on_error=None):
        self.connected_symbols = list(symbols)
        self.on_tick = on_tick

    def disconnect(self):
        self.disconnected = True


class TestRecorderBrokerSelection:
    def test_recorder_broker_default_and_env(self, monkeypatch):
        monkeypatch.delenv("ORDERFLOW_BROKER", raising=False)
        assert orderflow_recorder.recorder_broker() == "upstox"
        monkeypatch.setenv("ORDERFLOW_BROKER", "Fyers_TBT")
        assert orderflow_recorder.recorder_broker() == "fyers_tbt"

    def test_recorder_token_prepends_fyers_app_id(self, monkeypatch):
        import config

        monkeypatch.setattr(config, "FYERS_CLIENT_ID", "APP-100")
        monkeypatch.setattr(
            "db.models.get_shared_broker_token", lambda name: {"access_token": "TOK"}
        )
        assert orderflow_recorder.recorder_token("fyers") == "APP-100:TOK"
        assert orderflow_recorder.recorder_token("fyers_tbt") == "APP-100:TOK"

    def test_recorder_token_none_without_fyers_token(self, monkeypatch):
        monkeypatch.setattr("db.models.get_shared_broker_token", lambda name: None)
        assert orderflow_recorder.recorder_token("fyers") is None


class TestRecorderAdapterPath:
    def _recorder(self, monkeypatch):
        monkeypatch.setattr(
            orderflow_recorder, "get_adapter", lambda name: FakeAdapter
        )
        return OrderFlowRecorder(["RELIANCE", "TCS"], "tok", broker="fyers")

    def test_builds_broker_symbol_map_and_engines(self, monkeypatch):
        rec = self._recorder(monkeypatch)
        assert rec._adapter is not None
        assert set(rec._engines) == {"RELIANCE", "TCS"}
        assert rec._broker_to_symbol == {"X:RELIANCE": "RELIANCE", "X:TCS": "TCS"}

    def test_start_connects_adapter_and_routes_ticks(self, monkeypatch):
        rec = self._recorder(monkeypatch)
        journaled = []
        monkeypatch.setattr(
            orderflow_recorder.orderflow_journal, "append",
            lambda symbol, kind, payload, broker=None: journaled.append((symbol, kind, broker)),
        )
        rec.start()
        assert rec._adapter.connected_symbols == ["RELIANCE", "TCS"]
        rec.on_tick_adapter("X:TCS", {"ltp": 1.0})
        # The broker is part of the write so one file can never hold two feeds.
        assert ("TCS", "tick", "fyers") in journaled

    def test_unknown_broker_has_no_adapter(self, monkeypatch):
        monkeypatch.setattr(orderflow_recorder, "get_adapter", lambda name: None)
        rec = OrderFlowRecorder(["RELIANCE"], "tok", broker="nope")
        assert rec._adapter is None
        rec.start()  # must not raise


class TestRecorderSymbolsCase:
    def test_env_preserves_index_key_case_but_uppercases_names(self, monkeypatch):
        monkeypatch.setenv(
            "ORDERFLOW_RECORDER_SYMBOLS", "reliance,nse_index|Nifty 50"
        )
        symbols = recorder_symbols()
        assert "RELIANCE" in symbols
        assert "nse_index|Nifty 50" in symbols  # key left verbatim




class _StopMain(Exception):
    """Raised from the fake recorder so main() returns immediately.

    main() blocks on ``stop.wait(GAP_WARN_SEC)`` after start(), which would hang
    a unit test; aborting from start() keeps the assertions on the setup path.
    """


class TestUnknownBrokerToken:
    """An unknown broker must not fall through to another broker's credentials.

    Regression: ``recorder_token`` treated anything that was not "upstox" as
    Fyers, so a typo'd broker name quietly spent the Fyers token.
    """

    def test_unknown_broker_returns_none(self, monkeypatch):
        called = []
        monkeypatch.setattr(
            "db.models.get_shared_broker_token",
            lambda name: called.append(name) or {"access_token": "TOK"},
        )
        assert orderflow_recorder.recorder_token("nope") is None
        assert called == [], "must not touch the token store for an unknown broker"

    def test_upstox_still_resolves_via_oauth(self, monkeypatch):
        monkeypatch.setattr("api.paper.live_stream._get_upstox_token", lambda: "UPTOK")
        assert orderflow_recorder.recorder_token("upstox") == "UPTOK"


class TestRecorderScriptMain:
    """The entrypoint must honour ORDERFLOW_RECORDER_BROKER.

    Regression: scripts/orderflow_recorder.py hardcoded the Upstox token and
    never passed ``broker=``, so a full trading day was journaled from Upstox
    while the journal looked healthy.
    """

    def _patch(self, monkeypatch, *, token="TOK", market_open=True, stop_on_start=True):
        from scripts import orderflow_recorder as script

        captured = {}

        class FakeRecorder:
            auth_failed = False

            def __init__(self, symbols, tok, broker="upstox"):
                captured["symbols"] = list(symbols)
                captured["token"] = tok
                captured["broker"] = broker
                self._keys = {"k": "RELIANCE"}
                self._adapter = None

            def start(self):
                captured["started"] = True
                if stop_on_start:
                    raise _StopMain

            def stop(self):
                captured["stopped"] = True

            def check_gaps(self):
                pass

        monkeypatch.setattr("api.orderflow_recorder.OrderFlowRecorder", FakeRecorder)
        monkeypatch.setattr("api.orderflow_recorder.recorder_token", lambda broker: token)
        monkeypatch.setattr("trading.utils.is_market_open", lambda: market_open)
        monkeypatch.setattr("api.orderflow_journal.close_all", lambda: None)
        return script, captured

    def test_uses_broker_from_env(self, monkeypatch):
        monkeypatch.setenv("ORDERFLOW_RECORDER_BROKER", "fyers_tbt")
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE,TCS")
        script, captured = self._patch(monkeypatch)

        with pytest.raises(_StopMain):
            script.main([])
        assert captured["broker"] == "fyers_tbt", "env broker must reach the recorder"
        assert captured["symbols"] == ["RELIANCE", "TCS"]

    def test_flag_overrides_env(self, monkeypatch):
        monkeypatch.setenv("ORDERFLOW_RECORDER_BROKER", "upstox")
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script, captured = self._patch(monkeypatch)

        with pytest.raises(_StopMain):
            script.main(["--broker", "fyers_tbt"])
        assert captured["broker"] == "fyers_tbt"

    def test_defaults_to_upstox_when_unset(self, monkeypatch):
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script, captured = self._patch(monkeypatch)

        with pytest.raises(_StopMain):
            script.main([])
        assert captured["broker"] == "upstox"

    def test_unknown_broker_exits_nonzero_without_starting(self, monkeypatch, capsys):
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script, captured = self._patch(monkeypatch)

        assert script.main(["--broker", "nope"]) == 1
        assert "Unknown broker 'nope'" in capsys.readouterr().out
        assert captured == {}, "must not construct a recorder for an unknown broker"

    def test_missing_token_exits_zero_for_that_broker(self, monkeypatch, capsys):
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script, captured = self._patch(monkeypatch, token=None)

        assert script.main(["--broker", "fyers_tbt"]) == 0
        assert "No fyers_tbt access token" in capsys.readouterr().out
        assert "started" not in captured

    def test_market_closed_exits_without_starting_recorder(self, monkeypatch, capsys):
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script, captured = self._patch(monkeypatch, market_open=False)

        assert script.main([]) == 0
        assert "Market is closed" in capsys.readouterr().out
        assert "started" not in captured

    def test_dry_run_reports_broker_without_starting(self, monkeypatch, capsys):
        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script, captured = self._patch(monkeypatch, market_open=False)

        assert script.main(["--broker", "fyers_tbt", "--dry-run"]) == 0
        out = capsys.readouterr().out
        assert "broker=fyers_tbt" in out and "Dry run" in out
        assert "started" not in captured


    def test_exits_when_the_broker_rejects_the_session(self, monkeypatch, capsys):
        """auth_failed must end the run instead of looping on gap warnings."""
        from scripts import orderflow_recorder as script

        monkeypatch.setenv("ORDERFLOW_RECORDER_SYMBOLS", "RELIANCE")
        script_inst, captured = self._patch(monkeypatch, stop_on_start=False)

        class AuthFailingRecorder:
            auth_failed = True

            def __init__(self, symbols, tok, broker="upstox"):
                captured["broker"] = broker
                self._keys = {"k": "RELIANCE"}
                self._adapter = None

            def start(self):
                captured["started"] = True

            def stop(self):
                captured["stopped"] = True

            def check_gaps(self):
                captured["gaps_checked"] = True

        monkeypatch.setattr("api.orderflow_recorder.OrderFlowRecorder", AuthFailingRecorder)
        # main() hard-exits after teardown; intercept it so pytest survives.
        monkeypatch.setattr(script.os, "_exit", lambda code: (_ for _ in ()).throw(_StopMain()))

        with pytest.raises(_StopMain):
            script_inst.main([])

        assert "rejected the session" in capsys.readouterr().out
        assert captured.get("gaps_checked") is None, "must not keep gap-polling"
        assert captured.get("stopped") is True, "teardown must still run"


class TestBridgeJournalDefault:
    def test_bridge_journaling_is_off_unless_opted_in(self, monkeypatch):
        import importlib

        import api.orderflow_stream as stream

        monkeypatch.delenv("ORDERFLOW_BRIDGE_JOURNAL", raising=False)
        reloaded = importlib.reload(stream)
        try:
            assert reloaded._BRIDGE_JOURNAL is False, (
                "tabs must not append their broker's ticks to the canonical journal"
            )
        finally:
            monkeypatch.undo()
            importlib.reload(stream)

    def test_bridge_journaling_can_be_opted_in(self, monkeypatch):
        import importlib

        import api.orderflow_stream as stream

        monkeypatch.setenv("ORDERFLOW_BRIDGE_JOURNAL", "1")
        reloaded = importlib.reload(stream)
        try:
            assert reloaded._BRIDGE_JOURNAL is True
        finally:
            monkeypatch.undo()
            importlib.reload(stream)

    def test_symbol_count_above_connection_limit_fails_fast(self, monkeypatch, capsys):
        from scripts import orderflow_recorder as script

        monkeypatch.setattr("api.orderflow_recorder.recorder_token", lambda broker: "TOK")
        monkeypatch.setattr("trading.utils.is_market_open", lambda: True)

        rc = script.main([
            "--broker", "fyers_tbt",
            "--symbols", "A,B,C,D,E,F",
        ])
        out = capsys.readouterr().out
        assert rc == 1
        assert "allows 5 symbols per connection but 6 were requested" in out


class TestAuthFailureIsTerminal:
    """A rejected session must not look like a quiet market.

    Without this the recorder looped forever emitting "no tick for X in Ns"
    gap warnings while never capturing anything, and the reason was buried.
    """

    RAW_403 = (
        "Handshake status 403 Forbidden -+-+- {'set-cookie': '__cf_bm=SECRET; Path=/', "
        "'cf-ray': 'abc-MAA'} -+-+- b''"
    )

    def _recorder(self):
        return OrderFlowRecorder(["RELIANCE"], "tok", streamer_factory=FakeStreamer)

    def test_auth_error_sets_the_flag(self):
        rec = self._recorder()
        rec._on_error(self.RAW_403)
        assert rec.auth_failed is True

    def test_transient_error_does_not_set_the_flag(self):
        rec = self._recorder()
        rec._on_error("connection reset by peer")
        assert rec.auth_failed is False

    def test_flag_starts_clear(self):
        assert self._recorder().auth_failed is False

    def test_auth_error_log_does_not_leak_the_blob(self, caplog):
        rec = self._recorder()
        with caplog.at_level("WARNING", logger="orderflow.recorder"):
            rec._on_error(self.RAW_403)
        assert all("SECRET" not in r.getMessage() for r in caplog.records)
