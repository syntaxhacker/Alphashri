"""Honesty invariants of the double-VWAP research engine.

The engine's value is its fill rules, so these tests pin the rules, not the
strategy's profitability: no profit exit on the fill bar, gap-through stops fill
at the open, VWAP anchors are session-correct, and the untouched-level check is
strict about RTH only.
"""
from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
MOD = ROOT / "scripts" / "research" / "double_vwap" / "strategy.py"
spec = importlib.util.spec_from_file_location("double_vwap_strategy", MOD)
S = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = S
spec.loader.exec_module(S)


def make_day(o, h, l, c, t=None, on_vwap=100.0, ny_vwap=None, rth_start=0):
    n = len(c)
    t = t if t is not None else np.arange(570, 570 + n)
    return S.Day(date=date(2026, 3, 2), t=np.asarray(t), o=np.asarray(o, float),
                 h=np.asarray(h, float), l=np.asarray(l, float),
                 c=np.asarray(c, float), vol=np.ones(n), atr=np.full(n, 10.0),
                 ny_vwap=np.full(n, 100.0) if ny_vwap is None else np.asarray(ny_vwap, float),
                 on_vwap=on_vwap, rth_start=rth_start,
                 rng={"on": (110.0, 90.0, 0)})


def sig(day, idx, side, entry, stop, target):
    return dict(day=day, idx=idx, side=side, entry=entry, stop=stop, target=target,
                kind="A")


def test_no_profit_exit_on_fill_bar():
    # target is hit on the entry bar; the engine must not credit it
    d = make_day(o=[100, 100, 101], h=[101, 105, 102], l=[99, 99, 100.5], c=[100, 101, 101])
    tr = S.simulate(sig(d, 1, 1, 100.0, 98.0, 103.0), cost_pts=0.0)
    assert tr["exit"] == "time"
    assert tr["R"] == pytest.approx(0.5)


def test_stop_may_fill_on_entry_bar():
    d = make_day(o=[100, 100], h=[101, 100.5], l=[99, 97.5], c=[100, 98])
    tr = S.simulate(sig(d, 1, 1, 100.0, 98.0, 110.0), cost_pts=0.0)
    assert tr["exit"] == "stop"
    assert tr["R"] == pytest.approx(-1.0)


def test_gap_through_stop_fills_at_open():
    d = make_day(o=[100, 100, 97], h=[101, 100.5, 97.5], l=[99, 99, 96], c=[100, 100, 96.5])
    tr = S.simulate(sig(d, 1, 1, 100.0, 98.0, 110.0), cost_pts=0.0)
    assert tr["exit"] == "stop_gap"
    assert tr["R"] == pytest.approx(-1.5)


def test_stop_checked_before_target():
    d = make_day(o=[100, 100], h=[101, 105], l=[99, 97], c=[100, 100])
    tr = S.simulate(sig(d, 1, 1, 100.0, 98.0, 103.0), cost_pts=0.0)
    assert tr["exit"] == "stop"


def test_cost_reduces_r_in_points():
    d = make_day(o=[100, 100], h=[101, 104], l=[99, 100], c=[100, 103])
    free = S.simulate(sig(d, 1, 1, 100.0, 98.0, 103.0), cost_pts=0.0)
    paid = S.simulate(sig(d, 1, 1, 100.0, 98.0, 103.0), cost_pts=1.0)
    assert free["R"] == pytest.approx(1.5)
    assert paid["R"] == pytest.approx(1.0)


def test_overnight_vwap_is_frozen_at_the_open_and_ny_vwap_is_cumulative():
    on_t = pd.date_range("2026-03-02 08:00", periods=60, freq="1min")
    rth_t = pd.date_range("2026-03-02 09:30", periods=60, freq="1min")
    idx = on_t.append(rth_t).tz_localize("America/New_York")
    n = len(idx)
    frame = pd.DataFrame({
        "o": np.full(n, 100.0), "h": np.full(n, 110.0),
        "l": np.full(n, 90.0), "c": np.full(n, 100.0),
        "vol": np.r_[np.ones(60), np.r_[np.ones(59), 3.0]],
    }, index=idx)
    days = S.build_days(frame)
    assert len(days) == 1
    d = days[0]
    # ON typical price is 100 for every bar -> ON VWAP must be 100
    assert d.on_vwap == pytest.approx(100.0)
    # the last RTH bar carries 3x volume at the same price -> NY VWAP stays 100
    assert d.ny_vwap[-1] == pytest.approx(100.0)


def test_untouched_level_ignores_overnight_history():
    d = make_day(o=[100, 100, 100], h=[100, 101, 100], l=[100, 99, 100],
                 c=[100, 100, 100], rth_start=0)
    assert S.on_touched(d, 2, 0.0) is True
    d2 = make_day(o=[101, 101, 101], h=[101, 101.4, 101], l=[101, 101.1, 101],
                  c=[101, 101, 101], rth_start=0)
    assert S.on_touched(d2, 2, 0.0) is False
