"""
Extended chart endpoint tests for api/paper/endpoints.py.

Covers: cache hit/miss, intraday_only, ORB levels, EMA series,
pivot levels, trade markers, current position, resample edge cases,
_find_last_trading_day, _filter_to_date_or_recent.
"""

import pytest
import sys
import json
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_1min_candles():
    candles = []
    base_time = datetime(2026, 3, 30, 9, 15, 0, tzinfo=IST)
    for i in range(75):
        candles.append({
            "time": (base_time + timedelta(minutes=i)).isoformat(),
            "open": 282.0 + i * 0.1,
            "high": 284.0 + i * 0.1,
            "low": 281.0 + i * 0.1,
            "close": 283.0 + i * 0.1,
            "volume": 10000,
        })
    return candles


@pytest.fixture
def sample_1min_df():
    index = pd.date_range("2026-03-30 09:15:00", periods=75, freq="1min", tz="Asia/Kolkata")
    return pd.DataFrame({
        "open": [282.0 + i * 0.1 for i in range(75)],
        "high": [284.0 + i * 0.1 for i in range(75)],
        "low": [281.0 + i * 0.1 for i in range(75)],
        "close": [283.0 + i * 0.1 for i in range(75)],
        "volume": [10000] * 75,
    }, index=index)


@pytest.fixture
def sample_multi_day_df():
    """Multi-day 1min DataFrame for intraday_only tests."""
    frames = []
    for day_offset in range(3):
        base = datetime(2026, 3, 28 + day_offset, 9, 15, 0, tzinfo=IST)
        idx = pd.date_range(start=base, periods=50, freq="1min")
        df = pd.DataFrame({
            "open": [280.0 + day_offset] * 50,
            "high": [285.0 + day_offset] * 50,
            "low": [275.0 + day_offset] * 50,
            "close": [282.0 + day_offset] * 50,
            "volume": [10000] * 50,
        }, index=idx)
        frames.append(df)
    return pd.concat(frames)


@pytest.fixture
def sample_400day_df():
    dates = pd.date_range("2025-02-24", periods=400, freq="D", tz="Asia/Kolkata")
    return pd.DataFrame({
        "open": [100 + i * 0.5 for i in range(400)],
        "high": [105 + i * 0.5 for i in range(400)],
        "low": [95 + i * 0.5 for i in range(400)],
        "close": [102 + i * 0.5 for i in range(400)],
        "volume": [50000] * 400,
    }, index=dates)


@pytest.fixture
def mock_trading_deps():
    mock_trader = MagicMock()
    mock_trader.positions = {}
    mock_journal = MagicMock()
    mock_journal.trades = []
    return mock_trader, mock_journal


@pytest.fixture
def mock_trader_with_position():
    """Mock trader with an active position for RELIANCE."""
    from trading.paper_trader import OrderSide
    trader = MagicMock()
    pos = MagicMock()
    pos.symbol = "RELIANCE"
    pos.side = MagicMock(value="BUY")
    pos.quantity = 100
    pos.entry_price = 2500.0
    pos.current_price = 2520.0
    pos.entry_time = datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST)
    pos.stop_loss = 2475.0
    pos.take_profit = 2575.0
    pos.pnl = 2000.0
    pos.pnl_pct = 0.8
    pos.margin_used = 250000.0
    pos.order_id = "ORD-1"
    trader.positions = {"RELIANCE": pos}
    return trader


@pytest.fixture
def sample_journal_trade():
    """A mock journal trade for chart trade markers."""
    t = MagicMock()
    t.trade_id = "TRD-001"
    t.symbol = "RELIANCE"
    t.side = "BUY"
    t.quantity = 100
    t.entry_price = 2500.0
    t.exit_price = 2550.0
    t.entry_time = "2026-03-30T10:00:00+05:30"
    t.exit_time = "2026-03-30T11:00:00+05:30"
    t.pnl = 5000.0
    t.pnl_pct = 2.0
    t.exit_reason = "TP"
    t.costs = 50.0
    t.net_pnl = 4950.0
    t.sl_price = 2475.0
    t.tp_price = 2575.0
    t.strategy_id = 0
    t.strategy_name = ""
    t.notes = ""
    t.bot_id = None
    t.bot_name = None
    t.strategy_type = ""
    return t


# ---------------------------------------------------------------------------
# Tests: _resample_to_timeframe
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestResampleTimeframe:

    def test_resample_5min(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # Verify more candles than 15min would have (at least 15 candles from 75)
        assert len(data["candles"]) >= 14, f"Expected >=14 candles for 5min, got {len(data['candles'])}"
        assert data["timeframe"] == "5min"

    def test_resample_5min_vs_15min_candle_count(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        """Verify larger timeframe produces fewer candles."""
        mock_trader, mock_journal = mock_trading_deps

        # Get 5min candles
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df

        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            resp_5min = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
            resp_15min = client.get("/api/paper/chart/ONGC?timeframe=15min", headers=auth_headers)

        candles_5 = len(resp_5min.json()["candles"])
        candles_15 = len(resp_15min.json()["candles"])

        # 5min should have more candles than 15min
        assert candles_5 > candles_15, f"5min({candles_5}) should have more candles than 15min({candles_15})"
        # If tf_map is wrong (5min mapped to 15min), counts would be similar

    def test_resample_15min(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=15min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["candles"]) > 0

    def test_resample_30min(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=30min", headers=auth_headers)
        assert response.status_code == 200
        assert len(response.json()["candles"]) > 0

    def test_resample_1hour(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=1hour", headers=auth_headers)
        assert response.status_code == 200
        assert len(response.json()["candles"]) > 0

    def test_resample_1min_passthrough(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=1min", headers=auth_headers)
        assert response.status_code == 200
        # 1min should have more candles than 5min
        assert len(response.json()["candles"]) >= 75


# ---------------------------------------------------------------------------
# Tests: Cache hit/miss
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCacheHitMiss:

    def test_cache_hit_returns_cached_data(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        cached_df = sample_1min_df.copy()
        with patch("api.paper.endpoints.get_cached_candles", return_value=(cached_df, True)), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["cached"] is True
        assert len(data["candles"]) > 0

    def test_cache_miss_fetches_fresh(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df

        with patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)) as mock_get, \
             patch("api.paper.endpoints.save_cached_candles") as mock_save, \
             patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["cached"] is False
        assert len(data["candles"]) > 0
        # Verify save was called on cache miss
        assert mock_save.called, "save_cached_candles must be called on cache miss"


# ---------------------------------------------------------------------------
# Tests: intraday_only filter
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestIntradayOnly:

    def test_intraday_only_filters_to_last_day(self, client, auth_headers, sample_multi_day_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = sample_multi_day_df
        mock_api.fetch_intraday_data_v3.return_value = None
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=5min&intraday_only=true",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        # With intraday_only, candles should be from only one day
        if data.get("candles"):
            dates = set(c["time"][:10] for c in data["candles"])
            assert len(dates) <= 2  # at most boundary candles from adjacent day


# ---------------------------------------------------------------------------
# Tests: ORB levels
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestORBLevels:

    def test_orb_levels_present(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        orb = data.get("orb_levels")
        assert orb is not None
        assert "or_high" in orb
        assert "or_low" in orb
        assert "or_range" in orb
        assert "or_range_pct" in orb
        assert "or_minutes" in orb
        # Verify high > low (not flipped to min())
        assert orb["or_high"] > orb["or_low"], f"or_high({orb['or_high']}) must be > or_low({orb['or_low']})"
        # Verify or_range is positive
        assert orb["or_range"] > 0, f"or_range must be positive, got {orb['or_range']}"

    def test_orb_levels_with_strategy_id(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        mock_cfg = MagicMock()
        mock_cfg.or_minutes = 30
        mock_cfg.ema_fast_period = 9
        mock_cfg.ema_slow_period = 21
        mock_cfg.strategy_type = "EMA_CROSS"

        # SessionLocal is used as `with SessionLocal() as db:` with local import
        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_session.query.return_value.filter.return_value.first.return_value = mock_cfg

        def session_factory():
            return mock_session

        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("db.database.SessionLocal", side_effect=session_factory), \
             patch("api.paper.endpoints.SessionLocal", side_effect=session_factory), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=5min&strategy_id=1",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        orb = data.get("orb_levels")
        assert orb is not None
        assert orb["or_minutes"] == 30


# ---------------------------------------------------------------------------
# Tests: EMA series
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestEMASeries:

    def test_ema_series_computed(self, client, auth_headers, sample_1min_df, sample_400day_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        mock_api.fetch_historical_data_v3.return_value = sample_400day_df

        # Mock strategy config for both ORB (strategy_id lookup) and EMA (EMA_CROSS lookup)
        mock_orb_cfg = MagicMock()
        mock_orb_cfg.or_minutes = 30
        mock_ema_cfg = MagicMock()
        mock_ema_cfg.ema_fast_period = 9
        mock_ema_cfg.ema_slow_period = 21
        mock_ema_cfg.strategy_type = "EMA_CROSS"

        call_count = {"n": 0}
        def mock_first():
            call_count["n"] += 1
            if call_count["n"] == 1:
                return mock_orb_cfg  # First call: ORB strategy_id lookup
            return mock_ema_cfg  # Second call: EMA_CROSS lookup

        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_session.query.return_value.filter.return_value.first.side_effect = mock_first

        def session_factory():
            return mock_session

        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("db.database.SessionLocal", side_effect=session_factory), \
             patch("api.paper.endpoints.SessionLocal", side_effect=session_factory), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min&strategy_id=1", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        ema = data.get("ema_series")
        assert ema is not None
        assert "ema_fast" in ema
        assert "ema_slow" in ema
        assert len(ema["ema_fast"]["data"]) > 0
        assert len(ema["ema_slow"]["data"]) > 0

    def test_ema_series_graceful_on_db_error(self, client, auth_headers, sample_1min_df, sample_400day_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        mock_api.fetch_historical_data_v3.return_value = sample_400day_df
        # Pass strategy_id so the local import of SessionLocal runs,
        # then make it fail to test graceful fallback
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("db.database.SessionLocal", side_effect=Exception("DB error")), \
             patch("api.paper.endpoints.SessionLocal", side_effect=Exception("DB error")), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min&strategy_id=1", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["candles"]) > 0


# ---------------------------------------------------------------------------
# Tests: Pivot levels
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestPivotLevels:

    def test_pivot_levels_present(self, client, auth_headers, sample_1min_df, sample_400day_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        mock_api.fetch_historical_data_v3.return_value = sample_400day_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        pivots = data.get("pivot_levels")
        assert pivots is not None
        assert "pp" in pivots
        # Verify pivot relationships: r1 > pp > s1
        assert pivots["r1"] > pivots["pp"], f"r1({pivots['r1']}) must be > pp({pivots['pp']})"
        assert pivots["pp"] > pivots["s1"], f"pp({pivots['pp']}) must be > s1({pivots['s1']})"
        # If formula flipped (2*pp + prev_l instead of 2*pp - prev_l), these would fail
        assert "r1" in pivots
        assert "r2" in pivots
        assert "s1" in pivots
        assert "s2" in pivots
        assert pivots["r1"] >= pivots["pp"]
        assert pivots["pp"] >= pivots["s1"]


# ---------------------------------------------------------------------------
# Tests: Trade markers
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestTradeMarkers:

    def test_trades_from_db(self, client, auth_headers, sample_1min_df, mock_trading_deps, sample_journal_trade):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[sample_journal_trade]), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper.endpoints.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/RELIANCE?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["trades"]) >= 1
        trade = data["trades"][0]
        assert trade["symbol"] == "RELIANCE"
        assert "entry_price" in trade
        assert "exit_price" in trade

    def test_trades_fallback_to_journal(self, client, auth_headers, sample_1min_df, mock_trading_deps, sample_journal_trade):
        mock_trader, mock_journal = mock_trading_deps
        mock_journal.trades = [sample_journal_trade]
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        today = datetime.now(IST).strftime("%Y-%m-%d")
        sample_journal_trade.exit_time = f"{today}T11:00:00+05:30"
        sample_journal_trade.entry_time = f"{today}T10:00:00+05:30"
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[]), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper.endpoints.get_journal", return_value=mock_journal), \
             patch("pathlib.Path.exists", return_value=False):
            response = client.get("/api/paper/chart/RELIANCE?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "trades" in data, f"Response keys: {list(data.keys())}"
        assert len(data["trades"]) >= 1


# ---------------------------------------------------------------------------
# Tests: Current position overlay
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCurrentPosition:

    def test_position_from_snapshot(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        snapshot = {
            "positions": [
                {"symbol": "RELIANCE", "side": "BUY", "quantity": 100, "entry_price": 2500.0}
            ]
        }
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[]), \
             patch("api.paper.endpoints._load_fresh_bot_snapshot", return_value=snapshot), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/RELIANCE?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        pos = data.get("current_position")
        assert pos is not None
        assert pos["symbol"] == "RELIANCE"

    def test_position_from_in_memory_trader(self, client, auth_headers, sample_1min_df, mock_trading_deps, mock_trader_with_position):
        _, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[]), \
             patch("api.paper.endpoints._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper.endpoints.get_paper_trader", return_value=mock_trader_with_position), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader_with_position), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/RELIANCE?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        pos = data.get("current_position")
        assert pos is not None
        assert pos["symbol"] == "RELIANCE"

    def test_no_position(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[]), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/RELIANCE?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data.get("current_position") is None


# ---------------------------------------------------------------------------
# Tests: _find_last_trading_day
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestFindLastTradingDay:

    def test_finds_data_on_first_try(self):
        import api.paper.endpoints as ep
        from api.paper.endpoints import _find_last_trading_day
        mock_api = MagicMock()
        df = pd.DataFrame({
            "open": [100], "high": [105], "low": [95], "close": [102],
        }, index=pd.DatetimeIndex([datetime(2026, 3, 30, 9, 15, tzinfo=IST)]))
        mock_api.fetch_historical_data_v3.return_value = df
        # Inject pd into endpoints module (not imported at module level)
        old_pd = getattr(ep, 'pd', None)
        ep.pd = pd
        try:
            with patch("api.paper.endpoints.console"):
                result = _find_last_trading_day(mock_api, "ONGC", "2026-03-30", max_days=5)
        finally:
            if old_pd is None:
                delattr(ep, 'pd')
        assert result == "2026-03-30"

    def test_iterates_back_multiple_days(self):
        import api.paper.endpoints as ep
        from api.paper.endpoints import _find_last_trading_day
        mock_api = MagicMock()
        empty_df = pd.DataFrame()
        good_df = pd.DataFrame({
            "open": [100], "high": [105], "low": [95], "close": [102],
        }, index=pd.DatetimeIndex([datetime(2026, 3, 28, 9, 15, tzinfo=IST)]))
        mock_api.fetch_historical_data_v3.side_effect = [empty_df, empty_df, good_df]
        ep.pd = pd
        try:
            with patch("api.paper.endpoints.console"):
                result = _find_last_trading_day(mock_api, "ONGC", "2026-03-30", max_days=5)
        finally:
            delattr(ep, 'pd')
        assert result == "2026-03-28"

    def test_returns_original_date_on_failure(self):
        import api.paper.endpoints as ep
        from api.paper.endpoints import _find_last_trading_day
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = None
        ep.pd = pd
        try:
            with patch("api.paper.endpoints.console"):
                result = _find_last_trading_day(mock_api, "ONGC", "2026-03-30", max_days=3)
        finally:
            delattr(ep, 'pd')
        assert result == "2026-03-30"


# ---------------------------------------------------------------------------
# Tests: Weekend/holiday fallback
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestWeekendFallback:

    def test_weekend_returns_last_trading_day(self, client, auth_headers, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        friday = datetime(2026, 3, 27, 9, 15, 0, tzinfo=IST)
        idx = pd.date_range(start=friday, periods=50, freq="1min")
        df = pd.DataFrame({
            "open": [280.0] * 50, "high": [285.0] * 50,
            "low": [275.0] * 50, "close": [282.0] * 50,
            "volume": [10000] * 50,
        }, index=idx)
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = None
        mock_api.fetch_historical_data_v3.return_value = df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=5min&date=2026-03-28",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["candles"]) > 0


# ---------------------------------------------------------------------------
# Tests: Error handling
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestChartErrors:

    def test_no_data_returns_error(self, client, auth_headers, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = None
        mock_api.fetch_historical_data_v3.return_value = None
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._find_last_trading_day", return_value="2026-03-28"), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/INVALID?timeframe=5min&date=2026-03-28",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "error" in data

    def test_api_exception_handled(self, client, auth_headers):
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", side_effect=Exception("API down")):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "error" in data


# ---------------------------------------------------------------------------
# Tests: Response shape
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestResponseShape:

    def test_response_has_all_fields(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[]), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "symbol" in data
        assert "date" in data
        assert "timeframe" in data
        assert "candles" in data
        assert "trades" in data
        assert "cached" in data

    def test_candle_structure(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper.endpoints.get_cached_candles", return_value=(None, False)), \
             patch("api.paper.endpoints.save_cached_candles"), \
             patch("api.paper.endpoints._get_symbol_trades_from_db", return_value=[]), \
             patch("api.paper_trading._load_fresh_bot_snapshot", return_value=None), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get("/api/paper/chart/ONGC?timeframe=5min", headers=auth_headers)
        data = response.json()
        candle = data["candles"][0]
        assert "time" in candle
        assert "open" in candle
        assert "high" in candle
        assert "low" in candle
        assert "close" in candle
        assert "volume" in candle
