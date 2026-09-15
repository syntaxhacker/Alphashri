"""Tests for the order-flow signal engine (api/orderflow_signals.py)."""

import datetime

import config
from api.orderflow_signals import OrderFlowSignalEngine


def make_tick(ts_sec, ltp, volume, bid, ask, tbq, tsq, vwap, q=1000):
    return {
        "ltp": ltp,
        "volume": volume,
        "ltt": int(ts_sec * 1000),
        "vwap": vwap,
        "tbq": tbq,
        "tsq": tsq,
        "depth": {
            "buy": [{"price": bid, "quantity": q, "orders": 0}],
            "sell": [{"price": ask, "quantity": q, "orders": 0}],
        },
    }


def feed_buy_pressure(engine, n=40):
    """Rising price traded at the ask, bid-heavy book, above VWAP."""
    out = []
    for i in range(n):
        ts = 1000 + i
        ltp = 100.0 + i * 0.012
        tick = make_tick(ts, ltp, 1000 * i, ltp - 0.05, ltp, 500_000, 100_000, 99.0)
        sig = engine.update(tick)
        if sig:
            out.append(sig)
    return out


def feed_sell_pressure(engine, n=40):
    out = []
    for i in range(n):
        ts = 1000 + i
        ltp = 100.0 - i * 0.012
        tick = make_tick(ts, ltp, 1000 * i, ltp, ltp + 0.05, 100_000, 500_000, 101.0)
        sig = engine.update(tick)
        if sig:
            out.append(sig)
    return out


class TestGating:
    def test_no_signal_before_min_ticks(self):
        eng = OrderFlowSignalEngine()
        out = feed_buy_pressure(eng, n=10)
        assert out == []

    def test_no_signal_before_min_elapsed(self):
        eng = OrderFlowSignalEngine()
        # 35 ticks but all within a single second
        out = []
        for i in range(35):
            out.append(eng.update(make_tick(1000, 100.0, 500 * i, 99.95, 100.0, 500_000, 100_000, 99.0)))
        assert all(s is None for s in out)


class TestDirectionalSignals:
    def test_buy_pressure_yields_strong_buy(self):
        eng = OrderFlowSignalEngine()
        signals = feed_buy_pressure(eng)
        sides = [s["side"] for s in signals]
        assert sides, "expected at least one signal"
        assert all(s.endswith("BUY") for s in sides)
        assert "STRONG_BUY" in sides
        assert signals[-1]["side"] == "STRONG_BUY"
        strong = next(s for s in signals if s["side"] == "STRONG_BUY")
        assert strong["score"] >= eng.STRONG
        assert strong["reasons"]
        assert strong["cvd"] > 0

    def test_sell_pressure_yields_strong_sell(self):
        eng = OrderFlowSignalEngine()
        signals = feed_sell_pressure(eng)
        sides = [s["side"] for s in signals]
        assert sides, "expected at least one signal"
        assert all(s.endswith("SELL") for s in sides)
        assert "STRONG_SELL" in sides
        assert signals[-1]["side"] == "STRONG_SELL"
        assert next(s for s in signals if s["side"] == "STRONG_SELL")["cvd"] < 0


class TestAggressorClassification:
    def test_trades_at_ask_are_buys(self):
        eng = OrderFlowSignalEngine()
        eng.update(make_tick(1000, 100.0, 1000, 99.95, 100.0, 1, 1, 100.0))
        eng.update(make_tick(1001, 100.0, 1500, 99.95, 100.0, 1, 1, 100.0))  # at ask
        assert eng.snapshot()["cvd"] == 500

    def test_trades_at_bid_are_sells(self):
        eng = OrderFlowSignalEngine()
        eng.update(make_tick(1000, 100.0, 1000, 100.0, 100.05, 1, 1, 100.0))
        eng.update(make_tick(1001, 100.0, 1500, 100.0, 100.05, 1, 1, 100.0))  # at bid
        assert eng.snapshot()["cvd"] == -500


class TestNeutral:
    def test_balanced_flat_market_is_neutral(self):
        eng = OrderFlowSignalEngine()
        out = []
        for i in range(45):
            ts = 1000 + i
            # trade at mid, balanced book, price == vwap, no movement
            out.append(eng.update(make_tick(ts, 100.0, 1000 * i, 99.95, 100.05, 100_000, 100_000, 100.0)))
        signals = [s for s in out if s]
        assert signals == []
        assert eng.snapshot()["label"] == "NEUTRAL"


class TestCooldownAndReset:
    def test_weak_flip_blocked_during_cooldown(self):
        eng = OrderFlowSignalEngine()
        feed_buy_pressure(eng)
        assert eng.last_signal == "STRONG_BUY"
        # one tick later, mild opposing score should not flip (cooldown)
        sig = eng.update(make_tick(1041, 100.4, 1000 * 40, 100.35, 100.45, 120_000, 100_000, 100.0))
        assert sig is None or sig["side"] in ("BUY", "STRONG_BUY")

    def test_reset_clears_state(self):
        eng = OrderFlowSignalEngine()
        feed_buy_pressure(eng)
        assert eng.tick_count > 0
        eng.reset()
        assert eng.tick_count == 0
        assert eng.snapshot()["label"] == "NEUTRAL"
        assert eng.snapshot()["cvd"] == 0


class TestVwapEvent:
    def test_below_vwap_is_not_a_permanent_bearish_vote(self):
        eng = OrderFlowSignalEngine()
        # price persistently BELOW vwap, balanced book, no flow
        for i in range(40):
            eng.update(make_tick(1000 + i, 100.0, 1000 * i, 99.95, 100.05, 100_000, 100_000, 110.0))
        _, _, comp = eng._score(
            make_tick(1040, 100.0, 40_000, 99.95, 100.05, 100_000, 100_000, 110.0), 100.0, 1040
        )
        assert abs(comp["s_vwap"]) < 0.2  # no constant VWAP bias

    def test_reclaim_fires_a_positive_event(self):
        eng = OrderFlowSignalEngine()
        for i in range(20):
            eng.update(make_tick(1000 + i, 99.0, 1000 * i, 98.95, 99.05, 100_000, 100_000, 100.0))
        eng.update(make_tick(1021, 101.0, 21_000, 100.95, 101.05, 100_000, 100_000, 100.0))
        assert eng.vwap_event > 0.5


class TestAbsorption:
    def test_sellers_absorbed_contributes_bullishly(self):
        eng = OrderFlowSignalEngine()
        # trades hit the bid (sell) but price does not fall -> absorbed
        for i in range(40):
            eng.update(make_tick(1000 + i, 100.0, 1000 * i, 100.0, 100.05, 100_000, 100_000, 100.0))
        assert eng._absorption(100.0, 1039) == 1.0

    def test_no_absorption_without_one_sided_flow(self):
        eng = OrderFlowSignalEngine()
        for i in range(40):
            eng.update(make_tick(1000 + i, 100.0, 1000 * i, 100.0, 100.05, 100_000, 100_000, 100.0))
        # no flow recorded at all -> no absorption signal
        eng.agg_flow.clear()
        assert eng._absorption(100.0, 1039) == 0.0


class TestRegimeGate:
    def test_damps_near_close(self):
        eng = OrderFlowSignalEngine()
        dt = datetime.datetime(2026, 9, 15, 15, 20, 0, tzinfo=config.IST)
        ts = dt.timestamp()
        tick = make_tick(ts, 100.0, 1000, 99.95, 100.05, 100_000, 100_000, 100.0)
        assert eng._regime_gate(tick, 100.0, ts) == 0.5

    def test_damps_after_large_intraday_move(self):
        eng = OrderFlowSignalEngine()
        tick = make_tick(1000, 100.0, 1000, 99.95, 100.05, 100_000, 100_000, 100.0)
        tick["day"] = {"open": 90.0}  # +11% from open
        assert eng._regime_gate(tick, 100.0, 1000) == 0.6

    def test_normal_time_gate_is_one(self):
        eng = OrderFlowSignalEngine()
        dt = datetime.datetime(2026, 9, 15, 11, 0, 0, tzinfo=config.IST)
        ts = dt.timestamp()
        tick = make_tick(ts, 100.0, 1000, 99.95, 100.05, 100_000, 100_000, 100.0)
        assert eng._regime_gate(tick, 100.0, ts) == 1.0


class TestComponents:
    def test_signal_carries_components_and_weights(self):
        eng = OrderFlowSignalEngine()
        signals = feed_buy_pressure(eng)
        strong = next(s for s in signals if s["side"] == "STRONG_BUY")
        comp = strong["components"]
        for key in ("s_imb", "s_imb_raw", "absorb", "s_cvd", "s_vwap", "s_sweep", "s_mom", "raw", "gate", "weights"):
            assert key in comp
        assert abs(sum(comp["weights"].values()) - 1.0) < 1e-9
