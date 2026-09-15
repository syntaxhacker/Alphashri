"""Tests for the headless order-flow recorder (api/orderflow_recorder.py)."""

import pytest

from api import orderflow_recorder
from api.orderflow_recorder import OrderFlowRecorder, recorder_symbols

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
        lambda symbol, kind, payload: calls.append((symbol, kind, payload)),
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
