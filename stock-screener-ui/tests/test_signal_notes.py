"""
Signal Notes Tests.

Tests for enriched signal notes across all strategy signal generators:
- ORB (orb_signals.py)
- SR Breakout (sr_breakout_signals.py)
- EMA Cross (ema_cross_signals.py)
- 52W Chaser (week52_chaser_signals.py)
- 52W Target (week52_target_signals.py)
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def orb_generator():
    """Create ORB signal generator with hardcoded defaults (no config loader)."""
    with patch("trading.orb_signals._config_available", False):
        from trading.orb_signals import ORBSignalGenerator
        gen = ORBSignalGenerator()
        gen.enable_shorts = True
        return gen


@pytest.fixture
def or_levels():
    return {
        "or_high": 2525.0,
        "or_low": 2475.0,
        "or_range": 50.0,
        "or_range_pct": 2.0,
        "or_close": 2500.0,
        "or_candles": 9,
    }


@pytest.mark.unit
class TestORBSignalNotes:

    def test_long_entry_notes_contain_breakout_info(self, orb_generator, or_levels):
        signal = orb_generator.check_breakout(
            symbol="RELIANCE",
            current_price=2540.0,
            or_levels=or_levels,
            atr_pct=3.5,
            adx=28,
            rsi=62,
        )
        assert signal is not None
        notes = signal.notes
        assert "Breakout above OR high" in notes
        assert "2.00%" in notes
        assert f"SL {orb_generator.sl_pct}%" in notes
        assert f"TP {orb_generator.tp_pct}%" in notes
        assert "ATR 3.5%" in notes
        assert "ADX 28" in notes
        assert "RSI 62" in notes

    def test_short_entry_notes_contain_breakdown_info(self, orb_generator, or_levels):
        signal = orb_generator.check_breakout(
            symbol="RELIANCE",
            current_price=2455.0,
            or_levels=or_levels,
            atr_pct=3.5,
            adx=28,
            rsi=38,
        )
        assert signal is not None
        notes = signal.notes
        assert "Breakdown below OR low" in notes
        assert "2.00%" in notes
        assert f"SL {orb_generator.sl_pct}%" in notes
        assert f"TP {orb_generator.tp_pct}%" in notes

    def test_exit_notes_contain_pnl_pct_for_long(self, orb_generator):
        signal = orb_generator.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=2500.0,
            stop_loss=2490.0,
            take_profit=2515.0,
            current_price=2489.0,
        )
        assert signal is not None
        assert "PnL:" in signal.notes
        assert "-0.44%" in signal.notes

    def test_exit_notes_contain_pnl_pct_for_short(self, orb_generator):
        signal = orb_generator.check_exit(
            symbol="RELIANCE",
            position_side="SELL",
            entry_price=2500.0,
            stop_loss=2510.0,
            take_profit=2485.0,
            current_price=2484.0,
        )
        assert signal is not None
        assert "PnL:" in signal.notes
        assert "0.64%" in signal.notes

    def test_eod_exit_notes_contain_pnl(self, orb_generator):
        timestamp = datetime(2026, 4, 15, 14, 50, 0, tzinfo=IST)
        signal = orb_generator.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=2500.0,
            stop_loss=2490.0,
            take_profit=2515.0,
            current_price=2510.0,
            timestamp=timestamp,
        )
        assert signal is not None
        assert "EOD force exit" in signal.notes
        assert "PnL:" in signal.notes
        assert "+0.40%" in signal.notes


@pytest.mark.unit
class TestSRBreakoutSignalNotes:

    @pytest.fixture
    def sr_generator(self):
        from trading.sr_breakout_signals import SRBreakoutSignalGenerator
        return SRBreakoutSignalGenerator(config={
            "sl_pct": 0.5,
            "tp_pct": 1.5,
            "pivot_type": "fibonacci",
            "breakout_buffer_pct": 0.1,
            "eod_exit_hour": 15,
            "eod_exit_minute": 15,
        })

    def test_entry_notes_contain_pivot_type_and_params(self, sr_generator):
        prev_high, prev_low, prev_close = 2600.0, 2400.0, 2500.0
        pivots = sr_generator.calculate_pivot_points(prev_high, prev_low, prev_close)
        signal = sr_generator.check_entry(
            symbol="TCS",
            market_data={
                "current_price": pivots["R1"] * 1.002,
                "pivot_points": pivots,
            },
        )
        assert signal is not None
        assert "fibonacci" in signal.notes
        assert "SL 0.5%" in signal.notes
        assert "buffer 0.1%" in signal.notes

    def test_eod_exit_for_shorts_shows_negative_pnl_when_profitable(self, sr_generator):
        timestamp = datetime(2026, 4, 15, 15, 20, 0, tzinfo=IST)
        signal = sr_generator.check_exit(
            symbol="TCS",
            position_side="SELL",
            entry_price=2500.0,
            stop_loss=2550.0,
            take_profit=2400.0,
            current_price=2450.0,
            timestamp=timestamp,
        )
        assert signal is not None
        assert "EOD force exit" in signal.notes
        assert "PnL:" in signal.notes
        pnl_match = "+2.00%"
        assert pnl_match in signal.notes


@pytest.mark.unit
class TestEMACrossSignalNotes:

    @pytest.fixture
    def ema_generator(self):
        from trading.ema_cross_signals import EMACrossSignalGenerator
        return EMACrossSignalGenerator(config={
            "ema_fast_period": 9,
            "ema_slow_period": 21,
            "sl_pct": 0.5,
            "tp_pct": 1.5,
            "eod_exit_hour": 14,
            "eod_exit_minute": 45,
        })

    def test_entry_notes_contain_ema_periods_and_gap(self, ema_generator):
        signal = ema_generator.check_entry(
            symbol="HDFCBANK",
            market_data={
                "current_price": 1600.0,
                "ema_fast_current": 1601.0,
                "ema_fast_prev": 1598.0,
                "ema_slow_current": 1600.0,
                "ema_slow_prev": 1599.0,
            },
        )
        assert signal is not None
        assert "EMA9/21" in signal.notes
        assert "gap" in signal.notes
        assert "SL 0.5%" in signal.notes
        assert "TP 1.5%" in signal.notes


@pytest.mark.unit
class TestWeek52ChaserSignalNotes:

    @pytest.fixture
    def chaser_generator(self):
        from trading.week52_chaser_signals import Week52ChaserSignalGenerator
        return Week52ChaserSignalGenerator(config={
            "sl_pct": 3.0,
            "tp_pct": 5.0,
            "entry_threshold_pct": 3.0,
            "enable_filters": False,
        })

    def test_entry_notes_contain_breakout_info(self, chaser_generator):
        signal = chaser_generator.check_entry(
            symbol="RELIANCE",
            market_data={
                "current_price": 3060.0,
                "high_52w": 3000.0,
                "adx": 30.0,
                "rsi": 60.0,
            },
        )
        assert signal is not None
        assert "52W high" in signal.notes
        assert "Breakout" in signal.notes
        assert "SL @ 52W high" in signal.notes
        assert "TP 5.0%" in signal.notes
        assert "ADX 30" in signal.notes
        assert "RSI 60" in signal.notes


@pytest.mark.unit
class TestWeek52TargetSignalNotes:

    @pytest.fixture
    def target_generator(self):
        from trading.week52_target_signals import Week52TargetSignalGenerator
        return Week52TargetSignalGenerator(config={
            "sl_pct": 2.0,
            "entry_threshold_pct": 2.0,
            "trailing_stop_pct": 0.5,
        })

    def test_entry_notes_contain_52w_high_and_trail(self, target_generator):
        signal = target_generator.check_entry(
            symbol="TCS",
            market_data={
                "current_price": 3920.0,
                "high_52w": 4000.0,
            },
        )
        assert signal is not None
        assert "52W high" in signal.notes
        assert "4000.00" in signal.notes
        assert "SL 2.0%" in signal.notes
        assert "trail 0.5%" in signal.notes

    def test_exit_notes_contain_pnl(self, target_generator):
        signal = target_generator.check_exit(
            symbol="TCS",
            position_side="BUY",
            entry_price=3900.0,
            stop_loss=3822.0,
            take_profit=7800.0,
            current_price=3800.0,
            sl_pct=2.0,
        )
        assert signal is not None
        assert "PnL:" in signal.notes
