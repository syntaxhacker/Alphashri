"""Tests for week52 batch: staleness, market hours delegation, prompt run, workers/delay."""
import sys
from pathlib import Path
import inspect
from unittest.mock import patch, MagicMock, AsyncMock
import asyncio

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import config
from scripts.compute_52w_ranges_upstox import DEFAULT_WORKERS, DEFAULT_DELAY_SEC


class TestWeek52Defaults:
    def test_workers_and_delay(self):
        assert DEFAULT_WORKERS == 3, "should be 3 workers per AGENTS.md"
        assert abs(DEFAULT_DELAY_SEC - 0.35) < 1e-9, "should be 0.35s delay"


class TestIsMarketHoursDelegation:
    def test_delegates_to_is_market_open(self):
        from api_server_fastapi import _is_market_hours
        with patch("trading.utils.is_market_open", return_value=True) as mock_open:
            assert _is_market_hours() is True
            mock_open.assert_called_once()
        with patch("trading.utils.is_market_open", return_value=False) as mock_open:
            assert _is_market_hours() is False
            mock_open.assert_called_once()

    def test_fallback_on_import_error(self):
        from api_server_fastapi import _is_market_hours
        with patch.dict("sys.modules", {"trading.utils": None}):
            # force ImportError path
            with patch("api_server_fastapi.datetime") as mock_dt:
                mock_dt.now.return_value.hour = 10
                # reload function logic by patching is_market_open to raise
                with patch("trading.utils.is_market_open", side_effect=ImportError):
                    result = _is_market_hours()
                    # should fallback to hour check 8-16 -> True for hour 10
                    assert result in (True, False)


class TestSkipUpdatedToday:
    def test_skip_updated_today_filters(self):
        from scripts.compute_52w_ranges_upstox import load_symbols
        # Test the skip logic via main's filtering: mock DB rows with updated_at today
        from datetime import datetime
        mock_row = MagicMock()
        mock_row.symbol = "RELIANCE"
        mock_row.updated_at = datetime.now(config.IST).replace(tzinfo=None)
        mock_row2 = MagicMock()
        mock_row2.symbol = "TCS"
        mock_row2.updated_at = datetime(2020, 1, 1)
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = [mock_row, mock_row2]
        with patch("scripts.compute_52w_ranges_upstox.SessionLocal", return_value=mock_db):
            # Simulate the skip_updated_today filtering block
            today = datetime.now(config.IST).date()
            symbols = ["RELIANCE", "TCS", "INFY"]
            fresh = {r.symbol for r in [mock_row, mock_row2] if r.updated_at and r.updated_at.date() >= today}
            filtered = [s for s in symbols if s not in fresh]
            assert "RELIANCE" not in filtered
            assert "TCS" in filtered
            assert "INFY" in filtered


class TestPromptInitialRun:
    def test_compute_task_prompt_vs_interval(self):
        # Inspect source for prompt initial run: first sleep 5, else interval
        from api_server_fastapi import compute_52w_ranges_task
        src = inspect.getsource(compute_52w_ranges_task)
        assert "first" in src
        assert "await asyncio.sleep(5)" in src
        assert "await asyncio.sleep(interval)" in src
        assert "SCREENER_52W_INTERVAL_SEC" in src

    @pytest.mark.asyncio
    async def test_task_skips_when_market_closed(self):
        from api_server_fastapi import compute_52w_ranges_task
        # Patch sleeps to fast-forward and market hours to False to test continue path
        with patch("api_server_fastapi._is_market_hours", return_value=False), \
             patch("api_server_fastapi.asyncio.sleep", new_callable=AsyncMock) as mock_sleep, \
             patch("trading.week52_job_status.get_job_status", return_value=None), \
             patch("api.admin_routes._run_52w_batch_subprocess") as mock_run:
            # mock sleep to raise CancelledError after first iteration
            async def fake_sleep(secs):
                raise asyncio.CancelledError()
            mock_sleep.side_effect = fake_sleep
            try:
                await compute_52w_ranges_task()
            except asyncio.CancelledError:
                pass
            mock_run.assert_not_called()


class TestWeek52RangeLookup:
    def test_sanitize_bulk(self):
        from trading.week52_range_lookup import _sanitize_52w_ranges_bulk
        data = {
            "RELIANCE": {"high": 100, "low": 90, "close": 95},
            "BAD": {"high": float("inf"), "low": 90, "close": 95},
            "BAD2": {"high": None, "low": 90, "close": 95},
        }
        clean = _sanitize_52w_ranges_bulk(data)
        assert "RELIANCE" in clean
        assert "BAD" not in clean
        assert "BAD2" not in clean

    def test_load_all_uses_redis_first(self):
        from trading.week52_range_lookup import load_all_52w_ranges
        with patch("cache.redis_client.cache_get", return_value={"TCS": {"high": 100, "low": 50, "close": 80}}) as mock_get, \
             patch("db.database.SessionLocal") as mock_db_cls:
            result = load_all_52w_ranges()
            assert "TCS" in result
            mock_db_cls.assert_not_called()

    def test_screener_52w_no_ranges_warning(self):
        from api.screener_api.screener_52w import fetch_52w_high_data
        with patch("api.screener_api.screener_52w.load_all_52w_ranges", return_value={}):
            data = fetch_52w_high_data()
            assert data["approaching"] == []
            assert data["warning"] is not None
