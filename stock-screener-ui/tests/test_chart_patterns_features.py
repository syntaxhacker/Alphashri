"""Direct unit tests for the pure helpers in ``chart_patterns/features.py``.

Synthetic pandas/numpy data only (no network, no DB, no broker). Expected
values are hand-computed from the documented maths; floats use
``pytest.approx``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F

_INDEX = pd.date_range("2024-01-01", periods=200, freq="D", tz="UTC")


def make_frame(
    closes,
    *,
    spread: float = 0.5,
    volume: float = 1000.0,
    high=None,
    low=None,
    open_=None,
) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.asarray(open_, dtype=float) if open_ is not None else np.concatenate([[close[0]], close[:-1]]) if n else np.array([], dtype=float),
            "high": np.asarray(high, dtype=float) if high is not None else close + spread,
            "low": np.asarray(low, dtype=float) if low is not None else close - spread,
            "close": close,
            "volume": np.full(n, float(volume)),
        },
        index=_INDEX[:n],
    )


def atr_frame() -> pd.DataFrame:
    # True ranges: TR0 = 10-9 = 1
    # TR1 = max(12-10, |12-9.5|, |10-9.5|) = max(2, 2.5, 0.5) = 2.5
    # TR2 = max(11-10, |11-11|, |10-11|) = max(1, 0, 1) = 1
    return pd.DataFrame(
        {
            "open": [9.5, 11.0, 10.5],
            "high": [10.0, 12.0, 11.0],
            "low": [9.0, 10.0, 10.0],
            "close": [9.5, 11.0, 10.5],
            "volume": [100.0, 100.0, 100.0],
        },
        index=_INDEX[:3],
    )


# ---------------------------------------------------------------------------
# normalize_ohlcv
# ---------------------------------------------------------------------------


class TestNormalizeOhlcv:
    def test_none_returns_none(self):
        assert F.normalize_ohlcv(None) is None

    def test_non_dataframe_returns_none(self):
        assert F.normalize_ohlcv([]) is None
        assert F.normalize_ohlcv(pd.Series([1.0, 2.0])) is None

    def test_empty_dataframe_returns_none(self):
        empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        assert F.normalize_ohlcv(empty) is None

    @pytest.mark.parametrize("missing", ["open", "high", "low", "close"])
    def test_missing_required_column_raises(self, missing):
        df = make_frame([100.0, 101.0]).drop(columns=[missing])
        with pytest.raises(ValueError, match=missing):
            F.normalize_ohlcv(df)

    def test_uppercase_columns_are_lowercased(self):
        df = make_frame([100.0, 101.0]).rename(columns=str.upper)
        out = F.normalize_ohlcv(df)
        assert list(out.columns) == ["open", "high", "low", "close", "volume"]
        assert out["close"].tolist() == [100.0, 101.0]

    def test_mixed_case_columns_are_lowercased(self):
        df = make_frame([100.0]).rename(
            columns={"open": "Open", "high": "High", "low": "Low", "close": "Close", "volume": "Volume"}
        )
        out = F.normalize_ohlcv(df)
        assert list(out.columns) == ["open", "high", "low", "close", "volume"]

    def test_missing_volume_is_filled_with_zero(self):
        df = make_frame([100.0, 101.0]).drop(columns=["volume"])
        out = F.normalize_ohlcv(df)
        assert out["volume"].tolist() == [0.0, 0.0]

    def test_extra_columns_are_dropped(self):
        df = make_frame([100.0])
        df["extra"] = 42.0
        out = F.normalize_ohlcv(df)
        assert "extra" not in out.columns

    def test_nan_close_rows_are_dropped(self):
        df = make_frame([100.0, np.nan, 102.0])
        out = F.normalize_ohlcv(df)
        assert out["close"].tolist() == [100.0, 102.0]
        assert len(out) == 2

    def test_all_nan_closes_return_none(self):
        df = make_frame([np.nan, np.nan])
        assert F.normalize_ohlcv(df) is None

    def test_nan_volume_becomes_zero(self):
        df = make_frame([100.0, 101.0])
        df.iloc[0, df.columns.get_loc("volume")] = np.nan
        out = F.normalize_ohlcv(df)
        assert out["volume"].tolist() == [0.0, 1000.0]

    def test_string_numbers_are_coerced_to_float(self):
        df = pd.DataFrame(
            {"open": ["100"], "high": ["101"], "low": ["99"], "close": ["100.5"], "volume": ["10"]},
            index=_INDEX[:1],
        )
        out = F.normalize_ohlcv(df)
        assert out.iloc[0]["close"] == pytest.approx(100.5)
        assert out.iloc[0]["volume"] == pytest.approx(10.0)
        # to_numeric coerces to a numeric dtype (integers stay int64).
        assert all(pd.api.types.is_numeric_dtype(out[c]) for c in out.columns)
        assert float(out.iloc[0]["open"]) == pytest.approx(100.0)

    def test_non_numeric_close_coerces_to_nan_and_is_dropped(self):
        df = pd.DataFrame(
            {"open": [100.0], "high": [101.0], "low": [99.0], "close": ["abc"]},
            index=_INDEX[:1],
        )
        assert F.normalize_ohlcv(df) is None

    def test_non_numeric_non_close_column_becomes_nan_but_row_is_kept(self):
        df = pd.DataFrame(
            {"open": ["abc"], "high": [101.0], "low": [99.0], "close": [100.0]},
            index=_INDEX[:1],
        )
        out = F.normalize_ohlcv(df)
        assert np.isnan(out.iloc[0]["open"])
        assert out.iloc[0]["close"] == pytest.approx(100.0)

    def test_index_is_sorted_and_preserved(self):
        idx = pd.to_datetime(["2024-01-03", "2024-01-01", "2024-01-02"]).tz_localize("UTC")
        df = pd.DataFrame(
            {
                "open": [3.0, 1.0, 2.0],
                "high": [3.0, 1.0, 2.0],
                "low": [3.0, 1.0, 2.0],
                "close": [3.0, 1.0, 2.0],
                "volume": [30.0, 10.0, 20.0],
            },
            index=idx,
        )
        out = F.normalize_ohlcv(df)
        assert list(out.index) == sorted(idx)
        assert out["close"].tolist() == [1.0, 2.0, 3.0]

    def test_duplicate_index_keeps_last(self):
        idx = pd.to_datetime(["2024-01-02", "2024-01-02"]).tz_localize("UTC")
        df = pd.DataFrame(
            {
                "open": [1.0, 99.0],
                "high": [1.0, 99.0],
                "low": [1.0, 99.0],
                "close": [1.0, 99.0],
                "volume": [1.0, 99.0],
            },
            index=idx,
        )
        out = F.normalize_ohlcv(df)
        assert len(out) == 1
        assert out.iloc[0]["close"] == pytest.approx(99.0)

    def test_does_not_mutate_input(self):
        df = make_frame([100.0, 101.0]).rename(columns=str.upper)
        snapshot = df.copy(deep=True)
        out = F.normalize_ohlcv(df)
        pd.testing.assert_frame_equal(df, snapshot)
        out.iloc[0, out.columns.get_loc("close")] = -1.0
        assert df.iloc[0, df.columns.get_loc("CLOSE")] == pytest.approx(100.0)

    def test_stale_atr_cache_is_not_carried_over(self):
        df = make_frame([100.0, 101.0])
        df.attrs["_atr_cache"] = {14: 123.0}
        out = F.normalize_ohlcv(df)
        assert out.attrs.get("_atr_cache") is None

    def test_contract_frame_fast_path_returns_defensive_copy(self):
        df = make_frame([100.0, 101.0, 102.0])
        assert all(df[c].dtype == np.float64 for c in F.OHLCV_COLUMNS)
        out = F.normalize_ohlcv(df)
        pd.testing.assert_frame_equal(out, df)
        assert out is not df
        out.iloc[0, out.columns.get_loc("close")] = -1.0
        assert df["close"].iloc[0] == pytest.approx(100.0)

    def test_fast_path_matches_full_path(self):
        # Same values through the fast (already-normalised) and full (upper-case
        # names force coercion) branches must be identical.
        df = make_frame([100.0, 101.0, 102.0])
        fast = F.normalize_ohlcv(df)
        slow = F.normalize_ohlcv(df.rename(columns=str.upper))
        pd.testing.assert_frame_equal(fast, slow)

    def test_six_column_frame_takes_fast_path_and_drops_oi(self):
        df = make_frame([100.0, 101.0, 102.0])
        df["oi"] = np.asarray([10, 20, 30], dtype=np.int64)
        assert F._normalized_copy(df) is not None
        out = F.normalize_ohlcv(df)
        assert list(out.columns) == F.OHLCV_COLUMNS
        assert "oi" not in out.columns
        pd.testing.assert_frame_equal(out, make_frame([100.0, 101.0, 102.0]))

    def test_six_column_fast_path_is_defensive_copy(self):
        df = make_frame([100.0, 101.0, 102.0])
        df["oi"] = np.asarray([10, 20, 30], dtype=np.int64)
        snapshot = df.copy(deep=True)
        out = F.normalize_ohlcv(df)
        assert out is not df
        pd.testing.assert_frame_equal(df, snapshot)
        out.iloc[0, out.columns.get_loc("close")] = -1.0
        assert df["close"].iloc[0] == pytest.approx(100.0)

    def test_six_column_reordered_columns_take_fast_path(self):
        df = make_frame([100.0, 101.0])
        df["oi"] = np.asarray([10, 20], dtype=np.int64)
        df = df[["oi", "volume", "close", "low", "high", "open"]]
        assert F._normalized_copy(df) is not None
        out = F.normalize_ohlcv(df)
        pd.testing.assert_frame_equal(out, make_frame([100.0, 101.0]))

    def test_six_column_extra_values_are_not_read(self):
        # The extra column is dropped unread: NaNs there cannot break the fast
        # path, exactly as the full path's ``out[OHLCV_COLUMNS]`` ignores it.
        df = make_frame([100.0, 101.0])
        df["oi"] = np.asarray([np.nan, 20.0], dtype=float)
        assert F._normalized_copy(df) is not None
        out = F.normalize_ohlcv(df)
        pd.testing.assert_frame_equal(out, make_frame([100.0, 101.0]))

    def test_six_column_nan_close_falls_back_and_drops_row(self):
        df = make_frame([100.0, np.nan, 102.0])
        df["oi"] = np.asarray([10, 20, 30], dtype=np.int64)
        assert F._normalized_copy(df) is None
        out = F.normalize_ohlcv(df)
        assert out["close"].tolist() == [100.0, 102.0]
        assert "oi" not in out.columns

    def test_six_column_duplicate_index_falls_back_and_keeps_last(self):
        idx = pd.to_datetime(["2024-01-02", "2024-01-02"]).tz_localize("UTC")
        df = pd.DataFrame(
            {
                "open": [1.0, 99.0],
                "high": [1.0, 99.0],
                "low": [1.0, 99.0],
                "close": [1.0, 99.0],
                "volume": [1.0, 99.0],
                "oi": [5, 9],
            },
            index=idx,
        )
        assert F._normalized_copy(df) is None
        out = F.normalize_ohlcv(df)
        assert len(out) == 1
        assert out.iloc[0]["close"] == pytest.approx(99.0)

    def test_six_column_non_float_dtypes_fall_back_to_coercion(self):
        df = pd.DataFrame(
            {"open": ["100"], "high": ["101"], "low": ["99"], "close": ["100.5"], "volume": ["10"], "oi": [7]},
            index=_INDEX[:1],
        )
        assert F._normalized_copy(df) is None
        out = F.normalize_ohlcv(df)
        assert float(out.iloc[0]["close"]) == pytest.approx(100.5)
        assert "oi" not in out.columns

    def test_detect_patterns_identical_with_extra_column_and_full_path(self):
        from chart_patterns.engine import detect_patterns

        i = np.arange(140)
        closes = 100.0 + 2.0 * np.sin(i * 2.0 * np.pi / 20.0)
        base = make_frame(closes)
        six = base.copy()
        six["oi"] = np.full(len(base), 7, dtype=np.int64)
        upper = six.rename(columns=str.upper)

        def sig(hits):
            return [
                (h.pattern_id, h.status, h.base_days, h.breakout_level, h.confidence, h.start_date, h.end_date)
                for h in hits
            ]

        fast_hits = sig(detect_patterns(six, "1D", "SYN"))
        full_hits = sig(detect_patterns(upper, "1D", "SYN"))
        plain_hits = sig(detect_patterns(base, "1D", "SYN"))
        assert full_hits
        assert fast_hits == full_hits
        assert fast_hits == plain_hits


# ---------------------------------------------------------------------------
# linreg_fit / relative_slope / is_horizontal
# ---------------------------------------------------------------------------


class TestLinregFit:
    def test_rising_series(self):
        slope, intercept, r2 = F.linreg_fit(list(range(10)), [2 * x + 5 for x in range(10)])
        assert slope == pytest.approx(2.0)
        assert intercept == pytest.approx(5.0)
        assert r2 == pytest.approx(1.0)

    def test_falling_series(self):
        slope, intercept, r2 = F.linreg_fit(list(range(10)), [-3 * x + 100 for x in range(10)])
        assert slope == pytest.approx(-3.0)
        assert intercept == pytest.approx(100.0)
        assert r2 == pytest.approx(1.0)

    def test_flat_series(self):
        slope, intercept, r2 = F.linreg_fit(list(range(10)), [100.0] * 10)
        assert slope == pytest.approx(0.0, abs=1e-9)
        assert intercept == pytest.approx(100.0)
        assert r2 == pytest.approx(1.0)

    def test_empty_input(self):
        assert F.linreg_fit([], []) == (0.0, 0.0, 0.0)

    def test_single_point(self):
        assert F.linreg_fit([3.0], [42.0]) == (0.0, 42.0, 1.0)

    def test_two_points_exact_fit(self):
        slope, intercept, r2 = F.linreg_fit([0.0, 4.0], [10.0, 30.0])
        assert slope == pytest.approx(5.0)
        assert intercept == pytest.approx(10.0)
        assert r2 == pytest.approx(1.0)

    def test_noisy_series_reports_r2_in_unit_interval(self):
        slope, intercept, r2 = F.linreg_fit([0, 1, 2, 3, 4], [1.0, 2.1, 2.9, 4.2, 5.0])
        assert slope == pytest.approx(1.02, abs=0.05)
        assert 0.0 <= r2 <= 1.0
        assert r2 == pytest.approx(0.998, abs=0.01)


class TestRelativeSlopeAndHorizontal:
    def test_relative_slope_exact(self):
        assert F.relative_slope(2.0, 10, 100.0) == pytest.approx(0.2)
        assert F.relative_slope(-1.0, 5, 50.0) == pytest.approx(-0.1)

    def test_relative_slope_zero_mean_returns_zero(self):
        assert F.relative_slope(1.0, 10, 0.0) == 0.0

    def test_relative_slope_negative_mean_returns_zero(self):
        assert F.relative_slope(1.0, 10, -50.0) == 0.0

    def test_relative_slope_nonpositive_span_returns_zero(self):
        assert F.relative_slope(1.0, 0, 100.0) == 0.0
        assert F.relative_slope(1.0, -5, 100.0) == 0.0

    def test_is_horizontal_below_tolerance(self):
        # drift = 1*2/100 = 0.02 < 0.03 default tol
        assert F.is_horizontal(1.0, 2, 100.0) is True

    def test_is_horizontal_above_tolerance(self):
        # drift = 1*10/100 = 0.10 > 0.03
        assert F.is_horizontal(1.0, 10, 100.0) is False

    def test_is_horizontal_exactly_at_tolerance_is_true(self):
        # drift = 1*3/100 = 0.03 == tol (<= boundary)
        assert F.is_horizontal(1.0, 3, 100.0, tol=0.03) is True

    def test_is_horizontal_just_above_tolerance_is_false(self):
        # drift = 1.0001*3/100 = 0.030003 > 0.03
        assert F.is_horizontal(1.0001, 3, 100.0, tol=0.03) is False

    def test_is_horizontal_negative_slope_uses_absolute_drift(self):
        assert F.is_horizontal(-1.0, 3, 100.0, tol=0.03) is True
        assert F.is_horizontal(-2.0, 3, 100.0, tol=0.03) is False

    def test_is_horizontal_custom_tolerance(self):
        assert F.is_horizontal(1.0, 10, 100.0, tol=0.15) is True
        assert F.is_horizontal(1.0, 10, 100.0, tol=0.05) is False


# ---------------------------------------------------------------------------
# atr / atr_value
# ---------------------------------------------------------------------------


class TestAtr:
    def test_hand_computed_ema(self):
        # TR = [1.0, 2.5, 1.0], period=2 -> alpha=0.5
        # EMA = [1.0, 1.75, 1.375]
        s = F.atr(atr_frame(), period=2)
        assert s.tolist() == pytest.approx([1.0, 1.75, 1.375])
        assert list(s.index) == list(atr_frame().index)

    def test_first_bar_true_range_is_high_minus_low(self):
        s = F.atr(atr_frame(), period=14)
        assert s.iloc[0] == pytest.approx(1.0)

    def test_zero_range_series_is_zero(self):
        df = make_frame([100.0] * 5, spread=0.0)
        assert F.atr(df, period=2).tolist() == pytest.approx([0.0] * 5)

    def test_period_greater_than_length(self):
        # alpha = 1/14; seed EMA0 = 1.0, then EMA1 = 1 + (2.5-1)/14
        s = F.atr(atr_frame(), period=14)
        assert len(s) == 3
        assert s.iloc[0] == pytest.approx(1.0)
        assert s.iloc[1] == pytest.approx(1.0 + 1.5 / 14)

    def test_period_zero_is_guarded_to_one(self):
        # max(period, 1) -> alpha = 1.0, so EMA equals the TR itself.
        s = F.atr(atr_frame(), period=0)
        assert s.tolist() == pytest.approx([1.0, 2.5, 1.0])

    def test_empty_frame_returns_empty_series(self):
        s = F.atr(pd.DataFrame({"high": [], "low": [], "close": []}), period=2)
        assert isinstance(s, pd.Series)
        assert len(s) == 0

    def test_none_returns_empty_series(self):
        assert len(F.atr(None, period=2)) == 0


class TestAtrValue:
    def test_last_ema_value(self):
        assert F.atr_value(atr_frame(), period=2) == pytest.approx(1.375)

    def test_none_returns_zero(self):
        assert F.atr_value(None) == 0.0

    def test_empty_returns_zero(self):
        empty = pd.DataFrame({"high": [], "low": [], "close": []})
        assert F.atr_value(empty) == 0.0

    def test_zero_range_returns_zero(self):
        df = make_frame([100.0] * 5, spread=0.0)
        assert F.atr_value(df, period=2) == 0.0

    def test_result_is_memoized_on_frame(self):
        df = atr_frame()
        first = F.atr_value(df, period=2)
        df.iloc[2, df.columns.get_loc("high")] = 999.0
        assert F.atr_value(df, period=2) == pytest.approx(first)

    def test_different_periods_are_cached_separately(self):
        df = atr_frame()
        v2 = F.atr_value(df, period=2)
        v14 = F.atr_value(df, period=14)
        assert v2 == pytest.approx(1.375)
        assert v14 == pytest.approx(float(F.atr(df, period=14).iloc[-1]))

    def test_memo_does_not_write_frame_attrs(self):
        # The memo lives in a frame-scoped store, not ``df.attrs``: pandas 3
        # deep-copies attrs on every derived Series, which is the cost we removed.
        df = atr_frame()
        F.atr_value(df, period=2)
        assert "_atr_cache" not in df.attrs

    def test_memo_is_scoped_per_frame(self):
        wide = atr_frame()
        narrow = pd.DataFrame(
            {
                "open": [9.9, 10.0, 10.0],
                "high": [10.0, 10.2, 10.1],
                "low": [9.8, 9.9, 9.9],
                "close": [9.9, 10.0, 10.0],
                "volume": [100.0, 100.0, 100.0],
            },
            index=_INDEX[:3],
        )
        assert F.atr_value(wide, period=2) == pytest.approx(1.375)
        assert F.atr_value(narrow, period=2) != pytest.approx(1.375)


# ---------------------------------------------------------------------------
# is_volume_confirmed
# ---------------------------------------------------------------------------


class TestIsVolumeConfirmed:
    def frame(self, volumes) -> pd.DataFrame:
        n = len(volumes)
        df = make_frame([100.0] * n)
        df["volume"] = np.asarray(volumes, dtype=float)
        return df

    def test_above_multiplier(self):
        df = self.frame([100.0] * 5 + [150.0])  # mean prior = 100 -> threshold 120
        assert F.is_volume_confirmed(df, 5) is True

    def test_below_multiplier(self):
        df = self.frame([100.0] * 5 + [110.0])
        assert F.is_volume_confirmed(df, 5) is False

    def test_exactly_at_multiplier_is_not_confirmed(self):
        df = self.frame([100.0] * 5 + [120.0])  # strict > comparison
        assert F.is_volume_confirmed(df, 5) is False

    def test_custom_multiplier(self):
        df = self.frame([100.0] * 5 + [130.0])
        assert F.is_volume_confirmed(df, 5, mult=1.2) is True
        assert F.is_volume_confirmed(df, 5, mult=1.5) is False

    def test_zero_average_is_not_confirmed(self):
        df = self.frame([0.0] * 5 + [150.0])
        assert F.is_volume_confirmed(df, 5) is False

    def test_zero_current_volume_is_not_confirmed(self):
        df = self.frame([100.0] * 5 + [0.0])
        assert F.is_volume_confirmed(df, 5) is False

    def test_index_out_of_range(self):
        df = self.frame([100.0] * 5 + [150.0])
        assert F.is_volume_confirmed(df, 6) is False
        assert F.is_volume_confirmed(df, 99) is False
        assert F.is_volume_confirmed(df, -99) is False

    def test_first_bar_has_no_prior(self):
        df = self.frame([10000.0] + [100.0] * 5)
        assert F.is_volume_confirmed(df, 0) is False

    def test_negative_index_wraps_to_last_bar(self):
        df = self.frame([100.0] * 5 + [150.0])
        assert F.is_volume_confirmed(df, -1) is True

    def test_lookback_window_excludes_older_bars(self):
        # The 10000 outlier is outside the last-3 window; mean of prior 3 is 100.
        df = self.frame([10000.0, 100.0, 100.0, 100.0, 150.0])
        assert F.is_volume_confirmed(df, 4, lookback=3) is True
        # With lookback=4 the outlier dominates the mean instead.
        assert F.is_volume_confirmed(df, 4, lookback=4) is False

    def test_empty_and_none(self):
        assert F.is_volume_confirmed(pd.DataFrame({"volume": []}), 0) is False
        assert F.is_volume_confirmed(None, 0) is False


# ---------------------------------------------------------------------------
# count_touches
# ---------------------------------------------------------------------------


class TestCountTouches:
    def test_touches_inside_tolerance(self):
        # line = 100, tolerance = 0.75 * 10 = 7.5
        assert F.count_touches([(0, 105.0), (1, 103.0)], 0.0, 100.0, 10.0) == 2

    def test_touches_outside_tolerance(self):
        assert F.count_touches([(0, 110.0)], 0.0, 100.0, 10.0) == 0

    def test_touch_exactly_at_tolerance_boundary(self):
        assert F.count_touches([(0, 107.5)], 0.0, 100.0, 10.0) == 1

    def test_touch_just_beyond_tolerance(self):
        assert F.count_touches([(0, 107.6)], 0.0, 100.0, 10.0) == 0

    def test_pivot_exactly_on_line_counts(self):
        assert F.count_touches([(5, 110.0)], 2.0, 100.0, 4.0) == 1

    def test_slope_is_respected(self):
        # line at x=10 is 120; a pivot at 119 touches, 100 does not.
        assert F.count_touches([(10, 119.0), (10, 100.0)], 2.0, 100.0, 4.0) == 1

    def test_zero_atr_returns_zero_without_division_error(self):
        assert F.count_touches([(0, 100.0)], 0.0, 100.0, 0.0) == 0

    def test_negative_atr_returns_zero(self):
        assert F.count_touches([(0, 100.0)], 0.0, 100.0, -5.0) == 0

    def test_empty_pivots(self):
        assert F.count_touches([], 0.0, 100.0, 10.0) == 0

    def test_custom_tol_atr(self):
        assert F.count_touches([(0, 106.0)], 0.0, 100.0, 10.0, tol_atr=0.5) == 0
        assert F.count_touches([(0, 106.0)], 0.0, 100.0, 10.0, tol_atr=1.0) == 1


# ---------------------------------------------------------------------------
# r2_of / curvature_sign / polyfit_values
# ---------------------------------------------------------------------------


class TestR2Of:
    def test_perfect_fit(self):
        assert F.r2_of([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(1.0)

    def test_constant_series(self):
        assert F.r2_of([5.0, 5.0, 5.0], [5.0, 5.0, 5.0]) == pytest.approx(1.0)

    def test_worse_than_mean_is_clipped_to_zero(self):
        # ss_tot = 50, ss_res = 100 -> 1 - 2 = -1 -> clipped to 0
        assert F.r2_of([0.0, 10.0], [0.0, 0.0]) == pytest.approx(0.0)

    def test_partial_fit(self):
        # ss_tot = 2, ss_res = 0.5 -> 0.75
        assert F.r2_of([1.0, 2.0, 3.0], [1.5, 2.0, 2.5]) == pytest.approx(0.75)


class TestCurvatureSign:
    def test_positive_leading_coefficient(self):
        assert F.curvature_sign([1.0, 0.0, 0.0]) == 1

    def test_negative_leading_coefficient(self):
        assert F.curvature_sign([-2.0, 0.0, 0.0]) == -1

    def test_too_few_coefficients(self):
        assert F.curvature_sign([1.0, 2.0]) == 0
        assert F.curvature_sign([]) == 0

    def test_near_zero_leading_coefficient(self):
        assert F.curvature_sign([1e-13, 0.0, 0.0]) == 0


class TestPolyfitValues:
    def test_quadratic_fit_recovers_parabola(self):
        y = [float(x * x) for x in range(5)]
        fitted, coeffs = F.polyfit_values(y, degree=2)
        assert np.asarray(fitted).tolist() == pytest.approx(y, abs=1e-6)
        assert np.asarray(coeffs).tolist() == pytest.approx([1.0, 0.0, 0.0], abs=1e-6)

    def test_short_input_returns_copy_and_mean_coeffs(self):
        fitted, coeffs = F.polyfit_values([1.0, 2.0], degree=2)
        assert np.asarray(fitted).tolist() == [1.0, 2.0]
        assert np.asarray(coeffs).tolist() == pytest.approx([0.0, 0.0, 1.5])

    def test_empty_input(self):
        fitted, coeffs = F.polyfit_values([], degree=2)
        assert len(fitted) == 0
        assert np.asarray(coeffs).tolist() == [0.0, 0.0, 0.0]

    def test_explicit_x(self):
        fitted, coeffs = F.polyfit_values([2.0, 4.0, 6.0], degree=1, x=[0.0, 1.0, 2.0])
        assert np.asarray(fitted).tolist() == pytest.approx([2.0, 4.0, 6.0], abs=1e-6)
        assert np.asarray(coeffs).tolist() == pytest.approx([2.0, 2.0], abs=1e-6)


# ---------------------------------------------------------------------------
# last_n / between
# ---------------------------------------------------------------------------


class TestLastN:
    def test_last_two(self):
        pivots = [(0, 1.0), (1, 2.0), (2, 3.0)]
        assert F.last_n(pivots, 2) == [(1, 2.0), (2, 3.0)]

    def test_n_greater_than_length_returns_all(self):
        pivots = [(0, 1.0), (1, 2.0)]
        assert F.last_n(pivots, 10) == pivots

    def test_zero_and_negative_return_empty(self):
        pivots = [(0, 1.0)]
        assert F.last_n(pivots, 0) == []
        assert F.last_n(pivots, -3) == []

    def test_empty_input(self):
        assert F.last_n([], 3) == []


class TestBetween:
    def test_inclusive_endpoints(self):
        pivots = [(0, 1.0), (1, 2.0), (2, 3.0), (3, 4.0)]
        assert F.between(pivots, 1, 2) == [(1, 2.0), (2, 3.0)]

    def test_no_match(self):
        assert F.between([(0, 1.0)], 5, 9) == []

    def test_single_point_range(self):
        assert F.between([(2, 3.0)], 2, 2) == [(2, 3.0)]


# ---------------------------------------------------------------------------
# find_swing_highs / find_swing_lows / swing_points / pivot_frame
# ---------------------------------------------------------------------------


class TestSwingPivots:
    def test_single_peak_with_left1_right1(self):
        assert F.find_swing_highs(pd.Series([1.0, 2.0, 3.0, 2.0, 1.0]), left=1, right=1) == [2]

    def test_single_trough_with_left1_right1(self):
        assert F.find_swing_lows(pd.Series([3.0, 2.0, 1.0, 2.0, 3.0]), left=1, right=1) == [2]

    def test_flat_series_has_no_pivots(self):
        assert F.find_swing_highs(pd.Series([1.0] * 7), left=1, right=1) == []
        assert F.find_swing_lows(pd.Series([1.0] * 7), left=1, right=1) == []

    def test_monotonic_series_has_no_pivots(self):
        assert F.find_swing_highs(pd.Series([1.0, 2.0, 3.0, 4.0, 5.0]), left=1, right=1) == []
        assert F.find_swing_lows(pd.Series([1.0, 2.0, 3.0, 4.0, 5.0]), left=1, right=1) == []

    def test_too_short_for_window(self):
        assert F.find_swing_highs(pd.Series([1.0, 2.0, 3.0]), left=2, right=2) == []
        assert F.find_swing_lows(pd.Series([3.0, 2.0, 1.0]), left=2, right=2) == []

    def test_multiple_peaks(self):
        values = [1.0, 3.0, 1.0, 4.0, 1.0]
        assert F.find_swing_highs(pd.Series(values), left=1, right=1) == [1, 3]

    def test_endpoint_peak_is_never_a_pivot(self):
        assert F.find_swing_highs(pd.Series([5.0, 1.0, 1.0, 1.0, 1.0]), left=1, right=1) == []
        assert F.find_swing_lows(pd.Series([0.0, 5.0, 5.0, 5.0, 5.0]), left=1, right=1) == []

    def test_default_window_needs_five_points(self):
        # Peak at index 2 within [0..4] is a pivot with the defaults (2, 2).
        assert F.find_swing_highs(pd.Series([1.0, 2.0, 5.0, 2.0, 1.0])) == [2]


class TestSwingPointsAndPivotFrame:
    def _df(self) -> pd.DataFrame:
        return pd.DataFrame(
            {"high": [1.0, 3.0, 2.0, 1.0, 2.0], "low": [2.0, 1.0, 2.0, 1.0, 3.0]},
            index=_INDEX[:5],
        )

    def test_swing_points_sorted_by_position(self):
        pts = F.swing_points(self._df(), left=1, right=1)
        positions = [p[0] for p in pts]
        assert positions == sorted(positions)
        assert (1, "H", 3.0) in pts
        assert (1, "L", 1.0) in pts
        assert (3, "L", 1.0) in pts

    def test_pivot_frame_marks_only_pivots(self):
        df = self._df()
        pf = F.pivot_frame(df, left=1, right=1)
        assert list(pf.columns) == ["high_pivot", "low_pivot"]
        assert list(pf.index) == list(df.index)
        assert pf["high_pivot"].iloc[1] == pytest.approx(3.0)
        assert pf["high_pivot"].iloc[0] != pf["high_pivot"].iloc[0]  # NaN
        assert pf["low_pivot"].iloc[1] == pytest.approx(1.0)
        assert pf["low_pivot"].iloc[3] == pytest.approx(1.0)
        assert pf["low_pivot"].iloc[2] != pf["low_pivot"].iloc[2]  # NaN


# ---------------------------------------------------------------------------
# line_value / sample_line / fit_pivot_line
# ---------------------------------------------------------------------------


class TestLineHelpers:
    def test_line_value(self):
        assert F.line_value(2.0, 5.0, 3.0) == pytest.approx(11.0)

    def test_sample_line_endpoints(self):
        assert F.sample_line(2.0, 5.0, 0, 4) == [
            {"t": 0, "price": 5.0},
            {"t": 4, "price": 13.0},
        ]

    def test_fit_pivot_line_too_few_pivots(self):
        assert F.fit_pivot_line([]) is None
        assert F.fit_pivot_line([(1, 100.0)]) is None

    def test_fit_pivot_line_collinear(self):
        slope, intercept, r2 = F.fit_pivot_line([(0, 10.0), (1, 12.0), (2, 14.0)])
        assert slope == pytest.approx(2.0)
        assert intercept == pytest.approx(10.0)
        assert r2 == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# swing_extremes / envelope_line / penetration_ratio
# ---------------------------------------------------------------------------


class TestSwingExtremes:
    def test_highest_high_lowest_low(self):
        df = make_frame([100.0, 101.0, 102.0], high=[105.0, 108.0, 107.0], low=[95.0, 97.0, 94.0])
        hi, lo, hi_pos, lo_pos = F.swing_extremes(df, 0, 2)
        assert hi == pytest.approx(108.0)
        assert lo == pytest.approx(94.0)
        assert (hi_pos, lo_pos) == (1, 2)

    def test_subrange(self):
        df = make_frame([100.0, 101.0, 102.0], high=[105.0, 108.0, 107.0], low=[95.0, 97.0, 94.0])
        hi, lo, hi_pos, lo_pos = F.swing_extremes(df, 0, 1)
        assert hi == pytest.approx(108.0)
        assert lo == pytest.approx(95.0)
        assert (hi_pos, lo_pos) == (1, 0)

    def test_out_of_range_bounds_are_clamped(self):
        df = make_frame([100.0, 101.0], high=[105.0, 108.0], low=[95.0, 97.0])
        hi, lo, hi_pos, lo_pos = F.swing_extremes(df, -10, 99)
        assert (hi, lo, hi_pos, lo_pos) == (108.0, 95.0, 1, 0)

    def test_empty_and_none(self):
        assert F.swing_extremes(None, 0, 5) == (0.0, 0.0, 0, 5)
        empty = pd.DataFrame({"high": [], "low": []})
        assert F.swing_extremes(empty, 2, 5) == (0.0, 0.0, 2, 5)


class TestEnvelopeLine:
    def test_fewer_than_two_pivots(self):
        df = make_frame([100.0] * 5)
        assert F.envelope_line(df, [], "upper", 0.5) is None
        assert F.envelope_line(df, [(0, 100.0)], "upper", 0.5) is None

    def test_same_x_pivots_return_none(self):
        df = make_frame([100.0] * 5)
        assert F.envelope_line(df, [(1, 100.0), (1, 101.0)], "upper", 0.5) is None

    def test_flat_upper_boundary(self):
        df = make_frame([10.0] * 5, spread=0.0)  # high == 10 everywhere
        out = F.envelope_line(df, [(0, 10.0), (4, 10.0)], "upper", 0.5)
        assert out["slope"] == pytest.approx(0.0)
        assert out["viol"] == 0
        assert out["x0"] == 0 and out["x1"] == 4

    def test_flat_lower_boundary(self):
        df = make_frame([10.0] * 5, spread=0.0)  # low == 10 everywhere
        out = F.envelope_line(df, [(0, 10.0), (4, 10.0)], "lower", 0.5)
        assert out["slope"] == pytest.approx(0.0)
        assert out["viol"] == 0

    def test_memo_returns_equal_independent_result(self):
        df = make_frame([10.0] * 5, spread=0.0)
        pivots = [(0, 10.0), (4, 10.0)]
        first = F.envelope_line(df, pivots, "upper", 0.5)
        second = F.envelope_line(df, pivots, "upper", 0.5)
        assert first == second
        # Callers must not be able to corrupt the memoized entry.
        assert first is not second

    def test_memo_is_scoped_per_frame(self):
        flat = make_frame([10.0] * 5, spread=0.0)
        high = make_frame([10.0] * 5, spread=0.0, high=[12.0] * 5)
        pivots = [(0, 10.0), (4, 10.0)]
        a = F.envelope_line(flat, pivots, "upper", 0.5)
        b = F.envelope_line(high, pivots, "upper", 0.5)
        assert a["viol"] == 0
        assert b["viol"] == 5

    def test_memo_invalidated_by_in_place_price_edit(self):
        df = make_frame([10.0] * 5, spread=0.0)
        pivots = [(0, 10.0), (4, 10.0)]
        assert F.envelope_line(df, pivots, "upper", 0.5)["viol"] == 0
        df.loc[:, "high"] = 12.0
        edited = F.envelope_line(df, pivots, "upper", 0.5)
        fresh = F.envelope_line(
            make_frame([10.0] * 5, spread=0.0, high=[12.0] * 5), pivots, "upper", 0.5
        )
        assert edited == fresh
        assert edited["viol"] == 5


class TestPenetrationRatio:
    def test_never_pierced_upper(self):
        df = make_frame([9.0, 10.0, 11.0], spread=0.0)
        # line = 10, buffer = max(4*0.25, 1e-9) = 1 -> threshold 11; 11 is not > 11
        assert F.penetration_ratio(df, 0.0, 10.0, 0, 2, "upper", 4.0) == pytest.approx(0.0)

    def test_half_pierced_upper(self):
        df = make_frame([9.0, 11.0, 12.0], spread=0.0)
        # threshold 10 (buffer ~1e-9 with atr=0): 11 and 12 pierce -> 2/3 wait, use atr=4 below
        assert F.penetration_ratio(df, 0.0, 10.0, 0, 2, "upper", 0.0) == pytest.approx(2 / 3)

    def test_all_pierced_lower(self):
        df = make_frame([9.0, 8.0, 7.0], spread=0.0)
        assert F.penetration_ratio(df, 0.0, 10.0, 0, 2, "lower", 0.0) == pytest.approx(1.0)

    def test_none_and_empty(self):
        assert F.penetration_ratio(None, 0.0, 10.0, 0, 2, "upper", 1.0) == 1.0
        assert F.penetration_ratio(pd.DataFrame({"close": []}), 0.0, 10.0, 0, 2, "upper", 1.0) == 1.0

    def test_unknown_side_returns_zero(self):
        df = make_frame([9.0, 11.0])
        assert F.penetration_ratio(df, 0.0, 10.0, 0, 1, "sideways", 1.0) == 0.0

    def test_inverted_range_returns_zero(self):
        df = make_frame([9.0, 11.0])
        assert F.penetration_ratio(df, 0.0, 10.0, 1, 0, "upper", 1.0) == 0.0
