"""
Unit tests for backtest/chart_data.py.

Tests cover:
- Candle data formatting (DataFrame and dict inputs)
- ORB zone calculations
- Trade marker formatting with various exit reasons
- Pivot level extraction
- 52-week level extraction
- Chart data building for symbols
- ECharts series configuration
- Error handling for missing/invalid data
"""

import pytest
import pandas as pd
from datetime import datetime, timedelta
from backtest import chart_data


class TestFormatCandleDataDataFrame:
    """Tests for format_candle_data with DataFrame input."""

    @pytest.fixture
    def sample_df(self):
        """Create sample OHLCV DataFrame."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=5, freq='5min')
        return pd.DataFrame({
            'open': [100.0, 101.0, 102.0, 103.0, 104.0],
            'high': [101.0, 102.0, 103.0, 104.0, 105.0],
            'low': [99.5, 100.5, 101.5, 102.5, 103.5],
            'close': [100.5, 101.5, 102.5, 103.5, 104.5],
            'volume': [1000, 1100, 1200, 1300, 1400],
        }, index=dates)

    def test_returns_list(self, sample_df):
        """Test that function returns a list."""
        result = chart_data.format_candle_data(sample_df)
        assert isinstance(result, list)

    def test_correct_number_of_candles(self, sample_df):
        """Test correct number of candles returned."""
        result = chart_data.format_candle_data(sample_df)
        assert len(result) == 5

    def test_candle_has_required_keys(self, sample_df):
        """Test each candle has all required keys."""
        result = chart_data.format_candle_data(sample_df)
        required_keys = ['time', 'date', 'time_str', 'open', 'high', 'low', 'close', 'volume']
        for candle in result:
            for key in required_keys:
                assert key in candle

    def test_ohlc_values_correct(self, sample_df):
        """Test OHLC values are correctly extracted."""
        result = chart_data.format_candle_data(sample_df)
        assert result[0]['open'] == 100.0
        assert result[0]['high'] == 101.0
        assert result[0]['low'] == 99.5
        assert result[0]['close'] == 100.5

    def test_volume_is_int(self, sample_df):
        """Test volume is converted to int."""
        result = chart_data.format_candle_data(sample_df)
        assert isinstance(result[0]['volume'], int)
        assert result[0]['volume'] == 1000

    def test_date_format(self, sample_df):
        """Test date is formatted as YYYY-MM-DD."""
        result = chart_data.format_candle_data(sample_df)
        assert result[0]['date'] == '2024-01-15'

    def test_time_str_format(self, sample_df):
        """Test time_str is formatted as HH:MM."""
        result = chart_data.format_candle_data(sample_df)
        assert result[0]['time_str'] == '09:15'

    def test_time_is_isoformat(self, sample_df):
        """Test time is in ISO format."""
        result = chart_data.format_candle_data(sample_df)
        assert 'T' in result[0]['time']

    def test_empty_dataframe(self):
        """Test handling of empty DataFrame."""
        df = pd.DataFrame(columns=['open', 'high', 'low', 'close', 'volume'])
        result = chart_data.format_candle_data(df)
        assert result == []

    def test_dataframe_without_volume(self):
        """Test DataFrame without volume column defaults to 0."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=2, freq='5min')
        df = pd.DataFrame({
            'open': [100.0, 101.0],
            'high': [101.0, 102.0],
            'low': [99.5, 100.5],
            'close': [100.5, 101.5],
        }, index=dates)
        result = chart_data.format_candle_data(df)
        assert result[0]['volume'] == 0

    def test_timezone_aware_index(self):
        """Test handling of timezone-aware datetime index."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=2, freq='5min', tz='UTC')
        df = pd.DataFrame({
            'open': [100.0, 101.0],
            'high': [101.0, 102.0],
            'low': [99.5, 100.5],
            'close': [100.5, 101.5],
            'volume': [1000, 1100],
        }, index=dates)
        result = chart_data.format_candle_data(df)
        assert len(result) == 2


class TestFormatCandleDataDict:
    """Tests for format_candle_data with dict input."""

    @pytest.fixture
    def sample_dict(self):
        """Create sample candle data dict."""
        return {
            'index': ['2024-01-15T09:15:00', '2024-01-15T09:20:00', '2024-01-15T09:25:00'],
            'open': [100.0, 101.0, 102.0],
            'high': [101.0, 102.0, 103.0],
            'low': [99.5, 100.5, 101.5],
            'close': [100.5, 101.5, 102.5],
            'volume': [1000, 1100, 1200],
        }

    def test_returns_list(self, sample_dict):
        """Test that function returns a list."""
        result = chart_data.format_candle_data(sample_dict)
        assert isinstance(result, list)

    def test_correct_number_of_candles(self, sample_dict):
        """Test correct number of candles returned."""
        result = chart_data.format_candle_data(sample_dict)
        assert len(result) == 3

    def test_candle_has_required_keys(self, sample_dict):
        """Test each candle has all required keys."""
        result = chart_data.format_candle_data(sample_dict)
        required_keys = ['time', 'date', 'time_str', 'open', 'high', 'low', 'close', 'volume']
        for candle in result:
            for key in required_keys:
                assert key in candle

    def test_ohlc_values_correct(self, sample_dict):
        """Test OHLC values are correctly extracted."""
        result = chart_data.format_candle_data(sample_dict)
        assert result[0]['open'] == 100.0
        assert result[0]['high'] == 101.0
        assert result[0]['low'] == 99.5
        assert result[0]['close'] == 100.5

    def test_volume_is_int(self, sample_dict):
        """Test volume is converted to int."""
        result = chart_data.format_candle_data(sample_dict)
        assert isinstance(result[0]['volume'], int)
        assert result[0]['volume'] == 1000

    def test_time_with_z_suffix(self):
        """Test handling of time strings with Z suffix."""
        data = {
            'index': ['2024-01-15T09:15:00Z'],
            'open': [100.0],
            'high': [101.0],
            'low': [99.5],
            'close': [100.5],
            'volume': [1000],
        }
        result = chart_data.format_candle_data(data)
        assert len(result) == 1
        assert result[0]['date'] == '2024-01-15'

    def test_time_with_timezone_offset(self):
        """Test handling of time strings with +00:00 suffix."""
        data = {
            'index': ['2024-01-15T09:15:00+00:00'],
            'open': [100.0],
            'high': [101.0],
            'low': [99.5],
            'close': [100.5],
            'volume': [1000],
        }
        result = chart_data.format_candle_data(data)
        assert len(result) == 1
        assert result[0]['date'] == '2024-01-15'

    def test_empty_dict(self):
        """Test handling of empty dict."""
        result = chart_data.format_candle_data({})
        assert result == []

    def test_missing_keys_defaults(self):
        """Test missing keys use defaults."""
        data = {
            'index': ['2024-01-15T09:15:00'],
            'open': [100.0],
        }
        result = chart_data.format_candle_data(data)
        assert result[0]['high'] == 0
        assert result[0]['low'] == 0
        assert result[0]['close'] == 0
        assert result[0]['volume'] == 0

    def test_mismatched_array_lengths(self):
        """Test handling when arrays have different lengths."""
        data = {
            'index': ['2024-01-15T09:15:00', '2024-01-15T09:20:00'],
            'open': [100.0],
            'high': [101.0, 102.0],
            'low': [99.5, 100.5],
            'close': [100.5, 101.5],
            'volume': [1000, 1100],
        }
        result = chart_data.format_candle_data(data)
        assert len(result) == 2
        assert result[1]['open'] == 0

    def test_invalid_time_string_skipped(self):
        """Test invalid time strings are skipped."""
        data = {
            'index': ['invalid-time', '2024-01-15T09:20:00'],
            'open': [100.0, 101.0],
            'high': [101.0, 102.0],
            'low': [99.5, 100.5],
            'close': [100.5, 101.5],
            'volume': [1000, 1100],
        }
        result = chart_data.format_candle_data(data)
        assert len(result) == 1
        assert result[0]['date'] == '2024-01-15'


class TestFormatOrbZones:
    """Tests for format_orb_zones function."""

    @pytest.fixture
    def sample_candles(self):
        """Create sample candles for ORB zone testing."""
        candles = []
        base_date = '2024-01-15'
        times = ['09:15', '09:20', '09:25', '09:30', '09:35', '09:40', '09:45', '09:50', '09:55', '10:00']
        for i, t in enumerate(times):
            candles.append({
                'time': f'{base_date}T{t}:00',
                'date': base_date,
                'time_str': t,
                'open': 100.0 + i,
                'high': 101.0 + i,
                'low': 99.0 + i,
                'close': 100.5 + i,
                'volume': 1000,
            })
        return candles

    def test_returns_list(self, sample_candles):
        """Test that function returns a list."""
        result = chart_data.format_orb_zones(sample_candles)
        assert isinstance(result, list)

    def test_zone_has_required_keys(self, sample_candles):
        """Test each zone has required keys."""
        result = chart_data.format_orb_zones(sample_candles)
        if result:
            required_keys = ['date', 'or_high', 'or_low', 'or_end_time']
            for key in required_keys:
                assert key in result[0]

    def test_or_high_is_max_of_or_candles(self, sample_candles):
        """Test OR high is max high of OR period candles."""
        result = chart_data.format_orb_zones(sample_candles, or_minutes=45)
        assert result[0]['or_high'] == 109.0

    def test_or_low_is_min_of_or_candles(self, sample_candles):
        """Test OR low is min low of OR period candles."""
        result = chart_data.format_orb_zones(sample_candles, or_minutes=45)
        assert result[0]['or_low'] == 99.0

    def test_or_end_time_format(self, sample_candles):
        """Test OR end time is correctly formatted."""
        result = chart_data.format_orb_zones(sample_candles, or_minutes=45)
        assert result[0]['or_end_time'] == '10:00'

    def test_custom_or_minutes(self, sample_candles):
        """Test custom OR minutes parameter."""
        result = chart_data.format_orb_zones(sample_candles, or_minutes=30)
        assert result[0]['or_end_time'] == '09:45'

    def test_multiple_days(self):
        """Test OR zones across multiple days."""
        candles = [
            {'date': '2024-01-15', 'time_str': '09:15', 'high': 100, 'low': 98},
            {'date': '2024-01-15', 'time_str': '09:30', 'high': 102, 'low': 99},
            {'date': '2024-01-15', 'time_str': '10:00', 'high': 105, 'low': 101},
            {'date': '2024-01-16', 'time_str': '09:15', 'high': 110, 'low': 108},
            {'date': '2024-01-16', 'time_str': '09:30', 'high': 112, 'low': 109},
        ]
        result = chart_data.format_orb_zones(candles, or_minutes=45)
        assert len(result) == 2
        assert result[0]['date'] == '2024-01-15'
        assert result[1]['date'] == '2024-01-16'

    def test_empty_candles(self):
        """Test handling of empty candles list."""
        result = chart_data.format_orb_zones([])
        assert result == []

    def test_values_rounded(self, sample_candles):
        """Test OR values are rounded to 2 decimals."""
        candles = [
            {'date': '2024-01-15', 'time_str': '09:15', 'high': 100.123, 'low': 98.456},
            {'date': '2024-01-15', 'time_str': '09:30', 'high': 102.789, 'low': 99.111},
        ]
        result = chart_data.format_orb_zones(candles, or_minutes=45)
        assert result[0]['or_high'] == round(result[0]['or_high'], 2)
        assert result[0]['or_low'] == round(result[0]['or_low'], 2)


class TestFormatTradeMarkers:
    """Tests for format_trade_markers function."""

    @pytest.fixture
    def sample_trades(self):
        """Create sample trade data."""
        return [
            {
                'entry_price': 100.0,
                'exit_price': 102.0,
                'entry_time': '2024-01-15T10:00:00',
                'exit_time': '2024-01-15T11:00:00',
                'date': '2024-01-15',
                'quantity': 100,
                'gross_pnl': 200.0,
                'trading_costs': 15.0,
                'net_pnl': 185.0,
                'net_pnl_pct': 1.85,
                'exit_reason': 'TP',
                'hold_duration_minutes': 60,
                'or_high': 99.0,
                'or_low': 98.0,
            }
        ]

    def test_returns_list(self, sample_trades):
        """Test that function returns a list."""
        result = chart_data.format_trade_markers(sample_trades)
        assert isinstance(result, list)

    def test_two_markers_per_trade(self, sample_trades):
        """Test that each trade produces entry and exit markers."""
        result = chart_data.format_trade_markers(sample_trades)
        assert len(result) == 2

    def test_entry_marker_type(self, sample_trades):
        """Test entry marker has correct type."""
        result = chart_data.format_trade_markers(sample_trades)
        entry = [m for m in result if m['type'] == 'entry'][0]
        assert entry['type'] == 'entry'

    def test_exit_marker_type(self, sample_trades):
        """Test exit marker has correct type."""
        result = chart_data.format_trade_markers(sample_trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['type'] == 'exit'

    def test_trade_id_sequential(self):
        """Test trade IDs are sequential."""
        trades = [
            {'entry_price': 100.0, 'exit_price': 102.0, 'exit_reason': 'TP',
             'quantity': 100, 'gross_pnl': 200.0, 'trading_costs': 15.0,
             'net_pnl': 185.0, 'net_pnl_pct': 1.85},
            {'entry_price': 200.0, 'exit_price': 198.0, 'exit_reason': 'SL',
             'quantity': 50, 'gross_pnl': -100.0, 'trading_costs': 15.0,
             'net_pnl': -115.0, 'net_pnl_pct': -1.15},
        ]
        result = chart_data.format_trade_markers(trades)
        assert result[0]['trade_id'] == 1
        assert result[1]['trade_id'] == 1
        assert result[2]['trade_id'] == 2
        assert result[3]['trade_id'] == 2

    def test_entry_marker_symbol(self, sample_trades):
        """Test entry marker has triangle symbol."""
        result = chart_data.format_trade_markers(sample_trades)
        entry = [m for m in result if m['type'] == 'entry'][0]
        assert entry['marker']['symbol'] == 'triangle'

    def test_exit_marker_symbol(self, sample_trades):
        """Test exit marker has circle symbol."""
        result = chart_data.format_trade_markers(sample_trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['symbol'] == 'circle'

    def test_tp_exit_color(self, sample_trades):
        """Test take profit exit has green color."""
        result = chart_data.format_trade_markers(sample_trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#4CAF50'

    def test_sl_exit_color(self):
        """Test stop loss exit has red color."""
        trades = [{'entry_price': 100.0, 'exit_price': 98.0, 'exit_reason': 'SL',
                   'quantity': 100, 'gross_pnl': -200.0, 'trading_costs': 15.0,
                   'net_pnl': -215.0, 'net_pnl_pct': -2.15}]
        result = chart_data.format_trade_markers(trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#F44336'

    def test_eod_exit_color(self):
        """Test EOD exit has yellow color."""
        trades = [{'entry_price': 100.0, 'exit_price': 101.0, 'exit_reason': 'EOD',
                   'quantity': 100, 'gross_pnl': 100.0, 'trading_costs': 15.0,
                   'net_pnl': 85.0, 'net_pnl_pct': 0.85}]
        result = chart_data.format_trade_markers(trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#FFC107'

    def test_trailing_stop_exit_color(self):
        """Test trailing stop exit has purple color."""
        trades = [{'entry_price': 100.0, 'exit_price': 105.0, 'exit_reason': 'TRAILING_STOP',
                   'quantity': 100, 'gross_pnl': 500.0, 'trading_costs': 15.0,
                   'net_pnl': 485.0, 'net_pnl_pct': 4.85}]
        result = chart_data.format_trade_markers(trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#9C27B0'

    def test_max_holding_exit_color(self):
        """Test max holding exit has orange color."""
        trades = [{'entry_price': 100.0, 'exit_price': 101.0, 'exit_reason': 'MAX_HOLDING',
                   'quantity': 100, 'gross_pnl': 100.0, 'trading_costs': 15.0,
                   'net_pnl': 85.0, 'net_pnl_pct': 0.85}]
        result = chart_data.format_trade_markers(trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#FF9800'

    def test_new_52w_high_exit_color(self):
        """Test new 52W high exit has cyan color."""
        trades = [{'entry_price': 100.0, 'exit_price': 110.0, 'exit_reason': 'NEW_52W_HIGH',
                   'quantity': 100, 'gross_pnl': 1000.0, 'trading_costs': 15.0,
                   'net_pnl': 985.0, 'net_pnl_pct': 9.85}]
        result = chart_data.format_trade_markers(trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#00BCD4'

    def test_unknown_exit_reason_defaults_yellow(self):
        """Test unknown exit reason defaults to yellow."""
        trades = [{'entry_price': 100.0, 'exit_price': 101.0, 'exit_reason': 'UNKNOWN',
                   'quantity': 100, 'gross_pnl': 100.0, 'trading_costs': 15.0,
                   'net_pnl': 85.0, 'net_pnl_pct': 0.85}]
        result = chart_data.format_trade_markers(trades)
        exit_marker = [m for m in result if m['type'] == 'exit'][0]
        assert exit_marker['marker']['color'] == '#FFC107'

    def test_marker_includes_trade_data(self, sample_trades):
        """Test marker includes complete trade data."""
        result = chart_data.format_trade_markers(sample_trades)
        entry = result[0]
        assert entry['trade']['entry_price'] == 100.0
        assert entry['trade']['exit_price'] == 102.0
        assert entry['trade']['quantity'] == 100
        assert entry['trade']['exit_reason'] == 'TP'

    def test_marker_includes_orb_fields(self, sample_trades):
        """Test marker includes ORB strategy fields."""
        result = chart_data.format_trade_markers(sample_trades)
        entry = result[0]
        assert entry['trade']['or_high'] == 99.0
        assert entry['trade']['or_low'] == 98.0

    def test_marker_includes_pivot_fields(self):
        """Test marker includes S/R pivot fields."""
        trades = [{
            'entry_price': 100.0, 'exit_price': 102.0, 'exit_reason': 'TP',
            'quantity': 100, 'gross_pnl': 200.0, 'trading_costs': 15.0,
            'net_pnl': 185.0, 'net_pnl_pct': 1.85,
            'pp': 100.0, 'r1': 102.0, 's1': 98.0, 'r2': 104.0, 's2': 96.0,
        }]
        result = chart_data.format_trade_markers(trades)
        assert result[0]['trade']['pp'] == 100.0
        assert result[0]['trade']['r1'] == 102.0
        assert result[0]['trade']['s1'] == 98.0

    def test_marker_includes_52w_fields(self):
        """Test marker includes 52W chaser fields."""
        trades = [{
            'entry_price': 100.0, 'exit_price': 102.0, 'exit_reason': 'TP',
            'quantity': 100, 'gross_pnl': 200.0, 'trading_costs': 15.0,
            'net_pnl': 185.0, 'net_pnl_pct': 1.85,
            '52w_high': 105.0, 'trailing_active': True,
        }]
        result = chart_data.format_trade_markers(trades)
        assert result[0]['trade']['52w_high'] == 105.0
        assert result[0]['trade']['trailing_active'] is True

    def test_empty_trades(self):
        """Test handling of empty trades list."""
        result = chart_data.format_trade_markers([])
        assert result == []


class TestExtractPivotLevels:
    """Tests for extract_pivot_levels function."""

    def test_returns_list(self):
        """Test that function returns a list."""
        trades = [{'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0}]
        result = chart_data.extract_pivot_levels(trades)
        assert isinstance(result, list)

    def test_extracts_pivot_levels(self):
        """Test extraction of pivot levels from trades."""
        trades = [{
            'date': '2024-01-15',
            'pp': 100.0,
            'r1': 102.0,
            's1': 98.0,
            'r2': 104.0,
            's2': 96.0,
        }]
        result = chart_data.extract_pivot_levels(trades)
        assert len(result) == 1
        assert result[0]['date'] == '2024-01-15'
        assert result[0]['pp'] == 100.0
        assert result[0]['r1'] == 102.0
        assert result[0]['s1'] == 98.0

    def test_deduplicates_by_date(self):
        """Test that trades on same date are deduplicated."""
        trades = [
            {'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0},
            {'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0},
        ]
        result = chart_data.extract_pivot_levels(trades)
        assert len(result) == 1

    def test_multiple_dates(self):
        """Test handling of multiple dates."""
        trades = [
            {'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0},
            {'date': '2024-01-16', 'pp': 200.0, 'r1': 202.0, 's1': 198.0},
        ]
        result = chart_data.extract_pivot_levels(trades)
        assert len(result) == 2

    def test_skips_trades_without_pivots(self):
        """Test trades without pivot data are skipped."""
        trades = [
            {'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0},
            {'date': '2024-01-16'},
        ]
        result = chart_data.extract_pivot_levels(trades)
        assert len(result) == 1

    def test_handles_none_pivot_values(self):
        """Test handling of None pivot values."""
        trades = [
            {'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0, 'r2': None, 's2': None},
        ]
        result = chart_data.extract_pivot_levels(trades)
        assert result[0]['r2'] is None
        assert result[0]['s2'] is None

    def test_values_rounded(self):
        """Test pivot values are rounded to 2 decimals."""
        trades = [{
            'date': '2024-01-15',
            'pp': 100.123,
            'r1': 102.456,
            's1': 98.789,
        }]
        result = chart_data.extract_pivot_levels(trades)
        assert result[0]['pp'] == 100.12
        assert result[0]['r1'] == 102.46
        assert result[0]['s1'] == 98.79

    def test_empty_trades(self):
        """Test handling of empty trades list."""
        result = chart_data.extract_pivot_levels([])
        assert result == []

    def test_missing_date(self):
        """Test handling of trades without date."""
        trades = [{'pp': 100.0, 'r1': 102.0, 's1': 98.0}]
        result = chart_data.extract_pivot_levels(trades)
        assert result == []


class TestExtract52wLevels:
    """Tests for extract_52w_levels function."""

    def test_returns_list(self):
        """Test that function returns a list."""
        trades = [{'date': '2024-01-15', '52w_high': 105.0}]
        result = chart_data.extract_52w_levels(trades)
        assert isinstance(result, list)

    def test_extracts_52w_high(self):
        """Test extraction of 52W high from trades."""
        trades = [{
            'date': '2024-01-15',
            '52w_high': 105.0,
            'trailing_active': True,
        }]
        result = chart_data.extract_52w_levels(trades)
        assert len(result) == 1
        assert result[0]['52w_high'] == 105.0
        assert result[0]['trailing_active'] is True

    def test_multiple_trades(self):
        """Test handling of multiple trades."""
        trades = [
            {'date': '2024-01-15', '52w_high': 105.0, 'trailing_active': False},
            {'date': '2024-01-16', '52w_high': 110.0, 'trailing_active': True},
        ]
        result = chart_data.extract_52w_levels(trades)
        assert len(result) == 2

    def test_skips_trades_without_52w_high(self):
        """Test trades without 52W high are skipped."""
        trades = [
            {'date': '2024-01-15', '52w_high': 105.0},
            {'date': '2024-01-16'},
        ]
        result = chart_data.extract_52w_levels(trades)
        assert len(result) == 1

    def test_values_rounded(self):
        """Test 52W high values are rounded to 2 decimals."""
        trades = [{'date': '2024-01-15', '52w_high': 105.123}]
        result = chart_data.extract_52w_levels(trades)
        assert result[0]['52w_high'] == 105.12

    def test_default_trailing_active(self):
        """Test default value for trailing_active."""
        trades = [{'date': '2024-01-15', '52w_high': 105.0}]
        result = chart_data.extract_52w_levels(trades)
        assert result[0]['trailing_active'] is False

    def test_empty_trades(self):
        """Test handling of empty trades list."""
        result = chart_data.extract_52w_levels([])
        assert result == []

    def test_missing_date(self):
        """Test handling of trades without date."""
        trades = [{'52w_high': 105.0}]
        result = chart_data.extract_52w_levels(trades)
        assert result == []


class TestBuildChartDataForSymbol:
    """Tests for build_chart_data_for_symbol function."""

    @pytest.fixture
    def sample_data(self):
        """Create sample data for testing."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=5, freq='5min')
        candles_df = pd.DataFrame({
            'open': [100.0, 101.0, 102.0, 103.0, 104.0],
            'high': [101.0, 102.0, 103.0, 104.0, 105.0],
            'low': [99.5, 100.5, 101.5, 102.5, 103.5],
            'close': [100.5, 101.5, 102.5, 103.5, 104.5],
            'volume': [1000, 1100, 1200, 1300, 1400],
        }, index=dates)
        trades = [{
            'entry_price': 100.0,
            'exit_price': 102.0,
            'exit_reason': 'TP',
            'quantity': 100,
            'gross_pnl': 200.0,
            'trading_costs': 15.0,
            'net_pnl': 185.0,
            'net_pnl_pct': 1.85,
            'date': '2024-01-15',
        }]
        return candles_df, trades

    def test_returns_dict(self, sample_data):
        """Test that function returns a dict."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        assert isinstance(result, dict)

    def test_has_required_keys(self, sample_data):
        """Test result has all required keys."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        required_keys = ['symbol', 'candles', 'orb_zones', 'pivot_levels',
                         'week52_levels', 'trades', 'date_range', 'total_candles', 'total_trades']
        for key in required_keys:
            assert key in result

    def test_symbol_included(self, sample_data):
        """Test symbol is included in result."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('RELIANCE', candles_df, trades)
        assert result['symbol'] == 'RELIANCE'

    def test_total_candles_count(self, sample_data):
        """Test total candles count is correct."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        assert result['total_candles'] == 5

    def test_total_trades_count(self, sample_data):
        """Test total trades count is correct."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        assert result['total_trades'] == 1

    def test_date_range(self, sample_data):
        """Test date range is correctly extracted."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        assert result['date_range']['start'] == '2024-01-15'
        assert result['date_range']['end'] == '2024-01-15'

    def test_custom_or_minutes(self, sample_data):
        """Test custom OR minutes parameter."""
        candles_df, trades = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades, or_minutes=30)
        assert 'orb_zones' in result

    def test_empty_candles(self):
        """Test handling of empty candles DataFrame."""
        df = pd.DataFrame(columns=['open', 'high', 'low', 'close', 'volume'])
        result = chart_data.build_chart_data_for_symbol('TEST', df, [])
        assert result['total_candles'] == 0
        assert result['date_range']['start'] is None
        assert result['date_range']['end'] is None

    def test_empty_trades(self, sample_data):
        """Test handling of empty trades list."""
        candles_df, _ = sample_data
        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, [])
        assert result['total_trades'] == 0


class TestBuildEchartsSeries:
    """Tests for build_echarts_series function."""

    @pytest.fixture
    def sample_chart_data(self):
        """Create sample chart data for testing."""
        return {
            'candles': [
                {'time': '2024-01-15T09:15:00', 'date': '2024-01-15', 'time_str': '09:15',
                 'open': 100.0, 'high': 101.0, 'low': 99.5, 'close': 100.5, 'volume': 1000},
                {'time': '2024-01-15T09:20:00', 'date': '2024-01-15', 'time_str': '09:20',
                 'open': 100.5, 'high': 101.5, 'low': 100.0, 'close': 101.0, 'volume': 1100},
            ],
            'orb_zones': [
                {'date': '2024-01-15', 'or_high': 101.0, 'or_low': 99.5, 'or_end_time': '10:00'}
            ],
            'trades': [
                {'trade_id': 1, 'type': 'entry', 'time': '2024-01-15T10:00:00',
                 'price': 101.5, 'marker': {'symbol': 'triangle', 'color': '#2196F3', 'size': 12},
                 'trade': {'entry_price': 101.5, 'exit_price': 103.0, 'exit_reason': 'TP'}},
                {'trade_id': 1, 'type': 'exit', 'time': '2024-01-15T11:00:00',
                 'price': 103.0, 'marker': {'symbol': 'circle', 'color': '#4CAF50', 'size': 10},
                 'trade': {'entry_price': 101.5, 'exit_price': 103.0, 'exit_reason': 'TP'}},
            ],
        }

    def test_returns_dict(self, sample_chart_data):
        """Test that function returns a dict."""
        result = chart_data.build_echarts_series(sample_chart_data)
        assert isinstance(result, dict)

    def test_has_required_keys(self, sample_chart_data):
        """Test result has all required keys."""
        result = chart_data.build_echarts_series(sample_chart_data)
        required_keys = ['xAxisData', 'candlestick', 'series', 'orb_zones']
        for key in required_keys:
            assert key in result

    def test_xaxis_data_is_time_list(self, sample_chart_data):
        """Test xAxisData is list of times."""
        result = chart_data.build_echarts_series(sample_chart_data)
        assert isinstance(result['xAxisData'], list)
        assert len(result['xAxisData']) == 2

    def test_candlestick_data_format(self, sample_chart_data):
        """Test candlestick data is [open, close, low, high] format."""
        result = chart_data.build_echarts_series(sample_chart_data)
        assert result['candlestick'][0] == [100.0, 100.5, 99.5, 101.0]

    def test_series_has_all_types(self, sample_chart_data):
        """Test series has all expected series types."""
        result = chart_data.build_echarts_series(sample_chart_data)
        series_types = ['candlestick', 'entry', 'tp_exit', 'sl_exit', 'eod_exit',
                        'trailing_exit', 'max_hold_exit']
        for st in series_types:
            assert st in result['series']

    def test_entry_markers(self, sample_chart_data):
        """Test entry markers are extracted correctly."""
        result = chart_data.build_echarts_series(sample_chart_data)
        entry_data = result['series']['entry']['data']
        assert len(entry_data) == 1
        assert entry_data[0]['symbol'] == 'triangle'

    def test_exit_markers_by_type(self, sample_chart_data):
        """Test exit markers are separated by type."""
        result = chart_data.build_echarts_series(sample_chart_data)
        tp_data = result['series']['tp_exit']['data']
        assert len(tp_data) == 1

    def test_marker_has_value_coord(self, sample_chart_data):
        """Test markers have value with [time, price] coord."""
        result = chart_data.build_echarts_series(sample_chart_data)
        entry = result['series']['entry']['data'][0]
        assert 'value' in entry
        assert len(entry['value']) == 2

    def test_orb_zones_included(self, sample_chart_data):
        """Test ORB zones are included in result."""
        result = chart_data.build_echarts_series(sample_chart_data)
        assert result['orb_zones'] == sample_chart_data['orb_zones']

    def test_candlestick_series_config(self, sample_chart_data):
        """Test candlestick series has correct config."""
        result = chart_data.build_echarts_series(sample_chart_data)
        cs = result['series']['candlestick']
        assert cs['type'] == 'candlestick'
        assert cs['name'] == 'Price'
        assert 'itemStyle' in cs

    def test_empty_candles(self):
        """Test handling of empty candles."""
        chart_data_input = {
            'candles': [],
            'orb_zones': [],
            'trades': [],
        }
        result = chart_data.build_echarts_series(chart_data_input)
        assert result['xAxisData'] == []
        assert result['candlestick'] == []

    def test_empty_trades(self):
        """Test handling of empty trades."""
        chart_data_input = {
            'candles': [{'time': '2024-01-15T09:15:00', 'date': '2024-01-15',
                         'open': 100.0, 'high': 101.0, 'low': 99.5, 'close': 100.5}],
            'orb_zones': [],
            'trades': [],
        }
        result = chart_data.build_echarts_series(chart_data_input)
        assert result['series']['entry']['data'] == []


class TestIntegration:
    """Integration tests for chart data functions."""

    def test_full_workflow(self):
        """Test complete workflow from raw data to chart output."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=10, freq='5min')
        candles_df = pd.DataFrame({
            'open': [100.0 + i for i in range(10)],
            'high': [101.0 + i for i in range(10)],
            'low': [99.5 + i for i in range(10)],
            'close': [100.5 + i for i in range(10)],
            'volume': [1000 + i * 100 for i in range(10)],
        }, index=dates)

        trades = [{
            'entry_price': 100.0,
            'exit_price': 105.0,
            'entry_time': '2024-01-15T10:00:00',
            'exit_time': '2024-01-15T11:00:00',
            'date': '2024-01-15',
            'quantity': 100,
            'gross_pnl': 500.0,
            'trading_costs': 20.0,
            'net_pnl': 480.0,
            'net_pnl_pct': 4.8,
            'exit_reason': 'TP',
            'hold_duration_minutes': 60,
            'or_high': 101.0,
            'or_low': 99.5,
            'pp': 100.0,
            'r1': 102.0,
            's1': 98.0,
            '52w_high': 110.0,
            'trailing_active': False,
        }]

        chart_result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        echarts_result = chart_data.build_echarts_series(chart_result)

        assert chart_result['symbol'] == 'TEST'
        assert chart_result['total_candles'] == 10
        assert chart_result['total_trades'] == 1
        assert len(echarts_result['candlestick']) == 10
        assert len(echarts_result['series']['entry']['data']) == 1

    def test_multi_day_data(self):
        """Test handling of multi-day candle data."""
        day1 = pd.date_range('2024-01-15 09:15:00', periods=5, freq='5min')
        day2 = pd.date_range('2024-01-16 09:15:00', periods=5, freq='5min')
        dates = day1.append(day2)

        candles_df = pd.DataFrame({
            'open': [100.0] * 10,
            'high': [101.0] * 10,
            'low': [99.5] * 10,
            'close': [100.5] * 10,
            'volume': [1000] * 10,
        }, index=dates)

        trades = [
            {'entry_price': 100.0, 'exit_price': 101.0, 'exit_reason': 'TP',
             'quantity': 100, 'gross_pnl': 100.0, 'trading_costs': 10.0,
             'net_pnl': 90.0, 'net_pnl_pct': 0.9, 'date': '2024-01-15'},
            {'entry_price': 100.0, 'exit_price': 99.0, 'exit_reason': 'SL',
             'quantity': 100, 'gross_pnl': -100.0, 'trading_costs': 10.0,
             'net_pnl': -110.0, 'net_pnl_pct': -1.1, 'date': '2024-01-16'},
        ]

        result = chart_data.build_chart_data_for_symbol('TEST', candles_df, trades)
        assert len(result['orb_zones']) == 2

    def test_dict_and_dataframe_produce_same_output(self):
        """Test that dict and DataFrame inputs produce equivalent output."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=3, freq='5min')
        df = pd.DataFrame({
            'open': [100.0, 101.0, 102.0],
            'high': [101.0, 102.0, 103.0],
            'low': [99.5, 100.5, 101.5],
            'close': [100.5, 101.5, 102.5],
            'volume': [1000, 1100, 1200],
        }, index=dates)

        dict_data = {
            'index': ['2024-01-15T09:15:00', '2024-01-15T09:20:00', '2024-01-15T09:25:00'],
            'open': [100.0, 101.0, 102.0],
            'high': [101.0, 102.0, 103.0],
            'low': [99.5, 100.5, 101.5],
            'close': [100.5, 101.5, 102.5],
            'volume': [1000, 1100, 1200],
        }

        df_result = chart_data.format_candle_data(df)
        dict_result = chart_data.format_candle_data(dict_data)

        assert len(df_result) == len(dict_result)
        for i in range(len(df_result)):
            assert df_result[i]['open'] == dict_result[i]['open']
            assert df_result[i]['high'] == dict_result[i]['high']
            assert df_result[i]['low'] == dict_result[i]['low']
            assert df_result[i]['close'] == dict_result[i]['close']


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_candle_data_with_nan_values(self):
        """Test handling of NaN values in DataFrame."""
        dates = pd.date_range('2024-01-15 09:15:00', periods=2, freq='5min')
        df = pd.DataFrame({
            'open': [100.0, float('nan')],
            'high': [101.0, 102.0],
            'low': [99.5, 100.5],
            'close': [100.5, 101.5],
            'volume': [1000, 1100],
        }, index=dates)
        result = chart_data.format_candle_data(df)
        assert len(result) == 2

    def test_very_large_volume(self):
        """Test handling of very large volume values."""
        data = {
            'index': ['2024-01-15T09:15:00'],
            'open': [100.0],
            'high': [101.0],
            'low': [99.5],
            'close': [100.5],
            'volume': [999999999999],
        }
        result = chart_data.format_candle_data(data)
        assert result[0]['volume'] == 999999999999

    def test_fractional_ohlc_values(self):
        """Test handling of fractional OHLC values."""
        data = {
            'index': ['2024-01-15T09:15:00'],
            'open': [100.12345],
            'high': [101.67890],
            'low': [99.11111],
            'close': [100.55555],
            'volume': [1000],
        }
        result = chart_data.format_candle_data(data)
        assert isinstance(result[0]['open'], float)
        assert isinstance(result[0]['high'], float)

    def test_orb_zones_with_single_candle(self):
        """Test ORB zones with single candle."""
        candles = [{'date': '2024-01-15', 'time_str': '09:15', 'high': 100, 'low': 99}]
        result = chart_data.format_orb_zones(candles)
        assert len(result) == 1
        assert result[0]['or_high'] == 100
        assert result[0]['or_low'] == 99

    def test_trade_markers_missing_optional_fields(self):
        """Test trade markers with missing optional fields."""
        trades = [{
            'entry_price': 100.0,
            'exit_price': 102.0,
            'exit_reason': 'TP',
            'quantity': 100,
            'gross_pnl': 200.0,
            'trading_costs': 15.0,
            'net_pnl': 185.0,
            'net_pnl_pct': 1.85,
        }]
        result = chart_data.format_trade_markers(trades)
        assert len(result) == 2
        assert result[0]['trade']['or_high'] is None
        assert result[0]['trade']['52w_high'] is None

    def test_pivot_levels_with_partial_data(self):
        """Test pivot levels with partial pivot data."""
        trades = [
            {'date': '2024-01-15', 'pp': 100.0, 'r1': 102.0, 's1': 98.0, 'r2': 104.0},
            {'date': '2024-01-16', 'pp': 200.0, 'r1': 202.0, 's1': 198.0, 's2': 196.0},
        ]
        result = chart_data.extract_pivot_levels(trades)
        assert result[0]['s2'] is None
        assert result[1]['r2'] is None

    def test_echarts_with_no_matching_exit_types(self):
        """Test ECharts series when no exits match certain types."""
        chart_data_input = {
            'candles': [{'time': 't1', 'date': 'd1', 'open': 100, 'high': 101, 'low': 99, 'close': 100}],
            'orb_zones': [],
            'trades': [
                {'type': 'entry', 'time': 't1', 'price': 100, 'marker': {'symbol': 't', 'color': 'c', 'size': 10},
                 'trade': {'exit_reason': 'TP'}},
                {'type': 'exit', 'time': 't2', 'price': 102, 'marker': {'symbol': 'c', 'color': 'g', 'size': 8},
                 'trade': {'exit_reason': 'TP'}},
            ],
        }
        result = chart_data.build_echarts_series(chart_data_input)
        assert result['series']['sl_exit']['data'] == []
        assert result['series']['eod_exit']['data'] == []

    def test_negative_pnl(self):
        """Test handling of negative PnL values."""
        trades = [{
            'entry_price': 100.0,
            'exit_price': 98.0,
            'exit_reason': 'SL',
            'quantity': 100,
            'gross_pnl': -200.0,
            'trading_costs': 15.0,
            'net_pnl': -215.0,
            'net_pnl_pct': -2.15,
        }]
        result = chart_data.format_trade_markers(trades)
        assert result[0]['trade']['net_pnl'] == -215.0
        assert result[0]['trade']['net_pnl_pct'] == -2.15
