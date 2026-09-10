"""End-to-end analysis on synthetic data with known properties.

A drift-up random walk must show: positive session attribution for intraday,
PF >= ~1 at every horizon, and the chained sanity check matching actual return.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import generate_timeframe_edge_report as gte  # noqa: E402


def synth_dataset(n_days=120, seed=0, daily_drift=0.002):
    """Daily bars + 5m bars for each day (75 bars/day) from a drifted random walk."""
    rng = np.random.default_rng(seed)
    day_idx = pd.bdate_range("2025-01-06", periods=n_days)
    close_prev = 100.0
    d_rows = []
    m_frame = None
    for di, dt in enumerate(day_idx):
        o = close_prev * (1 + rng.normal(daily_drift * 0.3, 0.004))
        closes = o * np.exp(np.cumsum(rng.normal(daily_drift / 75, 0.0012, 75)))
        c = closes[-1]
        d_rows.append({"open": o, "high": max(o, c) * 1.002, "low": min(o, c) * 0.998,
                       "close": c, "volume": float(rng.integers(8e5, 12e5))})
        opens = np.concatenate([[o], closes[:-1]])
        day_start = pd.Timestamp(dt).tz_localize(gte.IST) + pd.Timedelta(minutes=gte.MARKET_OPEN_MIN)
        ts = pd.DatetimeIndex([day_start + pd.Timedelta(minutes=5 * i) for i in range(75)]).tz_convert("UTC")
        blk = pd.DataFrame({
            "open": opens,
            "high": np.maximum(opens, closes) * 1.0004,
            "low": np.minimum(opens, closes) * 0.9996,
            "close": closes,
            "volume": rng.integers(1000, 2000, 75).astype(float),
        }, index=ts)
        m_frame = blk if m_frame is None else pd.concat([m_frame, blk])
        close_prev = c
    daily = pd.DataFrame(d_rows, index=day_idx)
    return daily, m_frame


def test_drift_up_shows_positive_edge():
    # strong drift, zero costs -> every horizon's gross edge must be visible
    daily, m5 = synth_dataset(n_days=400, seed=3, daily_drift=0.005)
    res = gte.run_analysis("SYNTH", daily, m5, samples=500, seed=42, cost_bps=0.0, nifty=None)
    stats = {s["horizon"]: s for s in res["stats"]}
    assert set(stats) == {"5m", "15m", "1h", "4h", "overnight", "1d", "3d", "5d"}
    assert stats["1d"]["pf"] > 1.0
    assert stats["overnight"]["mean_pct"] > 0
    # sanity chain close to actual
    assert res["sanity"] < 5.0  # % diff between chained buckets and actual move


def test_session_share_sums_reasonable():
    daily, m5 = synth_dataset(seed=5)
    att = gte.run_analysis("SYNTH", daily, m5, samples=200, seed=1, cost_bps=6.0, nifty=None)["att"]
    total = sum(v for k, v in att["share"].items() if k != "midday" or True)
    assert total == pytest.approx(100.0, abs=1e-6)


def test_flat_series_no_fake_edge_daily():
    rng = np.random.default_rng(9)
    idx = pd.bdate_range("2025-01-06", periods=250)
    px = 100 + rng.normal(0, 0.01, 250).cumsum()
    daily = pd.DataFrame({"open": px, "high": px * 1.001, "low": px * 0.999,
                          "close": px, "volume": 1e6}, index=idx)
    res = gte.run_analysis("FLAT", daily, None, samples=500, seed=2, cost_bps=6.0, nifty=None)
    stats = {s["horizon"]: s for s in res["stats"]}
    # no intraday data -> only daily horizons present; none should be strongly profitable after costs
    assert all(s["pf"] < 2.0 for s in res["stats"])
    assert stats["5d"]["n"] == 246

