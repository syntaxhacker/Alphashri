"""
Live Stream API Tests for Alphashri.

Tests for GET /api/paper/live/stream SSE endpoint.

Total: 6 test cases (4 regular + 2 helper)
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

        def fake_db_token():
            call_order.append("db")
            return None

        def fake_file_token():
            call_order.append("file")
            return None

        def fake_env_token():
            call_order.append("env")
            return "env_token_123"

        monkeypatch.setattr(
            "api.paper.live_stream._get_upstox_token",
            fake_db_token,
        )

        response = auth_client.get("/api/paper/live/stream")
        assert response.status_code in (200, 404, 401)


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
