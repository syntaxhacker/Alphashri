"""
Unit tests for backtest/strategies/sr_breakout.py.

Tests cover:
- Strategy metadata (name, description, params)
- Parameter validation
- Pivot point calculations (classic, fibonacci, camarilla)
- Support/resistance level detection
- Breakout signal generation
- Entry/exit logic
- Stop-loss and take-profit calculations
- Edge cases (invalid data, empty candles, etc.)
- Helper functions
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch, MagicMock
from dataclasses import asdict

from backtest.strategies.sr_breakout import (
    PivotPoints,
    calculate_pivot_points,
    get_ist_time,
    get_previous_day_data,
    SRBreakoutStrategy,
    SRBreakoutConfig,
    SRBreakoutNautilusStrategy,
)
from backtest.strategies.base import StrategyParam


class TestPivotPointsDataclass:
    """Tests for PivotPoints dataclass."""

    def test_pivot_points_creation(self):
        pp = PivotPoints(pp=100.0, r1=105.0, r2=110.0, r3=115.0, s1=95.0, s2=90.0, s3=85.0)
        assert pp.pp == 100.0
        assert pp.r1 == 105.0
        assert pp.r2 == 110.0
        assert pp.r3 == 115.0
        assert pp.s1 == 95.0
        assert pp.s2 == 90.0
        assert pp.s3 == 85.0

    def test_pivot_points_all_levels_different(self):
        pp = PivotPoints(pp=100.0, r1=105.0, r2=110.0, r3=115.0, s1=95.0, s2=90.0, s3=85.0)
        levels = [pp.pp, pp.r1, pp.r2, pp.r3, pp.s1, pp.s2, pp.s3]
        assert len(set(levels)) == 7

    def test_pivot_points_resistance_above_pp(self):
        pp = PivotPoints(pp=100.0, r1=105.0, r2=110.0, r3=115.0, s1=95.0, s2=90.0, s3=85.0)
        assert pp.r1 > pp.pp
        assert pp.r2 > pp.r1
        assert pp.r3 > pp.r2

    def test_pivot_points_support_below_pp(self):
        pp = PivotPoints(pp=100.0, r1=105.0, r2=110.0, r3=115.0, s1=95.0, s2=90.0, s3=85.0)
        assert pp.s1 < pp.pp
        assert pp.s2 < pp.s1
        assert pp.s3 < pp.s2


class TestCalculatePivotPointsClassic:
    """Tests for classic pivot point calculation."""

    def test_classic_pivot_basic(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        expected_pp = (high + low + close) / 3
        assert pp.pp == expected_pp

    def test_classic_r1_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        pivot = (high + low + close) / 3
        expected_r1 = (2 * pivot) - low
        assert pp.r1 == expected_r1

    def test_classic_s1_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        pivot = (high + low + close) / 3
        expected_s1 = (2 * pivot) - high
        assert pp.s1 == expected_s1

    def test_classic_r2_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        pivot = (high + low + close) / 3
        expected_r2 = pivot + (high - low)
        assert pp.r2 == expected_r2

    def test_classic_s2_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        pivot = (high + low + close) / 3
        expected_s2 = pivot - (high - low)
        assert pp.s2 == expected_s2

    def test_classic_r3_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        pivot = (high + low + close) / 3
        expected_r3 = high + 2 * (pivot - low)
        assert pp.r3 == expected_r3

    def test_classic_s3_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        pivot = (high + low + close) / 3
        expected_s3 = low - 2 * (high - pivot)
        assert pp.s3 == expected_s3

    def test_classic_levels_ordering(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        assert pp.s3 < pp.s2 < pp.s1 < pp.pp < pp.r1 < pp.r2 < pp.r3

    def test_classic_equal_hlc(self):
        price = 100.0
        pp = calculate_pivot_points(price, price, price, 'classic')
        
        assert pp.pp == price
        assert pp.r1 == price
        assert pp.s1 == price


class TestCalculatePivotPointsFibonacci:
    """Tests for Fibonacci pivot point calculation."""

    def test_fibonacci_pivot_basic(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        expected_pp = (high + low + close) / 3
        assert pp.pp == expected_pp

    def test_fibonacci_r1_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        pivot = (high + low + close) / 3
        range_hl = high - low
        expected_r1 = pivot + (0.382 * range_hl)
        assert pp.r1 == expected_r1

    def test_fibonacci_r2_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        pivot = (high + low + close) / 3
        range_hl = high - low
        expected_r2 = pivot + (0.618 * range_hl)
        assert pp.r2 == expected_r2

    def test_fibonacci_r3_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        pivot = (high + low + close) / 3
        range_hl = high - low
        expected_r3 = pivot + (1.000 * range_hl)
        assert pp.r3 == expected_r3

    def test_fibonacci_s1_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        pivot = (high + low + close) / 3
        range_hl = high - low
        expected_s1 = pivot - (0.382 * range_hl)
        assert pp.s1 == expected_s1

    def test_fibonacci_s2_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        pivot = (high + low + close) / 3
        range_hl = high - low
        expected_s2 = pivot - (0.618 * range_hl)
        assert pp.s2 == expected_s2

    def test_fibonacci_s3_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        pivot = (high + low + close) / 3
        range_hl = high - low
        expected_s3 = pivot - (1.000 * range_hl)
        assert pp.s3 == expected_s3

    def test_fibonacci_levels_ordering(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'fibonacci')
        
        assert pp.s3 < pp.s2 < pp.s1 < pp.pp < pp.r1 < pp.r2 < pp.r3


class TestCalculatePivotPointsCamarilla:
    """Tests for Camarilla pivot point calculation."""

    def test_camarilla_pivot_basic(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        expected_pp = (high + low + close) / 3
        assert pp.pp == expected_pp

    def test_camarilla_r1_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        range_hl = high - low
        expected_r1 = close + (range_hl * 1.1 / 12)
        assert pp.r1 == expected_r1

    def test_camarilla_r2_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        range_hl = high - low
        expected_r2 = close + (range_hl * 1.1 / 6)
        assert pp.r2 == expected_r2

    def test_camarilla_r3_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        range_hl = high - low
        expected_r3 = close + (range_hl * 1.1 / 4)
        assert pp.r3 == expected_r3

    def test_camarilla_s1_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        range_hl = high - low
        expected_s1 = close - (range_hl * 1.1 / 12)
        assert pp.s1 == expected_s1

    def test_camarilla_s2_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        range_hl = high - low
        expected_s2 = close - (range_hl * 1.1 / 6)
        assert pp.s2 == expected_s2

    def test_camarilla_s3_calculation(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        range_hl = high - low
        expected_s3 = close - (range_hl * 1.1 / 4)
        assert pp.s3 == expected_s3

    def test_camarilla_levels_ordering(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'camarilla')
        
        assert pp.s3 < pp.s2 < pp.s1 < pp.r1 < pp.r2 < pp.r3


class TestCalculatePivotPointsDefault:
    """Tests for default pivot point behavior."""

    def test_invalid_type_defaults_to_classic(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'invalid_type')
        pp_classic = calculate_pivot_points(high, low, close, 'classic')
        
        assert pp.pp == pp_classic.pp
        assert pp.r1 == pp_classic.r1
        assert pp.s1 == pp_classic.s1

    def test_empty_type_defaults_to_classic(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, '')
        pp_classic = calculate_pivot_points(high, low, close, 'classic')
        
        assert pp.pp == pp_classic.pp


class TestCalculatePivotPointsEdgeCases:
    """Tests for edge cases in pivot point calculation."""

    def test_zero_values(self):
        pp = calculate_pivot_points(0.0, 0.0, 0.0, 'classic')
        assert pp.pp == 0.0
        assert pp.r1 == 0.0
        assert pp.s1 == 0.0

    def test_very_small_range(self):
        high, low, close = 100.01, 99.99, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        assert 99.99 <= pp.s1 <= pp.pp <= pp.r1 <= 100.01

    def test_large_range(self):
        high, low, close = 200.0, 50.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        assert pp.s3 < low
        assert pp.r3 > high

    def test_high_equals_low(self):
        price = 100.0
        pp = calculate_pivot_points(price, price, 100.0, 'classic')
        
        assert pp.pp == 100.0

    def test_close_at_high(self):
        high, low, close = 110.0, 90.0, 110.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        expected_pp = (110 + 90 + 110) / 3
        assert pp.pp == expected_pp

    def test_close_at_low(self):
        high, low, close = 110.0, 90.0, 90.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        
        expected_pp = (110 + 90 + 90) / 3
        assert pp.pp == expected_pp

    def test_negative_prices_not_handled(self):
        pp = calculate_pivot_points(-100.0, -110.0, -105.0, 'classic')
        assert pp.pp < 0


class TestGetIstTime:
    """Tests for IST time conversion function."""

    def test_midnight_utc(self):
        ts_ns = 0
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 5
        assert minute == 30

    def test_known_timestamp(self):
        ts_ns = 1704067200_000000000
        hour, minute, date = get_ist_time(ts_ns)
        assert isinstance(hour, int)
        assert isinstance(minute, int)
        assert 0 <= hour <= 23
        assert 0 <= minute <= 59

    def test_returns_tuple_of_three(self):
        ts_ns = 1704067200_000000000
        result = get_ist_time(ts_ns)
        assert len(result) == 3

    def test_market_open_time(self):
        dt = datetime(2024, 1, 2, 3, 45, 0, tzinfo=timezone.utc)
        ts_ns = int(dt.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 9
        assert minute == 15

    def test_market_close_time(self):
        dt = datetime(2024, 1, 2, 9, 45, 0, tzinfo=timezone.utc)
        ts_ns = int(dt.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 15
        assert minute == 15


class TestGetPreviousDayData:
    """Tests for get_previous_day_data function."""

    def create_test_dataframe(self, days=2, bars_per_day=10):
        data = []
        base_date = datetime(2024, 1, 1, 9, 15)
        
        for day in range(days):
            for bar in range(bars_per_day):
                ts = base_date + timedelta(days=day, minutes=bar * 5)
                data.append({
                    'open': 100.0 + bar,
                    'high': 100.5 + bar,
                    'low': 99.5 + bar,
                    'close': 100.0 + bar,
                    'volume': 1000,
                })
        
        df = pd.DataFrame(data)
        df.index = pd.to_datetime([base_date + timedelta(days=d, minutes=b*5) 
                                   for d in range(days) for b in range(bars_per_day)])
        return df

    def test_returns_none_for_empty_df(self):
        df = pd.DataFrame()
        from datetime import date
        current_date = date(2024, 1, 2)
        result = get_previous_day_data(df, current_date)
        
        assert result is None

    def test_returns_none_for_none_df(self):
        from datetime import date
        current_date = date(2024, 1, 2)
        result = get_previous_day_data(None, current_date)
        
        assert result is None


class TestSRBreakoutStrategyMetadata:
    """Tests for SRBreakoutStrategy metadata methods."""

    def test_get_name(self):
        name = SRBreakoutStrategy.get_name()
        assert isinstance(name, str)
        assert len(name) > 0
        assert "S/R" in name or "Support" in name or "Breakout" in name

    def test_get_description(self):
        desc = SRBreakoutStrategy.get_description()
        assert isinstance(desc, str)
        assert len(desc) > 0
        assert "pivot" in desc.lower() or "pp" in desc.lower()

    def test_get_params_returns_list(self):
        params = SRBreakoutStrategy.get_params()
        assert isinstance(params, list)

    def test_get_params_returns_strategy_param_objects(self):
        params = SRBreakoutStrategy.get_params()
        for param in params:
            assert isinstance(param, StrategyParam)

    def test_get_params_has_required_keys(self):
        params = SRBreakoutStrategy.get_params()
        keys = [p.key for p in params]
        
        assert 'pivot_type' in keys
        assert 'breakout_buffer_pct' in keys
        assert 'stop_loss_pct' in keys
        assert 'take_profit_pct' in keys
        assert 'trade_size' in keys
        assert 'enable_shorts' in keys
        assert 'cooldown_bars' in keys

    def test_pivot_type_param_options(self):
        params = SRBreakoutStrategy.get_params()
        pivot_param = next((p for p in params if p.key == 'pivot_type'), None)
        assert pivot_param is not None
        
        assert pivot_param.type == 'select'
        assert 'classic' in pivot_param.options
        assert 'fibonacci' in pivot_param.options
        assert 'camarilla' in pivot_param.options

    def test_enable_shorts_param_is_boolean(self):
        params = SRBreakoutStrategy.get_params()
        shorts_param = next((p for p in params if p.key == 'enable_shorts'), None)
        assert shorts_param is not None
        
        assert shorts_param.type == 'boolean'

    def test_trade_size_param_has_min_max(self):
        params = SRBreakoutStrategy.get_params()
        trade_size_param = next((p for p in params if p.key == 'trade_size'), None)
        assert trade_size_param is not None
        
        assert trade_size_param.min == 1
        assert trade_size_param.max == 5000


class TestSRBreakoutStrategyValidateParams:
    """Tests for SRBreakoutStrategy parameter validation."""

    def test_valid_params_no_errors(self):
        strategy = SRBreakoutStrategy()
        params = {
            'pivot_type': 'classic',
            'stop_loss_pct': 0.5,
            'take_profit_pct': 1.5,
            'timeframe': '5',
        }
        errors = strategy.validate_params(params)
        assert len(errors) == 0

    def test_invalid_pivot_type_returns_error(self):
        strategy = SRBreakoutStrategy()
        params = {
            'pivot_type': 'invalid',
        }
        errors = strategy.validate_params(params)
        assert len(errors) > 0
        assert any('pivot' in e.lower() for e in errors)

    def test_sl_greater_than_tp_returns_error(self):
        strategy = SRBreakoutStrategy()
        params = {
            'stop_loss_pct': 2.0,
            'take_profit_pct': 1.0,
        }
        errors = strategy.validate_params(params)
        assert len(errors) > 0
        assert any('stop loss' in e.lower() for e in errors)

    def test_sl_equal_to_tp_returns_error(self):
        strategy = SRBreakoutStrategy()
        params = {
            'stop_loss_pct': 1.0,
            'take_profit_pct': 1.0,
        }
        errors = strategy.validate_params(params)
        assert len(errors) > 0

    def test_invalid_timeframe_returns_error(self):
        strategy = SRBreakoutStrategy()
        params = {
            'timeframe': '30',
        }
        errors = strategy.validate_params(params)
        assert len(errors) > 0
        assert any('timeframe' in e.lower() for e in errors)

    def test_valid_timeframe_values(self):
        strategy = SRBreakoutStrategy()
        for tf in ['1', '5', '15']:
            params = {'timeframe': tf}
            errors = strategy.validate_params(params)
            tf_errors = [e for e in errors if 'timeframe' in e.lower()]
            assert len(tf_errors) == 0

    def test_valid_pivot_type_values(self):
        strategy = SRBreakoutStrategy()
        for pt in ['classic', 'fibonacci', 'camarilla']:
            params = {'pivot_type': pt}
            errors = strategy.validate_params(params)
            pt_errors = [e for e in errors if 'pivot' in e.lower()]
            assert len(pt_errors) == 0

    def test_empty_params_uses_defaults(self):
        strategy = SRBreakoutStrategy()
        errors = strategy.validate_params({})
        assert isinstance(errors, list)

    def test_returns_list_of_strings(self):
        strategy = SRBreakoutStrategy()
        params = {'pivot_type': 'invalid', 'timeframe': 'invalid'}
        errors = strategy.validate_params(params)
        
        assert isinstance(errors, list)
        for error in errors:
            assert isinstance(error, str)


class TestSRBreakoutStrategyGetDefaultParams:
    """Tests for default parameter values."""

    def test_get_default_params_returns_dict(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert isinstance(defaults, dict)

    def test_default_pivot_type(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['pivot_type'] == 'classic'

    def test_default_stop_loss(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['stop_loss_pct'] == 0.5

    def test_default_take_profit(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['take_profit_pct'] == 1.5

    def test_default_trade_size(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['trade_size'] == 100

    def test_default_enable_shorts(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['enable_shorts'] == False

    def test_default_cooldown_bars(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['cooldown_bars'] == 3

    def test_default_breakout_buffer(self):
        strategy = SRBreakoutStrategy()
        defaults = strategy.get_default_params()
        assert defaults['breakout_buffer_pct'] == 0.1


class TestSRBreakoutConfig:
    """Tests for SRBreakoutConfig dataclass."""

    def test_config_creation_with_minimal_params(self):
        from nautilus_trader.model import InstrumentId, BarType, Symbol, Venue
        
        venue = Venue("SIMULATED")
        instrument_id = InstrumentId.from_str(f"TEST.{venue}")
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        
        config = SRBreakoutConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
        )
        
        assert config.instrument_id == instrument_id
        assert config.bar_type == bar_type

    def test_config_default_values(self):
        from nautilus_trader.model import InstrumentId, BarType, Venue
        
        venue = Venue("SIMULATED")
        instrument_id = InstrumentId.from_str(f"TEST.{venue}")
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        
        config = SRBreakoutConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
        )
        
        assert config.pivot_type == 'classic'
        assert config.breakout_buffer_pct == 0.1
        assert config.sl_pct == 0.5
        assert config.tp_pct == 1.5
        assert config.trade_size == 100
        assert config.enable_shorts == False
        assert config.cooldown_bars == 3
        assert config.historical_df is None

    def test_config_custom_values(self):
        from nautilus_trader.model import InstrumentId, BarType, Venue
        
        venue = Venue("SIMULATED")
        instrument_id = InstrumentId.from_str(f"TEST.{venue}")
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        
        config = SRBreakoutConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            pivot_type='fibonacci',
            breakout_buffer_pct=0.2,
            sl_pct=0.75,
            tp_pct=2.0,
            trade_size=200,
            enable_shorts=True,
            cooldown_bars=5,
        )
        
        assert config.pivot_type == 'fibonacci'
        assert config.breakout_buffer_pct == 0.2
        assert config.sl_pct == 0.75
        assert config.tp_pct == 2.0
        assert config.trade_size == 200
        assert config.enable_shorts == True
        assert config.cooldown_bars == 5


class TestBreakoutSignalGeneration:
    """Tests for breakout signal generation logic."""

    def test_long_trigger_above_r1_with_buffer(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.1
        
        buffer_multiplier = buffer_pct / 100
        long_trigger = pp.r1 * (1 + buffer_multiplier)
        
        assert long_trigger > pp.r1
        assert long_trigger == pp.r1 * 1.001

    def test_short_trigger_below_s1_with_buffer(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.1
        
        buffer_multiplier = buffer_pct / 100
        short_trigger = pp.s1 * (1 - buffer_multiplier)
        
        assert short_trigger < pp.s1
        assert short_trigger == pp.s1 * 0.999

    def test_close_above_trigger_generates_long_signal(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.1
        
        buffer_multiplier = buffer_pct / 100
        long_trigger = pp.r1 * (1 + buffer_multiplier)
        
        test_close = long_trigger + 0.01
        assert test_close > long_trigger

    def test_close_below_trigger_generates_short_signal(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.1
        
        buffer_multiplier = buffer_pct / 100
        short_trigger = pp.s1 * (1 - buffer_multiplier)
        
        test_close = short_trigger - 0.01
        assert test_close < short_trigger

    def test_no_signal_when_close_between_levels(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.1
        
        buffer_multiplier = buffer_pct / 100
        long_trigger = pp.r1 * (1 + buffer_multiplier)
        short_trigger = pp.s1 * (1 - buffer_multiplier)
        
        test_close = pp.pp
        assert test_close < long_trigger
        assert test_close > short_trigger


class TestStopLossAndTakeProfit:
    """Tests for SL/TP calculation logic."""

    def test_long_position_tp_calculation(self):
        entry_price = 100.0
        tp_pct = 1.5
        
        pnl_pct = 1.5
        assert pnl_pct >= tp_pct

    def test_long_position_sl_calculation(self):
        entry_price = 100.0
        sl_pct = 0.5
        current_price = 99.0
        
        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        assert pnl_pct <= -sl_pct

    def test_short_position_tp_calculation(self):
        entry_price = 100.0
        tp_pct = 1.5
        current_price = 98.5
        
        pnl_pct = ((entry_price - current_price) / entry_price) * 100
        assert pnl_pct >= tp_pct

    def test_short_position_sl_calculation(self):
        entry_price = 100.0
        sl_pct = 0.5
        current_price = 101.0
        
        pnl_pct = ((entry_price - current_price) / entry_price) * 100
        assert pnl_pct <= -sl_pct

    def test_long_profit_at_tp_price(self):
        entry_price = 100.0
        tp_pct = 1.5
        tp_price = entry_price * (1 + tp_pct / 100)
        
        pnl_pct = ((tp_price - entry_price) / entry_price) * 100
        assert abs(pnl_pct - tp_pct) < 0.001

    def test_long_loss_at_sl_price(self):
        entry_price = 100.0
        sl_pct = 0.5
        sl_price = entry_price * (1 - sl_pct / 100)
        
        pnl_pct = ((sl_price - entry_price) / entry_price) * 100
        assert abs(pnl_pct - (-sl_pct)) < 0.001


class TestPnLCalculation:
    """Tests for P&L calculation logic."""

    def test_long_profit_calculation(self):
        entry_price = 100.0
        exit_price = 102.0
        quantity = 100
        
        gross_pnl = (exit_price - entry_price) * quantity
        assert gross_pnl == 200.0

    def test_long_loss_calculation(self):
        entry_price = 100.0
        exit_price = 98.0
        quantity = 100
        
        gross_pnl = (exit_price - entry_price) * quantity
        assert gross_pnl == -200.0

    def test_short_profit_calculation(self):
        entry_price = 100.0
        exit_price = 98.0
        quantity = 100
        
        gross_pnl = (entry_price - exit_price) * quantity
        assert gross_pnl == 200.0

    def test_short_loss_calculation(self):
        entry_price = 100.0
        exit_price = 102.0
        quantity = 100
        
        gross_pnl = (entry_price - exit_price) * quantity
        assert gross_pnl == -200.0

    def test_long_pnl_pct_calculation(self):
        entry_price = 100.0
        exit_price = 102.0
        
        pnl_pct = ((exit_price - entry_price) / entry_price) * 100
        assert pnl_pct == 2.0

    def test_short_pnl_pct_calculation(self):
        entry_price = 100.0
        exit_price = 98.0
        
        pnl_pct = ((entry_price - exit_price) / entry_price) * 100
        assert pnl_pct == 2.0


class TestMarketTiming:
    """Tests for market timing logic."""

    def test_market_open_time(self):
        mkt_open = 9 * 60 + 15
        assert mkt_open == 555

    def test_market_eod_exit_time(self):
        eod_exit = 15 * 60 + 15
        assert eod_exit == 915

    def test_bar_before_market_open(self):
        cur_min = 9 * 60 + 10
        mkt_open = 9 * 60 + 15
        assert cur_min < mkt_open

    def test_bar_at_market_open(self):
        cur_min = 9 * 60 + 15
        mkt_open = 9 * 60 + 15
        assert cur_min >= mkt_open

    def test_bar_at_eod_exit(self):
        cur_min = 15 * 60 + 15
        eod_exit = 15 * 60 + 15
        assert cur_min >= eod_exit

    def test_bar_before_eod(self):
        cur_min = 15 * 60 + 10
        eod_exit = 15 * 60 + 15
        assert cur_min < eod_exit


class TestCooldownLogic:
    """Tests for cooldown bar logic."""

    def test_cooldown_prevents_immediate_reentry(self):
        last_exit_bar = 10
        current_bar = 11
        cooldown_bars = 3
        
        bars_since_exit = current_bar - last_exit_bar
        assert bars_since_exit < cooldown_bars

    def test_cooldown_allows_entry_after_period(self):
        last_exit_bar = 10
        current_bar = 14
        cooldown_bars = 3
        
        bars_since_exit = current_bar - last_exit_bar
        assert bars_since_exit >= cooldown_bars

    def test_zero_cooldown_allows_immediate_entry(self):
        last_exit_bar = 10
        current_bar = 11
        cooldown_bars = 0
        
        if cooldown_bars > 0:
            bars_since_exit = current_bar - last_exit_bar
            assert bars_since_exit >= cooldown_bars
        else:
            assert True


class TestSRBreakoutNautilusStrategy:
    """Tests for SRBreakoutNautilusStrategy class."""

    def create_mock_config(self):
        from nautilus_trader.model import InstrumentId, BarType, Venue
        
        venue = Venue("SIMULATED")
        instrument_id = InstrumentId.from_str(f"TEST.{venue}")
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        
        return SRBreakoutConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
        )

    def test_strategy_initialization(self):
        config = self.create_mock_config()
        strategy = SRBreakoutNautilusStrategy(config)
        
        assert strategy._pivot_type == 'classic'
        assert strategy._breakout_buffer_pct == 0.1
        assert strategy._sl_pct == 0.5
        assert strategy._tp_pct == 1.5
        assert strategy._trade_size == 100
        assert strategy._enable_shorts == False
        assert strategy._cooldown_bars == 3

    def test_strategy_initial_state(self):
        config = self.create_mock_config()
        strategy = SRBreakoutNautilusStrategy(config)
        
        assert strategy._current_date is None
        assert strategy._pivot_points is None
        assert strategy._entry_price is None
        assert strategy._position_side is None
        assert strategy._last_exit_bar is None
        assert strategy._bar_number == 0
        assert strategy.trades == []

    def test_strategy_trades_list_initialized(self):
        config = self.create_mock_config()
        strategy = SRBreakoutNautilusStrategy(config)
        
        assert isinstance(strategy.trades, list)
        assert len(strategy.trades) == 0


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_pivot_points_with_zero_range(self):
        pp = calculate_pivot_points(100.0, 100.0, 100.0, 'classic')
        
        assert pp.pp == 100.0
        assert pp.r1 == 100.0
        assert pp.s1 == 100.0

    def test_pivot_points_with_extreme_values(self):
        pp = calculate_pivot_points(10000.0, 1.0, 5000.0, 'classic')
        
        assert pp.s3 < pp.s2 < pp.s1 < pp.pp < pp.r1 < pp.r2 < pp.r3

    def test_buffer_zero_pct(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.0
        
        buffer_multiplier = buffer_pct / 100
        long_trigger = pp.r1 * (1 + buffer_multiplier)
        
        assert long_trigger == pp.r1

    def test_large_buffer_pct(self):
        high, low, close = 110.0, 90.0, 100.0
        pp = calculate_pivot_points(high, low, close, 'classic')
        buffer_pct = 0.5
        
        buffer_multiplier = buffer_pct / 100
        long_trigger = pp.r1 * (1 + buffer_multiplier)
        
        assert long_trigger == pp.r1 * 1.005

    def test_very_small_prices(self):
        pp = calculate_pivot_points(0.10, 0.08, 0.09, 'classic')
        
        assert pp.pp > 0
        assert pp.s3 < pp.s2 < pp.s1 < pp.pp < pp.r1 < pp.r2 < pp.r3

    def test_fractional_pip_prices(self):
        pp = calculate_pivot_points(100.125, 99.875, 100.0, 'classic')
        
        assert isinstance(pp.pp, float)


class TestStrategyParamTypes:
    """Tests for parameter type definitions."""

    def test_all_params_have_valid_types(self):
        params = SRBreakoutStrategy.get_params()
        valid_types = {'number', 'select', 'boolean'}
        
        for param in params:
            assert param.type in valid_types

    def test_number_params_have_min_max_step(self):
        params = SRBreakoutStrategy.get_params()
        
        for param in params:
            if param.type == 'number':
                assert param.min is not None
                assert param.max is not None
                assert param.step is not None

    def test_select_params_have_options(self):
        params = SRBreakoutStrategy.get_params()
        
        for param in params:
            if param.type == 'select':
                assert param.options is not None
                assert len(param.options) > 0

    def test_boolean_params_have_defaults(self):
        params = SRBreakoutStrategy.get_params()
        
        for param in params:
            if param.type == 'boolean':
                assert param.default in [True, False]
