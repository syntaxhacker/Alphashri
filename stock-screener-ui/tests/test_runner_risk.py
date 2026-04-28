"""Unit tests for RunnerRiskMixin data fetching methods."""
import sys
from datetime import datetime, date, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from trading.runner_risk import RunnerRiskMixin
from trading.timezone import IST


class MockRunner(RunnerRiskMixin):
    """A test runner that implements required methods for RunnerRiskMixin."""
    def __init__(self, data_fetcher=None, to_date=None, ist_now=None, strategies=None):
        self._data_fetcher = data_fetcher
        self._to_date_val = to_date
        self._ist_now_val = ist_now
        self.strategies = strategies or {}
    
    def _get_data_fetcher(self):
        return self._data_fetcher
    
    def _get_to_date(self):
        return self._to_date_val
    
    def _ist_now(self):
        return self._ist_now_val if self._ist_now_val else datetime.now(IST)


@pytest.fixture
def sample_candles():
    """Sample 5-minute candles for ORB data."""
    return [
        {'time': '2026-04-09T09:15:00', 'open': 100, 'high': 101, 'low': 99, 'close': 100.5},
        {'time': '2026-04-09T09:20:00', 'open': 100.5, 'high': 102, 'low': 100, 'close': 101.5},
        {'time': '2026-04-09T09:25:00', 'open': 101.5, 'high': 103, 'low': 101, 'close': 102.5},
        {'time': '2026-04-09T09:30:00', 'open': 102.5, 'high': 104, 'low': 102, 'close': 103.5},
        {'time': '2026-04-09T09:35:00', 'open': 103.5, 'high': 105, 'low': 103, 'close': 104.5},
    ]


@pytest.fixture
def simple_daily_df():
    """Simple daily OHLCV DataFrame with 10 days."""
    import pandas as pd
    dates = pd.date_range(end=date.today(), periods=10, tz=IST)
    data = {
        'open': [100 + i for i in range(10)],
        'high': [101 + i for i in range(10)],
        'low': [99 + i for i in range(10)],
        'close': [100.5 + i for i in range(10)],
        'volume': [10000 + i*100 for i in range(10)],
    }
    df = pd.DataFrame(data, index=dates)
    return df


class TestFetchOrData:
    """Tests for fetch_or_data method."""

    def test_returns_none_if_no_fetcher(self):
        runner = MockRunner(data_fetcher=None)
        result = runner.fetch_or_data("RELIANCE")
        assert result is None

    def test_returns_none_if_df_empty(self):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = MagicMock(empty=True)
        runner = MockRunner(data_fetcher=mock_fetcher)
        result = runner.fetch_or_data("RELIANCE")
        assert result is None

    def test_returns_none_if_no_signal_generator(self):
        mock_fetcher = MagicMock()
        df = MagicMock()
        df.empty = False
        df.iterrows.return_value = [(0, {'open': 100, 'high': 101, 'low': 99, 'close': 100.5})]
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = df
        runner = MockRunner(data_fetcher=mock_fetcher, strategies={})
        result = runner.fetch_or_data("RELIANCE")
        assert result is None

    def test_processes_candles_and_adds_latest_fields(self):
        """Test successful OR calculation and latest price fields."""
        import pandas as pd
        mock_fetcher = MagicMock()
        sample_candles = [
            {'time': '2026-04-09T09:15:00', 'open': 100, 'high': 101, 'low': 99, 'close': 100.5},
            {'time': '2026-04-09T09:20:00', 'open': 100.5, 'high': 102, 'low': 100, 'close': 101.5},
            {'time': '2026-04-09T09:25:00', 'open': 101.5, 'high': 103, 'low': 101, 'close': 102.5},
            {'time': '2026-04-09T09:30:00', 'open': 102.5, 'high': 104, 'low': 102, 'close': 103.5},
            {'time': '2026-04-09T09:35:00', 'open': 103.5, 'high': 105, 'low': 103, 'close': 104.5},
        ]
        df = pd.DataFrame(sample_candles)
        df.index = pd.to_datetime(df['time'])
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = df

        mock_signal_gen = MagicMock()
        or_levels = {
            'or_high': 105.0,
            'or_low': 99.0,
            'or_open': 100.0,
            'or_range': 6.0,
            'or_range_pct': 6.0,
            'or_close': 104.5,
            'or_candles': 5,
        }
        mock_signal_gen.calculate_or_levels.return_value = or_levels

        mock_runner = MagicMock()
        mock_runner.strategy_type = "ORB"
        mock_runner.signal_generator = mock_signal_gen

        runner = MockRunner(data_fetcher=mock_fetcher, strategies={1: mock_runner})
        result = runner.fetch_or_data("RELIANCE", runner=mock_runner)

        assert result is not None
        assert result['or_high'] == 105.0
        assert result['or_low'] == 99.0
        # n=5, n%3=2, so latest_price uses last candle close
        assert result['latest_price'] == 104.5
        assert result['latest_high'] == 105.0
        assert result['latest_low'] == 103.0

    def test_latest_price_uses_correct_15min_boundary_multiple_of_3(self):
        """For n=6 (multiple of 3), latest_price should be from candle at index n - (n%3) - 1 = 5 (last candle)."""
        import pandas as pd
        mock_fetcher = MagicMock()
        # Create 6 candles
        sample_candles = [
            {'time': f'2026-04-09T09:{10+i*5:02d}:00', 'open': 100+i, 'high': 101+i, 'low': 99+i, 'close': 100.5+i}
            for i in range(6)
        ]
        df = pd.DataFrame(sample_candles)
        df.index = pd.to_datetime(df['time'])
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = df

        mock_signal_gen = MagicMock()
        or_levels = {'or_high': 106, 'or_low': 99, 'or_open': 100, 'or_range': 7, 'or_range_pct': 7, 'or_close': 105.5, 'or_candles': 6}
        mock_signal_gen.calculate_or_levels.return_value = or_levels

        mock_runner = MagicMock()
        mock_runner.strategy_type = "ORB"
        mock_runner.signal_generator = mock_signal_gen

        runner = MockRunner(data_fetcher=mock_fetcher, strategies={1: mock_runner})
        result = runner.fetch_or_data("RELIANCE", runner=mock_runner)

        # n=6 -> n%3=0 -> prev_boundary_idx = 6-0-1=5 -> last candle (index5) close = 100.5+5 = 105.5
        assert result['latest_price'] == 105.5
        assert result['latest_high'] == 106.0  # high of last candle = 101+5=106
        assert result['latest_low'] == 104.0   # low of last candle = 99+5=104

    def test_exception_returns_none_and_logs(self, capsys):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.side_effect = Exception("API error")
        runner = MockRunner(data_fetcher=mock_fetcher, strategies={})
        result = runner.fetch_or_data("RELIANCE")
        assert result is None
        captured = capsys.readouterr()
        # Should log an error message
        assert "Error fetching OR for RELIANCE" in captured.out or "Error fetching OR for RELIANCE" in captured.err


class TestFetchDailyData:
    """Tests for fetch_daily_data method."""

    def test_returns_none_if_no_fetcher(self):
        runner = MockRunner(data_fetcher=None, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")
        assert result is None

    def test_returns_none_if_df_empty(self):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = MagicMock(empty=True)
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")
        assert result is None

    def test_processes_daily_data_correctly(self, simple_daily_df):
        """Test successful processing of daily data."""
        import pandas as pd
        mock_fetcher = MagicMock()
        # Ensure volume column exists
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = simple_daily_df

        to_date = date.today()
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=to_date)
        result = runner.fetch_daily_data("RELIANCE")

        assert result is not None
        # Current price should be last close
        expected_current = simple_daily_df['close'].iloc[-1]
        assert result['current_price'] == expected_current

        # high_52w: max of last 252 days if available, else max of all. Here we have 10 days
        expected_high_52w = simple_daily_df['high'].max()
        assert result['high_52w'] == expected_high_52w

        assert result['daily_highs'] == simple_daily_df['high'].tolist()
        assert result['daily_closes'] == simple_daily_df['close'].tolist()
        assert result['volume'] == simple_daily_df['volume'].iloc[-1]
        # avg_volume_20d: only computed if len>=20, else 0.0
        if len(simple_daily_df) >= 20:
            expected_avg_vol = simple_daily_df['volume'].tolist()[-20:]
            assert result['avg_volume_20d'] == sum(expected_avg_vol) / 20
        else:
            assert result['avg_volume_20d'] == 0.0
        # ma50: if len(closes) >=50, else 0. Here len=10 -> 0
        assert result['ma50'] == 0.0
        assert result['ma200'] == 0.0
        # prev_high, prev_low, prev_close from second-last row
        assert result['prev_high'] == simple_daily_df['high'].iloc[-2]
        assert result['prev_low'] == simple_daily_df['low'].iloc[-2]
        assert result['prev_close'] == simple_daily_df['close'].iloc[-2]

    def test_ma_calculations_with_sufficient_data(self):
        """Test MA50 and MA200 when enough data is available."""
        import pandas as pd
        # Create 200 days of data
        dates = pd.date_range(end=date.today(), periods=200, tz=IST)
        closes = [100 + i*0.1 for i in range(200)]
        data = {
            'open': closes,
            'high': [c+1 for c in closes],
            'low': [c-1 for c in closes],
            'close': closes,
            'volume': [10000]*200,
        }
        df = pd.DataFrame(data, index=dates)
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = df
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")
        assert result is not None
        # ma50 = average of last 50 closes
        expected_ma50 = sum(closes[-50:]) / 50
        assert abs(result['ma50'] - expected_ma50) < 0.001
        # ma200 = average of last 200 closes (all)
        expected_ma200 = sum(closes) / 200
        assert abs(result['ma200'] - expected_ma200) < 0.001

    def test_prev_day_values_with_single_row(self):
        """When only one row, prev_* should fall back to current."""
        import pandas as pd
        dates = pd.date_range(end=date.today(), periods=1, tz=IST)
        df = pd.DataFrame({
            'open': [100],
            'high': [101],
            'low': [99],
            'close': [100.5],
            'volume': [10000],
        }, index=dates)
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = df
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")
        assert result is not None
        assert result['prev_high'] == 101.0
        assert result['prev_low'] == 99.0
        assert result['prev_close'] == 100.5

    def test_missing_volume_column(self):
        """If volume column missing, volume fields should be 0."""
        import pandas as pd
        dates = pd.date_range(end=date.today(), periods=5, tz=IST)
        df = pd.DataFrame({
            'open': [100]*5,
            'high': [101]*5,
            'low': [99]*5,
            'close': [100.5]*5,
        }, index=dates)
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = df
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")
        assert result is not None
        assert result['volume'] == 0.0
        assert result['avg_volume_20d'] == 0.0

    def test_exception_returns_none_and_logs(self, capsys):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.side_effect = Exception("API error")
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")
        assert result is None
        captured = capsys.readouterr()
        assert "Error fetching daily data for RELIANCE" in captured.out or "Error fetching daily data for RELIANCE" in captured.err

    # --- Intraday price override tests ---

    def test_overrides_current_price_with_intraday_data(self, simple_daily_df):
        """When intraday 1-min data is available, current_price should use the latest intraday close."""
        import pandas as pd
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = simple_daily_df

        intraday_df = pd.DataFrame({'close': [150.0, 151.5, 152.75]})
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = intraday_df

        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")

        assert result is not None
        assert result['current_price'] == 152.75  # latest intraday close
        # Daily fields should still be from daily data
        assert result['high_52w'] == simple_daily_df['high'].max()
        assert result['ma50'] == 0.0

    def test_falls_back_to_daily_close_when_intraday_is_none(self, simple_daily_df):
        """When intraday fetch returns None, current_price should use daily close."""
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = simple_daily_df
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = None

        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")

        assert result is not None
        expected = simple_daily_df['close'].iloc[-1]
        assert result['current_price'] == expected

    def test_falls_back_to_daily_close_when_intraday_empty(self, simple_daily_df):
        """When intraday fetch returns empty DataFrame, current_price should use daily close."""
        import pandas as pd
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = simple_daily_df

        empty_df = pd.DataFrame()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = empty_df

        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")

        assert result is not None
        expected = simple_daily_df['close'].iloc[-1]
        assert result['current_price'] == expected

    def test_falls_back_to_daily_close_when_intraday_raises_exception(self, simple_daily_df):
        """When intraday fetch raises an exception, current_price should fall back silently."""
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = simple_daily_df
        mock_fetcher.upstox_api.fetch_intraday_data_v3.side_effect = Exception("Intraday API error")

        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")

        assert result is not None
        expected = simple_daily_df['close'].iloc[-1]
        assert result['current_price'] == expected

    def test_intraday_override_preserves_daily_fields(self, simple_daily_df):
        """Intraday price override should not affect other daily data fields."""
        import pandas as pd
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = simple_daily_df
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = pd.DataFrame({'close': [999.0]})

        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_daily_data("RELIANCE")

        assert result is not None
        assert result['current_price'] == 999.0
        assert result['high_52w'] == simple_daily_df['high'].max()
        assert result['daily_highs'] == simple_daily_df['high'].tolist()
        assert result['daily_closes'] == simple_daily_df['close'].tolist()
        assert result['volume'] == simple_daily_df['volume'].iloc[-1]
        assert result['prev_high'] == simple_daily_df['high'].iloc[-2]
        assert result['prev_low'] == simple_daily_df['low'].iloc[-2]
        assert result['prev_close'] == simple_daily_df['close'].iloc[-2]


class TestFetchPreviousDayData:
    """Tests for fetch_previous_day_data method."""

    def test_returns_none_if_no_fetcher(self):
        runner = MockRunner(data_fetcher=None, to_date=date.today())
        result = runner.fetch_previous_day_data("RELIANCE")
        assert result is None

    def test_returns_none_if_df_empty_or_insufficient(self):
        mock_fetcher = MagicMock()
        # Empty df
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = MagicMock(empty=True)
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        assert runner.fetch_previous_day_data("RELIANCE") is None
        # Df with single row
        import pandas as pd
        df_single = pd.DataFrame({'close': [100]}, index=[pd.Timestamp(date.today(), tz=IST)])
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = df_single
        assert runner.fetch_previous_day_data("RELIANCE") is None

    def test_returns_current_and_previous_h_l_c(self):
        """Test correct extraction of prev day's HLC and current price."""
        import pandas as pd
        # Create df with 2 rows
        dates = pd.date_range(end=date.today(), periods=2, tz=IST)
        df = pd.DataFrame({
            'high': [101, 102],
            'low': [99, 100],
            'close': [100.5, 101.5],
        }, index=dates)
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.return_value = df
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_previous_day_data("RELIANCE")
        assert result is not None
        # current_price should be last close
        assert result['current_price'] == 101.5
        # prev_* from second-last (first) row
        assert result['prev_high'] == 101.0
        assert result['prev_low'] == 99.0
        assert result['prev_close'] == 100.5

    def test_exception_returns_none(self, capsys):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_historical_data_v3.side_effect = Exception("API error")
        runner = MockRunner(data_fetcher=mock_fetcher, to_date=date.today())
        result = runner.fetch_previous_day_data("RELIANCE")
        assert result is None
        captured = capsys.readouterr()
        assert "Error fetching prev day data for RELIANCE" in captured.out or "Error fetching prev day data for RELIANCE" in captured.err


class TestFetchEMAData:
    """Tests for fetch_ema_data method."""

    def test_returns_none_if_no_fetcher(self):
        runner = MockRunner(data_fetcher=None)
        result = runner.fetch_ema_data("RELIANCE", 9, 21)
        assert result is None

    def test_returns_none_if_df_empty(self):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = MagicMock(empty=True)
        runner = MockRunner(data_fetcher=mock_fetcher)
        result = runner.fetch_ema_data("RELIANCE")
        assert result is None

    def test_returns_none_if_insufficient_data(self):
        mock_fetcher = MagicMock()
        # Provide a DataFrame with only 5 rows, but need at least ema_slow_period+2 = 23
        import pandas as pd
        df = pd.DataFrame({'close': [100]*5})
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = df
        runner = MockRunner(data_fetcher=mock_fetcher)
        result = runner.fetch_ema_data("RELIANCE", ema_fast_period=9, ema_slow_period=21)
        assert result is None

    def test_computes_ema_correctly(self):
        """Test that EMA values are computed correctly using price series."""
        mock_fetcher = MagicMock()
        # Create a series of constant closes = 100, length sufficient (e.g., 100)
        import pandas as pd
        closes = [100.0] * 100
        df = pd.DataFrame({'close': closes})
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = df

        runner = MockRunner(data_fetcher=mock_fetcher)
        result = runner.fetch_ema_data("RELIANCE", ema_fast_period=9, ema_slow_period=21)

        assert result is not None
        # For constant price, EMA should equal that price
        assert result['current_price'] == 100.0
        assert result['ema_fast_current'] == round(100.0, 2)
        assert result['ema_fast_prev'] == round(100.0, 2)
        assert result['ema_slow_current'] == round(100.0, 2)
        assert result['ema_slow_prev'] == round(100.0, 2)
        # Also contains closes list
        assert result['closes'] == closes

    def test_ema_with_varying_prices(self):
        """Test EMA calculation with a simple price series."""
        mock_fetcher = MagicMock()
        # Use a linearly increasing series
        import pandas as pd
        closes = [100.0 + i for i in range(50)]
        df = pd.DataFrame({'close': closes})
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = df

        runner = MockRunner(data_fetcher=mock_fetcher)
        result = runner.fetch_ema_data("RELIANCE", ema_fast_period=5, ema_slow_period=10)

        assert result is not None
        # We don't need to verify exact EMA values; check they are floats and current > previous in uptrend
        assert isinstance(result['ema_fast_current'], float)
        assert isinstance(result['ema_slow_current'], float)
        # fast EMA should be more responsive; current fast > slow for uptrend?
        # Not necessarily; but check that both are sensible
        assert result['ema_fast_current'] > result['ema_fast_prev']  # should be slightly higher
        assert result['ema_slow_current'] > result['ema_slow_prev']

    def test_exception_returns_none_and_logs(self, capsys):
        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.side_effect = Exception("API error")
        runner = MockRunner(data_fetcher=mock_fetcher)
        result = runner.fetch_ema_data("RELIANCE")
        assert result is None
        captured = capsys.readouterr()
        assert "Error fetching EMA data for RELIANCE" in captured.out or "Error fetching EMA data for RELIANCE" in captured.err
