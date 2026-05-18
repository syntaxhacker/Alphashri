import pytest
from datetime import datetime

from trading.ema_utils import calculate_ema
from trading.ema_cross_signals import EMACrossSignalGenerator
from trading.orb_signals import SignalType


class TestEMACrossSignalGenerator:

    @pytest.fixture
    def gen(self):
        return EMACrossSignalGenerator({})

    def test_calculate_ema_basic(self):
        closes = [10, 11, 12, 11, 13]
        result = calculate_ema(closes, 3, return_full=True)
        assert len(result) == 5
        assert result[0] is None  # First period-1 values are None
        assert result[1] is None
        # EMA_2 = SMA(10, 11, 12) = 11.0
        assert abs(result[2] - 11.0) < 0.01
        # EMA_3 = 11 * 0.5 + 11.0 * 0.5 = 11.0
        assert abs(result[3] - 11.0) < 0.01
        # EMA_4 = 13 * 0.5 + 11.0 * 0.5 = 12.0
        assert abs(result[4] - 12.0) < 0.01

    def test_calculate_ema_insufficient_data(self):
        assert calculate_ema([], 5, return_full=True) == []
        assert calculate_ema([42], 5, return_full=True) == []
        assert calculate_ema([10, 11], 3, return_full=True) == []

    def test_config_defaults(self):
        gen = EMACrossSignalGenerator({})
        assert gen.ema_fast_period == 9
        assert gen.ema_slow_period == 21
        assert gen.sl_pct == 0.5
        assert gen.tp_pct == 1.5

    def test_config_custom_values(self):
        config = {"ema_fast_period": 5, "ema_slow_period": 13, "sl_pct": 1.0, "tp_pct": 2.0}
        gen = EMACrossSignalGenerator(config)
        assert gen.ema_fast_period == 5
        assert gen.ema_slow_period == 13
        assert gen.sl_pct == 1.0
        assert gen.tp_pct == 2.0

    @pytest.mark.parametrize("market_data,expected_type,expected_price,enable_shorts", [
        (
            {"current_price": 100.0, "ema_fast_prev": 99.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 101.0, "ema_slow_current": 100.0},
            SignalType.LONG_ENTRY, 100.0, False,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 101.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 99.0, "ema_slow_current": 100.0},
            SignalType.SHORT_ENTRY, 100.0, True,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 102.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 103.0, "ema_slow_current": 101.0},
            None, None, False,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 98.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 97.0, "ema_slow_current": 99.0},
            None, None, False,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 100.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 100.0, "ema_slow_current": 100.0},
            None, None, False,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 100.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 101.0, "ema_slow_current": 100.0},
            SignalType.LONG_ENTRY, 100.0, False,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 100.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 99.0, "ema_slow_current": 100.0},
            SignalType.SHORT_ENTRY, 100.0, True,
        ),
    ], ids=[
        "bullish_crossover", "bearish_crossover",
        "no_crossover_fast_above", "no_crossover_fast_below",
        "equal_no_cross", "bullish_from_equal", "bearish_from_equal",
    ])
    def test_check_entry_scenarios(self, market_data, expected_type, expected_price, enable_shorts):
        gen = EMACrossSignalGenerator({"enable_shorts": enable_shorts})
        signal = gen.check_entry("RELIANCE", market_data)
        if expected_type is None:
            assert signal is None
        else:
            assert signal is not None
            assert signal.signal_type == expected_type
            assert signal.price == expected_price

    def test_check_entry_missing_data(self, gen):
        assert gen.check_entry("RELIANCE", {}) is None
        assert gen.check_entry("RELIANCE", {"current_price": 100.0}) is None
        assert gen.check_entry("RELIANCE", {"current_price": None}) is None

    def test_check_entry_sl_tp_calculated(self, gen):
        market_data = {
            "current_price": 200.0,
            "ema_fast_prev": 199.0,
            "ema_slow_prev": 200.0,
            "ema_fast_current": 201.0,
            "ema_slow_current": 200.0,
        }
        long_signal = gen.check_entry("RELIANCE", market_data)
        assert long_signal is not None
        assert long_signal.stop_loss == round(200.0 * (1 - 0.5 / 100), 2)
        assert long_signal.take_profit == round(200.0 * (1 + 1.5 / 100), 2)

    def test_check_entry_sl_tp_calculated_shorts(self):
        gen = EMACrossSignalGenerator({"enable_shorts": True})
        market_data_bearish = {
            "current_price": 200.0,
            "ema_fast_prev": 201.0,
            "ema_slow_prev": 200.0,
            "ema_fast_current": 199.0,
            "ema_slow_current": 200.0,
        }
        short_signal = gen.check_entry("RELIANCE", market_data_bearish)
        assert short_signal is not None
        assert short_signal.stop_loss == round(200.0 * (1 + 0.5 / 100), 2)
        assert short_signal.take_profit == round(200.0 * (1 - 1.5 / 100), 2)

    def test_check_entry_notes_contain_periods(self, gen):
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 99.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 101.0,
            "ema_slow_current": 100.0,
        }
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is not None
        assert "EMA9" in signal.notes
        assert "21" in signal.notes
        assert "cross" in signal.notes

    @pytest.mark.parametrize("side,entry,sl,tp,current,hour,minute,expected_type,expected_notes", [
        ("BUY", 100.0, 99.0, 105.0, 98.5, 11, 0, SignalType.LONG_EXIT, "Stop loss hit"),
        ("BUY", 100.0, 99.0, 105.0, 106.0, 11, 0, SignalType.LONG_EXIT, "Take profit hit"),
        ("SELL", 100.0, 101.0, 95.0, 102.0, 11, 0, SignalType.SHORT_EXIT, "Stop loss hit"),
        ("SELL", 100.0, 101.0, 95.0, 94.0, 11, 0, SignalType.SHORT_EXIT, "Take profit hit"),
        ("BUY", 100.0, 99.0, 105.0, 102.0, 11, 0, None, None),
        ("BUY", 100.0, 99.0, 105.0, 102.0, 14, 46, SignalType.LONG_EXIT, "EOD force exit"),
        ("BUY", 100.0, 99.0, 105.0, 102.0, 14, 0, None, None),
    ], ids=[
        "stop_loss_long", "take_profit_long",
        "stop_loss_short", "take_profit_short",
        "no_trigger", "eod_force_exit", "before_eod",
    ])
    def test_check_exit_scenarios(self, gen, side, entry, sl, tp, current, hour, minute, expected_type, expected_notes):
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side=side,
            entry_price=entry,
            stop_loss=sl,
            take_profit=tp,
            current_price=current,
            timestamp=datetime(2025, 1, 1, hour, minute),
        )
        if expected_type is None:
            assert signal is None
        else:
            assert signal is not None
            assert signal.signal_type == expected_type
            assert expected_notes in signal.notes

    def test_check_entry_enable_shorts_false(self):
        """Test that enable_shorts=False (default) prevents bearish signals."""
        gen = EMACrossSignalGenerator({"enable_shorts": False})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 101.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 99.0,
            "ema_slow_current": 100.0,
        }
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is None

    def test_check_entry_enable_shorts_true(self):
        """Test that enable_shorts=True allows bearish signals."""
        gen = EMACrossSignalGenerator({"enable_shorts": True})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 101.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 99.0,
            "ema_slow_current": 100.0,
        }
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_ENTRY

    def test_check_entry_cooldown(self):
        """Test cooldown logic prevents immediate re-entry after exit."""
        gen = EMACrossSignalGenerator({"cooldown_bars": 3})
        gen._bar_number = 10
        gen._last_exit_bar = 9  # Exit just happened

        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 99.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 101.0,
            "ema_slow_current": 100.0,
        }
        # Within cooldown period
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is None

        # After cooldown period
        gen._bar_number = 13
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY

    def test_strategy_type_attribute(self):
        assert EMACrossSignalGenerator.strategy_type == "EMA_CROSS"
