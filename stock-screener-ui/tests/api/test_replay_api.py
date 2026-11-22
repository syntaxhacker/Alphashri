"""Tests for Replay API endpoints."""

import sys
import types
from pathlib import Path
import json
import pytest
import pandas as pd
from unittest.mock import patch, MagicMock
from datetime import datetime

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient


class TestReplayAPI:
    """Tests for POST /api/replay/run"""

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_success(self, mock_get_watchlist, mock_runner_class, client):
        """Test successful replay execution and SSE streaming."""
        mock_get_watchlist.return_value = ['RELIANCE', 'TCS', 'INFY']

        mock_bot_config = MagicMock(name="BotConfig")
        mock_runner = MagicMock(name="MultiStrategyRunner")
        mock_runner_class._load_bot_config.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner

        def fake_run_replay(date_str, symbols, strategy_filter, on_event, end_date_str=None):
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

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

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

        assert len(events) >= 5  # started + 3 progress + completed
        assert events[0]["type"] == "started"
        assert events[-1]["type"] == "completed"

        progress_events = [e for e in events if e["type"] == "progress"]
        assert len(progress_events) == 3

        mock_get_watchlist.assert_called_once()
        mock_runner_class._load_bot_config.assert_called_once_with(1)
        mock_runner_class.create_for_replay.assert_called_once_with(bot_config=mock_bot_config)
        mock_runner.run_replay.assert_called_once()

    @patch('trading.runner_core.MultiStrategyRunner')
    @patch('api.replay_api._get_dynamic_watchlist')
    def test_run_replay_with_bot_uuid(self, mock_get_watchlist, mock_runner_class, client):
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
    def test_run_replay_error_handling(self, mock_get_watchlist, mock_runner_class, client):
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

        events = []
        for line in response.iter_lines():
            if line and isinstance(line, bytes):
                line = line.decode('utf-8')
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except:
                    pass

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
    def test_run_replay_watchlist_used_when_no_symbols(self, mock_get_watchlist, mock_runner_class, client):
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
    def test_run_replay_specific_symbols(self, mock_get_watchlist, mock_runner_class, client):
        """Test that provided symbols are used directly."""
        mock_get_watchlist.return_value = ['DEFAULT']  # not used
        mock_bot_config = MagicMock()
        mock_runner = MagicMock()
        mock_runner_class._load_bot_config.return_value = mock_bot_config
        mock_runner_class.create_for_replay.return_value = mock_runner
        mock_runner.run_replay.return_value = None

        payload = {"date": "2026-04-25", "symbols": ["RELIANCE", "TCS"]}
        response = client.post("/api/replay/run", json=payload)
        assert response.status_code == 200
        # _get_dynamic_watchlist should not be called because symbols provided
        mock_get_watchlist.assert_not_called()
        # The runner.run_replay should get symbols list
        # We can't easily assert args on run_replay because it's called inside thread; but we can at least verify runner was called.


class TestWatchlistScanCache:
    """The ORB screen fans out to 3 TV profiles + the NSE instrument list.

    Replaying several requests in a session must not repeat that full scan.
    """

    @pytest.fixture(autouse=True)
    def _isolated_cache(self):
        clock = {"now": 1000.0}
        with patch('api.replay_api._watchlist_cache', None), \
             patch('api.replay_api._watchlist_clock', side_effect=lambda: clock["now"]):
            yield clock

    @staticmethod
    def _install_screener(calls, names):
        class FakeScreener:
            def __init__(self, use_relaxed=True):
                assert use_relaxed is True

            def screen(self, limit=200, verify_nse=True):
                calls.append((limit, verify_nse))
                return pd.DataFrame({'name': names})

        fake_module = types.SimpleNamespace(ORBStockScreener=FakeScreener)
        return patch.dict(sys.modules, {'orb_stock_screener': fake_module})

    def test_repeated_calls_scan_once_within_ttl(self, _isolated_cache):
        from api.replay_api import _get_dynamic_watchlist

        calls = []
        with self._install_screener(calls, ['reliance', 'tcs']):
            results = [_get_dynamic_watchlist() for _ in range(5)]

        assert calls == [(50, True)]  # single full scan, not one per request
        assert all(r == ['RELIANCE', 'TCS'] for r in results)

    def test_cache_expires_after_ttl(self, _isolated_cache):
        from api.replay_api import _get_dynamic_watchlist

        calls = []
        with self._install_screener(calls, ['reliance']):
            assert _get_dynamic_watchlist() == ['RELIANCE']
            _isolated_cache["now"] += 299.0
            assert _get_dynamic_watchlist() == ['RELIANCE']
            assert len(calls) == 1

            _isolated_cache["now"] += 2.0  # cross the 300s TTL
            assert _get_dynamic_watchlist() == ['RELIANCE']

        assert len(calls) == 2

    def test_refresh_cache_forces_a_new_scan(self, _isolated_cache):
        from api.replay_api import _get_dynamic_watchlist, _load_symbols

        calls = []
        with self._install_screener(calls, ['tcs']):
            _get_dynamic_watchlist()
            _get_dynamic_watchlist()
            _load_symbols(None, force_refresh=True)

        assert len(calls) == 2

    def test_failed_scan_is_not_retried_within_ttl(self, _isolated_cache):
        from api.replay_api import _get_dynamic_watchlist, DEFAULT_WATCHLIST

        calls = []

        class BrokenScreener:
            def __init__(self, use_relaxed=True):
                pass

            def screen(self, limit=200, verify_nse=True):
                calls.append(limit)
                raise RuntimeError("TV unavailable")

        fake_module = types.SimpleNamespace(ORBStockScreener=BrokenScreener)
        with patch.dict(sys.modules, {'orb_stock_screener': fake_module}):
            first = _get_dynamic_watchlist()
            second = _get_dynamic_watchlist()

        assert calls == [50]
        assert first == second == list(DEFAULT_WATCHLIST)

    def test_cached_watchlist_is_a_copy(self, _isolated_cache):
        from api.replay_api import _get_dynamic_watchlist

        with self._install_screener([], ['reliance']):
            first = _get_dynamic_watchlist()
            first.append('POISON')
            assert _get_dynamic_watchlist() == ['RELIANCE']

    def test_symbols_endpoint_reuses_scan_across_requests(self, _isolated_cache, client):
        calls = []
        with self._install_screener(calls, ['infy']):
            first = client.get('/api/replay/symbols')
            second = client.get('/api/replay/symbols')

        assert first.status_code == second.status_code == 200
        assert first.json() == second.json() == {'symbols': ['INFY']}
        assert len(calls) == 1

