"""Tests for Replay API endpoints."""

import sys
from pathlib import Path
import json
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

# =====================
# Replay API Tests
# =====================

class TestReplayAPI:
    """Tests for POST /api/replay/run"""

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_success(self, client, mock_get_watchlist, mock_runner_class):
        """Test successful replay execution and SSE streaming."""
        mock_get_watchlist.return_value = ['RELIANCE', 'TCS', 'INFY']

        mock_bot_config = MagicMock(name="BotConfig")
        mock_runner = MagicMock(name="MultiStrategyRunner")
        mock_runner_class._load_bot_config.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner

        # Simulate replay events via on_event callback
        def fake_run_replay(date_str, symbols, strategy_filter, on_event):
            on_event({
                "type": "started",
                "date": date_str,
                "symbols": symbols,
                "strategy": strategy_filter,
                "timestamp": datetime.now().isoformat()
            })
            for i, sym in enumerate(symbols):
                on_event({
                    "type": "progress",
                    "symbol": sym,
                    "current": i + 1,
                    "total": len(symbols)
                })
            on_event({
                "type": "completed",
                "total_symbols": len(symbols),
                "duration_seconds": 0.5
            })
            # No exception; thread will put None automatically

        mock_runner.run_replay.side_effect = fake_run_replay

        payload = {
            "date": "2026-04-25",
            "strategy": "ALL",
            "symbols": None,
            "refresh_cache": False,
            "bot_uuid": None
        }
        response = client.post("/api/replay/run", json=payload)

        # Assert streaming response
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        # Collect streamed events
        events = []
        for line in response.iter_lines():
            if not line:
                continue
            if isinstance(line, bytes):
                line = line.decode('utf-8')
            if line.startswith("data: "):
                try:
                    event_data = json.loads(line[6:])
                    events.append(event_data)
                except json.JSONDecodeError:
                    pass

        # Verify we got expected events
        assert len(events) >= 5  # started + 3 progress + completed
        assert events[0]["type"] == "started"
        assert events[-1]["type"] == "completed"

        progress_events = [e for e in events if e["type"] == "progress"]
        assert len(progress_events) == 3

        # Verify mocks
        mock_get_watchlist.assert_called_once()
        mock_runner_class._load_bot_config.assert_called_once_with(1)
        mock_runner_class.create_for_replay.assert_called_once_with(bot_config=mock_bot_config)
        mock_runner.run_replay.assert_called_once()

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_with_bot_uuid(self, client, mock_get_watchlist, mock_runner_class):
        """Test that bot_uuid uses _load_bot_config_by_uuid."""
        mock_get_watchlist.return_value = ['RELIANCE']
        mock_bot_config = MagicMock()
        mock_runner = MagicMock()
        mock_runner_class._load_bot_config_by_uuid.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner
        mock_runner.run_replay.return_value = None

        payload = {
            "date": "2026-04-25",
            "strategy": "ORB",
            "bot_uuid": "abc123"
        }
        response = client.post("/api/replay/run", json=payload)
        assert response.status_code == 200

        mock_runner_class._load_bot_config_by_uuid.assert_called_once_with("abc123")
        mock_runner_class._load_bot_config.assert_not_called()

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_error_handling(self, client, mock_get_watchlist, mock_runner_class):
        """Test that exceptions during replay are sent as error events."""
        mock_get_watchlist.return_value = ['RELIANCE']
        mock_bot_config = MagicMock()
        mock_runner = MagicMock()
        mock_runner_class._load_bot_config.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner
        mock_runner.run_replay.side_effect = Exception("Replay failed catastrophically")

        payload = {"date": "2026-04-25"}
        response = client.post("/api/replay/run", json=payload)
        assert response.status_code == 200

        # Collect events
        events = []
        for line in response.iter_lines():
            if line and isinstance(line, bytes):
                line = line.decode('utf-8')
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except:
                    pass

        # Should contain an error event with message
        error_events = [e for e in events if e.get("type") == "error"]
        assert len(error_events) >= 1
        assert "Replay failed catastrophically" in error_events[0]["message"]

    def test_run_replay_missing_date(self, client):
        """Test validation error for missing required date field."""
        payload = {"strategy": "ALL"}  # date missing
        response = client.post("/api/replay/run", json=payload)
        assert response.status_code == 422  # FastAPI validation error

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_watchlist_used_when_no_symbols(self, client, mock_get_watchlist, mock_runner_class):
        """Test that dynamic watchlist is used when symbols not provided."""
        mock_get_watchlist.return_value = ['DEFAULT1', 'DEFAULT2']
        mock_bot_config = MagicMock()
        mock_runner = MagicMock()
        mock_runner_class._load_bot_config.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner
        mock_runner.run_replay.return_value = None

        payload = {"date": "2026-04-25", "symbols": None}
        response = client.post("/api/replay/run", json=payload)
        assert response.status_code == 200
        mock_get_watchlist.assert_called_once()

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_specific_symbols(self, client, mock_get_watchlist, mock_runner_class):
        """Test that provided symbols are used directly."""
        mock_get_watchlist.return_value = ['DEFAULT']  # not used
        mock_bot_config = MagicMock()
        mock_runner = MagicMock()
        mock_runner_class._load_bot_config.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner
        mock_runner.run_replay.return_value = None

        payload = {"date": "2026-04-25", "symbols": "RELIANCE,TCS"}
        response = client.post("/api/replay/run", json=payload)
        assert response.status_code == 200
        # _get_dynamic_watchlist should not be called because symbols provided
        mock_get_watchlist.assert_not_called()
        # The runner.run_replay should get symbols list
        # We can't easily assert args on run_replay because it's called inside thread; but we can at least verify runner was called.
