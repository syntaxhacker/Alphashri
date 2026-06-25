import pytest
from datetime import datetime

from trading.sr_breakout_signals import SRBreakoutSignalGenerator
from trading.week52_chaser_signals import Week52ChaserSignalGenerator
from trading.week52_target_signals import Week52TargetSignalGenerator
from trading.orb_signals import SignalType


class TestSRBreakoutSignalGenerator:

    def setup_method(self):
        self.gen = SRBreakoutSignalGenerator(config={})
        self.before_1515 = datetime(2025, 1, 1, 10, 0)

    def test_calculate_pivot_points_classic(self):
        points = self.gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        assert points["PP"] == 90.0
        assert points["R1"] == 100.0
        assert points["S1"] == 80.0
        assert points["R2"] == 110.0
        assert points["S2"] == 70.0
        assert points["R3"] == 120.0
        assert points["S3"] == 60.0
        assert "R4" not in points
        assert "S4" not in points

    def test_calculate_pivot_points_fibonacci(self):
        fib_gen = SRBreakoutSignalGenerator(config={"pivot_type": "fibonacci"})
        points = fib_gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        assert points["PP"] == 90.0
        assert points["R1"] == round(90 + 0.382 * 20, 2)
        assert points["S1"] == round(90 - 0.382 * 20, 2)
        assert points["R2"] == round(90 + 0.618 * 20, 2)
        assert points["S2"] == round(90 - 0.618 * 20, 2)
        assert points["R3"] == 110.0
        assert points["S3"] == 70.0

    def test_calculate_pivot_points_camarilla(self):
        cam_gen = SRBreakoutSignalGenerator(config={"pivot_type": "camarilla"})
        points = cam_gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        assert points["PP"] == 90.0
        # Correct Camarilla formula from pivot_utils.py: close +/- hl * 1.1/N
        hl = 100 - 80  # 20
        r1 = 90 + hl * 1.1 / 12  # 91.83333...
        r2 = 90 + hl * 1.1 / 6   # 93.66666...
        r3 = 90 + hl * 1.1 / 4   # 95.5
        r4 = 90 + hl * 1.1 / 2   # 101.0
        s1 = 90 - hl * 1.1 / 12  # 88.16666...
        s2 = 90 - hl * 1.1 / 6   # 86.33333...
        s3 = 90 - hl * 1.1 / 4   # 84.5
        s4 = 90 - hl * 1.1 / 2   # 79.0
        assert points["R1"] == round(r1, 2)
        assert points["R2"] == round(r2, 2)
        assert points["R3"] == round(r3, 2)
        assert points["R4"] == round(r4, 2)
        assert points["S1"] == round(s1, 2)
        assert points["S2"] == round(s2, 2)
        assert points["S3"] == round(s3, 2)
        assert points["S4"] == round(s4, 2)

    def test_calculate_pivot_points_unknown_type_falls_back_to_classic(self):
        unknown_gen = SRBreakoutSignalGenerator(config={"pivot_type": "woodie"})
        points = unknown_gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        assert points["PP"] == 90.0
        assert points["R1"] == 100.0
        assert points["S1"] == 80.0
        assert points["R2"] == 110.0
        assert points["S3"] == 60.0
        assert "R4" not in points

    def test_check_entry_long_breakout_above_r1(self):
        pivots = self.gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        r1 = pivots["R1"]
        r2 = pivots["R2"]
        price = r1 * (1 + self.gen.breakout_buffer_pct / 100) + 1
        signal = self.gen.check_entry("TEST", {"current_price": price, "pivot_points": pivots})
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == price
        assert signal.stop_loss == round(price * (1 - self.gen.sl_pct / 100), 2)
        assert signal.take_profit == round(r2, 2)

    def test_check_entry_short_breakdown_below_s1(self):
        pivots = self.gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        s1 = pivots["S1"]
        s2 = pivots["S2"]
        price = s1 * (1 - self.gen.breakout_buffer_pct / 100) - 1
        signal = self.gen.check_entry("TEST", {"current_price": price, "pivot_points": pivots})
        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_ENTRY
        assert signal.price == price
        assert signal.stop_loss == round(price * (1 + self.gen.sl_pct / 100), 2)
        assert signal.take_profit == round(s2, 2)

    def test_check_entry_no_signal_within_range(self):
        pivots = self.gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        signal = self.gen.check_entry("TEST", {"current_price": 90, "pivot_points": pivots})
        assert signal is None

    def test_check_entry_no_signal_exactly_at_r1(self):
        pivots = self.gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        r1 = pivots["R1"]
        signal = self.gen.check_entry("TEST", {"current_price": r1, "pivot_points": pivots})
        assert signal is None

    def test_check_entry_no_signal_with_buffer_not_exceeded(self):
        """Price above R1 but within buffer should NOT trigger entry."""
        gen = SRBreakoutSignalGenerator(config={"breakout_buffer_pct": 0.5})
        pivots = gen.calculate_pivot_points(prev_high=100, prev_low=80, prev_close=90)
        r1 = pivots["R1"]
        buf = gen.breakout_buffer_pct / 100
        price_between_r1_and_buffer = r1 * (1 + buf * 0.5)
        signal = gen.check_entry("TEST", {
            "current_price": price_between_r1_and_buffer, "pivot_points": pivots,
        })
        assert signal is None, "Should not trigger when price is within buffer"

    def test_check_entry_missing_data(self):
        assert self.gen.check_entry("TEST", {}) is None
        assert self.gen.check_entry("TEST", {"current_price": 100}) is None
        assert self.gen.check_entry("TEST", {"pivot_points": {"R1": 100, "S1": 80}}) is None

    def test_check_exit_stop_loss_hit(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=99.5,
            take_profit=101.5, current_price=99.0, timestamp=self.before_1515,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "Stop loss hit" in signal.notes

    def test_check_exit_take_profit_hit(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=99.5,
            take_profit=101.5, current_price=102.0, timestamp=self.before_1515,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "Take profit hit" in signal.notes

    def test_check_exit_short_sl(self):
        signal = self.gen.check_exit(
            "TEST", "SELL", entry_price=100, stop_loss=100.5,
            take_profit=98.5, current_price=101.0, timestamp=self.before_1515,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert "Stop loss hit" in signal.notes

    def test_check_exit_short_tp(self):
        signal = self.gen.check_exit(
            "TEST", "SELL", entry_price=100, stop_loss=100.5,
            take_profit=98.5, current_price=98.0, timestamp=self.before_1515,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.SHORT_EXIT
        assert "Take profit hit" in signal.notes

    def test_check_exit_no_trigger(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=99.0,
            take_profit=101.0, current_price=100.0, timestamp=self.before_1515,
        )
        assert signal is None

    def test_config_defaults(self):
        gen = SRBreakoutSignalGenerator(config={})
        assert gen.sl_pct == 1.5
        assert gen.tp_pct == 2.5
        assert gen.pivot_type == "classic"
        assert gen.breakout_buffer_pct == 1.0

    def test_config_custom_values(self):
        gen = SRBreakoutSignalGenerator(config={
            "sl_pct": 1.0, "tp_pct": 2.0,
            "pivot_type": "fibonacci", "breakout_buffer_pct": 0.5,
        })
        assert gen.sl_pct == 1.0
        assert gen.tp_pct == 2.0
        assert gen.pivot_type == "fibonacci"
        assert gen.breakout_buffer_pct == 0.5


class TestWeek52ChaserSignalGenerator:

    def setup_method(self):
        self.gen = Week52ChaserSignalGenerator(config={})

    def test_check_entry_breakout_above_52w_high(self):
        price = 510.0
        signal = self.gen.check_entry("TEST", {"current_price": price, "high_52w": 500.0, "avg_volume_20d": 100000})
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == price
        assert signal.stop_loss == 500.0  # SL at 52W high
        assert signal.take_profit == round(price * (1 + self.gen.tp_pct / 100), 2)

    def test_check_entry_exactly_at_52w_high_rejected(self):
        signal = self.gen.check_entry("TEST", {"current_price": 500.0, "high_52w": 500.0})
        assert signal is None

    def test_check_entry_below_52w_high_rejected(self):
        signal = self.gen.check_entry("TEST", {"current_price": 490.0, "high_52w": 500.0})
        assert signal is None

    def test_check_entry_too_far_above_52w_high(self):
        signal = self.gen.check_entry("TEST", {"current_price": 520.0, "high_52w": 500.0})
        assert signal is None

    def test_check_entry_with_filters_all_pass(self):
        gen = Week52ChaserSignalGenerator(config={"enable_filters": True})
        signal = gen.check_entry("TEST", {
            "current_price": 510.0,
            "high_52w": 500.0,
            "adx": 30.0,
            "rsi": 60.0,
            "volume": 300000,
            "avg_volume_20d": 100000,
            "ma50": 480.0,
            "ma200": 470.0,
        })
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY

    def test_check_entry_with_filters_adx_fail(self):
        gen = Week52ChaserSignalGenerator(config={"enable_filters": True})
        signal = gen.check_entry("TEST", {
            "current_price": 510.0, "high_52w": 500.0, "adx": 20.0,
        })
        assert signal is None

    def test_check_entry_with_filters_rsi_fail(self):
        gen = Week52ChaserSignalGenerator(config={"enable_filters": True})
        signal = gen.check_entry("TEST", {
            "current_price": 510.0, "high_52w": 500.0, "rsi": 40.0,
        })
        assert signal is None

    def test_check_entry_with_filters_rsi_overbought(self):
        gen = Week52ChaserSignalGenerator(config={"enable_filters": True})
        signal = gen.check_entry("TEST", {
            "current_price": 510.0, "high_52w": 500.0, "rsi": 75.0,
        })
        assert signal is None

    def test_check_entry_with_filters_volume_fail(self):
        gen = Week52ChaserSignalGenerator(config={"enable_filters": True})
        signal = gen.check_entry("TEST", {
            "current_price": 510.0, "high_52w": 500.0,
            "volume": 100, "avg_volume_20d": 100,
        })
        assert signal is None

    def test_check_entry_with_filters_ma50_fail(self):
        gen = Week52ChaserSignalGenerator(config={"enable_filters": True})
        signal = gen.check_entry("TEST", {
            "current_price": 510.0, "high_52w": 500.0, "ma50": 520.0,
        })
        assert signal is None

    def test_check_entry_filters_disabled_by_default(self):
        signal = self.gen.check_entry("TEST", {
            "current_price": 510.0, "high_52w": 500.0,
            "adx": 10.0, "rsi": 30.0, "volume": 10, "avg_volume_20d": 100000,
        })
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY

    def test_check_exit_stop_loss(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=96,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "SL" in signal.notes

    def test_check_exit_take_profit(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=106,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "TP" in signal.notes

    def test_check_exit_trailing_stop_activation_and_exit(self):
        highest = 107.0
        trailing_stop_price = highest * (1 - 3.0 / 100)
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=trailing_stop_price - 1,
            enable_trailing_stop=True, trailing_active=True,
            highest_price_since_entry=highest, trailing_stop_pct=3.0,
            entry_52w_high=105.0,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "TRAILING_STOP" in signal.notes

    def test_check_exit_trailing_stop_activates_on_52w_cross(self):
        """Trailing stop should activate when price crosses entry_52w_high,
        then trigger exit when price drops below trailing stop price."""
        entry_52w_high = 105.0
        highest = 110.0
        trailing_stop_pct = 3.0
        # Price above 52W high should activate trailing, then drop below triggers exit
        trailing_stop_price = highest * (1 - trailing_stop_pct / 100)
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=95,
            take_profit=999, current_price=trailing_stop_price - 1,
            enable_trailing_stop=True, trailing_active=False,
            entry_52w_high=entry_52w_high,
            highest_price_since_entry=highest,
            trailing_stop_pct=trailing_stop_pct,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "TRAILING_STOP" in signal.notes
        # Verify TP was NOT triggered (current_price is below take_profit, so trailing is the reason)
        assert "TP" not in signal.notes

    def test_check_exit_trailing_stop_not_active(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=100,
            enable_trailing_stop=True, trailing_active=False,
            entry_52w_high=105.0,
        )
        assert signal is None

    def test_check_exit_max_holding(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=100,
            days_in_position=30, max_holding_days=30,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "MAX_HOLDING" in signal.notes

    def test_check_exit_new_52w_high_momentum_fade(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=100,
            entry_52w_high=100.0, current_52w_high=111.0,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "NEW_52W_HIGH" in signal.notes

    def test_check_exit_no_trigger(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=97,
            take_profit=105, current_price=100,
        )
        assert signal is None

    def test_check_exit_short_position_ignored(self):
        signal = self.gen.check_exit(
            "TEST", "SELL", entry_price=100, stop_loss=103,
            take_profit=95, current_price=96,
        )
        assert signal is None

    def test_config_defaults(self):
        gen = Week52ChaserSignalGenerator(config={})
        assert gen.sl_pct == 2.0
        assert gen.tp_pct == 3.0
        assert gen.entry_threshold_pct == 3.0
        assert gen.min_breakout_pct == 0.5
        assert gen.enable_trailing_stop is False
        assert gen.trailing_stop_pct == 2.0
        assert gen.trailing_activation_pct == 3.0
        assert gen.max_holding_days == 30
        assert gen.cooldown_days == 30
        assert gen.enable_filters is False


class TestWeek52TargetSignalGenerator:

    def setup_method(self):
        self.gen = Week52TargetSignalGenerator(config={})

    def test_check_entry_within_threshold(self):
        signal = self.gen.check_entry("TEST", {"current_price": 495.0, "high_52w": 500.0, "days_since_52w_high": 99, "avg_volume_20d": 100000})
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY
        assert signal.price == 495.0

    def test_check_entry_below_threshold(self):
        signal = self.gen.check_entry("TEST", {"current_price": 480.0, "high_52w": 500.0})
        assert signal is None

    def test_check_entry_fallback_to_daily_highs(self):
        daily_highs = [400.0] * 200 + [500.0]
        signal = self.gen.check_entry("TEST", {
            "current_price": 495.0, "daily_highs": daily_highs, "days_since_52w_high": 99, "avg_volume_20d": 100000,
        })
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_ENTRY

    def test_check_entry_above_52w_high_rejected(self):
        signal = self.gen.check_entry("TEST", {"current_price": 510.0, "high_52w": 500.0})
        assert signal is None

    def test_check_entry_missing_data(self):
        assert self.gen.check_entry("TEST", {}) is None
        assert self.gen.check_entry("TEST", {"current_price": 100.0}) is None
        assert self.gen.check_entry("TEST", {"high_52w": 500.0}) is None

    def test_check_entry_no_tp(self):
        """52W Target has no take profit — trailing stop manages exits."""
        signal = self.gen.check_entry("TEST", {"current_price": 495.0, "high_52w": 500.0, "days_since_52w_high": 99, "avg_volume_20d": 100000})
        assert signal is not None
        assert signal.take_profit == 0.0

    def test_check_entry_recent_touch_rejected(self):
        """Skip entry if 52W high was touched within recent_touch_days."""
        signal = self.gen.check_entry("TEST", {"current_price": 495.0, "high_52w": 500.0, "days_since_52w_high": 2})
        assert signal is None

    def test_check_exit_stop_loss_always_active(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=98,
            take_profit=1000, current_price=97,
            entry_52w_high=95.0, highest_price_since_entry=105.0,
            trailing_stop_pct=0.5,
            near_high_activation_pct=1.0,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "SL" in signal.notes

    def test_check_exit_trailing_stop_after_52w_cross(self):
        entry_52w_high = 100.0
        highest = 105.0
        trailing_stop_price = highest * (1 - 0.5 / 100)
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=98,
            take_profit=1000, current_price=trailing_stop_price - 0.5,
            entry_52w_high=entry_52w_high,
            highest_price_since_entry=highest,
            trailing_stop_pct=0.5,
            near_high_activation_pct=1.0,
            near_high_trail_pct=0.5,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "TRAILING_STOP" in signal.notes

    def test_check_exit_trailing_stop_not_active_far_below_52w(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=98,
            take_profit=1000, current_price=103.0,
            entry_52w_high=105.0,
            highest_price_since_entry=104.0,
            trailing_stop_pct=0.5,
            near_high_activation_pct=1.0,
        )
        assert signal is None

    def test_check_exit_trailing_stop_activates_near_52w_high(self):
        entry_52w_high = 100.0
        highest = 99.5
        near_high_trail_pct = 0.5
        near_high_activation_pct = 1.0
        trail_price = highest * (1 - near_high_trail_pct / 100)
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=98, stop_loss=95,
            take_profit=1000, current_price=trail_price,
            entry_52w_high=entry_52w_high,
            highest_price_since_entry=highest,
            trailing_stop_pct=2.0,
            near_high_activation_pct=near_high_activation_pct,
            near_high_trail_pct=near_high_trail_pct,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "TRAILING_STOP" in signal.notes

    def test_check_exit_above_52w_uses_wider_trail(self):
        entry_52w_high = 100.0
        highest = 103.0
        near_high_trail_pct = 0.5
        wider_trail_pct = 2.0
        near_high_activation_pct = 1.0
        # Above 52W high, so wider trail applies: 103 * 0.98 = 100.94
        # A 1% drop from 103 = 101.97, still above 100.94 → no exit
        signal_no_exit = self.gen.check_exit(
            "TEST", "BUY", entry_price=98, stop_loss=95,
            take_profit=1000, current_price=101.97,
            entry_52w_high=entry_52w_high,
            highest_price_since_entry=highest,
            trailing_stop_pct=wider_trail_pct,
            near_high_activation_pct=near_high_activation_pct,
            near_high_trail_pct=near_high_trail_pct,
        )
        assert signal_no_exit is None
        # A drop all the way to trail trigger: 103 * 0.98 = 100.94
        signal_exit = self.gen.check_exit(
            "TEST", "BUY", entry_price=98, stop_loss=95,
            take_profit=1000, current_price=100.94,
            entry_52w_high=entry_52w_high,
            highest_price_since_entry=highest,
            trailing_stop_pct=wider_trail_pct,
            near_high_activation_pct=near_high_activation_pct,
            near_high_trail_pct=near_high_trail_pct,
        )
        assert signal_exit is not None
        assert signal_exit.signal_type == SignalType.LONG_EXIT
        assert "TRAILING_STOP" in signal_exit.notes

    def test_check_exit_max_holding(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=98,
            take_profit=1000, current_price=100.0,
            days_in_position=15,
        )
        assert signal is not None
        assert signal.signal_type == SignalType.LONG_EXIT
        assert "MAX_HOLDING" in signal.notes

    def test_check_exit_no_trigger(self):
        signal = self.gen.check_exit(
            "TEST", "BUY", entry_price=100, stop_loss=98,
            take_profit=1000, current_price=100.0,
        )
        assert signal is None

    def test_check_exit_short_ignored(self):
        signal = self.gen.check_exit(
            "TEST", "SELL", entry_price=100, stop_loss=102,
            take_profit=98, current_price=97,
        )
        assert signal is None

    def test_config_defaults(self):
        gen = Week52TargetSignalGenerator(config={})
        assert gen.sl_pct == 2.0
        assert gen.tp_pct == 0.0
        assert gen.entry_threshold_pct == 2.0
        assert gen.trailing_stop_pct == 2.0
        assert gen.near_high_activation_pct == 1.0
        assert gen.near_high_trail_pct == 0.5
        assert gen.max_holding_days == 15
        assert gen.cooldown_days == 7
        assert gen.recent_touch_days == 5
