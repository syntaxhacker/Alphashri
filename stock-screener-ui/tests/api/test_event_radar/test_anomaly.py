"""Tripwire math tests — pure functions, synthetic bars, plus one real-data regression.

No network anywhere in this file: the fetchers are never called. The real-data
test reads a recorded ORCL 1-minute tape from ``fixtures/``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from api.event_radar.anomaly import (
    SIGMA_FLOOR,
    apply_cooldown,
    baseline_profile,
    detect,
    robust_sigma,
    scan_symbol,
)
from api.event_radar.contract import Anomaly

FIXTURES = Path(__file__).parent / "fixtures"


# --------------------------------------------------------------------------- #
# Synthetic bars
# --------------------------------------------------------------------------- #


def make_bars(
    sessions: int = 6,
    minutes: int = 30,
    *,
    jump_at: int | None = 15,
    jump_pct: float = 0.0,
    jump_vol_mult: float = 1.0,
    noise: float = 0.0,
) -> pd.DataFrame:
    """``sessions`` days of ``minutes`` 1-minute bars starting 09:30 New York.

    The baseline is flat (or a deterministic ±noise wiggle) and the LAST session
    carries the injected move, so the last session is always the one under test.
    """
    stamps: list[pd.Timestamp] = []
    for day in range(sessions):
        start = pd.Timestamp("2026-10-19 09:30", tz="America/New_York") + pd.Timedelta(days=day)
        stamps.extend(pd.date_range(start, periods=minutes, freq="1min"))
    index = pd.DatetimeIndex(stamps)

    rng = np.random.default_rng(7)
    close = np.full(len(index), 100.0)
    if noise:
        wiggle = np.cumsum(rng.normal(0.0, noise, size=len(index)))
        close = close + wiggle
    volume = np.full(len(index), 1000.0)

    if jump_at is not None and jump_pct:
        offset = (sessions - 1) * minutes + jump_at
        close[offset:] = close[offset] * (1.0 + jump_pct)
        volume[offset] = 1000.0 * jump_vol_mult

    return pd.DataFrame(
        {
            "Open": close,
            "High": close,
            "Low": close,
            "Close": close,
            "Volume": volume,
        },
        index=index,
    )


class TestRobustSigma:
    def test_constant_series_is_zero(self):
        assert robust_sigma([5.0] * 10) == 0.0

    def test_symmetric_series_scales_the_mad(self):
        # median 0, |deviation| all 1 -> MAD 1 -> 1.4826
        assert robust_sigma([-1.0, 0.0, 1.0]) == pytest.approx(1.4826)

    def test_too_few_samples(self):
        assert robust_sigma([]) == 0.0
        assert robust_sigma([0.1]) == 0.0
        assert robust_sigma([0.1, 0.2]) == 0.0

    def test_nan_and_inf_are_ignored(self):
        assert robust_sigma([float("nan"), 1.0, 1.0, 1.0, float("inf")]) == 0.0

    def test_never_raises_on_junk(self):
        assert robust_sigma([None, "x", 3.0]) == 0.0  # type: ignore[list-item]

    def test_outlier_does_not_move_it_much(self):
        base = [0.1, -0.1, 0.05, -0.05, 0.0, 0.02, -0.02]
        with_outlier = base + [5.0]
        assert robust_sigma(with_outlier) == pytest.approx(robust_sigma(base), rel=0.6)


class TestBaselineProfile:
    def test_minute_lookup_and_median_volume(self):
        bars = make_bars()
        profile = baseline_profile(bars)
        assert 9 * 60 + 30 in profile  # 09:30
        assert 9 * 60 + 45 in profile
        median_volume, sigma = profile[9 * 60 + 30]
        assert median_volume == pytest.approx(1000.0)
        assert sigma == 0.0  # perfectly flat baseline

    def test_empty_frame(self):
        assert baseline_profile(pd.DataFrame()) == {}

    def test_missing_column_returns_empty(self):
        bars = make_bars().drop(columns=["Volume"])
        assert baseline_profile(bars) == {}

    def test_returns_are_computed_per_session(self):
        # A gap between sessions must not enter the intraday sigma: every
        # session opens 10% above the previous close, and the profile is still
        # flat because there is no *within-session* move.
        bars = make_bars(sessions=4, minutes=10)
        for day, start in enumerate(range(0, len(bars), 10)):
            bars.iloc[start : start + 10, bars.columns.get_loc("Close")] = 100.0 * (1.1**day)
        profile = baseline_profile(bars)
        assert profile[9 * 60 + 30][1] == 0.0


class TestDetect:
    def test_ten_percent_on_13x_volume_fires(self):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        profile = baseline_profile(bars.iloc[: -30])  # first 5 sessions only
        found = detect(bars, profile, symbol="ORCL")

        assert len(found) == 1
        hit = found[0]
        assert hit.symbol == "ORCL"
        assert hit.ret_pct == pytest.approx(10.0, abs=0.01)
        assert hit.vol_ratio == pytest.approx(13.0)
        assert hit.price == pytest.approx(110.0)
        assert hit.suspected and "13.0x" in hit.suspected
        assert hit.ts.startswith("2026-10-24T09:45:00")  # 5 sessions after 10-19

    def test_small_move_on_small_volume_does_not_fire(self):
        bars = make_bars(jump_pct=0.004, jump_vol_mult=2.0)
        profile = baseline_profile(bars.iloc[: -30])
        assert detect(bars, profile, symbol="ORCL") == []

    def test_big_move_on_ordinary_volume_does_not_fire(self):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=2.0)
        profile = baseline_profile(bars.iloc[: -30])
        assert detect(bars, profile, symbol="ORCL") == []

    def test_zero_volume_bars_are_skipped(self):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        bars.iloc[-15, bars.columns.get_loc("Volume")] = 0.0  # the 09:45 jump bar
        profile = baseline_profile(bars.iloc[: -30])
        assert detect(bars, profile, symbol="ORCL") == []

    def test_dead_quiet_sigma_falls_back_to_the_floor(self):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        profile = baseline_profile(bars.iloc[: -30])
        assert profile[9 * 60 + 45][1] == 0.0  # dead quiet

        hit = detect(bars, profile, symbol="ORCL")[0]
        assert hit.ret_sigma == pytest.approx(0.10 / SIGMA_FLOOR, rel=0.01)
        assert np.isfinite(hit.ret_sigma)

    def test_minute_without_a_baseline_is_skipped(self):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        profile = baseline_profile(bars.iloc[: -30])
        profile.pop(9 * 60 + 45)
        assert detect(bars, profile, symbol="ORCL") == []

    def test_only_the_last_session_is_evaluated(self):
        bars = make_bars(sessions=6, jump_at=15, jump_pct=0.10, jump_vol_mult=13.0)
        # Move the shock into an earlier session: nothing to report today.
        offset = 2 * 30 + 15
        close = bars["Close"].to_numpy(copy=True)
        close[offset:] = close[offset] * 1.10
        bars["Close"] = close
        volume = bars["Volume"].to_numpy(copy=True)
        volume[offset] = 13000.0
        bars["Volume"] = volume

        profile = baseline_profile(bars.iloc[: -30])
        assert detect(bars, profile, symbol="ORCL") == []

    def test_symbol_falls_back_to_frame_attrs(self):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        bars.attrs["symbol"] = "msft"
        profile = baseline_profile(bars.iloc[: -30])
        assert detect(bars, profile)[0].symbol == "MSFT"

    def test_empty_inputs(self):
        assert detect(pd.DataFrame(), {}) == []
        assert detect(make_bars(), {}) == []
        assert detect(make_bars().iloc[:1], {540: (1.0, 0.0)}) == []


class TestCooldown:
    def _an(self, symbol: str, ts: str) -> Anomaly:
        return Anomaly(symbol=symbol, ts=ts, price=1.0, ret_pct=5.0, ret_sigma=9.0, vol_ratio=9.0)

    def test_keeps_the_first_and_mutes_the_rest(self):
        anomalies = [
            self._an("ORCL", "2026-10-28T14:19:00-04:00"),
            self._an("ORCL", "2026-10-28T14:20:00-04:00"),  # 1 min later
            self._an("MSFT", "2026-10-28T14:20:00-04:00"),  # other symbol
            self._an("ORCL", "2026-10-28T15:05:00-04:00"),  # > 30 min later
        ]
        kept = apply_cooldown(anomalies, cooldown_min=30)
        assert [(an.symbol, an.ts) for an in kept] == [
            ("ORCL", "2026-10-28T14:19:00-04:00"),
            ("MSFT", "2026-10-28T14:20:00-04:00"),
            ("ORCL", "2026-10-28T15:05:00-04:00"),
        ]

    def test_order_of_input_does_not_matter(self):
        anomalies = [
            self._an("ORCL", "2026-10-28T14:25:00-04:00"),
            self._an("ORCL", "2026-10-28T14:19:00-04:00"),
        ]
        kept = apply_cooldown(anomalies, cooldown_min=30)
        assert [an.ts for an in kept] == ["2026-10-28T14:19:00-04:00"]

    def test_input_list_is_not_mutated(self):
        anomalies = [
            self._an("ORCL", "2026-10-28T14:25:00-04:00"),
            self._an("ORCL", "2026-10-28T14:19:00-04:00"),
        ]
        snapshot = list(anomalies)
        apply_cooldown(anomalies)
        assert anomalies == snapshot

    def test_empty(self):
        assert apply_cooldown([]) == []


# --------------------------------------------------------------------------- #
# Real-data regression (recorded ORCL tape, 2026-10-19 .. 2026-10-28)
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def orcl_bars() -> pd.DataFrame:
    frame = pd.read_csv(FIXTURES / "orcl_8d_1m.csv", parse_dates=["ts"], index_col="ts")
    frame.index = frame.index.tz_convert("America/New_York")
    return frame[["Open", "High", "Low", "Close", "Volume"]]


class TestRealData:
    def test_oracle_investor_day_breakout_is_detected(self, orcl_bars):
        sessions = np.unique(np.asarray(orcl_bars.index.date))
        assert len(sessions) == 8
        assert str(sessions[-1]) == "2026-10-28"

        baseline = orcl_bars[orcl_bars.index.date < sessions[-1]]
        profile = baseline_profile(baseline)
        found = detect(orcl_bars, profile, symbol="ORCL")

        assert found, "the 2026-10-28 investor-day ramp must trip the tripwire"

        window = [
            an
            for an in found
            if "2026-10-28T14:15:00" <= an.ts <= "2026-10-28T14:25:59"
        ]
        assert window, "the anomaly must land in the 14:15-14:25 ET window"

        first = window[0]
        assert first.ret_pct > 0
        assert first.vol_ratio > 8.0
        assert first.ret_sigma >= 4.0

        # CONTRACT/SPEC CONFLICT, resolved in favour of the recorded tape:
        # the spec asked for a single-bar ret_pct > 5, but no 1-minute bar in
        # this file moves more than 2.28% — the >5% move is the 10-minute ramp.
        # Assert the window (not one bar) and the ignition bar's real size.
        ten_minute = orcl_bars.loc["2026-10-28 14:15":"2026-10-28 14:25"]
        window_move = (
            ten_minute["Close"].iloc[-1] / ten_minute["Close"].iloc[0] - 1.0
        ) * 100.0
        assert window_move > 5.0
        assert first.ret_pct > 1.0

    def test_cooldown_returns_only_the_ignition_bar(self, orcl_bars):
        sessions = np.unique(np.asarray(orcl_bars.index.date))
        baseline = orcl_bars[orcl_bars.index.date < sessions[-1]]
        raw = detect(orcl_bars, baseline_profile(baseline), symbol="ORCL")
        cooled = apply_cooldown(raw)
        assert len(cooled) < len(raw)
        assert cooled[0].ts == raw[0].ts


class TestScanSymbol:
    def test_short_history_is_not_scored(self, monkeypatch):
        bars = make_bars(sessions=1)
        monkeypatch.setattr("api.event_radar.anomaly.fetch_us_1m", lambda symbol: bars)
        assert scan_symbol("ORCL", "us") == []

    def test_fetch_failure_raises(self, monkeypatch):
        def boom(symbol):
            raise RuntimeError("no intraday data for ORCL")

        monkeypatch.setattr("api.event_radar.anomaly.fetch_us_1m", boom)
        with pytest.raises(RuntimeError):
            scan_symbol("ORCL", "us")

    def test_scan_marks_the_exchange_and_cools_down(self, monkeypatch):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        monkeypatch.setattr("api.event_radar.anomaly.fetch_us_1m", lambda symbol: bars)
        found = scan_symbol("ORCL", "us")
        assert len(found) == 1
        assert found[0].exchange == "NASDAQ"

    def test_india_path_uses_the_nse_frame(self, monkeypatch):
        bars = make_bars(jump_pct=0.10, jump_vol_mult=13.0)
        monkeypatch.setattr("api.event_radar.anomaly.fetch_india_1m", lambda symbol: bars)
        found = scan_symbol("RELIANCE", "india")
        assert found and found[0].exchange == "NSE"
