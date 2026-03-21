"""
Comprehensive unit tests for trading/orb_signals.py

Tests cover:
- SignalType enum
- ORBSignal dataclass
- ORBSignalGenerator class
  - Initialization with various parameters
  - Opening range calculation
  - Signal generation (bullish/bearish breakout)
  - Entry/exit price calculations
  - Stop-loss and take-profit levels
  - Signal validation (OR range filtering)
  - Exit checking (SL/TP/EOD)
- create_entry_signal convenience function
- Edge cases (no signal, invalid data)
"""

import pytest
from datetime import datetime, timedelta
from dataclasses import fields

from trading.orb_signals import (
    SignalType,
    ORBSignal,
    ORBSignalGenerator,
    create_entry_signal,
)


@pytest.fixture(autouse=True)
def reset_global_state():
    """Reset any global module state before and after each test."""
    import trading.orb_signals as orb_module
    
    original_config_available = getattr(orb_module, '_config_available', None)
    
    try:
        from pytest_mock import _mock_cache
        _mock_cache.clear()
    except ImportError:
        pass
    
    yield
    
    if original_config_available is not None:
        orb_module._config_available = original_config_available


# ============================================================================
# SignalType Enum Tests
# ============================================================================

class TestSignalType:
    """Tests for SignalType enum."""

    def test_signal_type_values(self):
        """Test that SignalType has all expected values."""
        assert SignalType.LONG_ENTRY.value == "LONG_ENTRY"
        assert SignalType.SHORT_ENTRY.value == "SHORT_ENTRY"
        assert SignalType.LONG_EXIT.value == "LONG_EXIT"
        assert SignalType.SHORT_EXIT.value == "SHORT_EXIT"

    def test_signal_type_count(self):
        """Test that SignalType has exactly 4 members."""
        assert len(SignalType) == 4

    def test_signal_type_from_string(self):
        """Test creating SignalType from string value."""
        assert SignalType("LONG_ENTRY") == SignalType.LONG_ENTRY
        assert SignalType("SHORT_ENTRY") == SignalType.SHORT_ENTRY

    def test_signal_type_invalid_string_raises(self):
        """Test that invalid string raises ValueError."""
        with pytest.raises(ValueError):
            SignalType("INVALID")


# ============================================================================
# ORBSignal Dataclass Tests
# ============================================================================

class TestORBSignal:
    """Tests for ORBSignal dataclass."""

    def test_orb_signal_has_all_fields(self):
        """Test that ORBSignal has all expected fields."""
        signal = ORBSignal(
            symbol="TEST",
            signal_type=SignalType.LONG_ENTRY,
            price=100.0,
            stop_loss=99.0,
            take_profit=103.0,
            or_high=101.0,
            or_low=98.0,
            or_range=3.0,
            or_range_pct=3.0,
            timestamp=datetime.now(),
        )

        expected_fields = [
            "symbol", "signal_type", "price", "stop_loss", "take_profit",
            "or_high", "or_low", "or_range", "or_range_pct", "timestamp",
            "atr_pct", "adx", "rsi", "score", "notes",
        ]

        for field_name in expected_fields:
            assert hasattr(signal, field_name), f"Missing field: {field_name}"

    def test_orb_signal_required_fields(self):
        """Test that ORBSignal requires all mandatory fields."""
        signal = ORBSignal(
            symbol="RELIANCE",
            signal_type=SignalType.LONG_ENTRY,
            price=2500.0,
            stop_loss=2490.0,
            take_profit=2530.0,
            or_high=2500.0,
            or_low=2480.0,
            or_range=20.0,
            or_range_pct=0.8,
            timestamp=datetime.now(),
        )

        assert signal.symbol == "RELIANCE"
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == 2500.0
        assert signal.stop_loss == 2490.0
        assert signal.take_profit == 2530.0
        assert signal.or_high == 2500.0
        assert signal.or_low == 2480.0
        assert signal.or_range == 20.0
        assert signal.or_range_pct == 0.8

    def test_orb_signal_optional_fields_defaults(self):
        """Test that optional fields have correct defaults."""
        signal = ORBSignal(
            symbol="TEST",
            signal_type=SignalType.LONG_ENTRY,
            price=100.0,
            stop_loss=99.0,
            take_profit=103.0,
            or_high=101.0,
            or_low=98.0,
            or_range=3.0,
            or_range_pct=3.0,
            timestamp=datetime.now(),
        )

        assert signal.atr_pct == 0.0
        assert signal.adx == 0.0
        assert signal.rsi == 0.0
        assert signal.score == 0.0
        assert signal.notes == ""

    def test_orb_signal_optional_fields_custom(self):
        """Test that optional fields can be set."""
        signal = ORBSignal(
            symbol="TEST",
            signal_type=SignalType.LONG_ENTRY,
            price=100.0,
            stop_loss=99.0,
            take_profit=103.0,
            or_high=101.0,
            or_low=98.0,
            or_range=3.0,
            or_range_pct=3.0,
            timestamp=datetime.now(),
            atr_pct=5.5,
            adx=35.0,
            rsi=65.0,
            score=75.0,
            notes="Strong breakout",
        )

        assert signal.atr_pct == 5.5
        assert signal.adx == 35.0
        assert signal.rsi == 65.0
        assert signal.score == 75.0
        assert signal.notes == "Strong breakout"


# ============================================================================
# ORBSignalGenerator Initialization Tests
# ============================================================================

class TestORBSignalGeneratorInit:
    """Tests for ORBSignalGenerator initialization."""

    def test_init_default_values(self):
        """Test initialization with default values."""
        generator = ORBSignalGenerator()

        assert generator.or_minutes == 45
        assert generator.sl_pct == 0.4
        assert generator.tp_pct == 1.2
        assert generator.min_or_range_pct == 0.5
        assert generator.max_or_range_pct == 3.0

    def test_init_custom_or_minutes(self):
        """Test initialization with custom or_minutes."""
        generator = ORBSignalGenerator(or_minutes=30)

        assert generator.or_minutes == 30

    def test_init_custom_sl_tp(self):
        """Test initialization with custom SL/TP percentages."""
        generator = ORBSignalGenerator(sl_pct=0.5, tp_pct=1.5)

        assert generator.sl_pct == 0.5
        assert generator.tp_pct == 1.5

    def test_init_custom_or_range_pct(self):
        """Test initialization with custom OR range percentages."""
        generator = ORBSignalGenerator(
            min_or_range_pct=0.3,
            max_or_range_pct=2.5
        )

        assert generator.min_or_range_pct == 0.3
        assert generator.max_or_range_pct == 2.5

    def test_init_all_custom_parameters(self):
        """Test initialization with all custom parameters."""
        generator = ORBSignalGenerator(
            or_minutes=60,
            sl_pct=0.6,
            tp_pct=1.8,
            min_or_range_pct=0.4,
            max_or_range_pct=2.0,
        )

        assert generator.or_minutes == 60
        assert generator.sl_pct == 0.6
        assert generator.tp_pct == 1.8
        assert generator.min_or_range_pct == 0.4
        assert generator.max_or_range_pct == 2.0

    def test_init_empty_caches(self):
        """Test that caches are initialized empty."""
        generator = ORBSignalGenerator()

        assert generator.or_levels == {}
        assert generator.active_signals == {}

    def test_market_timing_constants(self):
        """Test market timing constants."""
        assert ORBSignalGenerator.MARKET_OPEN == (9, 15)
        assert ORBSignalGenerator.OR_END == (10, 0)
        assert ORBSignalGenerator.MARKET_CLOSE == (15, 30)
        assert ORBSignalGenerator.FORCE_EXIT == (14, 45)


# ============================================================================
# Opening Range Calculation Tests
# ============================================================================

class TestCalculateORLevels:
    """Tests for calculate_or_levels method."""

    def test_calculate_or_levels_basic(self):
        """Test basic OR level calculation."""
        generator = ORBSignalGenerator(or_minutes=45)

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 100, 'high': 102, 'low': 99, 'close': 101},
            {'time': '2024-01-15T09:20:00', 'open': 101, 'high': 103, 'low': 100, 'close': 102},
            {'time': '2024-01-15T09:25:00', 'open': 102, 'high': 104, 'low': 101, 'close': 103},
            {'time': '2024-01-15T09:30:00', 'open': 103, 'high': 105, 'low': 102, 'close': 104},
            {'time': '2024-01-15T09:35:00', 'open': 104, 'high': 106, 'low': 103, 'close': 105},
            {'time': '2024-01-15T09:40:00', 'open': 105, 'high': 107, 'low': 104, 'close': 106},
            {'time': '2024-01-15T09:45:00', 'open': 106, 'high': 108, 'low': 105, 'close': 107},
            {'time': '2024-01-15T09:50:00', 'open': 107, 'high': 109, 'low': 106, 'close': 108},
            {'time': '2024-01-15T09:55:00', 'open': 108, 'high': 110, 'low': 107, 'close': 109},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_high'] == 110
        assert result['or_low'] == 99
        assert result['or_range'] == 11
        assert result['or_candles'] == 9

    def test_calculate_or_levels_with_datetime_objects(self):
        """Test OR calculation with datetime objects instead of strings."""
        generator = ORBSignalGenerator(or_minutes=45)
        base_time = datetime(2024, 1, 15, 9, 15)

        candles = [
            {'time': base_time + timedelta(minutes=i*5), 'open': 100+i, 'high': 102+i, 'low': 99+i, 'close': 101+i}
            for i in range(9)
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_high'] == 110
        assert result['or_low'] == 99

    def test_calculate_or_levels_empty_candles(self):
        """Test OR calculation with empty candle list."""
        generator = ORBSignalGenerator()

        result = generator.calculate_or_levels([])

        assert result is None

    def test_calculate_or_levels_insufficient_candles(self):
        """Test OR calculation with fewer than 5 candles."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'high': 102, 'low': 99, 'close': 101},
            {'time': '2024-01-15T09:20:00', 'high': 103, 'low': 100, 'close': 102},
            {'time': '2024-01-15T09:25:00', 'high': 104, 'low': 101, 'close': 103},
            {'time': '2024-01-15T09:30:00', 'high': 105, 'low': 102, 'close': 104},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is None

    def test_calculate_or_levels_exactly_5_candles(self):
        """Test OR calculation with exactly 5 candles (minimum required)."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 100, 'high': 102, 'low': 99, 'close': 101},
            {'time': '2024-01-15T09:20:00', 'open': 101, 'high': 103, 'low': 100, 'close': 102},
            {'time': '2024-01-15T09:25:00', 'open': 102, 'high': 104, 'low': 101, 'close': 103},
            {'time': '2024-01-15T09:30:00', 'open': 103, 'high': 105, 'low': 102, 'close': 104},
            {'time': '2024-01-15T09:35:00', 'open': 104, 'high': 106, 'low': 103, 'close': 105},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_candles'] == 5

    def test_calculate_or_levels_excludes_non_or_candles(self):
        """Test that candles outside OR period are excluded."""
        generator = ORBSignalGenerator(or_minutes=45)

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 99, 'high': 100, 'low': 99, 'close': 99.5},
            {'time': '2024-01-15T09:20:00', 'open': 100, 'high': 101, 'low': 99.5, 'close': 100},
            {'time': '2024-01-15T09:25:00', 'open': 101, 'high': 102, 'low': 100, 'close': 101},
            {'time': '2024-01-15T09:30:00', 'open': 102, 'high': 103, 'low': 101, 'close': 102},
            {'time': '2024-01-15T09:35:00', 'open': 103, 'high': 104, 'low': 102, 'close': 103},
            {'time': '2024-01-15T09:40:00', 'open': 104, 'high': 105, 'low': 103, 'close': 104},
            {'time': '2024-01-15T09:45:00', 'open': 105, 'high': 106, 'low': 104, 'close': 105},
            {'time': '2024-01-15T09:50:00', 'open': 106, 'high': 107, 'low': 105, 'close': 106},
            {'time': '2024-01-15T09:55:00', 'open': 107, 'high': 108, 'low': 106, 'close': 107},
            {'time': '2024-01-15T10:05:00', 'open': 140, 'high': 150, 'low': 140, 'close': 145},
            {'time': '2024-01-15T10:10:00', 'open': 145, 'high': 160, 'low': 150, 'close': 155},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_high'] == 108
        assert result['or_low'] == 99
        assert result['or_candles'] == 9

    def test_calculate_or_levels_or_range_pct(self):
        """Test OR range percentage calculation."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 99, 'high': 100, 'low': 98, 'close': 99},
            {'time': '2024-01-15T09:20:00', 'open': 99, 'high': 101, 'low': 99, 'close': 100},
            {'time': '2024-01-15T09:25:00', 'open': 100, 'high': 102, 'low': 100, 'close': 101},
            {'time': '2024-01-15T09:30:00', 'open': 101, 'high': 103, 'low': 101, 'close': 102},
            {'time': '2024-01-15T09:35:00', 'open': 102, 'high': 104, 'low': 102, 'close': 103},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_range'] == 6
        expected_pct = (6 / 103) * 100
        assert abs(result['or_range_pct'] - expected_pct) < 0.01

    def test_calculate_or_levels_invalid_time_string(self):
        """Test handling of invalid time strings."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': 'invalid-time', 'open': 100, 'high': 102, 'low': 99, 'close': 101},
            {'time': '2024-01-15T09:20:00', 'open': 101, 'high': 103, 'low': 100, 'close': 102},
            {'time': '2024-01-15T09:25:00', 'open': 102, 'high': 104, 'low': 101, 'close': 103},
            {'time': '2024-01-15T09:30:00', 'open': 103, 'high': 105, 'low': 102, 'close': 104},
            {'time': '2024-01-15T09:35:00', 'open': 104, 'high': 106, 'low': 103, 'close': 105},
            {'time': '2024-01-15T09:40:00', 'open': 105, 'high': 107, 'low': 104, 'close': 106},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_candles'] == 5

    def test_calculate_or_levels_timezone_aware(self):
        """Test handling of timezone-aware datetimes."""
        generator = ORBSignalGenerator()
        from datetime import timezone

        base = datetime(2024, 1, 15, 9, 15, tzinfo=timezone.utc)
        candles = [
            {'time': base + timedelta(minutes=i*5), 'open': 100+i, 'high': 100+i+1, 'low': 100+i-1, 'close': 100+i}
            for i in range(9)
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None

    def test_calculate_or_levels_zero_close_price(self):
        """Test OR calculation handles zero close price."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 0, 'high': 0, 'low': 0, 'close': 0},
            {'time': '2024-01-15T09:20:00', 'open': 0, 'high': 0, 'low': 0, 'close': 0},
            {'time': '2024-01-15T09:25:00', 'open': 0, 'high': 0, 'low': 0, 'close': 0},
            {'time': '2024-01-15T09:30:00', 'open': 0, 'high': 0, 'low': 0, 'close': 0},
            {'time': '2024-01-15T09:35:00', 'open': 0, 'high': 0, 'low': 0, 'close': 0},
        ]

        result = generator.calculate_or_levels(candles)

        assert result is not None
        assert result['or_range_pct'] == 0


# ============================================================================
# Breakout Detection Tests
# ============================================================================

class TestCheckBreakout:
    """Tests for check_breakout method."""

    @pytest.fixture
    def generator(self):
        """Create a generator with standard parameters."""
        return ORBSignalGenerator(
            or_minutes=45,
            sl_pct=0.4,
            tp_pct=1.2,
            min_or_range_pct=0.5,
            max_or_range_pct=3.0,
        )

    @pytest.fixture
    def valid_or_levels(self):
        """Create valid OR levels for testing."""
        return {
            'or_high': 100.0,
            'or_low': 98.0,
            'or_range': 2.0,
            'or_range_pct': 2.0,
        }

    def test_long_breakout_detection(self, generator, valid_or_levels):
        """Test detection of long breakout (price above OR high)."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=valid_or_levels,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == 100.5
        assert signal.symbol == "TEST"

    def test_short_breakout_detection(self, generator, valid_or_levels):
        """Test detection of short breakout (price below OR low)."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=97.5,
            or_levels=valid_or_levels,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_ENTRY
        assert signal.price == 97.5
        assert signal.symbol == "TEST"

    def test_no_breakout_price_within_range(self, generator, valid_or_levels):
        """Test no signal when price is within OR range."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=99.0,
            or_levels=valid_or_levels,
        )

        assert signal is None

    def test_no_breakout_price_at_or_high(self, generator, valid_or_levels):
        """Test no signal when price is exactly at OR high."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.0,
            or_levels=valid_or_levels,
        )

        assert signal is None

    def test_no_breakout_price_at_or_low(self, generator, valid_or_levels):
        """Test no signal when price is exactly at OR low."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=98.0,
            or_levels=valid_or_levels,
        )

        assert signal is None

    def test_long_signal_stop_loss_calculation(self, generator, valid_or_levels):
        """Test stop-loss calculation for long signal."""
        price = 100.5
        expected_sl = round(price * (1 - 0.4 / 100), 2)

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=price,
            or_levels=valid_or_levels,
        )

        assert signal.stop_loss == expected_sl

    def test_long_signal_take_profit_calculation(self, generator, valid_or_levels):
        """Test take-profit calculation for long signal."""
        price = 100.5
        expected_tp = round(price * (1 + 1.2 / 100), 2)

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=price,
            or_levels=valid_or_levels,
        )

        assert signal.take_profit == expected_tp

    def test_short_signal_stop_loss_calculation(self, generator, valid_or_levels):
        """Test stop-loss calculation for short signal."""
        price = 97.5
        expected_sl = round(price * (1 + 0.4 / 100), 2)

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=price,
            or_levels=valid_or_levels,
        )

        assert signal.stop_loss == expected_sl

    def test_short_signal_take_profit_calculation(self, generator, valid_or_levels):
        """Test take-profit calculation for short signal."""
        price = 97.5
        expected_tp = round(price * (1 - 1.2 / 100), 2)

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=price,
            or_levels=valid_or_levels,
        )

        assert signal.take_profit == expected_tp

    def test_signal_includes_or_levels(self, generator, valid_or_levels):
        """Test that signal includes OR levels."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=valid_or_levels,
        )

        assert signal.or_high == 100.0
        assert signal.or_low == 98.0
        assert signal.or_range == 2.0
        assert signal.or_range_pct == 2.0

    def test_signal_includes_optional_indicators(self, generator, valid_or_levels):
        """Test that signal includes optional technical indicators."""
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=valid_or_levels,
            atr_pct=5.5,
            adx=35.0,
            rsi=65.0,
            score=80.0,
        )

        assert signal.atr_pct == 5.5
        assert signal.adx == 35.0
        assert signal.rsi == 65.0
        assert signal.score == 80.0

    def test_signal_has_timestamp(self, generator, valid_or_levels):
        """Test that signal has a timestamp."""
        before = datetime.now()
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=valid_or_levels,
        )
        after = datetime.now()

        assert before <= signal.timestamp <= after

    def test_signal_has_notes(self, generator, valid_or_levels):
        """Test that signal has appropriate notes."""
        long_signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=valid_or_levels,
        )
        assert "Breakout above OR high" in long_signal.notes
        assert "100.00" in long_signal.notes

        short_signal = generator.check_breakout(
            symbol="TEST",
            current_price=97.5,
            or_levels=valid_or_levels,
        )
        assert "Breakdown below OR low" in short_signal.notes
        assert "98.00" in short_signal.notes

    def test_or_range_too_small_no_signal(self, generator):
        """Test no signal when OR range is below minimum."""
        small_range_levels = {
            'or_high': 100.0,
            'or_low': 99.9,
            'or_range': 0.1,
            'or_range_pct': 0.1,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=small_range_levels,
        )

        assert signal is None

    def test_or_range_too_large_no_signal(self, generator):
        """Test no signal when OR range is above maximum."""
        large_range_levels = {
            'or_high': 110.0,
            'or_low': 90.0,
            'or_range': 20.0,
            'or_range_pct': 5.0,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=111.0,
            or_levels=large_range_levels,
        )

        assert signal is None

    def test_custom_sl_tp_parameters(self):
        """Test custom SL/TP parameters override defaults."""
        generator = ORBSignalGenerator(sl_pct=0.6, tp_pct=1.5)
        or_levels = {
            'or_high': 100.0,
            'or_low': 98.0,
            'or_range': 2.0,
            'or_range_pct': 2.0,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.5,
            or_levels=or_levels,
        )

        expected_sl = round(100.5 * (1 - 0.6 / 100), 2)
        expected_tp = round(100.5 * (1 + 1.5 / 100), 2)

        assert signal.stop_loss == expected_sl
        assert signal.take_profit == expected_tp

    def test_boundary_or_range_pct_min(self):
        """Test signal at minimum OR range percentage boundary."""
        generator = ORBSignalGenerator(min_or_range_pct=0.5)
        or_levels = {
            'or_high': 100.5,
            'or_low': 100.0,
            'or_range': 0.5,
            'or_range_pct': 0.5,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=101.0,
            or_levels=or_levels,
        )

        assert signal is not None

    def test_boundary_or_range_pct_max(self):
        """Test signal at maximum OR range percentage boundary."""
        generator = ORBSignalGenerator(max_or_range_pct=3.0)
        or_levels = {
            'or_high': 103.0,
            'or_low': 100.0,
            'or_range': 3.0,
            'or_range_pct': 3.0,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=103.5,
            or_levels=or_levels,
        )

        assert signal is not None


# ============================================================================
# Exit Signal Tests
# ============================================================================

class TestCheckExit:
    """Tests for check_exit method."""

    @pytest.fixture
    def generator(self):
        """Create a generator for testing."""
        return ORBSignalGenerator()

    def test_long_exit_on_stop_loss(self, generator, mocker):
        """Test long exit when stop loss is hit."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=98.5,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert signal.notes == "Stop loss hit"

    def test_long_exit_on_take_profit(self, generator, mocker):
        """Test long exit when take profit is hit."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=102.5,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert signal.notes == "Take profit hit"

    def test_short_exit_on_stop_loss(self, generator, mocker):
        """Test short exit when stop loss is hit."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="SELL",
            entry_price=100.0,
            stop_loss=101.0,
            take_profit=98.0,
            current_price=101.5,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert signal.notes == "Stop loss hit"

    def test_short_exit_on_take_profit(self, generator, mocker):
        """Test short exit when take profit is hit."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="SELL",
            entry_price=100.0,
            stop_loss=101.0,
            take_profit=98.0,
            current_price=97.5,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert signal.notes == "Take profit hit"

    def test_no_exit_price_within_range_long(self, generator, mocker):
        """Test no exit for long when price is within SL/TP range."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=100.5,
        )

        assert signal is None

    def test_no_exit_price_within_range_short(self, generator, mocker):
        """Test no exit for short when price is within SL/TP range."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="SELL",
            entry_price=100.0,
            stop_loss=101.0,
            take_profit=98.0,
            current_price=99.5,
        )

        assert signal is None

    def test_eod_force_exit_long(self, generator, mocker):
        """Test EOD force exit for long position at 14:45."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 14, 45)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=100.5,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "EOD force exit" in signal.notes

    def test_eod_force_exit_short(self, generator, mocker):
        """Test EOD force exit for short position at 14:45."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 14, 45)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="SELL",
            entry_price=100.0,
            stop_loss=101.0,
            take_profit=98.0,
            current_price=99.5,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert "EOD force exit" in signal.notes

    def test_eod_force_exit_after_14_45(self, generator, mocker):
        """Test EOD force exit for times after 14:45 but before 15:00."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 14, 50)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=100.5,
        )

        assert signal is not None
        assert "EOD force exit" in signal.notes

    def test_no_eod_exit_before_14_45(self, generator, mocker):
        """Test no EOD exit before 14:45."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 14, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=100.5,
        )

        assert signal is None

    def test_exit_signal_includes_prices(self, generator, mocker):
        """Test that exit signal includes SL/TP prices."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=98.5,
        )

        assert signal.stop_loss == 99.0
        assert signal.take_profit == 102.0
        assert signal.price == 98.5

    def test_long_exit_exact_stop_loss(self, generator, mocker):
        """Test long exit when price is exactly at stop loss."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=99.0,
        )

        assert signal is not None
        assert signal.notes == "Stop loss hit"

    def test_long_exit_exact_take_profit(self, generator, mocker):
        """Test long exit when price is exactly at take profit."""
        mock_datetime = mocker.patch('trading.orb_signals.datetime')
        mock_datetime.now.return_value = datetime(2024, 1, 15, 10, 30)
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        signal = generator.check_exit(
            symbol="TEST",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            current_price=102.0,
        )

        assert signal is not None
        assert signal.notes == "Take profit hit"


# ============================================================================
# create_entry_signal Function Tests
# ============================================================================

class TestCreateEntrySignal:
    """Tests for create_entry_signal convenience function."""

    def test_create_long_entry_signal(self):
        """Test creating a long entry signal."""
        signal = create_entry_signal(
            symbol="RELIANCE",
            price=2500.0,
            or_high=2490.0,
            or_low=2470.0,
            sl_pct=0.4,
            tp_pct=1.2,
            side="LONG",
        )

        assert signal.symbol == "RELIANCE"
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == 2500.0
        assert signal.or_high == 2490.0
        assert signal.or_low == 2470.0
        assert signal.or_range == 20.0

    def test_create_short_entry_signal(self):
        """Test creating a short entry signal."""
        signal = create_entry_signal(
            symbol="INFY",
            price=1500.0,
            or_high=1520.0,
            or_low=1490.0,
            side="SHORT",
        )

        assert signal.symbol == "INFY"
        assert signal.signal_type == SignalType.SHORT_ENTRY
        assert signal.price == 1500.0

    def test_long_signal_sl_calculation(self):
        """Test stop-loss calculation for long signal."""
        price = 100.0
        sl_pct = 0.5
        expected_sl = round(price * (1 - sl_pct / 100), 2)

        signal = create_entry_signal(
            symbol="TEST",
            price=price,
            or_high=99.0,
            or_low=97.0,
            sl_pct=sl_pct,
            side="LONG",
        )

        assert signal.stop_loss == expected_sl

    def test_long_signal_tp_calculation(self):
        """Test take-profit calculation for long signal."""
        price = 100.0
        tp_pct = 1.5
        expected_tp = round(price * (1 + tp_pct / 100), 2)

        signal = create_entry_signal(
            symbol="TEST",
            price=price,
            or_high=99.0,
            or_low=97.0,
            tp_pct=tp_pct,
            side="LONG",
        )

        assert signal.take_profit == expected_tp

    def test_short_signal_sl_calculation(self):
        """Test stop-loss calculation for short signal."""
        price = 100.0
        sl_pct = 0.5
        expected_sl = round(price * (1 + sl_pct / 100), 2)

        signal = create_entry_signal(
            symbol="TEST",
            price=price,
            or_high=101.0,
            or_low=99.0,
            sl_pct=sl_pct,
            side="SHORT",
        )

        assert signal.stop_loss == expected_sl

    def test_short_signal_tp_calculation(self):
        """Test take-profit calculation for short signal."""
        price = 100.0
        tp_pct = 1.5
        expected_tp = round(price * (1 - tp_pct / 100), 2)

        signal = create_entry_signal(
            symbol="TEST",
            price=price,
            or_high=101.0,
            or_low=99.0,
            tp_pct=tp_pct,
            side="SHORT",
        )

        assert signal.take_profit == expected_tp

    def test_or_range_calculation(self):
        """Test OR range calculation."""
        signal = create_entry_signal(
            symbol="TEST",
            price=100.0,
            or_high=105.0,
            or_low=95.0,
            side="LONG",
        )

        assert signal.or_range == 10.0

    def test_or_range_pct_calculation(self):
        """Test OR range percentage calculation."""
        price = 100.0
        or_high = 105.0
        or_low = 95.0
        or_range = or_high - or_low
        expected_pct = round((or_range / price) * 100, 2)

        signal = create_entry_signal(
            symbol="TEST",
            price=price,
            or_high=or_high,
            or_low=or_low,
            side="LONG",
        )

        assert signal.or_range_pct == expected_pct

    def test_default_parameters(self):
        """Test that default parameters are used."""
        price = 100.0
        expected_sl = round(price * (1 - 0.4 / 100), 2)
        expected_tp = round(price * (1 + 1.2 / 100), 2)

        signal = create_entry_signal(
            symbol="TEST",
            price=price,
            or_high=99.0,
            or_low=97.0,
            side="LONG",
        )

        assert signal.stop_loss == expected_sl
        assert signal.take_profit == expected_tp

    def test_signal_has_timestamp(self):
        """Test that signal has a timestamp."""
        before = datetime.now()
        signal = create_entry_signal(
            symbol="TEST",
            price=100.0,
            or_high=99.0,
            or_low=97.0,
            side="LONG",
        )
        after = datetime.now()

        assert before <= signal.timestamp <= after

    def test_signal_rounding(self):
        """Test that SL and TP are properly rounded."""
        signal = create_entry_signal(
            symbol="TEST",
            price=123.456,
            or_high=120.0,
            or_low=115.0,
            sl_pct=0.4,
            tp_pct=1.2,
            side="LONG",
        )

        assert signal.stop_loss == round(signal.stop_loss, 2)
        assert signal.take_profit == round(signal.take_profit, 2)


# ============================================================================
# Display Signals Tests
# ============================================================================

# ============================================================================
# Integration Tests
# ============================================================================

class TestORBSignalGeneratorIntegration:
    """Integration tests for ORBSignalGenerator."""

    def test_full_workflow_long_signal(self):
        """Test complete workflow for long signal generation."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 100, 'high': 100.5, 'low': 99.8, 'close': 100.2},
            {'time': '2024-01-15T09:20:00', 'open': 100.2, 'high': 100.7, 'low': 100.0, 'close': 100.5},
            {'time': '2024-01-15T09:25:00', 'open': 100.5, 'high': 101.0, 'low': 100.3, 'close': 100.8},
            {'time': '2024-01-15T09:30:00', 'open': 100.8, 'high': 101.3, 'low': 100.6, 'close': 101.0},
            {'time': '2024-01-15T09:35:00', 'open': 101.0, 'high': 101.5, 'low': 100.8, 'close': 101.2},
            {'time': '2024-01-15T09:40:00', 'open': 101.2, 'high': 101.7, 'low': 101.0, 'close': 101.5},
            {'time': '2024-01-15T09:45:00', 'open': 101.5, 'high': 102.0, 'low': 101.3, 'close': 101.7},
            {'time': '2024-01-15T09:50:00', 'open': 101.7, 'high': 102.2, 'low': 101.5, 'close': 102.0},
            {'time': '2024-01-15T09:55:00', 'open': 102.0, 'high': 102.5, 'low': 101.8, 'close': 102.2},
        ]

        or_levels = generator.calculate_or_levels(candles)
        assert or_levels is not None

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=102.8,
            or_levels=or_levels,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.or_high == 102.5
        assert signal.or_low == 99.8

    def test_full_workflow_short_signal(self):
        """Test complete workflow for short signal generation."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 100, 'high': 100.5, 'low': 99.8, 'close': 100.2},
            {'time': '2024-01-15T09:20:00', 'open': 100.2, 'high': 100.7, 'low': 100.0, 'close': 100.5},
            {'time': '2024-01-15T09:25:00', 'open': 100.5, 'high': 101.0, 'low': 100.3, 'close': 100.8},
            {'time': '2024-01-15T09:30:00', 'open': 100.8, 'high': 101.3, 'low': 100.6, 'close': 101.0},
            {'time': '2024-01-15T09:35:00', 'open': 101.0, 'high': 101.5, 'low': 100.8, 'close': 101.2},
            {'time': '2024-01-15T09:40:00', 'open': 101.2, 'high': 101.7, 'low': 101.0, 'close': 101.5},
            {'time': '2024-01-15T09:45:00', 'open': 101.5, 'high': 102.0, 'low': 101.3, 'close': 101.7},
            {'time': '2024-01-15T09:50:00', 'open': 101.7, 'high': 102.2, 'low': 101.5, 'close': 102.0},
            {'time': '2024-01-15T09:55:00', 'open': 102.0, 'high': 102.5, 'low': 101.8, 'close': 102.2},
        ]

        or_levels = generator.calculate_or_levels(candles)
        assert or_levels is not None

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=99.5,
            or_levels=or_levels,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_ENTRY

    def test_full_workflow_no_signal(self):
        """Test workflow when no signal should be generated."""
        generator = ORBSignalGenerator()

        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 100, 'high': 100.5, 'low': 99.8, 'close': 100.2},
            {'time': '2024-01-15T09:20:00', 'open': 100.2, 'high': 100.7, 'low': 100.0, 'close': 100.5},
            {'time': '2024-01-15T09:25:00', 'open': 100.5, 'high': 101.0, 'low': 100.3, 'close': 100.8},
            {'time': '2024-01-15T09:30:00', 'open': 100.8, 'high': 101.3, 'low': 100.6, 'close': 101.0},
            {'time': '2024-01-15T09:35:00', 'open': 101.0, 'high': 101.5, 'low': 100.8, 'close': 101.2},
            {'time': '2024-01-15T09:40:00', 'open': 101.2, 'high': 101.7, 'low': 101.0, 'close': 101.5},
            {'time': '2024-01-15T09:45:00', 'open': 101.5, 'high': 102.0, 'low': 101.3, 'close': 101.7},
            {'time': '2024-01-15T09:50:00', 'open': 101.7, 'high': 102.2, 'low': 101.5, 'close': 102.0},
            {'time': '2024-01-15T09:55:00', 'open': 102.0, 'high': 102.5, 'low': 101.8, 'close': 102.2},
        ]

        or_levels = generator.calculate_or_levels(candles)
        signal = generator.check_breakout(
            symbol="TEST",
            current_price=101.5,
            or_levels=or_levels,
        )

        assert signal is None


# ============================================================================
# Edge Cases Tests
# ============================================================================

class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_zero_price_handling(self):
        """Test handling of zero prices."""
        generator = ORBSignalGenerator()

        or_levels = {
            'or_high': 100.0,
            'or_low': 98.0,
            'or_range': 2.0,
            'or_range_pct': 2.0,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=0.0,
            or_levels=or_levels,
        )

        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_ENTRY

    def test_negative_price_handling(self):
        """Test handling of negative prices."""
        signal = create_entry_signal(
            symbol="TEST",
            price=-100.0,
            or_high=-95.0,
            or_low=-105.0,
            side="LONG",
        )

        assert signal.price == -100.0

    def test_very_large_price_values(self):
        """Test handling of very large price values."""
        large_price = 1000000.0
        signal = create_entry_signal(
            symbol="TEST",
            price=large_price,
            or_high=large_price - 1000,
            or_low=large_price - 2000,
            side="LONG",
        )

        assert signal.price == large_price
        assert signal.stop_loss < large_price
        assert signal.take_profit > large_price

    def test_very_small_or_range(self):
        """Test with very small OR range."""
        generator = ORBSignalGenerator(min_or_range_pct=0.01)

        or_levels = {
            'or_high': 100.01,
            'or_low': 100.00,
            'or_range': 0.01,
            'or_range_pct': 0.01,
        }

        signal = generator.check_breakout(
            symbol="TEST",
            current_price=100.02,
            or_levels=or_levels,
        )

        assert signal is not None

    def test_or_levels_missing_keys(self):
        """Test handling of OR levels dict with missing keys."""
        generator = ORBSignalGenerator()

        incomplete_or_levels = {
            'or_high': 100.0,
            'or_low': 98.0,
        }

        with pytest.raises(KeyError):
            generator.check_breakout(
                symbol="TEST",
                current_price=101.0,
                or_levels=incomplete_or_levels,
            )

    def test_exact_or_boundary_prices(self):
        """Test signals at exact OR boundary prices."""
        generator = ORBSignalGenerator()
        or_levels = {
            'or_high': 100.0,
            'or_low': 98.0,
            'or_range': 2.0,
            'or_range_pct': 2.0,
        }

        signal_at_high = generator.check_breakout(
            symbol="TEST",
            current_price=100.0,
            or_levels=or_levels,
        )
        assert signal_at_high is None

        signal_at_low = generator.check_breakout(
            symbol="TEST",
            current_price=98.0,
            or_levels=or_levels,
        )
        assert signal_at_low is None

        signal_above_high = generator.check_breakout(
            symbol="TEST",
            current_price=100.01,
            or_levels=or_levels,
        )
        assert signal_above_high is not None
        assert signal_above_high.signal_type == SignalType.LONG_ENTRY

        signal_below_low = generator.check_breakout(
            symbol="TEST",
            current_price=97.99,
            or_levels=or_levels,
        )
        assert signal_below_low is not None
        assert signal_below_low.signal_type == SignalType.SHORT_ENTRY

    def test_different_or_minutes_settings(self):
        """Test OR calculation with different or_minutes settings."""
        candles = [
            {'time': '2024-01-15T09:15:00', 'open': 99, 'high': 100, 'low': 99, 'close': 99.5},
            {'time': '2024-01-15T09:20:00', 'open': 100, 'high': 101, 'low': 100, 'close': 100.5},
            {'time': '2024-01-15T09:25:00', 'open': 101, 'high': 102, 'low': 101, 'close': 101.5},
            {'time': '2024-01-15T09:30:00', 'open': 102, 'high': 103, 'low': 102, 'close': 102.5},
            {'time': '2024-01-15T09:35:00', 'open': 103, 'high': 104, 'low': 103, 'close': 103.5},
            {'time': '2024-01-15T09:40:00', 'open': 104, 'high': 105, 'low': 104, 'close': 104.5},
            {'time': '2024-01-15T09:45:00', 'open': 105, 'high': 106, 'low': 105, 'close': 105.5},
            {'time': '2024-01-15T09:50:00', 'open': 106, 'high': 107, 'low': 106, 'close': 106.5},
            {'time': '2024-01-15T09:55:00', 'open': 107, 'high': 108, 'low': 107, 'close': 107.5},
            {'time': '2024-01-15T10:00:00', 'open': 108, 'high': 109, 'low': 108, 'close': 108.5},
            {'time': '2024-01-15T10:05:00', 'open': 109, 'high': 110, 'low': 109, 'close': 109.5},
            {'time': '2024-01-15T10:10:00', 'open': 110, 'high': 111, 'low': 110, 'close': 110.5},
        ]

        generator_30min = ORBSignalGenerator(or_minutes=30)
        result_30min = generator_30min.calculate_or_levels(candles)
        assert result_30min is not None
        assert result_30min['or_candles'] == 7

        generator_60min = ORBSignalGenerator(or_minutes=60)
        result_60min = generator_60min.calculate_or_levels(candles)
        assert result_60min is not None
        assert result_60min['or_candles'] == 12

    def test_signal_immutability(self):
        """Test that signals are dataclasses and can be compared."""
        signal1 = create_entry_signal(
            symbol="TEST",
            price=100.0,
            or_high=99.0,
            or_low=97.0,
            side="LONG",
        )

        signal2 = create_entry_signal(
            symbol="TEST",
            price=100.0,
            or_high=99.0,
            or_low=97.0,
            side="LONG",
        )

        assert signal1.symbol == signal2.symbol
        assert signal1.price == signal2.price
        assert signal1.signal_type == signal2.signal_type
