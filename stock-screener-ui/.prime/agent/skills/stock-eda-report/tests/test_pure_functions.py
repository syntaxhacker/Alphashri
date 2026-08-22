"""Pytest unit tests for the pure helper/analysis functions in the stock-eda-report skill.

Covers only functions that do NOT render figures or the report:
    _fiscal_quarter, _to_utc_aware, _bar_labels, market_stats, event_study.
All inputs are synthetic and deterministic; no network access is required.
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
import matplotlib.pyplot as plt


# --------------------------------------------------------------------------
# _fiscal_quarter
# --------------------------------------------------------------------------
def test_fiscal_quarter_mapping():
    assert gen._fiscal_quarter("2024-01-23") == "Q3 FY2024"
    assert gen._fiscal_quarter("2024-05-01") == "Q4 FY2024"
    assert gen._fiscal_quarter("2024-07-20") == "Q1 FY2025"
    assert gen._fiscal_quarter("2024-10-19") == "Q2 FY2025"


def test_fiscal_quarter_month_boundaries():
    # Jan-Mar -> Q3 FY{year}; Apr-Jun -> Q4 FY{year};
    # Jul-Sep -> Q1 FY{year+1}; Oct-Dec -> Q2 FY{year+1}.
    assert gen._fiscal_quarter("2024-03-31") == "Q3 FY2024"
    assert gen._fiscal_quarter("2024-04-01") == "Q4 FY2024"
    assert gen._fiscal_quarter("2024-06-30") == "Q4 FY2024"
    assert gen._fiscal_quarter("2024-07-01") == "Q1 FY2025"
    assert gen._fiscal_quarter("2024-09-30") == "Q1 FY2025"
    assert gen._fiscal_quarter("2024-10-01") == "Q2 FY2025"
    assert gen._fiscal_quarter("2024-12-31") == "Q2 FY2025"


# --------------------------------------------------------------------------
# _to_utc_aware
# --------------------------------------------------------------------------
def test_to_utc_aware_naive_index_is_localized_to_utc():
    idx = pd.DatetimeIndex(["2024-01-23 09:15:00", "2024-01-23 15:30:00"])
    out = gen._to_utc_aware(idx)
    assert str(out.tz) == "UTC"
    assert out[0] == pd.Timestamp("2024-01-23 09:15:00", tz="UTC")
    assert out[1] == pd.Timestamp("2024-01-23 15:30:00", tz="UTC")


def test_to_utc_aware_aware_index_is_converted_to_utc():
    idx = pd.DatetimeIndex(["2024-01-23 09:15:00"]).tz_localize("Asia/Kolkata")
    out = gen._to_utc_aware(idx)
    assert str(out.tz) == "UTC"
    # 09:15 IST == 03:45 UTC
    assert out[0] == pd.Timestamp("2024-01-23 03:45:00", tz="UTC")


# --------------------------------------------------------------------------
# _bar_labels
# --------------------------------------------------------------------------
def test_bar_labels_annotates_single_bar():
    fig, ax = plt.subplots()
    try:
        bars = ax.bar([0], [1.5], width=0.8)
        gen._bar_labels(ax, bars, fmt="{:.1f}", fontsize=8, dy=0.02)
        assert len(ax.texts) == 1
        assert ax.texts[0].get_text() == "1.5"
    finally:
        plt.close(fig)


# --------------------------------------------------------------------------
# market_stats
# --------------------------------------------------------------------------
def _synthetic_daily(n=60, start="2025-01-06"):
    idx = pd.bdate_range(start, periods=n)
    rng = np.random.default_rng(42)
    close = 1000.0 * np.exp(np.cumsum(rng.normal(0.0, 0.01, n)))
    gap_pct = rng.normal(0.0, 0.4, n)
    intraday_pct = rng.normal(0.1, 0.9, n)
    ret = np.concatenate(([np.nan], np.diff(close) / close[:-1] * 100.0))
    return pd.DataFrame(
        {"close": close, "ret": ret, "gap_pct": gap_pct, "intraday_pct": intraday_pct},
        index=idx,
    )


def test_market_stats_keys_are_finite_floats():
    daily = _synthetic_daily()
    rng = np.random.default_rng(7)
    nifty = pd.Series(
        20000.0 * np.exp(np.cumsum(rng.normal(0.0, 0.005, len(daily)))),
        index=daily.index,
    )
    res = gen.market_stats(daily, nifty)
    for key in (
        "beta",
        "corr_nifty",
        "cum_gap",
        "cum_intra",
        "gap_up_pct",
        "median_gap",
        "median_intra",
    ):
        assert key in res, key
        val = res[key]
        assert isinstance(val, (int, float, np.floating)), (key, type(val))
        assert np.isfinite(val), (key, val)
    assert -5.0 <= res["beta"] <= 5.0
    assert -1.0 <= res["corr_nifty"] <= 1.0
    assert 0.0 <= res["gap_up_pct"] <= 100.0


def test_market_stats_returns_empty_dict_when_nifty_is_none():
    daily = _synthetic_daily()
    assert gen.market_stats(daily, None) == {}


# --------------------------------------------------------------------------
# event_study
# --------------------------------------------------------------------------
def _event_daily(n=60, start="2025-01-06"):
    idx = pd.bdate_range(start, periods=n)
    close = 100.0 + np.arange(n, dtype=float) * 2.0  # known arithmetic series
    volume = 1000.0 + np.arange(n, dtype=float) * 10.0
    return pd.DataFrame({"close": close, "volume": volume}, index=idx)


def test_event_study_skips_pre_window_and_computes_returns():
    daily = _event_daily()
    ed = pd.DataFrame(
        {
            "date_ist": [
                pd.Timestamp("2024-12-15"),  # before first daily date -> skipped
                pd.Timestamp("2025-02-10", tz="Asia/Kolkata"),  # beat
                pd.Timestamp("2025-02-17", tz="Asia/Kolkata"),  # miss
                pd.Timestamp("2025-02-24", tz="Asia/Kolkata"),  # beat (enables rho)
            ],
            "eps_est": [10.0, 10.0, 10.0, 10.0],
            "eps_actual": [9.0, 11.0, 8.5, 10.3],
            "surprise_pct": [-10.0, 8.0, -6.0, 3.0],
        }
    )
    ev = gen.event_study(ed, daily)

    # (a) the event dated before the first daily date is skipped
    assert len(ev) == 3
    assert "2024-12-15" not in set(ev["ann_date_ist"])

    # (b) an in-window event has ret_d0 computed against the known close series
    idx_list = list(daily.index)
    d0 = pd.Timestamp("2025-02-10")
    pos = idx_list.index(d0)
    expected_ret_d0 = (
        daily.loc[idx_list[pos], "close"] / daily.loc[idx_list[pos - 1], "close"] - 1.0
    )
    row = ev.loc[ev["d0"] == "2025-02-10"].iloc[0]
    assert row["ann_date_ist"] == "2025-02-10"
    assert np.isclose(row["ret_d0"], expected_ret_d0)

    # (c) output has the expected columns, including the derived aggregate columns
    expected_cols = {
        "ann_date_ist",
        "d0",
        "surprise_pct",
        "eps_est",
        "eps_actual",
        "ret_d0",
        "ret_d1",
        "ret_d3",
        "ret_d5",
        "ret_d10",
        "vol_ratio_d0",
        "surprise_rho",
        "surprise_p",
        "beat_10d",
        "miss_10d",
        "earn_vol_ratio",
    }
    assert expected_cols.issubset(set(ev.columns))
    for col in ("surprise_rho", "beat_10d", "miss_10d", "earn_vol_ratio"):
        assert np.isfinite(ev[col].iloc[0]), col
