import pytest
from datetime import datetime

from trading.ema_cross_signals import EMACrossSignalGenerator
from trading.orb_signals import SignalType


class TestEMACrossSignalGenerator:

    def test_calculate_ema_basic(self):
        closes = [10, 11, 12, 11, 13]
        result = EMACrossSignalGenerator.calculate_ema(closes, 3)
        multiplier = 2.0 / 4
        assert result[0] == 10
        assert result[1] == 11 * multiplier + 10 * (1 - multiplier)
        assert result[2] == 12 * multiplier + result[1] * (1 - multiplier)
        assert result[3] == 11 * multiplier + result[2] * (1 - multiplier)
        assert result[4] == 13 * multiplier + result[3] * (1 - multiplier)

    def test_calculate_ema_empty_list(self):
        assert EMACrossSignalGenerator.calculate_ema([], 5) == []

    def test_calculate_ema_single_value(self):
        assert EMACrossSignalGenerator.calculate_ema([42], 5) == [42]

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

    def test_check_entry_bullish_crossover(self):
        gen = EMACrossSignalGenerator({})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 99.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 101.0,
            "ema_slow_current": 100.0,
        }
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == 100.0

    def test_check_entry_bearish_crossover(self):
        gen = EMACrossSignalGenerator({})
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
        assert signal.price == 100.0

    def test_check_entry_no_crossover_fast_above(self):
        gen = EMACrossSignalGenerator({})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 102.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 103.0,
            "ema_slow_current": 101.0,
        }
        assert gen.check_entry("RELIANCE", market_data) is None

    def test_check_entry_no_crossover_fast_below(self):
        gen = EMACrossSignalGenerator({})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 98.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 97.0,
            "ema_slow_current": 99.0,
        }
        assert gen.check_entry("RELIANCE", market_data) is None

    def test_check_entry_equal_no_cross(self):
        gen = EMACrossSignalGenerator({})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 100.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 100.0,
            "ema_slow_current": 100.0,
        }
        assert gen.check_entry("RELIANCE", market_data) is None

    def test_check_entry_bullish_from_equal(self):
        gen = EMACrossSignalGenerator({})
        market_data = {
            "current_price": 100.0,
            "ema_fast_prev": 100.0,
            "ema_slow_prev": 100.0,
            "ema_fast_current": 101.0,
            "ema_slow_current": 100.0,
        }
        signal = gen.check_entry("RELIANCE", market_data)
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY

    def test_check_entry_missing_data(self):
        gen = EMACrossSignalGenerator({})
        assert gen.check_entry("RELIANCE", {}) is None
        assert gen.check_entry("RELIANCE", {"current_price": 100.0}) is None
        assert gen.check_entry("RELIANCE", {"current_price": None}) is None

    def test_check_entry_sl_tp_calculated(self):
        gen = EMACrossSignalGenerator({})
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

    def test_check_entry_notes_contain_periods(self):
        gen = EMACrossSignalGenerator({})
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
        assert "EMA21" in signal.notes

    def test_check_exit_stop_loss_long(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=105.0,
            current_price=98.5,
            timestamp=datetime(2025, 1, 1, 11, 0),
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert signal.notes == "Stop loss hit"

    def test_check_exit_take_profit_long(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=105.0,
            current_price=106.0,
            timestamp=datetime(2025, 1, 1, 11, 0),
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert signal.notes == "Take profit hit"

    def test_check_exit_stop_loss_short(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="SELL",
            entry_price=100.0,
            stop_loss=101.0,
            take_profit=95.0,
            current_price=102.0,
            timestamp=datetime(2025, 1, 1, 11, 0),
        )
        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert signal.notes == "Stop loss hit"

    def test_check_exit_take_profit_short(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="SELL",
            entry_price=100.0,
            stop_loss=101.0,
            take_profit=95.0,
            current_price=94.0,
            timestamp=datetime(2025, 1, 1, 11, 0),
        )
        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert signal.notes == "Take profit hit"

    def test_check_exit_no_trigger(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=105.0,
            current_price=102.0,
            timestamp=datetime(2025, 1, 1, 11, 0),
        )
        assert signal is None

    def test_check_exit_eod_force_exit(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=105.0,
            current_price=102.0,
            timestamp=datetime(2025, 1, 1, 14, 46),
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert signal.notes == "EOD force exit (14:45)"

    def test_check_exit_before_eod(self):
        gen = EMACrossSignalGenerator({})
        signal = gen.check_exit(
            symbol="RELIANCE",
            position_side="BUY",
            entry_price=100.0,
            stop_loss=99.0,
            take_profit=105.0,
            current_price=102.0,
            timestamp=datetime(2025, 1, 1, 14, 0),
        )
        assert signal is None

    def test_strategy_type_attribute(self):
        assert EMACrossSignalGenerator.strategy_type == "EMA_CROSS"
