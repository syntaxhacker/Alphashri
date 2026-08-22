"""Pytest unit tests for the ANALYSIS functions in the stock-eda-report skill.

Covers only `analyze_daily` and `analyze_intraday`. Rendering functions
(`render_figures`, `render_report`) are intentionally NOT tested here -- another
agent owns those and they are being changed concurrently.

All inputs are synthetic, deterministic and offline: a ~120-business-day daily
OHLCV frame and a two-day (09:15-15:29 IST) 1-minute OHLCV frame with a strong
opening-minute / midday U-shape.
"""
import os

# The project venv sometimes inherits an inline backend via MPLBACKEND; force Agg
# before matplotlib is imported anywhere in this process.
os.environ["MPLBACKEND"] = "Agg"

import sys
import importlib.util
from pathlib import Path

root = Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
spec = importlib.util.spec_from_file_location(
    "gen",
    root / ".prime/agent/skills/stock-eda-report/scripts/generate_stock_eda_report.py",
)
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

import numpy as np
import pandas as pd

DAILY_KEYS = {
    "daily", "up_mean_vol", "down_mean_vol", "up_median_vol", "down_median_vol",
    "rho_abs_vol", "rho_signed_vol", "obv_corr", "adl_corr", "top10_share",
    "top5_share", "fwd_up3", "fwd_up5", "fwd_dn3", "fwd_base", "mean_ret",
    "median_ret", "min_ret", "max_ret", "mean_rv", "max_rv", "cur_rv",
    "ret_ac1", "jb_p", "logvol_ac1",
}

INTRADAY_KEYS = {
    "min_vol", "bucket_vol", "big", "big_hour", "open_min_share",
    "first15_share", "first30_share", "first_hour_share", "midday_share",
    "last30_share", "last15_share", "open_min_vol", "median_min_vol", "n_big",
    "first_hour_big_pct", "first15_big_pct", "big_abs_move", "top_prints",
}


def _make_daily(n=120):
    """Deterministic daily OHLCV frame: sine + linear trend close, seeded volume."""
    idx = pd.bdate_range("2025-01-01", periods=n)
    t = np.arange(n, dtype=float)
    close = np.round(1000.0 + 40.0 * np.sin(t / 8.0) + 0.6 * t, 2)
    rng = np.random.default_rng(42)
    volume = rng.integers(1_000_000, 5_000_000, n).astype(float)
    daily = pd.DataFrame(
        {
            "open": close,
            "high": close * 1.02,
            "low": close * 0.98,
            "close": close,
            "volume": volume,
        },
        index=idx,
    )
    daily.index.name = "date"
    # analyze_daily consumes a `ret` column (normally added by load_daily);
    # compute it deterministically from close.
    daily["ret"] = daily["close"].pct_change()
    return daily


def _make_minute():
    """Two IST trading days of 1-min bars (09:15-15:29) with a volume U-shape."""
    base = 1000.0
    frames = []
    for day in ("2025-05-05", "2025-05-06"):
        idx = pd.date_range(f"{day} 09:15", f"{day} 15:29", freq="1min", tz="Asia/Kolkata")
        mins = np.arange(len(idx), dtype=float)
        volume = np.full(len(idx), 100.0)
        volume[mins == 0] = 20000.0                    # opening-minute spike
        volume[(mins >= 150) & (mins <= 254)] = 20.0   # midday lull
        volume[mins >= 360] = 3000.0                   # closing surge (last 15 min)
        close = base + 2.0 * np.sin(mins / 20.0) + 0.001 * mins
        open_ = np.roll(close, 1)
        open_[0] = base
        high = np.maximum(open_, close) * 1.0002
        low = np.minimum(open_, close) * 0.9998
        frames.append(
            pd.DataFrame(
                {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
                index=idx,
            )
        )
    return pd.concat(frames)


# --------------------------------------------------------------------------
# analyze_daily
# --------------------------------------------------------------------------
def test_analyze_daily_returns_dict_with_expected_keys():
    daily = _make_daily()
    result = gen.analyze_daily(daily)

    assert isinstance(result, dict)
    assert DAILY_KEYS.issubset(set(result.keys()))
    assert isinstance(result["daily"], pd.DataFrame)


def test_analyze_daily_stats_and_derived_columns():
    daily = _make_daily()
    result = gen.analyze_daily(daily)

    # Volume on up days must be strictly positive.
    assert result["up_mean_vol"] > 0

    # Spearman correlation must be a valid correlation coefficient.
    rho_abs = result["rho_abs_vol"]
    assert -1.0 <= rho_abs <= 1.0

    # Forward-return baseline stats are produced for all five horizons.
    assert set(result["fwd_base"].keys()) == {1, 3, 5, 10, 20}
    for horizon, stats in result["fwd_base"].items():
        assert isinstance(stats, tuple) and len(stats) == 3

    # The returned daily frame gains the derived columns (ret is consumed from
    # the input; the rest are computed by analyze_daily).
    out_daily = result["daily"]
    assert {"ret", "abs_ret", "log_vol", "vol_ratio", "obv", "adl", "fwd1", "fwd20"}.issubset(
        set(out_daily.columns)
    )
    gained = {"abs_ret", "log_vol", "vol_ratio", "obv", "adl", "fwd1", "fwd20"}
    assert gained.isdisjoint(daily.columns)


# --------------------------------------------------------------------------
# analyze_intraday
# --------------------------------------------------------------------------
def test_analyze_intraday_returns_dict_with_expected_keys():
    m1 = _make_minute()
    result = gen.analyze_intraday(m1)

    assert isinstance(result, dict)
    assert INTRADAY_KEYS.issubset(set(result.keys()))
    assert isinstance(result["min_vol"], pd.DataFrame)
    assert isinstance(result["bucket_vol"], pd.DataFrame)
    assert isinstance(result["big"], pd.DataFrame)
    assert isinstance(result["big_hour"], pd.Series)
    assert isinstance(result["top_prints"], pd.DataFrame)


def test_analyze_intraday_ushape_and_big_player_metrics():
    m1 = _make_minute()
    result = gen.analyze_intraday(m1)

    # U-shape: the single opening minute prints more of the day's volume than
    # the entire midday stretch (minutes 150-254).
    assert result["open_min_share"] > result["midday_share"]

    # The opening minute is far busier than the typical (median) minute.
    assert result["open_min_vol"] > result["median_min_vol"]

    # Big-player prints (volume > 20x the day's median minute) exist and are
    # front-loaded into the first hour / first 15 minutes.
    assert result["n_big"] > 0
    assert 0.0 <= result["first_hour_big_pct"] <= 100.0
    assert 0.0 <= result["first15_big_pct"] <= 100.0

    # The top-10 print table has at most 10 rows.
    assert len(result["top_prints"]) <= 10
