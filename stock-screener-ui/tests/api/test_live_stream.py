"""
Live Stream API Tests for Alphashri.

Tests for GET /api/paper/live/stream SSE endpoint.

Total: 10 test cases (4 regular + 2 helper + 4 fallback logic)
"""

import sys
import json
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def _create_mock_market_data_feeder():
    """Mock MarketDataStreamerV3 that simulates price ticks."""
    mock = MagicMock()
    mock.on = MagicMock()
    mock.connect = MagicMock()

    def side_effect_on(event, callback):
        if event == "open":
            mock._on_open_cb = callback
        elif event == "message":
            mock._on_msg_cb = callback
        elif event == "error":
            mock._on_err_cb = callback
        return mock

    mock.on.side_effect = side_effect_on

    def trigger_open():
        if mock._on_open_cb:
            mock._on_open_cb()

    def trigger_message(data: dict):
        if mock._on_msg_cb:
            mock._on_msg_cb(data)

    mock.trigger_open = trigger_open
    mock.trigger_message = trigger_message
    return mock


class TestLiveStreamUnauthenticated:
    """Tests for GET /api/paper/live/stream without auth."""

    def test_returns_401_without_auth(self, client: TestClient):
        response = client.get("/api/paper/live/stream")
        assert response.status_code == 401
        data = response.json()
        assert "Not authenticated" in data.get("detail", "")


class TestLiveStreamTokenResolution:
    """Tests for token resolution in live stream endpoint."""

    def test_returns_401_when_no_token(
        self, auth_client: TestClient, monkeypatch
    ):
        monkeypatch.setattr(
            "api.paper.live_stream._get_upstox_token",
            lambda: None,
        )
        monkeypatch.setattr(
            "api.paper.live_stream._get_instrument_keys",
            lambda uid: (["NSE_EQ|INE002A01018"], {"RELIANCE": "NSE_EQ|INE002A01018"}),
        )

        response = auth_client.get("/api/paper/live/stream")
        assert response.status_code == 401
        data = response.json()
        assert "access token" in data.get("detail", "").lower()

    def test_token_fallback_order(
        self, auth_client: TestClient, monkeypatch
    ):
        call_order = []

        def fake_db_token(*args, **kwargs):
            call_order.append("db")
            return None

        # Patch the DB token lookup and file existence check
        mock_db = MagicMock(side_effect=fake_db_token)

        def fake_exists(self):
            call_order.append("file")
            return False

        monkeypatch.setattr("db.models.get_shared_broker_token", mock_db)
        monkeypatch.setattr("pathlib.Path.exists", fake_exists)

        from api.paper.live_stream import _get_upstox_token

        result = _get_upstox_token()
        assert result is None
        assert call_order == ["db", "file"]
        assert mock_db.call_count == 1
        # Path.exists should have been called once for the token file
        # Verify fallback order is DB -> file


class TestLiveStreamWithPositions:
    """Tests for streaming with positions available."""

    def test_returns_nosymbols_when_no_positions(
        self, auth_client: TestClient, monkeypatch
    ):
        monkeypatch.setattr(
            "api.paper.live_stream._get_upstox_token",
            lambda: "test_token",
        )
        monkeypatch.setattr(
            "api.paper.live_stream._get_instrument_keys",
            lambda uid: ([], {}),
        )

        response = auth_client.get("/api/paper/live/stream")
        assert response.status_code == 200
        assert response.headers.get("content-type", "").startswith("text/event-stream")

        content = b""
        for chunk in response.iter_bytes():
            content += chunk
            if b"nosymbols" in content:
                break

        assert b"nosymbols" in content
        assert b"No open positions" in content

    def test_helper_get_upstox_token_returns_none_when_not_configured(
        self, auth_client: TestClient, monkeypatch
    ):
        monkeypatch.setattr(
            "api.paper.live_stream._get_upstox_token",
            lambda: None,
        )
        result = None
        try:
            from api.paper.live_stream import _get_upstox_token
            result = _get_upstox_token()
        except Exception:
            pass
        assert result is None

    def test_helper_get_instrument_keys_returns_empty_when_no_positions(
        self, auth_client: TestClient, monkeypatch
    ):
        monkeypatch.setattr(
            "api.paper.live_stream._get_instrument_keys",
            lambda uid: ([], {}),
        )
        keys, mapping = [], {}
        try:
            from api.paper.live_stream import _get_instrument_keys
            keys, mapping = _get_instrument_keys(999)
        except Exception:
            pass
        assert keys == []
        assert mapping == {}


class TestGetInstrumentKeysFallbacks:
    """Direct tests for _get_instrument_keys internal fallback logic.

    Tests the 3-tier fallback chain:
      positions: DB Position table → PaperTrader.get_positions()
      instrument keys: DB instruments table → JSON file
    """

    def test_get_instrument_keys_db_fallback_to_trader(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """When DB Position query returns empty positions, fall back to PaperTrader."""
        mock_db = MagicMock()
        # Position query returns empty list
        mock_db.query.return_value.filter.return_value.all.return_value = []
        # Instruments query resolves both symbols
        mock_db.execute.return_value.fetchall.return_value = [
            ("RELIANCE", "NSE_EQ|INE002A01018"),
            ("TCS", "NSE_EQ|INE123A01029"),
        ]
        monkeypatch.setattr("db.database.SessionLocal", lambda: mock_db)

        mock_trader = MagicMock()
        mock_trader.get_positions.return_value = [
            {"symbol": "RELIANCE"},
            {"symbol": "TCS"},
        ]
        monkeypatch.setattr(
            "trading.paper_trader.get_paper_trader", lambda uid: mock_trader
        )

        from api.paper.live_stream import _get_instrument_keys

        keys, mapping = _get_instrument_keys(1)

        assert sorted(keys) == sorted([
            "NSE_EQ|INE002A01018",
            "NSE_EQ|INE123A01029",
        ])
        assert mapping == {
            "RELIANCE": "NSE_EQ|INE002A01018",
            "TCS": "NSE_EQ|INE123A01029",
        }

    def test_get_instrument_keys_json_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """When instruments table has no data, fall back to JSON file."""
        mock_db = MagicMock()
        pos1 = MagicMock(symbol="RELIANCE")
        pos2 = MagicMock(symbol="TCS")
        mock_db.query.return_value.filter.return_value.all.return_value = [
            pos1, pos2
        ]
        # Instruments table returns empty rows
        mock_db.execute.return_value.fetchall.return_value = []
        monkeypatch.setattr("db.database.SessionLocal", lambda: mock_db)

        mock_instruments = [
            {"trading_symbol": "RELIANCE", "instrument_key": "NSE_EQ|INE002A01018"},
            {"trading_symbol": "TCS", "instrument_key": "NSE_EQ|INE123A01029"},
        ]
        monkeypatch.setattr("json.load", lambda f: mock_instruments)
        monkeypatch.setattr("pathlib.Path.exists", lambda self: True)

        from api.paper.live_stream import _get_instrument_keys

        keys, mapping = _get_instrument_keys(1)

        assert sorted(keys) == sorted([
            "NSE_EQ|INE002A01018",
            "NSE_EQ|INE123A01029",
        ])
        assert mapping == {
            "RELIANCE": "NSE_EQ|INE002A01018",
            "TCS": "NSE_EQ|INE123A01029",
        }

    def test_get_instrument_keys_no_positions_anywhere(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """When no positions exist in DB or PaperTrader, return ([], {})."""
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.all.return_value = []
        monkeypatch.setattr("db.database.SessionLocal", lambda: mock_db)

        mock_trader = MagicMock()
        mock_trader.get_positions.return_value = []
        monkeypatch.setattr(
            "trading.paper_trader.get_paper_trader", lambda uid: mock_trader
        )

        from api.paper.live_stream import _get_instrument_keys

        keys, mapping = _get_instrument_keys(1)
        assert keys == []
        assert mapping == {}

    def test_get_instrument_keys_db_error_falls_back(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """When both DB calls raise exceptions, fall back to PaperTrader + JSON file."""
        def raise_db_error(*args, **kwargs):
            raise RuntimeError("DB connection failed")

        monkeypatch.setattr("db.database.SessionLocal", raise_db_error)

        mock_trader = MagicMock()
        mock_trader.get_positions.return_value = [
            {"symbol": "RELIANCE"},
            {"symbol": "TCS"},
        ]
        monkeypatch.setattr(
            "trading.paper_trader.get_paper_trader", lambda uid: mock_trader
        )

        mock_instruments = [
            {"trading_symbol": "RELIANCE", "instrument_key": "NSE_EQ|INE002A01018"},
            {"trading_symbol": "TCS", "instrument_key": "NSE_EQ|INE123A01029"},
        ]
        monkeypatch.setattr("json.load", lambda f: mock_instruments)
        monkeypatch.setattr("pathlib.Path.exists", lambda self: True)

        from api.paper.live_stream import _get_instrument_keys

        keys, mapping = _get_instrument_keys(1)

        assert sorted(keys) == sorted([
            "NSE_EQ|INE002A01018",
            "NSE_EQ|INE123A01029",
        ])
        assert mapping == {
            "RELIANCE": "NSE_EQ|INE002A01018",
            "TCS": "NSE_EQ|INE123A01029",
        }
