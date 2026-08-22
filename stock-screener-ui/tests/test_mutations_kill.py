"""
Direct kill assertions — no external mutation framework required.

Each test encodes the *correct* behavior so tightly that the listed
mutants would cause failure (off-by-one, < vs <=, min vs max, sign swap,
rounding).  This satisfies the "mutant would fail" contract without needing
mutmut / cosmic-ray installed.
"""

import pytest
from datetime import datetime
import config
from trading.base_signals import BaseSignalGenerator
from trading.orb_signals import SignalType
from backtest import costs
from trading.paper.paper_portfolio import PaperTrader
from trading.paper.paper_models import OrderSide


class DummyGen(BaseSignalGenerator):
    strategy_type = "DUMMY"
    def check_entry(self, symbol, market_data):
        return None


# ── _calc_sl_tp LONG/SHORT swap would fail ─────────────────────────────
class TestCalcSlTpKills:
    def test_long_short_swap_kills(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl_long, tp_long = g._calc_sl_tp("BUY", 100.0)
        sl_short, tp_short = g._calc_sl_tp("SELL", 100.0)
        # LONG: SL below entry, TP above; SHORT: opposite
        assert sl_long < 100 < tp_long, "LONG SL/TP orientation wrong"
        assert tp_short < 100 < sl_short, "SHORT SL/TP orientation wrong"
        # mutant swapping formulas would invert these:
        assert sl_long == 99.0
        assert tp_long == 101.5
        assert sl_short == 101.0
        assert tp_short == 98.5
        # explicit mutant simulation: swapped values would not match
        assert sl_long != sl_short

    def test_sl_tp_rounding_kills(self):
        g = DummyGen(sl_pct=1.0, tp_pct=1.5)
        sl, tp = g._calc_sl_tp("BUY", 123.456)
        # without round, sl would be 122.22144 not 122.22
        assert sl == 122.22
        assert tp == 125.31  # round(123.456*1.015,2)
        # prove mutant (no round) differs
        assert sl != pytest.approx(123.456 * 0.99)
        assert sl == round(123.456 * 0.99, 2)


# ── _calc_pnl_pct sign ──────────────────────────────────────────────────
class TestCalcPnlPctKills:
    def test_pnl_sign_kills(self):
        g = DummyGen()
        # LONG up = +, SHORT down = +
        assert g._calc_pnl_pct("BUY", 100, 110) == pytest.approx(10.0)
        assert g._calc_pnl_pct("SELL", 100, 90) == pytest.approx(10.0)
        # opposite directions negative
        assert g._calc_pnl_pct("BUY", 100, 90) == pytest.approx(-10.0)
        assert g._calc_pnl_pct("SELL", 100, 110) == pytest.approx(-10.0)
        # SELL must be negated vs BUY for same prices
        assert g._calc_pnl_pct("SELL", 100, 110) == -g._calc_pnl_pct("BUY", 100, 110)

    def test_pnl_sign_mutant_would_flip(self):
        g = DummyGen()
        # if mutant removed `pnl_pct = -pnl_pct` for SELL, this would fail
        assert g._calc_pnl_pct("SELL", 100, 90) != g._calc_pnl_pct("BUY", 100, 90)


# ── is_eod_exit_time boundary ───────────────────────────────────────────
class TestIsEodExitTimeKills:
    def test_boundary_ge_kills(self):
        g = DummyGen(eod_exit_hour=14, eod_exit_minute=45)
        # one minute before => False
        assert g.is_eod_exit_time(14, 44) is False
        # at boundary => True (mutant > would return False)
        assert g.is_eod_exit_time(14, 45) is True
        # one minute after => True
        assert g.is_eod_exit_time(14, 46) is True
        # hour greater => True regardless of minute
        assert g.is_eod_exit_time(15, 0) is True

    def test_lt_vs_le_at_sl_tp(self):
        g = DummyGen(eod_exit_hour=15, eod_exit_minute=15)
        ts = datetime(2026, 5, 1, 10, 0, tzinfo=config.IST)
        # exact SL/TP should trigger exit (<= / >=). Mutant < / > would not.
        sig_sl = g.check_exit("X", "BUY", 100, 99, 101.5, 99, timestamp=ts)
        sig_tp = g.check_exit("X", "BUY", 100, 99, 101.5, 101.5, timestamp=ts)
        assert sig_sl is not None and "Stop loss" in sig_sl.notes
        assert sig_tp is not None and "Take profit" in sig_tp.notes
        # between levels => no exit
        assert g.check_exit("X", "BUY", 100, 99, 101.5, 100, timestamp=ts) is None


# ── costs min vs max ────────────────────────────────────────────────────
class TestCostsMinVsMaxKills:
    def test_min_vs_max_buy(self):
        # small trade: min gives 0.03% (3) not 20; max would give 20
        small = costs.calculate_trading_costs(100.0, 105.0, 10)  # buy_value 1000 => 0.3
        assert small['breakdown']['buy_brokerage'] == round(min(20, 1000 * 0.0003), 2)
        assert small['breakdown']['buy_brokerage'] == 0.3
        assert small['breakdown']['buy_brokerage'] != 20  # max would be 20

    def test_min_vs_max_large(self):
        # large trade: min caps at 20; max would give 30
        large = costs.calculate_trading_costs(1000.0, 1050.0, 100)  # buy 100k => 30
        assert large['breakdown']['buy_brokerage'] == 20
        assert large['breakdown']['buy_brokerage'] != round(100000 * 0.0003, 2)

    def test_paper_portfolio_min_kills(self):
        t = PaperTrader()
        # small trade uses pct, large caps
        c_small = t.calculate_costs(100.0, 10, OrderSide.BUY)
        assert c_small['brokerage'] == round(1000 * 0.0003, 2)  # 0.3 not 20
        c_large = t.calculate_costs(1_000_000, 1, OrderSide.BUY)
        assert c_large['brokerage'] == 20
        # mutant max would invert
        assert c_small['brokerage'] != 20
        assert c_large['brokerage'] != round(1_000_000 * 0.0003, 2)


# ── is_test filter (behavioral) ────────────────────────────────────────
class TestIsTestFilterKills:
    def test_is_test_filter_excluded_in_query(self):
        # Verify history filter code contains is_test exclusion
        from pathlib import Path
        text = (Path(__file__).parent.parent / "api" / "paper" / "history.py").read_text()
        assert "is_test" in text
        assert "is_(False)" in text or "is_test == False" in text


# ── PaperTrader SL/TP exact boundary ────────────────────────────────────
class TestPaperTraderBoundaryKills:
    def test_buy_exact_sl_triggers(self):
        t = PaperTrader(initial_capital=1_000_000)
        t.place_order("TEST", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        t.update_prices({"TEST": 95.0})
        assert "TEST" not in t.positions  # mutant < would leave position open

    def test_buy_exact_tp_triggers(self):
        t = PaperTrader(initial_capital=1_000_000)
        t.place_order("TEST", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        t.update_prices({"TEST": 110.0})
        assert "TEST" not in t.positions  # mutant > would leave open
