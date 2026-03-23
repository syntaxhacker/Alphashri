import pytest
from datetime import datetime

from trading.ema_cross_signals import EMACrossSignalGenerator
from trading.orb_signals import SignalType


class TestEMACrossSignalGenerator:

    @pytest.fixture
    def gen(self):
        return EMACrossSignalGenerator({})

    def test_calculate_ema_basic(self):
        closes = [10, 11, 12, 11, 13]
        result = EMACrossSignalGenerator.calculate_ema(closes, 3)
        multiplier = 2.0 / 4
        sma_seed = sum(closes[:3]) / 3
        assert len(result) == 3
        assert result[0] == sma_seed
        assert result[1] == 11 * multiplier + sma_seed * (1 - multiplier)
        assert result[2] == 13 * multiplier + result[1] * (1 - multiplier)

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

    @pytest.mark.parametrize("market_data,expected_type,expected_price", [
        (
            {"current_price": 100.0, "ema_fast_prev": 99.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 101.0, "ema_slow_current": 100.0},
            SignalType.LONG_ENTRY, 100.0,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 101.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 99.0, "ema_slow_current": 100.0},
            SignalType.SHORT_ENTRY, 100.0,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 102.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 103.0, "ema_slow_current": 101.0},
            None, None,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 98.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 97.0, "ema_slow_current": 99.0},
            None, None,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 100.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 100.0, "ema_slow_current": 100.0},
            None, None,
        ),
        (
            {"current_price": 100.0, "ema_fast_prev": 100.0, "ema_slow_prev": 100.0,
             "ema_fast_current": 101.0, "ema_slow_current": 100.0},
            SignalType.LONG_ENTRY, 100.0,
        ),
    ], ids=[
        "bullish_crossover", "bearish_crossover",
        "no_crossover_fast_above", "no_crossover_fast_below",
        "equal_no_cross", "bullish_from_equal",
    ])
    def test_check_entry_scenarios(self, gen, market_data, expected_type, expected_price):
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
        assert "EMA21" in signal.notes

    @pytest.mark.parametrize("side,entry,sl,tp,current,hour,minute,expected_type,expected_notes", [
        ("BUY", 100.0, 99.0, 105.0, 98.5, 11, 0, SignalType.LONG_EXIT, "Stop loss hit"),
        ("BUY", 100.0, 99.0, 105.0, 106.0, 11, 0, SignalType.LONG_EXIT, "Take profit hit"),
        ("SELL", 100.0, 101.0, 95.0, 102.0, 11, 0, SignalType.SHORT_EXIT, "Stop loss hit"),
        ("SELL", 100.0, 101.0, 95.0, 94.0, 11, 0, SignalType.SHORT_EXIT, "Take profit hit"),
        ("BUY", 100.0, 99.0, 105.0, 102.0, 11, 0, None, None),
        ("BUY", 100.0, 99.0, 105.0, 102.0, 14, 46, SignalType.LONG_EXIT, "EOD force exit (14:45)"),
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
            assert signal.notes == expected_notes

    def test_strategy_type_attribute(self):
        assert EMACrossSignalGenerator.strategy_type == "EMA_CROSS"
