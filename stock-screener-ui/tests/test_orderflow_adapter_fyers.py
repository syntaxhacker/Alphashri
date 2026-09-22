"""Tests for the Fyers order-flow adapter (no network / no SDK needed)."""

import sys
from unittest import mock

import pytest

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
    for key, value in kwargs.items():
        setattr(socket, key, value)
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


class TestFyersExtraFields:
    def test_quote_carries_circuit_and_feed_time(self):
        adapter = FyersAdapter()
        out = adapter.normalize({
            "type": "sf", "symbol": "NSE:SBIN-EQ", "ltp": 981.2,
            "prev_close_price": 968.0, "upper_ckt": 1064.8, "lower_ckt": 871.2,
            "last_traded_time": 1789538200, "exch_feed_time": 1789538201,
        })
        _, tick = out[0]
        assert tick["circuit"] == {"upper": 1064.8, "lower": 871.2}
        assert tick["feed_ts"] == 1789538201 * 1000

    def test_tbt_depth_carries_sequence_and_snapshot(self):
        adapter = get_adapter("fyers_tbt")()
        depth = {
            "bidprice": [100.0], "bidqty": [10], "bidordn": [1],
            "askprice": [100.1], "askqty": [20], "askordn": [2],
            "tbq": 5, "tsq": 6, "sendtime": 1789538200, "seqNo": 15421, "snapshot": False,
        }
        _, tick = adapter.normalize_depth("NSE:SBIN-EQ", depth)
        assert tick["seq"] == 15421
        assert tick["snapshot"] is False
        assert tick["feed_ts"] == 1789538200 * 1000
        assert tick["circuit"] is None


class TestFyersTbtSymbolFilter:
    def test_mismatched_symbol_updates_are_dropped(self):
        adapter = get_adapter("fyers_tbt")(access_token="APP:TOK")
        seen = []
        fake_tbt = _FakeTbt()
        adapter.connect(
            ["ITC"],
            on_tick=lambda s, t: seen.append(s),
            tbt_factory=lambda **kw: _with_kwargs(fake_tbt, kw),
            data_factory=lambda **kw: _with_kwargs(_FakeSocket(), kw),
        )
        # SDK mis-maps and delivers RELIANCE for our ITC subscription
        fake_tbt.on_depth_update("NSE:RELIANCE-EQ", {"bidprice":[1],"bidqty":[1],"askprice":[2],"askqty":[1]})
        assert seen == []
        # correct symbol passes through
        fake_tbt.on_depth_update("NSE:ITC-EQ", {"bidprice":[1],"bidqty":[1],"askprice":[2],"askqty":[1]})
        assert seen == ["NSE:ITC-EQ"]


class _FakeTbt:
    def __init__(self):
        self.depth_handler = None
        self.subscribed = []

    def connect(self):
        pass

    def subscribe(self, **kw):
        self.subscribed.append(kw)

    def switchChannel(self, **kw):
        pass

    def close_connection(self):
        pass


class TestInPlaceSubscribe:
    """Growing the existing connection is required, not a nicety.

    A second adapter instance in one process makes the Fyers SDK cross-deliver
    payloads between instruments, so the hub must be able to add a symbol to the
    live socket instead of constructing another adapter.
    """

    def test_data_socket_adapter_subscribes_new_symbol_in_place(self):
        adapter = get_adapter("fyers")(access_token="APP:TOK")
        sock = _FakeSocket()
        adapter.connect(
            ["SBIN"],
            on_tick=lambda s, t: None,
            socket_factory=lambda **kw: _with_kwargs(sock, kw),
        )
        assert sock.subscribed == (["NSE:SBIN-EQ"], "DepthUpdate")

        assert adapter.subscribe_symbol("itc") is True
        assert sock.subscribed == (["NSE:ITC-EQ"], "DepthUpdate")

    def test_data_socket_adapter_rejects_subscribe_before_connect(self):
        adapter = get_adapter("fyers")(access_token="APP:TOK")
        with pytest.raises(RuntimeError):
            adapter.subscribe_symbol("ITC")

    def test_tbt_adapter_subscribes_new_symbol_on_both_sockets(self):
        adapter = get_adapter("fyers_tbt")(access_token="APP:TOK")
        fake_tbt = _FakeTbt()
        data_sock = _FakeSocket()
        adapter.connect(
            ["SBIN"],
            on_tick=lambda s, t: None,
            tbt_factory=lambda **kw: _with_kwargs(fake_tbt, kw),
            data_factory=lambda **kw: _with_kwargs(data_sock, kw),
        )
        tbt_calls = len(fake_tbt.subscribed)

        assert adapter.subscribe_symbol("ITC") is True
        assert len(fake_tbt.subscribed) == tbt_calls + 1
        assert fake_tbt.subscribed[-1]["symbol_tickers"] == {"NSE:ITC-EQ"}
        assert data_sock.subscribed == (["NSE:ITC-EQ"], "SymbolUpdate")

    def test_tbt_adapter_subscribe_is_idempotent(self):
        adapter = get_adapter("fyers_tbt")(access_token="APP:TOK")
        fake_tbt = _FakeTbt()
        adapter.connect(
            ["ITC"],
            on_tick=lambda s, t: None,
            tbt_factory=lambda **kw: _with_kwargs(fake_tbt, kw),
            data_factory=lambda **kw: _with_kwargs(_FakeSocket(), kw),
        )
        tbt_calls = len(fake_tbt.subscribed)

        assert adapter.subscribe_symbol("ITC") is True
        assert len(fake_tbt.subscribed) == tbt_calls

    def test_tbt_adapter_rejects_subscribe_before_connect(self):
        adapter = get_adapter("fyers_tbt")(access_token="APP:TOK")
        with pytest.raises(RuntimeError):
            adapter.subscribe_symbol("ITC")

    def test_base_adapter_refuses_in_place_subscribe_by_default(self):
        from api.orderflow_adapters.base import OrderFlowAdapter

        class Minimal(OrderFlowAdapter):
            name = "minimal"

            def normalize(self, raw):
                return []

        with pytest.raises(NotImplementedError):
            Minimal().subscribe_symbol("ITC")


class TestFyersDepthUpdateExtras:
    """DepthUpdate/quote dicts now carry OI, 52w band, ticksize and per-level num."""

    def test_oi_mapped_from_oi_key(self):
        _, tick = FyersAdapter().normalize(_dp_payload(oi=12345))[0]
        assert tick["oi"] == 12345.0

    def test_oi_mapped_from_open_interest_alias(self):
        _, tick = FyersAdapter().normalize(_dp_payload(open_interest=999))[0]
        assert tick["oi"] == 999.0

    def test_oi_defaults_to_zero_when_absent(self):
        _, tick = FyersAdapter().normalize(_dp_payload())[0]
        assert tick["oi"] == 0.0

    def test_52w_mapped_from_yhigh_ylow(self):
        _, tick = FyersAdapter().normalize(_dp_payload(Yhigh=1200.0, Ylow=800.0))[0]
        assert tick["52w_high"] == 1200.0
        assert tick["52w_low"] == 800.0

    def test_52w_mapped_from_nested_eq(self):
        _, tick = FyersAdapter().normalize(
            _dp_payload(eq={"yh": 1210.0, "yl": 810.0})
        )[0]
        assert tick["52w_high"] == 1210.0
        assert tick["52w_low"] == 810.0

    def test_no_52w_keys_when_absent(self):
        _, tick = FyersAdapter().normalize(_dp_payload())[0]
        assert "52w_high" not in tick
        assert "52w_low" not in tick

    def test_ticksize_mapped(self):
        _, tick = FyersAdapter().normalize(_dp_payload(ticksize=0.05))[0]
        assert tick["ticksize"] == 0.05

    def test_no_ticksize_key_when_absent(self):
        _, tick = FyersAdapter().normalize(_dp_payload())[0]
        assert "ticksize" not in tick

    def test_per_level_num_preserved(self):
        payload = _dp_payload()
        for i in range(1, 6):
            payload[f"bid_num{i}"] = 100 + i
            payload[f"ask_num{i}"] = 200 + i
        _, tick = FyersAdapter().normalize(payload)[0]
        assert tick["depth"]["buy"][0]["num"] == 101
        assert tick["depth"]["buy"][4]["num"] == 105
        assert tick["depth"]["sell"][0]["num"] == 201
        # orders still mapped alongside num
        assert tick["depth"]["buy"][0]["orders"] == 1

    def test_no_num_keys_when_absent(self):
        _, tick = FyersAdapter().normalize(_dp_payload())[0]
        assert tick["depth"]["buy"][0] == {"price": 799.5, "quantity": 100.0, "orders": 1}

    def test_day_from_dq_when_quote_fields_absent(self):
        payload = _dp_payload(
            dq={"do": 796.0, "dh": 805.0, "dl": 794.0, "dc": 800.0}
        )
        for key in ("open_price", "high_price", "low_price", "vol_traded_today"):
            payload.pop(key)
        _, tick = FyersAdapter().normalize(payload)[0]
        assert tick["day"] == {
            "open": 796.0,
            "high": 805.0,
            "low": 794.0,
            "close": 800.0,
            "volume": 0.0,
        }

    def test_quote_day_wins_over_dq(self):
        _, tick = FyersAdapter().normalize(
            _dp_payload(dq={"do": 1.0, "dh": 2.0, "dl": 0.5, "dc": 1.5})
        )[0]
        assert tick["day"]["open"] == 796.0


class TestFyersTbtExtras:
    """TBT path maps quote.oi, eq.yh/yl, dq day, ticksize and per-level num."""

    def _book(self, n=2):
        return {
            "bidprice": [100.0 - i * 0.1 for i in range(n)],
            "bidqty": [10 + i for i in range(n)],
            "bidordn": [1 + i for i in range(n)],
            "askprice": [100.1 + i * 0.1 for i in range(n)],
            "askqty": [20 + i for i in range(n)],
            "askordn": [2 + i for i in range(n)],
            "tbq": 100,
            "tsq": 200,
            "sendtime": 1789538200,
            "seqNo": 7,
        }

    def _feed(self, n=2, **extra):
        return {"depth": self._book(n), **extra}

    def test_oi_from_quote_submessage(self):
        adapter = get_adapter("fyers_tbt")()
        _, tick = adapter.normalize_depth(
            "NSE:SBIN-EQ", self._feed(quote={"oi": 1500})
        )
        assert tick["oi"] == 1500.0

    def test_oi_prefers_feed_over_quote_socket_merge(self):
        adapter = get_adapter("fyers_tbt")()
        adapter.remember_quote(
            {
                "symbol": "NSE:SBIN-EQ",
                "ltp": 100.0,
                "vol_traded_today": 10,
                "open_price": 99.0,
                "high_price": 101.0,
                "low_price": 98.0,
            }
        )
        _, tick = adapter.normalize_depth(
            "NSE:SBIN-EQ", self._feed(quote={"oi": 1500})
        )
        assert tick["oi"] == 1500.0

    def test_oi_falls_back_to_zero_without_feed_or_merge(self):
        _, tick = get_adapter("fyers_tbt")().normalize_depth(
            "NSE:SBIN-EQ", self._book()
        )
        assert tick["oi"] == 0.0

    def test_52w_from_eq(self):
        _, tick = get_adapter("fyers_tbt")().normalize_depth(
            "NSE:SBIN-EQ", self._feed(eq={"yh": 1200.0, "yl": 800.0})
        )
        assert tick["52w_high"] == 1200.0
        assert tick["52w_low"] == 800.0

    def test_day_from_dq_when_no_quote_day(self):
        _, tick = get_adapter("fyers_tbt")().normalize_depth(
            "NSE:SBIN-EQ",
            self._feed(dq={"do": 796.0, "dh": 805.0, "dl": 794.0, "dc": 800.0}),
        )
        assert tick["day"] == {
            "open": 796.0,
            "high": 805.0,
            "low": 794.0,
            "close": 800.0,
            "volume": 0.0,
        }

    def test_quote_day_wins_over_dq(self):
        adapter = get_adapter("fyers_tbt")()
        adapter.remember_quote(
            {
                "symbol": "NSE:SBIN-EQ",
                "ltp": 100.0,
                "vol_traded_today": 10,
                "open_price": 99.0,
                "high_price": 101.0,
                "low_price": 98.0,
            }
        )
        _, tick = adapter.normalize_depth(
            "NSE:SBIN-EQ",
            self._feed(dq={"do": 1.0, "dh": 2.0, "dl": 0.5, "dc": 1.5}),
        )
        assert tick["day"]["open"] == 99.0

    def test_ticksize_from_symdetail(self):
        _, tick = get_adapter("fyers_tbt")().normalize_depth(
            "NSE:SBIN-EQ", self._feed(symdetail={"ticksize": 0.05})
        )
        assert tick["ticksize"] == 0.05

    def test_per_level_num_from_arrays(self):
        book = self._book()
        book["bidnum"] = [7, 8]
        book["asknum"] = [9, 10]
        _, tick = get_adapter("fyers_tbt")().normalize_depth("NSE:SBIN-EQ", book)
        assert tick["depth"]["buy"][0]["num"] == 7
        assert tick["depth"]["buy"][1]["num"] == 8
        assert tick["depth"]["sell"][0]["num"] == 9
        assert tick["depth"]["buy"][0]["orders"] == 1

    def test_plain_book_has_no_new_keys(self):
        _, tick = get_adapter("fyers_tbt")().normalize_depth(
            "NSE:SBIN-EQ", self._book()
        )
        assert "52w_high" not in tick
        assert "52w_low" not in tick
        assert "ticksize" not in tick
        assert tick["day"] is None
        assert tick["depth"]["buy"][0] == {
            "price": 100.0,
            "quantity": 10.0,
            "orders": 1,
        }

    def test_object_shaped_feed_is_accepted(self):
        from types import SimpleNamespace

        adapter = get_adapter("fyers_tbt")()
        feed = SimpleNamespace(
            depth=SimpleNamespace(
                bidprice=[100.0],
                bidqty=[10],
                bidordn=[1],
                askprice=[100.1],
                askqty=[20],
                askordn=[2],
                tbq=5,
                tsq=6,
                sendtime=1789538200,
                seqNo=3,
                snapshot=False,
            ),
            quote=SimpleNamespace(oi=321),
            eq=SimpleNamespace(yh=1200.0, yl=800.0),
            dq=None,
            symdetail=SimpleNamespace(ticksize=0.05),
        )
        _, tick = adapter.normalize_depth("NSE:SBIN-EQ", feed)
        assert tick["oi"] == 321.0
        assert tick["52w_high"] == 1200.0
        assert tick["52w_low"] == 800.0
        assert tick["ticksize"] == 0.05
        assert tick["seq"] == 3
