"""
Unit tests specifically for the ORB Conservative strategy variant.

According to the seed configuration (scripts/seed_qa_data.py), the ORB Conservative
variant uses the following parameters:
- or_minutes: 45
- sl_pct: 0.4
- tp_pct: 1.2
- max_positions: 3

Tests cover:
1. Configuration Tests: Verifying that ORBConfig correctly accepts and stores
   the conservative parameters.
2. Opening Range Timing Tests: Verifying the 45-minute parameter logic ensures
   the OR ends exactly at 10:00 AM (IST) and captures the right highest/lowest prices.
3. Signal Generation & Risk Management: Verifying that simulated bars trigger a
   signal correctly and subsequently close exactly at -0.4% Stop-Loss or +1.2% Take-Profit.
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from backtest.strategies.orb import (
    ORBConfig,
    ORBNautilusStrategy,
    get_ist_time,
)

# --- 1. CONFIGURATION TESTS ---

def _create_mock_instrument_id():
    """Create a mock InstrumentId for testing."""
    mock = MagicMock()
    mock.__str__ = MagicMock(return_value="TEST.SIMULATED")
    return mock

def _create_mock_bar_type():
    """Create a mock BarType for testing."""
    mock = MagicMock()
    mock.__str__ = MagicMock(return_value="TEST.SIMULATED-5-MINUTE-LAST-EXTERNAL")
    return mock

def test_orb_conservative_config():
    """Test: ORBConfig stores the conservative variant parameters correctly."""
    config = ORBConfig(
        instrument_id=_create_mock_instrument_id(),
        bar_type=_create_mock_bar_type(),
        or_minutes=45,
        sl_pct=0.4,
        tp_pct=1.2,
        trade_size=100,
        enable_shorts=False,
    )

    assert config.or_minutes == 45
    assert config.sl_pct == 0.4
    assert config.tp_pct == 1.2
    assert config.enable_shorts is False

# --- 2. OPENING RANGE TIMING TESTS ---

class TestORBNautilusStrategy(ORBNautilusStrategy):
    """Wrapper to allow easy mocking of Cython attributes."""
    
    @property
    def cache(self):
        if not hasattr(self, "_mock_cache"):
            self._mock_cache = MagicMock()
            self._mock_cache.positions_open.return_value = []
        return self._mock_cache
        
    def submit_order(self, order):
        if not hasattr(self, "_mock_submit_order"):
            self._mock_submit_order = MagicMock()
        return self._mock_submit_order(order)
        
    @property
    def order_factory(self):
        if not hasattr(self, "_mock_order_factory"):
            self._mock_order_factory = MagicMock()
        return self._mock_order_factory
        
    def close_all_positions(self, instrument_id):
        if not hasattr(self, "_mock_close_all_positions"):
            self._mock_close_all_positions = MagicMock()
        return self._mock_close_all_positions(instrument_id)

class TestORBConservativeTiming:
    """Tests verify that a 45-minute Opening Range behaves exactly as expected."""
    
    def _create_strategy(self, **kwargs):
        """Create an ORBNautilusStrategy initialized with conservative parameters."""
        config_kwargs = {
            'instrument_id': _create_mock_instrument_id(),
            'bar_type': _create_mock_bar_type(),
            'or_minutes': 45,
            'sl_pct': 0.4,
            'tp_pct': 1.2,
            'trade_size': 100,
            'enable_shorts': False,
        }
        config_kwargs.update(kwargs)
        config = ORBConfig(**config_kwargs)
        strategy = TestORBNautilusStrategy(config=config)
        return strategy

    def _create_mock_bar(self, ts_ns, open_p, high, low, close, volume=1000):
        bar = MagicMock()
        bar.ts_event = ts_ns
        bar.open.__float__ = MagicMock(return_value=float(open_p))
        bar.high.__float__ = MagicMock(return_value=float(high))
        bar.low.__float__ = MagicMock(return_value=float(low))
        bar.close.__float__ = MagicMock(return_value=float(close))
        bar.volume = volume
        return bar

    def _get_ts_ns(self, year, month, day, hour_ist, min_ist):
        """Helper to get a UTC nanosecond timestamp from IST time."""
        dt_ist = datetime(year, month, day, hour_ist, min_ist, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        dt_utc = dt_ist.astimezone(timezone.utc)
        return int(dt_utc.timestamp() * 1_000_000_000)

    def test_conservative_45_min_or_period(self):
        """Test: The strategy should track OR bars until exactly 10:00 IST (45 minutes past 9:15), then define the OR."""
        strategy = self._create_strategy()
        
        # 9:15 IST Bar
        b1_ts = self._get_ts_ns(2024, 1, 15, 9, 15)
        bar1 = self._create_mock_bar(b1_ts, 100.0, 105.0, 99.0, 104.0)
        strategy.on_bar(bar1)
        
        # Check state mid-OR
        assert strategy._or_defined is False
        assert strategy._or_high == 105.0
        assert strategy._or_low == 99.0
        assert strategy._or_bars == 1
        
        # 9:30 IST Bar
        b2_ts = self._get_ts_ns(2024, 1, 15, 9, 30)
        bar2 = self._create_mock_bar(b2_ts, 104.0, 108.0, 103.0, 107.0)
        strategy.on_bar(bar2)
        
        assert strategy._or_defined is False
        assert strategy._or_high == 108.0
        assert strategy._or_low == 99.0
        assert strategy._or_bars == 2
        
        # 9:55 IST Bar (Last bar inside the 45-min window)
        b3_ts = self._get_ts_ns(2024, 1, 15, 9, 55)
        bar3 = self._create_mock_bar(b3_ts, 107.0, 110.0, 106.0, 109.0)
        strategy.on_bar(bar3)
        
        assert strategy._or_defined is False
        assert strategy._or_high == 110.0
        assert strategy._or_low == 99.0
        assert strategy._or_bars == 3
        
        # 10:00 IST Bar (OR is now over, first actionable bar)
        b4_ts = self._get_ts_ns(2024, 1, 15, 10, 0)
        # Price closes at 109.5, still within OR (99.0 to 110.0), no breakout
        bar4 = self._create_mock_bar(b4_ts, 109.0, 109.5, 108.0, 109.5)
        strategy.on_bar(bar4)
        
        assert strategy._or_defined is True
        # OR High/Low shouldn't include the 10:00 bar itself
        assert strategy._or_high == 110.0
        assert strategy._or_low == 99.0
        # No entry signal triggered yet
        assert strategy._entry_price is None

# --- 3. SIGNAL GENERATION & RISK MANAGEMENT TESTS ---

class TestORBConservativeRiskManagement:
    """Tests verify Entry and the exact 0.4% Stop-Loss and 1.2% Take-Profit ratios."""
    
    def _create_strategy(self):
        """Create an ORBNautilusStrategy initialized with conservative parameters."""
        config = ORBConfig(
            instrument_id=_create_mock_instrument_id(),
            bar_type=_create_mock_bar_type(),
            or_minutes=45,
            sl_pct=0.4,
            tp_pct=1.2,
            trade_size=100,
            enable_shorts=False,
            cooldown_bars=0  # Turn off cooldown for easier testing
        )
        strategy = TestORBNautilusStrategy(config=config)
        return strategy

    def _get_ts_ns(self, year, month, day, hour_ist, min_ist):
        dt_ist = datetime(year, month, day, hour_ist, min_ist, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        dt_utc = dt_ist.astimezone(timezone.utc)
        return int(dt_utc.timestamp() * 1_000_000_000)

    def _create_mock_bar(self, ts_ns, open_p, high, low, close, volume=1000):
        bar = MagicMock()
        bar.ts_event = ts_ns
        bar.open.__float__ = MagicMock(return_value=float(open_p))
        bar.high.__float__ = MagicMock(return_value=float(high))
        bar.low.__float__ = MagicMock(return_value=float(low))
        bar.close.__float__ = MagicMock(return_value=float(close))
        bar.volume = volume
        return bar

    def test_conservative_long_entry_and_take_profit(self):
        """Test: Long breakout entry, followed by a +1.2% target exit."""
        strategy = self._create_strategy()
        
        mock_pos = MagicMock()
        mock_pos.quantity = "100"
        strategy._current_date = datetime(2024, 1, 15).date()
        strategy._or_high = 1000.0
        strategy._or_low = 990.0
        strategy._or_bars = 9
        strategy._or_defined = True
        
        # 10:05 IST Bar - Breakout above 1000! Closes at 1002.
        b1_ts = self._get_ts_ns(2024, 1, 15, 10, 5)
        bar1 = self._create_mock_bar(b1_ts, 999.0, 1003.0, 999.0, 1002.0)
        
        strategy.on_bar(bar1)
        
        assert strategy._position_side == "LONG"
        assert strategy._entry_price == 1002.0
        assert hasattr(strategy, "_mock_submit_order")
        
        # Now simulate having a position
        strategy.cache.positions_open.return_value = [mock_pos]
        
        # 10:10 IST Bar - Reaches exactly +1.2% (1002 * 1.012 = 1014.024) - let's go slightly higher
        b2_ts = self._get_ts_ns(2024, 1, 15, 10, 10)
        bar2 = self._create_mock_bar(b2_ts, 1002.0, 1015.0, 1002.0, 1014.5)
        
        strategy.on_bar(bar2)
        
        # The exit function should have been called, cleaning up state
        assert strategy._position_side is None
        assert strategy._entry_price is None
        assert hasattr(strategy, "_mock_close_all_positions")
        
        # Verify it was written to the trades ledger correctly as a TP
        assert len(strategy.trades) == 1
        trade = strategy.trades[0]
        assert trade['exit_reason'] == "TP"
        assert trade['entry_price'] == 1002.0
        assert trade['exit_price'] == 1014.5
        assert trade['gross_pnl_pct'] > 1.2 # Profit percentage is >= 1.2%


    def test_conservative_long_entry_and_stop_loss(self):
        """Test: Long breakout entry, followed by a -0.4% stop loss exit."""
        strategy = self._create_strategy()
        
        mock_pos = MagicMock()
        mock_pos.quantity = "100"
        
        # Pre-seed the Opening Range
        strategy._current_date = datetime(2024, 1, 15).date()
        strategy._or_high = 1000.0
        strategy._or_low = 990.0
        strategy._or_bars = 9
        strategy._or_defined = True
        
        # 10:05 IST Bar - Breakout LONG at 1002.0
        b1_ts = self._get_ts_ns(2024, 1, 15, 10, 5)
        bar1 = self._create_mock_bar(b1_ts, 999.0, 1003.0, 999.0, 1002.0)
        strategy.on_bar(bar1)
        
        # Now simulate having a position
        strategy.cache.positions_open.return_value = [mock_pos]
        
        # 10:10 IST Bar - Reaches exactly -0.4% (1002 * 0.996 = 997.992)
        b2_ts = self._get_ts_ns(2024, 1, 15, 10, 10)
        bar2 = self._create_mock_bar(b2_ts, 1002.0, 1002.0, 995.0, 997.0)
        
        strategy.on_bar(bar2)
        
        # Verify SL was hit and logged
        assert len(strategy.trades) == 1
        trade = strategy.trades[0]
        assert trade['exit_reason'] == "SL"
        assert trade['entry_price'] == 1002.0
        assert trade['exit_price'] == 997.0
        assert trade['gross_pnl_pct'] <= -0.4 # Loss percentage is <= -0.4%
