"""Tests for the order-flow adapter base + registry + Upstox adapter."""

from api.orderflow_adapters import (
    OrderFlowAdapter,
    available_adapters,
    get_adapter,
    make_depth,
)
from api.orderflow_adapters.upstox import UpstoxAdapter


class TestRegistry:
    def test_upstox_is_registered(self):
        assert "upstox" in available_adapters()
        assert get_adapter("upstox") is UpstoxAdapter

    def test_unknown_adapter_returns_none(self):
        assert get_adapter("does-not-exist") is None

    def test_upstox_is_an_adapter(self):
        assert issubclass(UpstoxAdapter, OrderFlowAdapter)


class TestMakeDepth:
    def test_filters_zero_price_and_qty_and_coerces_orders(self):
        levels = [
            {"price": 100.0, "quantity": 50, "orders": 3},
            {"price": 0, "quantity": 10, "orders": 1},
            {"price": 99.0, "quantity": 0},
        ]
        assert make_depth(levels) == [{"price": 100.0, "quantity": 50.0, "orders": 3}]

    def test_empty(self):
        assert make_depth(None) == []
        assert make_depth([]) == []


class TestUpstoxNormalize:
    def _payload(self):
        return {
            "type": "live_feed",
            "feeds": {
                "NSE_EQ|INE002A01018": {
                    "fullFeed": {
                        "marketFF": {
                            "ltpc": {"ltp": 2500.0, "ltt": "1713345678000", "ltq": "10", "cp": 2400.0},
                            "marketLevel": {
                                "bidAskQuote": [
                                    {"bidQ": "500", "bidP": 2499.9, "askQ": "300", "askP": 2500.1}
                                ]
                            },
                            "vtt": "1234567",
                            "atp": 2495.0,
                        }
                    }
                }
            },
        }

    def test_maps_feeds_to_normalized_ticks(self):
        adapter = UpstoxAdapter()
        out = adapter.normalize(self._payload())
        assert len(out) == 1
        key, data = out[0]
        assert key == "NSE_EQ|INE002A01018"
        assert data["ltp"] == 2500.0
        assert data["depth"]["buy"][0]["price"] == 2499.9

    def test_non_feed_message_returns_empty(self):
        adapter = UpstoxAdapter()
        assert adapter.normalize({"type": "market_info"}) == []
        assert adapter.normalize({}) == []
        assert adapter.normalize(None) == []

    def test_capabilities(self):
        caps = UpstoxAdapter().capabilities()
        assert caps["name"] == "upstox"
        assert caps["depth_levels"] == 5
        assert caps["has_order_counts"] is False
