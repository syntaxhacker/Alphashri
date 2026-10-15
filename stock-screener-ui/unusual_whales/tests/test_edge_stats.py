"""Tests for edge_stats dedupe (independent observations) + resolver exit pick.

All synthetic — no real alerts.db / edge.db is touched. `edge_stats.build_rows`
is exercised directly with monkeypatched outcomes + metadata.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import edge_resolver as R  # noqa: E402
import edge_stats as S  # noqa: E402


def _make(outs, meta):
    """Build (outcomes, meta) closures for monkeypatching."""

    def add(ticker, ts, dir_, ret, exc, horizon="5m", kind="flow",
            asset="etf", sweep=1, premium=2_000_000):
        aid = f"{ticker}:{ts}:{len(outs)}"
        meta[aid] = {
            "kind": kind,
            "ticker": ticker,
            "asset_class": asset,
            "sweep": sweep,
            "premium": premium,
            "event_ts": ts,
        }
        outs.append(
            {
                "alert_id": aid,
                "horizon": horizon,
                "entry_ts": ts,
                "dir": dir_,
                "ret": ret,
                "excess": exc,
            }
        )

    return add


@pytest.fixture()
def patch_stats(monkeypatch):
    outs: list = []
    meta: dict = {}
    add = _make(outs, meta)
    monkeypatch.setattr(S.edge_store, "get_outcomes", lambda: outs)
    monkeypatch.setattr(S, "_meta_for", lambda ids: meta)
    return add, S.build_rows


def test_dedupe_collapses_same_ticker_minute(patch_stats):
    add, build_rows = patch_stats
    # same ticker + minute + dir => ONE independent observation (mean of group)
    add("SPY", "2026-09-29T20:15:00Z", 1, 1.0, 0.1)
    add("SPY", "2026-09-29T20:15:30Z", 1, 1.0, 0.1)
    add("SPY", "2026-09-29T20:15:50Z", 1, 3.0, 0.3)
    add("SPY", "2026-09-29T20:16:00Z", 1, 2.0, 0.2)
    add("QQQ", "2026-09-29T20:15:00Z", 1, -1.0, -0.1)

    row = next(
        r for r in build_rows()
        if r["scope"] == "kind" and r["bucket"] == "flow" and r["horizon"] == "5m"
    )
    assert row["n_raw"] == 5
    assert row["n_ind"] == 3  # SPY 20:15, SPY 20:16, QQQ 20:15
    assert row["distinct_tickers"] == 2
    assert row["distinct_sessions"] == 1
    assert row["low_n"] == 1  # below the 20 / 5 / 2 gate
    # win rate is a FRACTION over independent observations: SPY 20:15 (+), SPY
    # 20:16 (+), QQQ (-) => 2/3
    assert row["win_rate"] == round(2 / 3, 4)
    # avg_ret is a FRACTION too (percent / 100) of the independent means
    assert row["avg_ret"] == pytest.approx(((1 + 1 + 3) / 3 + 2 - 1) / 3 / 100.0, abs=1e-6)
    assert row["avg_excess"] == pytest.approx((0.1666667 + 0.2 - 0.1) / 3 / 100.0, abs=1e-6)
    assert row["tstat"] is not None  # computed from the 3 independent excess values


def test_group_mean_uses_all_group_members(patch_stats):
    add, build_rows = patch_stats
    # three identical contracts at one instant must average, not triple-count
    add("SPY", "2026-09-29T20:15:00Z", 1, 2.0, 0.2)
    add("SPY", "2026-09-29T20:15:10Z", 1, 4.0, 0.4)
    add("SPY", "2026-09-29T20:15:20Z", 1, 6.0, 0.6)
    row = next(
        r for r in build_rows()
        if r["scope"] == "ticker" and r["bucket"] == "SPY" and r["horizon"] == "5m"
    )
    assert row["n_raw"] == 3 and row["n_ind"] == 1
    assert row["avg_ret"] == pytest.approx(0.04, abs=1e-6)  # mean 4% -> 0.04
    assert row["avg_excess"] == pytest.approx(0.004, abs=1e-6)
    assert row["win_rate"] == 1.0


def test_ranked_gate_requires_20_ind_5_tickers_2_sessions(patch_stats):
    add, build_rows = patch_stats
    tickers = ["SPY", "QQQ", "IWM", "TLT", "GLD"]
    for ticker in tickers:
        for day in ("2026-09-28", "2026-09-29"):
            for minute in (15, 16):
                add(ticker, f"{day}T20:{minute}:00Z", 1, 0.5, 0.05)
    # 5 tickers x 2 sessions x 2 minutes = 20 independent observations
    row = next(
        r for r in build_rows()
        if r["scope"] == "kind" and r["bucket"] == "flow" and r["horizon"] == "5m"
    )
    assert row["n_ind"] == 20
    assert row["distinct_tickers"] == 5
    assert row["distinct_sessions"] == 2
    assert row["low_n"] == 0
    assert row["win_rate"] == 1.0
    assert row["avg_ret"] == pytest.approx(0.005, abs=1e-6)
    assert row["avg_excess"] == pytest.approx(0.0005, abs=1e-6)


def test_missing_excess_leaves_avg_excess_none(patch_stats):
    add, build_rows = patch_stats
    add("SPY", "2026-09-29T20:15:00Z", 1, 1.0, None)
    add("QQQ", "2026-09-29T20:15:00Z", 1, 1.0, None)
    row = next(
        r for r in build_rows()
        if r["scope"] == "kind" and r["bucket"] == "flow" and r["horizon"] == "5m"
    )
    assert row["n_ind"] == 2
    assert row["avg_excess"] is None and row["tstat"] is None


# ------------------------------------------------------------ resolver exit pick
def test_exit_bar_closest_to_target_not_last_in_window():
    base = datetime(2026, 9, 29, 20, 15, tzinfo=timezone.utc)
    bars = [{"ts": R._iso(base + timedelta(minutes=k)), "c": 100 + k} for k in (0, 5, 10)]
    series = R._series(bars)
    target = base + timedelta(minutes=5)  # 5m horizon
    picked = R._closest_bar(series, target, 5)
    assert picked["ts"] == R._iso(target)  # NOT the +10 bar


def test_exit_bar_outside_tolerance_is_none():
    base = datetime(2026, 9, 29, 20, 15, tzinfo=timezone.utc)
    bars = [{"ts": R._iso(base + timedelta(minutes=20)), "c": 120}]
    assert R._closest_bar(R._series(bars), base + timedelta(minutes=5), 5) is None


def test_targets_cover_full_horizon_plus_tolerance():
    dt = datetime(2026, 9, 29, 20, 15, tzinfo=timezone.utc)
    intra, daily = R._targets_for(dt, ["60m"])
    assert intra == [(dt, dt + timedelta(minutes=65))]
    assert daily == []
    intra, daily = R._targets_for(dt, ["1d"])
    assert intra == [(dt, dt + timedelta(minutes=5))]
    assert daily == [(dt, dt)]
