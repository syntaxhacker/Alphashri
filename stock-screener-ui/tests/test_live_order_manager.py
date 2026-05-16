"""Tests for LiveOrderManager."""

from unittest.mock import MagicMock, patch

import pytest

from trading.live_order_manager import LiveOrderManager


@pytest.fixture
def mock_api():
    api = MagicMock()
    api.place_order.return_value = {
        "status": "success",
        "data": {"order_ids": ["ORD12345"]},
        "metadata": {"latency": 30},
    }
    api.get_funds.return_value = {
        "equity": {"available_margin": "500000"},
    }
    api.get_order_details.return_value = {
        "order_id": "ORD12345",
        "status": "complete",
        "average_price": "1520.50",
        "filled_quantity": 10,
        "pending_quantity": 0,
        "trading_symbol": "RELIANCE",
        "transaction_type": "BUY",
    }
    return api


@pytest.fixture
def manager(mock_api):
    return LiveOrderManager(mock_api)


class TestLiveOrderManager:
    def test_place_entry_order_long(self, manager, mock_api):
        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
            tag="ORB_RELIANCE",
        )

        assert result is not None
        assert result["order_id"] == "ORD12345"
        assert result["filled_price"] == 1520.50
        mock_api.place_order.assert_called_once_with(
            symbol="RELIANCE",
            transaction_type="BUY",
            quantity=10,
            order_type="MARKET",
            product="D",
            slice=True,
            tag="ORB_RELIANCE",
        )

    def test_place_entry_order_short(self, manager, mock_api):
        result = manager.place_entry_order(
            symbol="TCS",
            side="SHORT",
            quantity=5,
            price=3500.00,
        )

        assert result is not None
        assert result["order_id"] == "ORD12345"
        mock_api.place_order.assert_called_once_with(
            symbol="TCS",
            transaction_type="SELL",
            quantity=5,
            order_type="MARKET",
            product="D",
            slice=True,
            tag="",
        )

    def test_place_exit_order_long(self, manager, mock_api):
        result = manager.place_exit_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            tag="EXIT_RELIANCE",
        )

        assert result is not None
        assert result["order_id"] == "ORD12345"
        mock_api.place_order.assert_called_once_with(
            symbol="RELIANCE",
            transaction_type="SELL",
            quantity=10,
            order_type="MARKET",
            product="D",
            slice=True,
            tag="EXIT_RELIANCE",
        )

    def test_place_exit_order_short(self, manager, mock_api):
        result = manager.place_exit_order(
            symbol="TCS",
            side="SHORT",
            quantity=5,
        )

        assert result is not None
        mock_api.place_order.assert_called_once_with(
            symbol="TCS",
            transaction_type="BUY",
            quantity=5,
            order_type="MARKET",
            product="D",
            slice=True,
            tag="",
        )

    def test_place_order_api_failure(self, manager, mock_api):
        mock_api.place_order.return_value = None

        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
        )

        assert result is None

    def test_place_order_api_error_status(self, manager, mock_api):
        mock_api.place_order.return_value = {
            "status": "error",
            "data": {},
            "metadata": {"latency": 5},
        }

        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
        )

        assert result is None

    def test_place_order_no_order_ids(self, manager, mock_api):
        mock_api.place_order.return_value = {
            "status": "success",
            "data": {"order_ids": []},
            "metadata": {"latency": 30},
        }

        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
        )

        assert result is None

    def test_poll_for_fill_complete(self, manager, mock_api):
        filled_price = manager._poll_for_fill("ORD12345")
        assert filled_price == 1520.50

    def test_poll_for_fill_incomplete(self, manager, mock_api):
        mock_api.get_order_details.return_value = {
            "order_id": "ORD12345",
            "status": "open",
            "average_price": "0",
        }

        filled_price = manager._poll_for_fill("ORD12345")
        assert filled_price is None

    def test_poll_for_fill_rejected(self, manager, mock_api):
        mock_api.get_order_details.return_value = {
            "order_id": "ORD12345",
            "status": "rejected",
            "average_price": "0",
        }

        filled_price = manager._poll_for_fill("ORD12345")
        assert filled_price is None

    def test_tag_truncated_to_40_chars(self, manager, mock_api):
        long_tag = "A" * 100
        manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
            tag=long_tag,
        )

        called_tag = mock_api.place_order.call_args[1]["tag"]
        assert len(called_tag) <= 40
        assert called_tag == "A" * 40

    def test_fallback_price_when_poll_fails(self, manager, mock_api):
        mock_api.get_order_details.return_value = None

        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
        )

        assert result is not None
        assert result["order_id"] == "ORD12345"
        assert result["filled_price"] == 1520.00  # Falls back to signal price

    def test_cancel_order_not_implemented(self, manager, mock_api):
        del mock_api.cancel_order  # Method doesn't exist
        result = manager.cancel_order("ORD12345")
        assert result is False

    def test_cancel_order_success(self, manager, mock_api):
        mock_api.cancel_order.return_value = {
            "status": "success",
            "data": {"order_id": "ORD12345"},
        }
        result = manager.cancel_order("ORD12345")
        assert result is True

    def test_cancel_order_failure(self, manager, mock_api):
        mock_api.cancel_order.return_value = {
            "status": "error",
            "data": {},
        }
        result = manager.cancel_order("ORD12345")
        assert result is False

    def test_poll_for_fill_no_api_method(self, manager):
        manager_without = LiveOrderManager(MagicMock())
        # Remove both get_order_details and get_order_book from mock
        if hasattr(manager_without.api, 'get_order_details'):
            del manager_without.api.get_order_details
        if hasattr(manager_without.api, 'get_order_book'):
            del manager_without.api.get_order_book

        filled_price = manager_without._poll_for_fill("ORD12345")
        assert filled_price is None

    def test_funds_check_insufficient(self, manager, mock_api):
        mock_api.get_funds.return_value = {
            "equity": {"available_margin": "1000"},
        }

        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
        )

        assert result is None  # Rejected due to insufficient funds

    def test_funds_check_unavailable(self, manager, mock_api):
        del mock_api.get_funds

        result = manager.place_entry_order(
            symbol="RELIANCE",
            side="LONG",
            quantity=10,
            price=1520.00,
        )

        assert result is not None  # Graceful degradation, proceeds anyway
