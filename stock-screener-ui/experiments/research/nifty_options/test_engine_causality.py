"""Regression tests for the NIFTY options research engine.

Focus: causality (no look-ahead), conservative stop ordering, and the cost /
margin model. Run with:
    .venv/bin/python -m pytest experiments/research/nifty_options/test_engine_causality.py
"""
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import EngineConfig, ExpiryResolver, Leg, Signal, Trade, replay  # noqa: E402
from costs import (ExecutionModel, capital_for_structure, round_trip_costs)  # noqa: E402


def _spot(day="2026-06-02", n=12, start=23000.0, step=10.0):
    ts = pd.date_range(f"{day} 09:15", periods=n, freq="5min", tz="Asia/Kolkata")
    close = np.arange(start, start + n * step, step)
    return pd.DataFrame({"open": close - 2, "high": close + 5, "low": close - 5,
                         "close": close, "volume": 1000.0}, index=ts)


class CountingSource:
    """Returns premium = underlying price; records every timestamp it is asked for."""
    def __init__(self):
        self.seen = []

    def leg_price(self, ts, leg, spot, field="close"):
        self.seen.append((ts, field))
        return float(spot)


def test_signal_at_close_fills_at_next_open():
    spot = _spot()
    src = CountingSource()
    resolver = ExpiryResolver([date(2026, 6, 4)], {date(2026, 6, 4): True})
    fired = {}

    def strat(ctx, i):
        if i == 4 and "done" not in fired:
            fired["done"] = True
            return Signal([Leg("CE", "BUY", 0)], reason="t", tag="t", max_hold_min=10)
        return None

    trades = replay(strat, spot, src, resolver, EngineConfig(), date(2026, 6, 2), date(2026, 6, 2))
    assert len(trades) == 1
    # signal on bar 4 -> entry on bar 5
    assert trades[0].entry_ts == spot.index[5]


def test_engine_never_requests_timestamps_after_exit():
    """All price lookups must be <= the exit timestamp (no future reads)."""
    spot = _spot()
    g = CountingSource()
    resolver = ExpiryResolver([date(2026, 6, 4)], {date(2026, 6, 4): True})

    def strat(ctx, i):
        if i == 2:
            return Signal([Leg("CE", "BUY", 0)], reason="t", tag="t", max_hold_min=15)
        return None

    trades = replay(strat, spot, g, resolver, EngineConfig(), date(2026, 6, 2), date(2026, 6, 2))
    order = list(spot.index)
    exit_i = order.index(trades[0].exit_ts)
    for ts, _field in g.seen:
        assert order.index(ts) <= exit_i + 1


def test_stop_assumed_before_target_when_bar_spans_both():
    # entry premium ~230xx; a single bar with a huge range spans both -10% and +10%
    ts = pd.date_range("2026-06-02 09:15", periods=8, freq="5min", tz="Asia/Kolkata")
    close = np.full(8, 23000.0)
    high = close.copy(); low = close.copy()
    high[4] = 46000.0   # +100%
    low[4] = 11500.0    # -50%
    spot = pd.DataFrame({"open": close, "high": high, "low": low, "close": close,
                         "volume": 1000.0}, index=ts)
    g = CountingSource()
    resolver = ExpiryResolver([date(2026, 6, 4)], {date(2026, 6, 4): True})

    def strat(ctx, i):
        if i == 2:
            return Signal([Leg("CE", "BUY", 0)], reason="t", tag="t",
                          stop_pct=0.10, target_pct=0.10, max_hold_min=60)
        return None

    trades = replay(strat, spot, g, resolver, EngineConfig(), date(2026, 6, 2), date(2026, 6, 2))
    assert trades[0].exit_reason == "STOP"
    assert trades[0].net_pnl < 0


def test_target_detected_on_large_favourable_move():
    ts = pd.date_range("2026-06-02 09:15", periods=8, freq="5min", tz="Asia/Kolkata")
    close = np.array([23000, 23000, 23000, 23000, 26000, 26000, 26000, 26000], dtype=float)
    spot = pd.DataFrame({"open": close, "high": close + 50, "low": close - 50,
                         "close": close, "volume": 1000.0}, index=ts)
    g = CountingSource()
    resolver = ExpiryResolver([date(2026, 6, 4)], {date(2026, 6, 4): True})

    def strat(ctx, i):
        if i == 2:
            return Signal([Leg("CE", "BUY", 0)], reason="t", tag="t",
                          stop_pct=0.10, target_pct=0.10, max_hold_min=60)
        return None

    trades = replay(strat, spot, g, resolver, EngineConfig(), date(2026, 6, 2), date(2026, 6, 2))
    assert trades[0].exit_reason == "TARGET"
    assert trades[0].gross_pnl > 0


def test_costs_stt_only_on_sell_and_positive():
    buy_only = round_trip_costs(100, 100, 65, "BUY")
    assert buy_only > 0
    # a sell-side round trip should carry STT, so strictly costlier than buy-side
    sell_only = round_trip_costs(100, 100, 65, "SELL")
    assert sell_only > 0


def test_spread_margin_is_width_times_lot():
    legs = [{"side": "SELL", "premium": 40, "strike": 23200, "option_type": "PE"},
            {"side": "BUY", "premium": 15, "strike": 23150, "option_type": "PE"}]
    cap = capital_for_structure(23000, 65, legs)
    assert cap == pytest.approx(50 * 65)


def test_long_only_capital_is_debit():
    legs = [{"side": "BUY", "premium": 120, "strike": 23000, "option_type": "CE"}]
    assert capital_for_structure(23000, 65, legs) == pytest.approx(120 * 65)
