"""Tests for the Fyers order-flow adapter (no network / no SDK needed)."""

import sys
from unittest import mock

from api.orderflow_adapters import available_adapters, get_adapter
from api.orderflow_adapters.fyers import (
    FyersAdapter,
    FyersTbtAdapter,
    _default_socket_factory,
)


def _dp_payload(**overrides):
    payload = {
        "type": "dp",
        "symbol": "NSE:SBIN-EQ",
        "ltp": 800.5,
        "prev_close_price": 795.0,
        "open_price": 796.0,
        "high_price": 805.0,
        "low_price": 794.0,
        "vol_traded_today": 1234567,
        "avg_trade_price": 799.25,
        "last_traded_time": 1713345678,
        "last_traded_qty": 25,
        "tot_buy_qty": 40000,
        "tot_sell_qty": 51000,
    }
    for i in range(1, 6):
        payload[f"bid_price{i}"] = 800.5 - i
        payload[f"bid_size{i}"] = 100 * i
        payload[f"bid_order{i}"] = i
        payload[f"ask_price{i}"] = 800.5 + i
        payload[f"ask_size{i}"] = 200 * i
        payload[f"ask_order{i}"] = 10 + i
    payload.update(overrides)
    return payload


def _sf_payload(**overrides):
    payload = {
        "type": "sf",
        "symbol": "NSE:SBIN-EQ",
        "ltp": 800.5,
        "prev_close_price": 795.0,
        "open_price": 796.0,
        "high_price": 805.0,
        "low_price": 794.0,
        "vol_traded_today": 1234567,
        "avg_trade_price": 799.25,
        "last_traded_time": 1713345678,
        "last_traded_qty": 25,
        "tot_buy_qty": 40000,
        "tot_sell_qty": 51000,
        "bid_price": 800.4,
        "ask_price": 800.6,
        "bid_size": 150,
        "ask_size": 250,
    }
    payload.update(overrides)
    return payload


class TestNormalizeDepth:
    def test_maps_depth_message(self):
        out = FyersAdapter().normalize(_dp_payload())
        assert len(out) == 1
        symbol, tick = out[0]
        assert symbol == "NSE:SBIN-EQ"
        assert tick["ltp"] == 800.5
        assert tick["volume"] == 1234567.0
        assert tick["vwap"] == 799.25
        assert tick["ltq"] == 25.0
        assert tick["cp"] == 795.0
        assert tick["tbq"] == 40000.0
        assert tick["tsq"] == 51000.0
        assert tick["ltt"] == 1713345678000

    def test_depth_has_five_levels_with_order_counts(self):
        _, tick = FyersAdapter().normalize(_dp_payload())[0]
        buy = tick["depth"]["buy"]
        sell = tick["depth"]["sell"]
        assert len(buy) == 5
        assert len(sell) == 5
        assert buy[0] == {"price": 799.5, "quantity": 100.0, "orders": 1}
        assert buy[4] == {"price": 795.5, "quantity": 500.0, "orders": 5}
        assert sell[0] == {"price": 801.5, "quantity": 200.0, "orders": 11}

    def test_day_is_populated(self):
        _, tick = FyersAdapter().normalize(_dp_payload())[0]
        assert tick["day"] == {
            "open": 796.0,
            "high": 805.0,
            "low": 794.0,
            "close": 800.5,
            "volume": 1234567.0,
        }

    def test_uneven_levels_are_skipped(self):
        payload = _dp_payload()
        for i in range(3, 6):
            payload.pop(f"bid_price{i}")
            payload.pop(f"bid_size{i}")
            payload.pop(f"bid_order{i}")
        _, tick = FyersAdapter().normalize(payload)[0]
        assert len(tick["depth"]["buy"]) == 2
        assert len(tick["depth"]["sell"]) == 5

    def test_missing_ltt_is_zero(self):
        _, tick = FyersAdapter().normalize(_dp_payload(last_traded_time=None))[0]
        assert tick["ltt"] == 0

    def test_no_day_when_all_day_fields_absent(self):
        payload = _dp_payload()
        for key in ("open_price", "high_price", "low_price", "vol_traded_today"):
            payload.pop(key)
        _, tick = FyersAdapter().normalize(payload)[0]
        assert tick["day"] is None


class TestNormalizeQuote:
    def test_quote_uses_best_level_depth(self):
        out = FyersAdapter().normalize(_sf_payload())
        assert len(out) == 1
        _, tick = out[0]
        assert tick["ltp"] == 800.5
        assert tick["depth"]["buy"] == [
            {"price": 800.4, "quantity": 150.0, "orders": 0}
        ]
        assert tick["depth"]["sell"] == [
            {"price": 800.6, "quantity": 250.0, "orders": 0}
        ]

    def test_quote_without_depth_fields_does_not_raise(self):
        payload = _sf_payload()
        for key in ("bid_price", "ask_price", "bid_size", "ask_size"):
            payload.pop(key)
        _, tick = FyersAdapter().normalize(payload)[0]
        assert tick["depth"] == {"buy": [], "sell": []}


class TestNormalizeNonMarket:
    def test_returns_empty_for_non_market_types(self):
        adapter = FyersAdapter()
        assert adapter.normalize({"type": "cn"}) == []
        assert adapter.normalize({"type": "sub"}) == []
        assert adapter.normalize({"type": "if", "symbol": "NSE:NIFTY50-INDEX"}) == []
        assert adapter.normalize({"type": "unknown"}) == []

    def test_returns_empty_for_missing_or_bad_input(self):
        adapter = FyersAdapter()
        assert adapter.normalize(None) == []
        assert adapter.normalize({}) == []
        assert adapter.normalize("nope") == []
        assert adapter.normalize({"type": "dp"}) == []


class TestFyersSymbol:
    def test_equity_gets_exchange_and_eq_suffix(self):
        assert FyersAdapter().fyers_symbol("reliance") == "NSE:RELIANCE-EQ"

    def test_already_formatted_is_passed_through(self):
        adapter = FyersAdapter()
        assert adapter.fyers_symbol("NSE:NIFTY50-INDEX") == "NSE:NIFTY50-INDEX"
        assert adapter.fyers_symbol("NSE:SBIN-EQ") == "NSE:SBIN-EQ"


class _FakeSocket:
    def __init__(self, **kwargs):
        self.on_message = kwargs.get("on_message")
        self.on_error = kwargs.get("on_error")
        self.subscribed = None
        self.kept_running = False
        self.connected = False
        self.closed = False

    def connect(self):
        self.connected = True

    def subscribe(self, symbols=None, data_type=None):
        self.subscribed = (symbols, data_type)

    def keep_running(self):
        self.kept_running = True

    def close_connection(self):
        self.closed = True


class TestRegistry:
    def test_fyers_is_registered(self):
        assert "fyers" in available_adapters()
        assert get_adapter("fyers") is FyersAdapter

    def test_capabilities(self):
        caps = FyersAdapter().capabilities()
        assert caps["name"] == "fyers"
        assert caps["depth_levels"] == 5
        assert caps["max_symbols_per_connection"] == 5000
        assert caps["max_connections"] == 3
        assert caps["has_order_counts"] is True

    def test_tbt_adapter_is_registered(self):
        assert "fyers_tbt" in available_adapters()
        assert FyersTbtAdapter().capabilities()["depth_levels"] == 50


class TestConnect:
    def test_wires_messages_to_on_tick_and_subscribes_depth(self):
        socket = _FakeSocket()
        adapter = FyersAdapter(access_token="APP:TOKEN")
        ticks = []

        adapter.connect(
            ["SBIN", "NSE:NIFTY50-INDEX"],
            on_tick=lambda symbol, tick: ticks.append((symbol, tick)),
            socket_factory=lambda **kwargs: _with_kwargs(socket, kwargs),
        )

        symbols, data_type = socket.subscribed
        assert symbols == ["NSE:SBIN-EQ", "NSE:NIFTY50-INDEX"]
        assert data_type == "DepthUpdate"
        assert socket.kept_running is True

        socket.on_message(_dp_payload())
        assert len(ticks) == 1
        assert ticks[0][0] == "NSE:SBIN-EQ"
        assert ticks[0][1]["ltp"] == 800.5

    def test_requires_access_token(self):
        adapter = FyersAdapter()
        with mock.patch.dict("os.environ", {}, clear=True):
            try:
                adapter.connect(["SBIN"], on_tick=lambda *a: None)
            except ValueError as exc:
                assert "access_token" in str(exc)
            else:  # pragma: no cover
                raise AssertionError("expected ValueError")

    def test_disconnect_closes_socket(self):
        socket = _FakeSocket()
        adapter = FyersAdapter(access_token="APP:TOKEN")
        adapter.connect(
            ["SBIN"],
            on_tick=lambda *a: None,
            socket_factory=lambda **kwargs: _with_kwargs(socket, kwargs),
        )
        adapter.disconnect()
        assert socket.closed is True

    def test_missing_sdk_raises_clear_error(self):
        blocked = {"fyers_apiv3": None, "fyers_apiv3.FyersWebsocket": None}
        with mock.patch.dict(sys.modules, blocked):
            try:
                _default_socket_factory(
                    access_token="APP:TOKEN",
                    on_connect=lambda *a: None,
                    on_message=lambda *a: None,
                    on_error=lambda *a: None,
                    on_close=lambda *a: None,
                )
            except RuntimeError as exc:
                assert "fyers_apiv3" in str(exc)
            else:  # pragma: no cover
                raise AssertionError("expected RuntimeError")


def _with_kwargs(socket, kwargs):
    socket.on_message = kwargs.get("on_message")
    socket.on_error = kwargs.get("on_error")
    return socket


class TestFyersTbtAdapter:
    def _depth(self, n=50):
        return {
            "bidprice": [100.0 - i * 0.1 for i in range(n)],
            "bidqty": [10 + i for i in range(n)],
            "bidordn": [1 + i for i in range(n)],
            "askprice": [100.1 + i * 0.1 for i in range(n)],
            "askqty": [20 + i for i in range(n)],
            "askordn": [2 + i for i in range(n)],
            "tbq": 566578,
            "tsq": 681658,
            "sendtime": 1789538203,
            "seqNo": 15421,
        }

    def test_registered_with_50_levels(self):
        assert "fyers_tbt" in available_adapters()
        caps = get_adapter("fyers_tbt")().capabilities()
        assert caps["depth_levels"] == 50
        assert caps["max_symbols_per_connection"] == 5
        assert caps["max_connections"] == 3
        assert caps["has_order_counts"] is True

    def test_normalizes_50_level_depth(self):
        adapter = get_adapter("fyers_tbt")()
        symbol, tick = adapter.normalize_depth("NSE:SBIN-EQ", self._depth())
        assert symbol == "NSE:SBIN-EQ"
        assert len(tick["depth"]["buy"]) == 50
        assert len(tick["depth"]["sell"]) == 50
        assert tick["depth"]["buy"][0] == {"price": 100.0, "quantity": 10.0, "orders": 1}
        assert tick["tbq"] == 566578.0 and tick["tsq"] == 681658.0
        # sendtime is epoch seconds -> ms
        assert tick["ltt"] == 1789538203 * 1000

    def test_drops_zero_price_or_qty_levels(self):
        adapter = get_adapter("fyers_tbt")()
        depth = self._depth(n=3)
        depth["bidqty"][1] = 0  # level 2 has no quantity
        _, tick = adapter.normalize_depth("NSE:SBIN-EQ", depth)
        assert len(tick["depth"]["buy"]) == 2

    def test_quote_fields_are_merged_into_depth(self):
        adapter = get_adapter("fyers_tbt")()
        adapter.remember_quote(
            {
                "symbol": "NSE:SBIN-EQ",
                "ltp": 982.65,
                "vol_traded_today": 1234567,
                "avg_trade_price": 980.1,
                "last_traded_time": 1789538200,
                "prev_close_price": 990.0,
                "tot_buy_qty": 111,
                "tot_sell_qty": 222,
                "open_price": 985.0,
                "high_price": 991.0,
                "low_price": 978.0,
            }
        )
        _, tick = adapter.normalize_depth("NSE:SBIN-EQ", self._depth(n=2))
        assert tick["ltp"] == 982.65
        assert tick["volume"] == 1234567.0
        assert tick["vwap"] == 980.1
        assert tick["cp"] == 990.0
        assert tick["day"]["open"] == 985.0

    def test_normalize_contract_entry(self):
        adapter = get_adapter("fyers_tbt")()
        out = adapter.normalize({"symbol": "NSE:SBIN-EQ", "depth": self._depth(n=2)})
        assert len(out) == 1 and out[0][0] == "NSE:SBIN-EQ"
        assert adapter.normalize({}) == []
        assert adapter.normalize("nope") == []
