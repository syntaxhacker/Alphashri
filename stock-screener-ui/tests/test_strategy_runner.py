"""Unit tests for StrategyRunner dataclass."""
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from trading.strategy_runner import StrategyRunner, INTRADAY_STRATEGY_TYPES, SWING_STRATEGY_TYPES


class TestStrategyRunnerInit:
    """Tests for StrategyRunner initialization."""

    def test_default_values(self):
        """Test default field values."""
        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="Test Strategy",
            strategy_type="ORB",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        assert runner.strategy_id == 1
        assert runner.strategy_name == "Test Strategy"
        assert runner.strategy_type == "ORB"
        assert runner.config == {}
        assert runner.max_positions == 5
        assert runner.capital_allocation_pct == 0.5
        assert runner.status == "pending"
        assert runner.last_scan_time is None
        assert runner.last_scan_items == []
        assert runner.signals_generated == 0
        assert runner.trades_executed == 0
        # Note: signal_generator is initialized in __post_init__ based on strategy_type

    def test_custom_values(self):
        """Test custom initialization with non-default values."""
        now = datetime.now()
        runner = StrategyRunner(
            strategy_id=2,
            strategy_name="Custom Strategy",
            strategy_type="EMA_CROSS",
            config={"ema_fast_period": 12, "ema_slow_period": 26},
            max_positions=3,
            capital_allocation_pct=0.3,
            signal_generator=None,
            status="running",
            last_scan_time=now,
            last_scan_items=[{"symbol": "TEST"}],
            signals_generated=10,
            trades_executed=5,
        )
        assert runner.status == "running"
        assert runner.last_scan_time == now
        assert runner.last_scan_items == [{"symbol": "TEST"}]
        assert runner.signals_generated == 10
        assert runner.trades_executed == 5

    def test_signal_generator_provided(self):
        """Test that provided signal_generator is used without creating a new one."""
        mock_gen = MagicMock()
        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="Test",
            strategy_type="ORB",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
            signal_generator=mock_gen,
        )
        assert runner.signal_generator is mock_gen


class TestSignalGeneratorInitialization:
    """Tests for __post_init__ signal generator creation."""

    def test_orb_creates_orbsignalgenerator(self):
        """Test ORB strategy type creates ORBSignalGenerator with default config."""
        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="ORB Test",
            strategy_type="ORB",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.orb_signals import ORBSignalGenerator
        assert isinstance(runner.signal_generator, ORBSignalGenerator)
        # Check defaults (from ORBSignalGenerator fallback when config is empty)
        assert runner.signal_generator.or_minutes == 45
        assert runner.signal_generator.sl_pct == 1.0
        assert runner.signal_generator.tp_pct == 1.5
        assert runner.signal_generator.min_or_range_pct == 0.5
        assert runner.signal_generator.max_or_range_pct == 3.0
        assert runner.signal_generator.breakout_buffer_pct == 0.3

    def test_orb_uses_config_values(self):
        """Test ORB strategy uses provided config values."""
        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="ORB Custom",
            strategy_type="ORB",
            config={
                'or_minutes': 60,
                'sl_pct': 0.6,
                'tp_pct': 1.8,
                'min_or_range_pct': 0.8,
                'max_or_range_pct': 4.0,
                'breakout_buffer_pct': 0.5,
            },
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        assert runner.signal_generator.or_minutes == 60
        assert runner.signal_generator.sl_pct == 0.6
        assert runner.signal_generator.tp_pct == 1.8
        assert runner.signal_generator.min_or_range_pct == 0.8
        assert runner.signal_generator.max_or_range_pct == 4.0
        assert runner.signal_generator.breakout_buffer_pct == 0.5

    def test_sr_breakout_creates_generator(self):
        """Test SR_BREAKOUT creates SRBreakoutSignalGenerator."""
        runner = StrategyRunner(
            strategy_id=2,
            strategy_name="SR Breakout",
            strategy_type="SR_BREAKOUT",
            config={"sl_pct": 0.5, "tp_pct": 2.0, "pivot_type": "fibonacci"},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.sr_breakout_signals import SRBreakoutSignalGenerator
        assert isinstance(runner.signal_generator, SRBreakoutSignalGenerator)
        assert runner.signal_generator.sl_pct == 0.5
        assert runner.signal_generator.tp_pct == 2.0
        assert runner.signal_generator.pivot_type == "fibonacci"

    def test_sr_breakout_defaults(self):
        """Test SR_BREAKOUT uses defaults when config not provided."""
        runner = StrategyRunner(
            strategy_id=2,
            strategy_name="SR Breakout",
            strategy_type="SR_BREAKOUT",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.sr_breakout_signals import SRBreakoutSignalGenerator
        assert isinstance(runner.signal_generator, SRBreakoutSignalGenerator)
        assert runner.signal_generator.sl_pct == 1.5
        assert runner.signal_generator.tp_pct == 2.5
        assert runner.signal_generator.pivot_type == "classic"

    def test_52w_chaser_creates_generator(self):
        """Test 52W_CHASER creates Week52ChaserSignalGenerator."""
        runner = StrategyRunner(
            strategy_id=3,
            strategy_name="52W Chaser",
            strategy_type="52W_CHASER",
            config={"entry_threshold_pct": 5.0},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.week52_chaser_signals import Week52ChaserSignalGenerator
        assert isinstance(runner.signal_generator, Week52ChaserSignalGenerator)
        assert runner.signal_generator.entry_threshold_pct == 5.0

    def test_52w_target_creates_generator(self):
        """Test 52W_TARGET creates Week52TargetSignalGenerator."""
        runner = StrategyRunner(
            strategy_id=4,
            strategy_name="52W Target",
            strategy_type="52W_TARGET",
            config={"trailing_stop_pct": 1.0},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.week52_target_signals import Week52TargetSignalGenerator
        assert isinstance(runner.signal_generator, Week52TargetSignalGenerator)
        assert runner.signal_generator.trailing_stop_pct == 1.0

    def test_ema_cross_creates_generator(self):
        """Test EMA_CROSS creates EMACrossSignalGenerator."""
        runner = StrategyRunner(
            strategy_id=5,
            strategy_name="EMA Cross",
            strategy_type="EMA_CROSS",
            config={"ema_fast_period": 12, "ema_slow_period": 26, "cooldown_bars": 5},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.ema_cross_signals import EMACrossSignalGenerator
        assert isinstance(runner.signal_generator, EMACrossSignalGenerator)
        assert runner.signal_generator.ema_fast_period == 12
        assert runner.signal_generator.ema_slow_period == 26
        assert runner.signal_generator.cooldown_bars == 5
        # sl_pct and tp_pct come from BaseSignalGenerator __init__ via EMACrossSignalGenerator's super
        assert runner.signal_generator.sl_pct == 1.0
        assert runner.signal_generator.tp_pct == 1.5

    def test_unknown_type_fallback_to_orb(self):
        """Test unknown strategy type falls back to ORBSignalGenerator."""
        runner = StrategyRunner(
            strategy_id=6,
            strategy_name="Unknown",
            strategy_type="UNKNOWN_TYPE",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.orb_signals import ORBSignalGenerator
        assert isinstance(runner.signal_generator, ORBSignalGenerator)

    def test_ema_cross_defaults(self):
        """Test EMA_CROSS uses defaults when config not provided."""
        runner = StrategyRunner(
            strategy_id=5,
            strategy_name="EMA Cross",
            strategy_type="EMA_CROSS",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.ema_cross_signals import EMACrossSignalGenerator
        assert isinstance(runner.signal_generator, EMACrossSignalGenerator)
        assert runner.signal_generator.ema_fast_period == 9
        assert runner.signal_generator.ema_slow_period == 21
        assert runner.signal_generator.cooldown_bars == 3
        assert runner.signal_generator.sl_pct == 1.0
        assert runner.signal_generator.tp_pct == 1.5
        assert runner.signal_generator.enable_shorts is False

    def test_52w_chaser_defaults(self):
        """Test 52W_CHASER uses defaults."""
        runner = StrategyRunner(
            strategy_id=3,
            strategy_name="52W Chaser",
            strategy_type="52W_CHASER",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.week52_chaser_signals import Week52ChaserSignalGenerator
        assert isinstance(runner.signal_generator, Week52ChaserSignalGenerator)
        assert runner.signal_generator.sl_pct == 2.0
        assert runner.signal_generator.tp_pct == 3.0
        assert runner.signal_generator.entry_threshold_pct == 3.0
        assert runner.signal_generator.enable_trailing_stop is False
        assert runner.signal_generator.trailing_stop_pct == 2.0
        assert runner.signal_generator.trailing_activation_pct == 3.0
        assert runner.signal_generator.max_holding_days == 30
        assert runner.signal_generator.cooldown_days == 30
        assert runner.signal_generator.enable_filters is False

    def test_52w_target_defaults(self):
        """Test 52W_TARGET uses defaults."""
        runner = StrategyRunner(
            strategy_id=4,
            strategy_name="52W Target",
            strategy_type="52W_TARGET",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
        )
        from trading.week52_target_signals import Week52TargetSignalGenerator
        assert isinstance(runner.signal_generator, Week52TargetSignalGenerator)
        assert runner.signal_generator.sl_pct == 2.0
        assert runner.signal_generator.tp_pct == 0.0
        assert runner.signal_generator.entry_threshold_pct == 2.0
        assert runner.signal_generator.trailing_stop_pct == 2.0
        assert runner.signal_generator.max_holding_days == 15
        assert runner.signal_generator.cooldown_days == 7

    def test_signal_generator_not_created_if_provided(self):
        """If signal_generator is provided, __post_init__ does not create a new one."""
        mock_gen = MagicMock()
        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="Test",
            strategy_type="ORB",
            config={},
            max_positions=5,
            capital_allocation_pct=0.5,
            signal_generator=mock_gen,
        )
        # Should not have created a new one
        assert runner.signal_generator is mock_gen


class TestIntradayAndSwingTypes:
    """Tests for the strategy type constants."""

    def test_intraday_strategy_types(self):
        """Test INTRADAY_STRATEGY_TYPES contains expected types."""
        assert INTRADAY_STRATEGY_TYPES == {"ORB", "SR_BREAKOUT", "EMA_CROSS"}

    def test_swing_strategy_types(self):
        """Test SWING_STRATEGY_TYPES contains expected types."""
        assert SWING_STRATEGY_TYPES == {"52W_CHASER", "52W_TARGET"}


class TestTimestampedConsole:
    """Tests for _TimestampedConsole timestamp prefixing."""
    
    def test_timestamped_console_prepends_timestamp(self):
        """_TimestampedConsole.print should prepend [HH:MM:SS] to output."""
        from trading.runner_core import _TimestampedConsole
        import io
        from rich.console import Console as RichConsole
        
        output = io.StringIO()
        ts_console = _TimestampedConsole(file=output, force_terminal=False)
        ts_console.print("test message")
        
        result = output.getvalue()
        assert "[" in result
        assert "]" in result
        assert "test message" in result
    
    def test_timestamped_console_timestamp_format(self):
        """Timestamp should match HH:MM:SS pattern."""
        from trading.runner_core import _TimestampedConsole
        import io
        import re
        
        output = io.StringIO()
        ts_console = _TimestampedConsole(file=output, force_terminal=False)
        ts_console.print("hello")
        
        ts_match = re.search(r'\[(\d{2}:\d{2}:\d{2})\].*hello', output.getvalue(), re.DOTALL)
        assert ts_match is not None, f"Expected [HH:MM:SS] prefix with message, got: {output.getvalue()}"
