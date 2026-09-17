"""Tests for the order-flow adapter base + registry + Upstox adapter."""

import pytest

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


class TestErrorSanitization:
    """Broker SDK errors must never leak the raw HTTP response.

    A Fyers 403 arrives as::

        Handshake status 403 Forbidden -+-+- {'set-cookie': '__cf_bm=...',
        'cf-ray': '...'} -+-+- b''

    That blob was logged and pushed to the browser verbatim. It carries
    credential-adjacent values and buries the one fact the user needs.
    """

    RAW_403 = (
        "Handshake status 403 Forbidden -+-+- {'date': 'Thu, 17 Sep 2026 07:31:03 GMT', "
        "'set-cookie': '__cf_bm=SECRETCOOKIEVALUE; HttpOnly; Secure; Path=/; Domain=fyers.in', "
        "'cf-ray': 'a3c668b7db28aa6a-MAA', 'server': 'cloudflare'} -+-+- b''"
    )

    def test_strips_header_blob_and_cookie(self):
        from api.orderflow_adapters.base import strip_error_noise

        cleaned = strip_error_noise(self.RAW_403)
        assert cleaned == "Handshake status 403 Forbidden"
        assert "SECRETCOOKIEVALUE" not in cleaned
        assert "cf-ray" not in cleaned
        assert "set-cookie" not in cleaned

    def test_truncates_unknown_long_tails(self):
        from api.orderflow_adapters.base import strip_error_noise

        cleaned = strip_error_noise("x" * 5000)
        assert len(cleaned) == 200

    def test_plain_messages_pass_through(self):
        from api.orderflow_adapters.base import strip_error_noise

        assert strip_error_noise("fyers quote socket unavailable: timeout") == (
            "fyers quote socket unavailable: timeout"
        )

    @pytest.mark.parametrize(
        "message",
        [
            "Handshake status 403 Forbidden",
            "HTTP 401 Unauthorized",
            "token expired",
            "invalid token",
            "authentication failed",
            "no access token",
        ],
    )
    def test_auth_errors_detected(self, message):
        from api.orderflow_adapters.base import is_auth_error

        assert is_auth_error(message) is True

    def test_non_auth_errors_not_flagged(self):
        from api.orderflow_adapters.base import is_auth_error

        assert is_auth_error("connection reset by peer") is False
        assert is_auth_error("") is False

    def test_auth_error_becomes_an_instruction(self):
        from api.orderflow_adapters.base import sanitize_adapter_error

        out = sanitize_adapter_error("fyers_tbt", self.RAW_403)
        assert "Fyers TBT session expired" in out
        assert "FYERS TBT" not in out
        assert "Settings" in out
        assert "SECRETCOOKIEVALUE" not in out
        assert "-+-+-" not in out

    def test_non_auth_error_is_returned_clean(self):
        from api.orderflow_adapters.base import sanitize_adapter_error

        assert sanitize_adapter_error("fyers", "quote socket unavailable: timeout") == (
            "quote socket unavailable: timeout"
        )

    def test_empty_error_still_yields_a_line(self):
        from api.orderflow_adapters.base import sanitize_adapter_error

        assert sanitize_adapter_error("fyers", "") != ""

    def test_sanitizer_is_idempotent(self):
        """Adapters sanitize, then the hub/bridge does — it must not nest."""
        from api.orderflow_adapters.base import sanitize_adapter_error

        once = sanitize_adapter_error("fyers_tbt", self.RAW_403)
        twice = sanitize_adapter_error("fyers_tbt", once)
        assert twice == once
        assert twice.count("session expired or rejected") == 1
        assert twice.count("Settings") == 1

