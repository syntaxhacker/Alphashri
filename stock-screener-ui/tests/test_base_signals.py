"""
Unit tests for trading/base_signals.py BaseSignalGenerator.

Covers:
- _calc_sl_tp LONG/SHORT with overrides, tp=0, rounding
- _safe_float with None/missing/invalid
- _calc_pnl_pct LONG/SHORT, div0 guard
- _format_exit_note formatting
- is_eod_exit_time boundaries
- check_exit with EOD, SL, TP, no exit using IST timestamp kwarg
- Base52WSignalGenerator.is_eod_exit_time always False
"""
import pytest
from datetime import datetime
import config
from trading.base_signals import BaseSignalGenerator
from trading.week52_utils import Base52WSignalGenerator
from trading.orb_signals import SignalType


class DummyGen(BaseSignalGenerator):
    strategy_type = "DUMMY"

    def check_entry(self, symbol, market_data):
        return None


class TestCalcSlTp:
    def test_long_default(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("BUY", 100.0)
        assert sl == 99.0
        assert tp == 101.5

    def test_short_default(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("SELL", 100.0)
        assert sl == 101.0
        assert tp == 98.5

    def test_long_overrides(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("LONG", 200.0, sl_pct=2.0, tp_pct=3.0)
        assert sl == 196.0  # 200*(1-0.02)
        assert tp == 206.0  # 200*(1+0.03)

    def test_short_overrides(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("SHORT", 200.0, sl_pct=2.0, tp_pct=3.0)
        assert sl == 204.0
        assert tp == 194.0

    def test_tp_zero_returns_zero(self):
        g = DummyGen(sl_pct=1.0, tp_pct=0)
        sl, tp = g._calc_sl_tp("BUY", 100.0)
        assert tp == 0
        sl2, tp2 = g._calc_sl_tp("SELL", 100.0)
        assert tp2 == 0

    def test_tp_zero_override(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("BUY", 100.0, tp_pct=0)
        assert tp == 0

    def test_rounding(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("BUY", 123.456)
        assert sl == round(123.456 * 0.99, 2)
        assert tp == round(123.456 * 1.015, 2)

    def test_case_insensitive_side(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl_buy, _ = g._calc_sl_tp("buy", 100.0)
        sl_long, _ = g._calc_sl_tp("long", 100.0)
        sl_sell, _ = g._calc_sl_tp("sell", 100.0)
        sl_short, _ = g._calc_sl_tp("short", 100.0)
        assert sl_buy == 99.0
        assert sl_long == 99.0
        assert sl_sell == 101.0
        assert sl_short == 101.0

    def test_zero_entry_price(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("BUY", 0.0)
        assert sl == 0.0
        assert tp == 0.0


class TestSafeFloat:
    def test_valid_float(self):
        assert DummyGen._safe_float({"x": 1.23}, "x") == 1.23

    def test_int_value(self):
        assert DummyGen._safe_float({"x": 5}, "x") == 5.0

    def test_string_numeric(self):
        assert DummyGen._safe_float({"x": "3.14"}, "x") == pytest.approx(3.14)

    def test_none_returns_default(self):
        assert DummyGen._safe_float({"x": None}, "x", default=0.0) == 0.0
        assert DummyGen._safe_float({"x": None}, "x", default=5.5) == 5.5

    def test_missing_key_returns_default(self):
        assert DummyGen._safe_float({}, "missing", default=2.5) == 2.5
        assert DummyGen._safe_float({}, "missing") == 0.0

    def test_invalid_string_raises(self):
        with pytest.raises((ValueError, TypeError)):
            DummyGen._safe_float({"x": "not_a_number"}, "x")

    def test_zero_value(self):
        assert DummyGen._safe_float({"x": 0}, "x") == 0.0

    def test_negative(self):
        assert DummyGen._safe_float({"x": -1.5}, "x") == -1.5


class TestCalcPnlPct:
    def test_long_positive(self):
        g = DummyGen()
        assert g._calc_pnl_pct("BUY", 100, 110) == pytest.approx(10.0)

    def test_long_negative(self):
        g = DummyGen()
        assert g._calc_pnl_pct("BUY", 100, 90) == pytest.approx(-10.0)

    def test_short_positive_when_price_down(self):
        g = DummyGen()
        assert g._calc_pnl_pct("SELL", 100, 90) == pytest.approx(10.0)

    def test_short_negative_when_price_up(self):
        g = DummyGen()
        assert g._calc_pnl_pct("SELL", 100, 110) == pytest.approx(-10.0)

    def test_div0_guard_entry_zero(self):
        g = DummyGen()
        assert g._calc_pnl_pct("BUY", 0, 110) == 0.0
        assert g._calc_pnl_pct("SELL", 0, 110) == 0.0

    def test_div0_guard_none_entry(self):
        g = DummyGen()
        assert g._calc_pnl_pct("BUY", None, 110) == 0.0  # type: ignore

    def test_small_entry(self):
        g = DummyGen()
        assert g._calc_pnl_pct("BUY", 0.01, 0.02) == pytest.approx(100.0)


class TestFormatExitNote:
    def test_positive_pnl(self):
        assert DummyGen._format_exit_note("Stop loss hit ₹99.00", 1.23) == "Stop loss hit ₹99.00 (PnL: +1.23%)"

    def test_negative_pnl(self):
        assert DummyGen._format_exit_note("TP", -2.5) == "TP (PnL: -2.50%)"

    def test_zero_pnl(self):
        assert DummyGen._format_exit_note("EOD", 0) == "EOD (PnL: +0.00%)"

    def test_rounding(self):
        assert DummyGen._format_exit_note("reason", 1.23456) == "reason (PnL: +1.23%)"


class TestIsEodExitTime:
    def test_before_eod(self):
        g = DummyGen(eod_exit_hour=14, eod_exit_minute=45)
        assert g.is_eod_exit_time(14, 44) is False
        assert g.is_eod_exit_time(13, 59) is False
        assert g.is_eod_exit_time(9, 15) is False

    def test_at_eod(self):
        g = DummyGen(eod_exit_hour=14, eod_exit_minute=45)
        assert g.is_eod_exit_time(14, 45) is True

    def test_after_eod(self):
        g = DummyGen(eod_exit_hour=14, eod_exit_minute=45)
        assert g.is_eod_exit_time(14, 46) is True
        assert g.is_eod_exit_time(15, 0) is True
        assert g.is_eod_exit_time(15, 30) is True

    def test_hour_greater(self):
        g = DummyGen(eod_exit_hour=15, eod_exit_minute=15)
        assert g.is_eod_exit_time(15, 15) is True
        assert g.is_eod_exit_time(16, 0) is True
        assert g.is_eod_exit_time(15, 14) is False
        assert g.is_eod_exit_time(14, 59) is False

    def test_midnight_boundary(self):
        g = DummyGen(eod_exit_hour=0, eod_exit_minute=0)
        assert g.is_eod_exit_time(0, 0) is True
        assert g.is_eod_exit_time(23, 59) is True


class TestGetCurrentTime:
    def test_timestamp_kwarg(self):
        g = DummyGen()
        ts = datetime(2026, 5, 1, 10, 30, tzinfo=config.IST)
        h, m = g._get_current_time(timestamp=ts)
        assert h == 10
        assert m == 30

    def test_invalid_timestamp_falls_back(self):
        g = DummyGen()
        h, m = g._get_current_time(timestamp="not-a-datetime")  # type: ignore
        # should not crash, returns some hour/minute ints
        assert isinstance(h, int)
        assert isinstance(m, int)


class TestCheckExit:
    def _gen(self):
        return DummyGen(sl_pct=1.0, tp_pct=1.5, eod_exit_hour=15, eod_exit_minute=15)

    def test_eod_exit_long(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 15, 30, tzinfo=config.IST)  # after 15:15
        sig = g.check_exit("RELIANCE", "BUY", 100, 99, 101.5, 102, timestamp=ts)
        assert sig is not None
        assert sig.signal_type == SignalType.LONG_EXIT
        assert "EOD" in sig.notes

    def test_eod_exit_short(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 15, 15, tzinfo=config.IST)  # exactly at EOD
        sig = g.check_exit("RELIANCE", "SELL", 100, 101, 98.5, 99, timestamp=ts)
        assert sig is not None
        assert sig.signal_type == SignalType.SHORT_EXIT

    def test_eod_boundary_before(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 15, 14, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "BUY", 100, 99, 101.5, 50, timestamp=ts)
        # price 50 below SL, should trigger SL not EOD
        assert sig is not None
        assert "Stop loss" in sig.notes

    def test_sl_hit_long(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "BUY", 100, 99, 101.5, 98.5, timestamp=ts)
        assert sig is not None
        assert sig.signal_type == SignalType.LONG_EXIT
        assert "Stop loss" in sig.notes

    def test_tp_hit_long(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "BUY", 100, 99, 101.5, 102, timestamp=ts)
        assert sig is not None
        assert "Take profit" in sig.notes

    def test_sl_hit_short(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "SELL", 100, 101, 98.5, 102, timestamp=ts)
        assert sig is not None
        assert sig.signal_type == SignalType.SHORT_EXIT
        assert "Stop loss" in sig.notes

    def test_tp_hit_short(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "SELL", 100, 101, 98.5, 98, timestamp=ts)
        assert sig is not None
        assert sig.signal_type == SignalType.SHORT_EXIT
        assert "Take profit" in sig.notes

    def test_no_exit(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "BUY", 100, 99, 101.5, 100.2, timestamp=ts)
        assert sig is None

    def test_no_exit_short_between_levels(self):
        g = self._gen()
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        sig = g.check_exit("RELIANCE", "SELL", 100, 101, 98.5, 99.5, timestamp=ts)
        assert sig is None

    def test_istes_timestamp_used_not_mocker(self):
        """Ensure check_exit respects passed IST timestamp kwarg."""
        g = DummyGen(eod_exit_hour=14, eod_exit_minute=45)
        before = datetime(2026, 5, 1, 14, 44, tzinfo=config.IST)
        at = datetime(2026, 5, 1, 14, 45, tzinfo=config.IST)
        assert g.check_exit("X", "BUY", 100, 99, 101, 100, timestamp=before) is None
        sig = g.check_exit("X", "BUY", 100, 99, 101, 100, timestamp=at)
        assert sig is not None and "EOD" in sig.notes


class DummySwingGen(Base52WSignalGenerator):
    strategy_type = "DUMMY_SWING"
    def check_entry(self, symbol, market_data):
        return None


class TestBase52WIsEod:
    def test_always_false(self):
        g = DummySwingGen(sl_pct=1.0, tp_pct=1.5)
        assert g.is_eod_exit_time(9, 15) is False
        assert g.is_eod_exit_time(14, 45) is False
        assert g.is_eod_exit_time(15, 15) is False
        assert g.is_eod_exit_time(23, 59) is False
        assert g.is_eod_exit_time(0, 0) is False

    def test_extract_exit_kwargs_defaults(self):
        g = DummySwingGen(sl_pct=2.0, tp_pct=3.0)
        # set attribute for fallback
        g.max_holding_days = 30  # type: ignore
        ek = g._extract_exit_kwargs({}, 100.0)
        assert ek["days_in_position"] == 0
        assert ek["max_holding_days"] == 30
        assert ek["highest_price_since_entry"] == 100.0
        assert ek["entry_52w_high"] is None

    def test_extract_exit_kwargs_overrides(self):
        g = DummySwingGen(sl_pct=1.0, tp_pct=1.5)
        ek = g._extract_exit_kwargs(
            {"days_in_position": 5, "max_holding_days": 10, "highest_price_since_entry": 150, "entry_52w_high": 120, "trailing_stop_pct": 3.0},
            100.0,
        )
        assert ek["days_in_position"] == 5
        assert ek["max_holding_days"] == 10
        assert ek["highest_price_since_entry"] == 150
        assert ek["entry_52w_high"] == 120
        assert ek["trailing_stop_pct"] == 3.0

    def test_create_signal_has_ist_timestamp(self):
        g = DummyGen()
        sig = g.create_signal(symbol="A", signal_type=SignalType.LONG_ENTRY, price=100, stop_loss=99, take_profit=101)
        assert sig.timestamp.tzinfo is not None
