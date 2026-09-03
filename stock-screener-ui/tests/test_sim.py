"""TDD contract for trading/sim.py — Tradovate-style tick-correct fills.

RED phase: these tests define the required behavior. They MUST fail before implementation.
Conventions: NQ tick_size=0.25; buy pays ask, sell receives bid; slippage is adverse.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from trading.sim import SimAccount, MarketOrder, LimitOrder, StopOrder, BracketOrder


def acct(**kw):
    args = {"tick_size": 0.25, "slippage_ticks": 1, "commission": 2.5}
    args.update(kw)
    return SimAccount(**args)


class TestMarketFills:
    def test_buy_pays_ask_plus_slippage(self):
        a = acct()
        a.submit(MarketOrder("BUY", 1))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)
        assert a.position_qty == 1
        assert a.avg_price == pytest.approx(100.50)   # ask + 1 tick
        assert a.realized == pytest.approx(-2.5)      # entry commission only

    def test_sell_receives_bid_minus_slippage(self):
        a = acct()
        a.submit(MarketOrder("SELL", 1))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)
        assert a.position_qty == -1
        assert a.avg_price == pytest.approx(99.75)    # bid - 1 tick

    def test_no_fill_without_ticks(self):
        a = acct()
        a.submit(MarketOrder("BUY", 1))
        assert a.position_qty == 0


class TestLimitOrders:
    def test_limit_rests_until_touched(self):
        a = acct()
        a.submit(LimitOrder("BUY", 1, 99.75))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)      # ask above limit
        assert a.position_qty == 0
        a.on_tick(ts=2000, bid=99.5, ask=99.75)        # ask touches limit
        assert a.position_qty == 1
        assert a.avg_price == pytest.approx(99.75)    # maker fill, no adverse slip

    def test_limit_never_touched_never_fills(self):
        a = acct()
        a.submit(LimitOrder("SELL", 1, 105.0))
        for i in range(5):
            a.on_tick(ts=1000 + i, bid=100.0, ask=100.25)
        assert a.position_qty == 0
        assert len(a.open_orders) == 1


class TestStops:
    def test_stop_triggers_and_slips_adverse(self):
        a = acct()
        a.submit(MarketOrder("BUY", 1))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)      # fill 100.50
        a.submit(StopOrder("SELL", 1, 99.5))
        a.on_tick(ts=2000, bid=100.0, ask=100.25)      # no touch
        assert a.position_qty == 1
        a.on_tick(ts=3000, bid=99.25, ask=99.5)        # touch -> trigger, fill bid - slip
        assert a.position_qty == 0
        # exit 99.00, entry 100.50, 2 commissions: (99.00-100.50) - 5.00 = -6.50
        assert a.realized == pytest.approx(-6.50)


class TestBrackets:
    def test_tp_fill_cancels_sl(self):
        a = acct()
        a.submit(BracketOrder("BUY", 1, sl=95.0, tp=110.0))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)      # market fill 100.50, OCO rests
        assert a.position_qty == 1
        assert len(a.open_orders) == 2
        a.on_tick(ts=2000, bid=110.0, ask=110.5)       # bid >= tp -> TP fills at limit
        assert a.position_qty == 0
        assert len(a.open_orders) == 0                # SL cancelled
        # (110.00-100.50) - 5.00 = +4.50
        assert a.realized == pytest.approx(4.50)

    def test_sl_fill_cancels_tp(self):
        a = acct()
        a.submit(BracketOrder("BUY", 1, sl=95.0, tp=110.0))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)
        a.on_tick(ts=2000, bid=94.0, ask=94.25)        # bid <= sl -> SL fills at bid - slip
        assert a.position_qty == 0
        assert len(a.open_orders) == 0
        # (93.75-100.50) - 5.00 = -11.75
        assert a.realized == pytest.approx(-11.75)


class TestNetting:
    def test_opposite_market_nets_and_realizes(self):
        a = acct()
        a.submit(MarketOrder("BUY", 1))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)      # long 100.50
        a.submit(MarketOrder("SELL", 1))
        a.on_tick(ts=2000, bid=102.0, ask=102.25)      # sell 101.75
        assert a.position_qty == 0
        # (101.75-100.50) - 5.00 = -3.75
        assert a.realized == pytest.approx(-3.75)


class TestBreakeven:
    def test_move_stop_to_breakeven(self):
        a = acct()
        a.submit(BracketOrder("BUY", 1, sl=95.0, tp=130.0))
        a.on_tick(ts=1000, bid=100.0, ask=100.25)      # fill 100.50
        a.move_stop(100.50)                            # BE revision
        a.on_tick(ts=2000, bid=100.0, ask=100.25)      # bid 100.0 <= 100.50 -> BE stop
        assert a.position_qty == 0
        # (99.75-100.50) - 5.00 = -5.75 (stop fills bid - slip, scratch less costs)
        assert a.realized == pytest.approx(-5.75)
