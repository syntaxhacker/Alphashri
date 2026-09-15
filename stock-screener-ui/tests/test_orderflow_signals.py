"""Tests for the order-flow signal engine (api/orderflow_signals.py)."""

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
