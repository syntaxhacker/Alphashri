"""Tests for the Order Flow WebSocket bridge (api/orderflow_stream.py)."""

import queue as thr_queue

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import orderflow_stream
from api.orderflow_stream import _normalize_tick, _normalize_market_status, _num


@pytest.fixture(autouse=True)
def _disable_journal(monkeypatch):
    """Keep tests from reading/writing the real session journal."""
    monkeypatch.setenv("ORDERFLOW_JOURNAL", "0")
    yield


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(orderflow_stream.router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Unit: normalization
# ---------------------------------------------------------------------------

class TestNum:
    def test_coerces_numeric_strings(self):
        assert _num("75") == 75.0

    def test_none_returns_default(self):
        assert _num(None) == 0.0
        assert _num(None, 5.0) == 5.0

    def test_invalid_returns_default(self):
        assert _num("abc") == 0.0


class TestNormalizeTick:
    def _full_payload(self):
        return {
            "NSE_EQ|INE002A01018": {
                "fullFeed": {
                    "marketFF": {
                        "ltpc": {"ltp": 2450.5, "ltt": "1713345678000", "ltq": "10", "cp": 2400.0},
                        "marketLevel": {
                            "bidAskQuote": [
                                {"bidQ": "500", "bidP": 2450.45, "askQ": "300", "askP": 2450.55},
                                {"bidQ": "100", "bidP": 2450.40, "askQ": "0", "askP": 0},
                            ]
                        },
                        "vtt": "1234567",
                        "atp": 2441.25,
                        "tbq": 46050,
                        "tsq": 41850,
                        "oi": 210000,
                        "iv": 0.131,
                        "marketOHLC": {
                            "ohlc": [
                                {"interval": "1d", "open": 2400, "high": 2470, "low": 2380, "close": 2450.5, "vol": "779400"},
                                {"interval": "I1", "open": 2450, "high": 2452, "low": 2449, "close": 2450.5, "vol": "8475"},
                            ]
                        },
                    }
                },
                "requestMode": "full_d5",
            }
        }

    def test_maps_to_market_data_shape(self):
        tick = _normalize_tick(self._full_payload())
        assert tick["type"] == "market_data"
        data = tick["data"]
        assert data["ltp"] == 2450.5
        assert data["volume"] == 1234567.0
        assert data["vwap"] == 2441.25
        assert data["ltt"] == 1713345678000
        assert data["depth"]["buy"][0] == {"price": 2450.45, "quantity": 500.0, "orders": 0}
        assert data["depth"]["sell"] == [{"price": 2450.55, "quantity": 300.0, "orders": 0}]

    def test_includes_extra_full_feed_fields(self):
        data = _normalize_tick(self._full_payload())["data"]
        assert data["tbq"] == 46050.0
        assert data["tsq"] == 41850.0
        assert data["oi"] == 210000.0
        assert data["iv"] == 0.131
        assert data["day"] == {
            "open": 2400.0, "high": 2470.0, "low": 2380.0, "close": 2450.5, "volume": 779400.0,
        }

    def test_extracts_option_greeks(self):
        payload = self._full_payload()
        mff = payload["NSE_EQ|INE002A01018"]["fullFeed"]["marketFF"]
        mff["optionGreeks"] = {
            "delta": 0.5, "gamma": 0.0007, "theta": -8.5, "vega": 16.7, "rho": 3.9,
        }
        greeks = _normalize_tick(payload)["data"]["greeks"]
        assert greeks == {"delta": 0.5, "gamma": 0.0007, "theta": -8.5, "vega": 16.7, "rho": 3.9}

    def test_equity_has_no_greeks(self):
        assert _normalize_tick(self._full_payload())["data"]["greeks"] is None

    def test_vwap_defaults_to_zero_without_atp(self):
        payload = self._full_payload()
        del payload["NSE_EQ|INE002A01018"]["fullFeed"]["marketFF"]["atp"]
        assert _normalize_tick(payload)["data"]["vwap"] == 0.0

    def test_filters_zero_price_and_qty_levels(self):
        tick = _normalize_tick(self._full_payload())
        assert len(tick["data"]["depth"]["buy"]) == 2
        assert len(tick["data"]["depth"]["sell"]) == 1

    def test_ltpc_only_feed_returns_none(self):
        payload = {"NSE_EQ|X": {"ltpc": {"ltp": 100.0}}}
        assert _normalize_tick(payload) is None

    def test_empty_payload_returns_none(self):
        assert _normalize_tick({}) is None
        assert _normalize_tick(None) is None


class TestMarketStatus:
    def test_extracts_segment_status(self):
        msg = {
            "type": "market_info",
            "currentTs": "1732775008661",
            "marketInfo": {
                "segmentStatus": {"NSE_EQ": "NORMAL_OPEN", "NSE_FO": "NORMAL_OPEN"}
            },
        }
        out = _normalize_market_status(msg)
        assert out["type"] == "market_status"
        assert out["segments"]["NSE_EQ"] == "NORMAL_OPEN"

    def test_non_market_info_returns_none(self):
        assert _normalize_market_status({"type": "live_feed", "feeds": {}}) is None
        assert _normalize_market_status({"type": "market_info", "marketInfo": {}}) is None


# ---------------------------------------------------------------------------
# WebSocket protocol
# ---------------------------------------------------------------------------

class TestOrderFlowWs:
    def test_rejects_invalid_token(self):
        with _make_client().websocket_connect("/ws/orderflow") as ws:
            ws.send_json({"action": "authenticate", "api_key": "garbage"})
            msg = ws.receive_json()
            assert "Authentication failed" in msg["message"]

    def test_rejects_wrong_action(self, monkeypatch):
        monkeypatch.setattr(orderflow_stream, "decode_token", lambda _t: {"type": "access"})
        with _make_client().websocket_connect("/ws/orderflow") as ws:
            ws.send_json({"action": "hello"})
            msg = ws.receive_json()
            assert "expected authenticate" in msg["message"]

    def test_auth_success_then_symbol_not_found(self, monkeypatch):
        monkeypatch.setattr(orderflow_stream, "decode_token", lambda _t: {"type": "access"})
        monkeypatch.setattr(orderflow_stream, "_resolve_instrument_key", lambda *a, **k: None)
        with _make_client().websocket_connect("/ws/orderflow") as ws:
            ws.send_json({"action": "authenticate", "api_key": "tok"})
            assert ws.receive_json()["message"] == "Authentication successful"
            ws.send_json({"action": "subscribe", "symbol": "NOPE", "exchange": "NSE"})
            msg = ws.receive_json()
            assert msg["type"] == "subscribe"
            assert msg["status"] == "error"
            assert "Symbol not found" in msg["message"]

    def test_subscribe_without_upstox_token(self, monkeypatch):
        monkeypatch.setattr(orderflow_stream, "decode_token", lambda _t: {"type": "access"})
        monkeypatch.setattr(orderflow_stream, "_resolve_instrument_key", lambda *a, **k: "NSE_EQ|X")
        monkeypatch.setattr(orderflow_stream, "_get_upstox_token", lambda: None)
        with _make_client().websocket_connect("/ws/orderflow") as ws:
            ws.send_json({"action": "authenticate", "api_key": "tok"})
            ws.receive_json()
            ws.send_json({"action": "subscribe", "symbol": "RELIANCE", "exchange": "NSE"})
            msg = ws.receive_json()
            assert msg["status"] == "error"
            assert "No Upstox access token" in msg["message"]

    def test_subscribe_success_streams_market_data(self, monkeypatch):
        monkeypatch.setattr(orderflow_stream, "decode_token", lambda _t: {"type": "access"})
        monkeypatch.setattr(orderflow_stream, "_resolve_instrument_key", lambda *a, **k: "NSE_EQ|X")
        monkeypatch.setattr(orderflow_stream, "_get_upstox_token", lambda: "uptoken")

        tick = {
            "type": "market_data",
            "data": {
                "ltp": 100.0,
                "volume": 10.0,
                "ltt": 1713345678000,
                "depth": {"buy": [], "sell": []},
            },
        }

        class FakeStream:
            def __init__(self, token, instrument_key, q, symbol=""):
                self.q = q
                self.symbol = symbol

            def warm_start(self):
                pass

            def start(self):
                self.q.put_nowait(tick)

            def stop(self):
                pass

        monkeypatch.setattr(orderflow_stream, "_UpstoxOrderFlowStream", FakeStream)

        with _make_client().websocket_connect("/ws/orderflow") as ws:
            ws.send_json({"action": "authenticate", "api_key": "tok"})
            ws.receive_json()
            ws.send_json({"action": "subscribe", "symbol": "RELIANCE", "exchange": "NSE"})
            assert ws.receive_json() == {"type": "subscribe", "status": "success"}
            assert ws.receive_json() == tick


def test_upstox_stream_push_drops_on_full_queue():
    q = thr_queue.Queue(maxsize=1)
    stream = orderflow_stream._UpstoxOrderFlowStream("tok", "NSE_EQ|X", q)
    q.put_nowait({"first": True})
    stream._push({"second": True})  # must not raise
    assert q.qsize() == 1


class TestConnectionLimiter:
    def test_cap_and_release(self, monkeypatch):
        monkeypatch.setenv("ORDERFLOW_MAX_CONNECTIONS", "2")
        monkeypatch.setattr(orderflow_stream, "_active_connections", 0)
        assert orderflow_stream._acquire_connection() is True
        assert orderflow_stream._acquire_connection() is True
        assert orderflow_stream._acquire_connection() is False  # capped
        orderflow_stream._release_connection()
        assert orderflow_stream._acquire_connection() is True
        orderflow_stream._release_connection()
        orderflow_stream._release_connection()
        assert orderflow_stream._active_connections == 0

    def test_default_is_five(self, monkeypatch):
        monkeypatch.delenv("ORDERFLOW_MAX_CONNECTIONS", raising=False)
        assert orderflow_stream._max_connections() == 5


class TestBuildHistory:
    def _entries(self, n=10):
        return [
            {"ts": i * 1000, "kind": "tick", "data": {"ltt": i * 1000, "ltp": 100 + i}}
            for i in range(n)
        ]

    def test_windows_to_latest(self, monkeypatch):
        entries = self._entries()
        signals = [{"ts": 1, "kind": "signal", "data": {"side": "BUY", "score": 0.5}}]
        monkeypatch.setattr(orderflow_stream.orderflow_journal, "is_enabled", lambda: True)
        monkeypatch.setattr(
            orderflow_stream.orderflow_journal,
            "read",
            lambda symbol, day=None, kind=None: entries if kind == "tick" else signals,
        )
        hist = orderflow_stream._build_history("RELIANCE", window_sec=3, max_ticks=100)
        # latest ltt = 9000, cutoff 6000 -> ticks with ltt 6000..9000
        assert [t["ltp"] for t in hist["ticks"]] == [106, 107, 108, 109]
        assert hist["signals"] == [{"side": "BUY", "score": 0.5}]

    def test_caps_tick_count(self, monkeypatch):
        entries = self._entries(100)
        monkeypatch.setattr(orderflow_stream.orderflow_journal, "is_enabled", lambda: True)
        monkeypatch.setattr(
            orderflow_stream.orderflow_journal,
            "read",
            lambda symbol, day=None, kind=None: entries if kind == "tick" else [],
        )
        hist = orderflow_stream._build_history("X", window_sec=10_000, max_ticks=5)
        assert len(hist["ticks"]) == 5

    def test_disabled_returns_empty(self, monkeypatch):
        monkeypatch.setattr(orderflow_stream.orderflow_journal, "is_enabled", lambda: False)
        assert orderflow_stream._build_history("X") == {"ticks": [], "signals": []}


class TestSymbolResolution:
    def test_passes_through_instrument_key(self):
        assert orderflow_stream._resolve_instrument_key("NSE_FO|56984") == "NSE_FO|56984"

    def test_falls_back_to_instruments_json_for_fno(self, monkeypatch):
        monkeypatch.setattr(
            orderflow_stream,
            "_load_instruments_json",
            lambda: {"NIFTY 23250 PE 22 SEP 26": "NSE_FO|56984"},
        )
        assert (
            orderflow_stream._resolve_instrument_key("nifty 23250 pe 22 sep 26", "NFO")
            == "NSE_FO|56984"
        )

    def test_empty_symbol_returns_none(self):
        assert orderflow_stream._resolve_instrument_key("") is None


class TestStreamMessageHandling:
    """End-to-end: decoded feed message → queued status / tick / signal."""

    IKEY = "NSE_EQ|INE002A01018"

    def _stream(self):
        q: thr_queue.Queue = thr_queue.Queue()
        return orderflow_stream._UpstoxOrderFlowStream("tok", self.IKEY, q), q

    def _msg(self, ts_sec, ltp, vol, bid, ask, tbq, tsq, atp):
        return {
            "feeds": {
                self.IKEY: {
                    "fullFeed": {
                        "marketFF": {
                            "ltpc": {"ltp": ltp, "ltt": str(int(ts_sec * 1000)), "ltq": "10", "cp": 100.0},
                            "marketLevel": {
                                "bidAskQuote": [
                                    {"bidQ": "1000", "bidP": bid, "askQ": "1000", "askP": ask}
                                ]
                            },
                            "vtt": str(int(vol)),
                            "atp": atp,
                            "tbq": tbq,
                            "tsq": tsq,
                        }
                    }
                }
            }
        }

    def test_market_status_is_pushed(self):
        stream, q = self._stream()
        stream.handle_feed_message(
            {"type": "market_info", "currentTs": "1", "marketInfo": {"segmentStatus": {"NSE_EQ": "NORMAL_OPEN"}}}
        )
        msg = q.get_nowait()
        assert msg["type"] == "market_status"
        assert msg["segments"]["NSE_EQ"] == "NORMAL_OPEN"

    def test_ticks_and_buy_signal_are_pushed(self):
        stream, q = self._stream()
        for i in range(45):
            ts = 1000 + i
            ltp = 100.0 + i * 0.02
            stream.handle_feed_message(
                self._msg(ts, ltp, 1000 * i, ltp - 0.05, ltp, 500_000, 100_000, 99.0)
            )
        types = []
        while not q.empty():
            types.append(q.get_nowait()["type"])
        assert "market_data" in types
        assert "signal" in types

    def test_closed_stream_ignores_messages(self):
        stream, q = self._stream()
        stream.stop()
        stream.handle_feed_message(
            self._msg(1000, 100.0, 1000, 99.95, 100.0, 1, 1, 100.0)
        )
        assert q.empty()

