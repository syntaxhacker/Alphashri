"""Unit tests for the pure maths of the position-probability skill.

No network: every fixture is a synthetic series, so the suite runs offline.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import lib_probability as lp  # noqa: E402


def price_series(values, start="2024-01-01", freq="B"):
    idx = pd.date_range(start, periods=len(values), freq=freq)
    return pd.Series(values, index=idx)


def ohlcv(close, volume=None):
    idx = close.index
    return pd.DataFrame({
        "open": close,
        "high": close * 1.01,
        "low": close * 0.99,
        "close": close,
        "volume": volume if volume is not None else [1e6] * len(close),
    }, index=idx)


# --------------------------------------------------------------------------
# features
# --------------------------------------------------------------------------


def test_rsi_bounds_and_extremes():
    rising = price_series(np.arange(1, 60, dtype=float))
    falling = price_series(np.arange(60, 1, -1, dtype=float))
    assert lp.rsi(rising).iloc[-1] > 95
    assert lp.rsi(falling).iloc[-1] < 5
    assert lp.rsi(rising).dropna().between(0, 100).all()


def test_build_features_columns_and_distances():
    close = price_series(np.linspace(100, 200, 260))
    f = lp.build_features(ohlcv(close))
    for col in ("rsi", "ret10", "d20", "d50", "d200", "slope200", "volr", "sig60", "pos52"):
        assert col in f.columns
    assert f["d200"].iloc[-1] > 0
    assert f["dma200"].iloc[-1] == pytest.approx(close.tail(200).mean())
    assert 0 <= f["pos52"].iloc[-1] <= 1


def test_describe_state_flags_counter_trend():
    close = price_series(np.concatenate([np.linspace(100, 200, 200), np.linspace(200, 120, 60)]))
    f = lp.build_features(ohlcv(close))
    st = lp.describe_state(f)
    assert st["counter_trend"] is True
    assert st["trend"] == "DOWNTREND"
    assert st["dma200"] > 0


# --------------------------------------------------------------------------
# cycle structure
# --------------------------------------------------------------------------


def test_zigzag_alternates_and_captures_pivots():
    values = [100, 120, 140, 130, 110, 90, 95, 130, 160, 150]
    s = price_series(values)
    pivots = lp.zigzag(s, 20)
    kinds = [p[2] for p in pivots]
    assert all(kinds[i] != kinds[i + 1] for i in range(len(kinds) - 1))
    legs = lp.swing_legs(pivots, s)
    assert legs
    # the synthetic path rises to 140, slides to 90, then rallies to 160
    assert [l["type"] for l in legs] == ["DROP", "RALLY"]
    assert legs[0]["from"] == pytest.approx(140.0)
    assert legs[1]["to"] == pytest.approx(160.0)
    assert abs(legs[0]["to"] - legs[0]["from"] * (1 + legs[0]["pct"] / 100)) < 1e-6


def test_drawdown_episodes_find_trough_and_merge_neighbours():
    values = list(np.linspace(100, 200, 120)) + list(np.linspace(200, 100, 120))
    s = price_series(values)
    eps = lp.drawdown_episodes(s, 0.30)
    assert eps, "expected at least one 30% drawdown"
    assert eps[0]["dd"] <= -0.30
    # one slide must not be reported twice
    assert len(eps) == 1


def test_forward_returns_alignment():
    s = price_series([100, 110, 121, 133.1, 146.41])
    fwd = lp.forward_returns(s, 2)
    assert len(fwd) == 3
    assert fwd.iloc[0] == pytest.approx(0.21)


def test_non_overlapping_episodes_respect_gap():
    idx = pd.date_range("2024-01-01", periods=10, freq="B")
    mask = pd.Series([True] * 6 + [False] * 4, index=idx)
    eps = lp.non_overlapping_episodes(mask, 3)
    assert len(eps) == 2
    assert (eps[1] - eps[0]).days >= 2


# --------------------------------------------------------------------------
# conditional sampling
# --------------------------------------------------------------------------


def test_matched_analog_applies_bounds():
    idx = pd.date_range("2024-01-01", periods=100, freq="B")
    base = pd.DataFrame({"fwd": np.linspace(-0.1, 0.1, 100),
                         "rsi": np.linspace(30, 90, 100),
                         "d200": np.linspace(-0.2, 0.2, 100)}, index=idx)
    sel = lp.matched_analog(base, {"rsi": (40, 60), "d200": (None, 0.0)})
    assert len(sel) > 0
    assert (base.loc[sel.index, "rsi"].between(40, 60)).all()
    assert (base.loc[sel.index, "d200"] <= 0).all()


def test_rsi_peak_decay_reports_bins():
    idx = pd.date_range("2024-01-01", periods=400, freq="B")
    rng = np.random.default_rng(0)
    base = pd.DataFrame({"rsi": np.clip(rng.normal(55, 12, 400), 5, 95),
                         "fwd": rng.normal(0, 0.03, 400)}, index=idx)
    rows = lp.rsi_peak_decay(base)
    assert rows
    assert all(0 <= r["p_up"] <= 1 for r in rows)
    assert rows[0]["bin"] == "0-1d"


# --------------------------------------------------------------------------
# simulation
# --------------------------------------------------------------------------


def test_mc_bootstrap_median_near_spot_for_zero_drift():
    rng = np.random.default_rng(1)
    returns = rng.normal(0.0002, 0.02, 1000)
    term = lp.mc_bootstrap(returns, 100.0, 8, 50_000, rng)
    assert abs(np.median(term) - 100.0) < 2.0
    assert term.min() > 0


def test_mc_lognormal_respects_vol_and_drift():
    rng = np.random.default_rng(2)
    term = lp.mc_lognormal(100.0, 8, 0.30, 0.0, 50_000, rng)
    implied = term.std() / 100.0
    assert implied == pytest.approx(0.30 * np.sqrt(8 / 252), rel=0.08)
    assert abs(np.median(term) - 100.0) < 1.0


def test_mc_market_implied_scales_with_beta():
    rng = np.random.default_rng(3)
    flat = lp.mc_market_implied(100.0, 8, [1.0], [0.03], 0.10, None, 40_000, rng)
    half = lp.mc_market_implied(100.0, 8, [0.5], [0.03], 0.10, None, 40_000, rng)
    assert flat.std() > half.std()
    assert abs(np.median(flat) - 100.0) < 2.0


# --------------------------------------------------------------------------
# reporting helpers
# --------------------------------------------------------------------------


def test_bucket_table_sums_to_one():
    rng = np.random.default_rng(4)
    term = rng.normal(100, 5, 100_000)
    buckets = [(0, 95, "<95"), (95, 105, "95-105"), (105, 1e9, ">105")]
    rows = lp.bucket_table(term, buckets)
    assert sum(r["p"] for r in rows) == pytest.approx(1.0)


def test_key_levels_side_and_probability():
    term = np.array([90.0, 95.0, 100.0, 105.0, 110.0])
    rows = lp.key_levels(term, [95.0, 105.0], spot=100.0)
    assert rows[0]["side"] == "below" and rows[0]["p"] == pytest.approx(0.2)
    assert rows[1]["side"] == "above" and rows[1]["p"] == pytest.approx(0.2)


def test_summarise_percentiles_ordered():
    rng = np.random.default_rng(5)
    term = rng.normal(50, 10, 50_000)
    s = lp.summarise(term)
    assert s["p10"] < s["p25"] < s["median"] < s["p75"] < s["p90"]
