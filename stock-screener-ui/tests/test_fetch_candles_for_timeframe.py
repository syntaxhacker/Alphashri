"""Tests for market_data.fetch_candles_for_timeframe (mocked, no network).

Covers the unified provider aggregator: per-timeframe provider paths,
today-merge behaviour, the synthetic 1D partial-today bar, window
computation, and frame invariants.
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from market_data.market_data import (
    _lookback_days,
    fetch_candles_for_timeframe,
)

from chart_patterns.timeframes import TIMEFRAME_IDS


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _sane_frame(index: pd.DatetimeIndex, base: float = 100.0) -> pd.DataFrame:
    """Deterministic OHLCV frame with sane relations (high>=max(o,c), ...)."""
    n = len(index)
    opens = [base + i * 0.1 for i in range(n)]
    closes = [o + 0.05 for o in opens]
    data = {
        "open": opens,
        "high": [max(o, c) + 0.1 for o, c in zip(opens, closes)],
        "low": [min(o, c) - 0.1 for o, c in zip(opens, closes)],
        "close": closes,
        "volume": [1000.0 + i for i in range(n)],
        "oi": [0.0] * n,
    }
    return pd.DataFrame(data, index=index)


def _intraday_bars(n: int, freq: str, start: str, tz: str = "Asia/Kolkata") -> pd.DataFrame:
    idx = pd.date_range(start, periods=n, freq=freq, tz=tz)
    return _sane_frame(idx)


def _daily_bars(end: str, periods: int) -> pd.DataFrame:
    idx = pd.bdate_range(end=end, periods=periods, tz="UTC")
    return _sane_frame(idx)


def assert_frame_invariants(df: pd.DataFrame) -> None:
    """UTC index, strictly ascending, unique, OHLC sane."""
    assert df is not None
    assert not df.empty
    for col in ("open", "high", "low", "close", "volume"):
        assert col in df.columns
    assert df.index.tz is not None
    assert str(df.index.tz) == "UTC"
    assert df.index.is_monotonic_increasing
    assert (df.index[1:] > df.index[:-1]).all()
    assert not df.index.has_duplicates
    hi = df[["open", "close"]].max(axis=1)
    lo = df[["open", "close"]].min(axis=1)
    assert bool(((df["high"] >= hi) & (df["low"] <= lo)).all())


def _median_diff_minutes(df: pd.DataFrame) -> float:
    diffs = df.index.to_series().diff().dropna().dt.total_seconds()
    return float(diffs.median() / 60.0)


_FIXED_END = pd.Timestamp("2026-04-09 10:00", tz="UTC")

_FREQ_FOR_MINUTES = {
    1: "1min", 5: "5min", 10: "10min", 15: "15min", 30: "30min",
    60: "1h", 240: "4h", 1440: "B", 10080: "W-FRI", 43200: "ME",
}


def _bars_for_spacing(spacing_min: int, n: int = 500) -> pd.DataFrame:
    if spacing_min == 1440:
        idx = pd.bdate_range(end=_FIXED_END.date().isoformat(), periods=n, tz="UTC")
        return _sane_frame(idx)
    freq = _FREQ_FOR_MINUTES.get(spacing_min, f"{spacing_min}min")
    idx = pd.date_range(end=_FIXED_END, periods=n, freq=freq, tz="UTC")
    return _sane_frame(idx)


def _provider_minutes(unit: str, interval) -> int:
    unit = str(unit).lower()
    iv = int(str(interval))
    if unit.startswith("min"):
        return iv
    if unit.startswith("hour"):
        return iv * 60
    if unit.startswith("day"):
        return 1440
    if unit.startswith("week"):
        return 10080
    return 43200


def _make_api() -> MagicMock:
    """Provider mock returning correctly-spaced bars for any native request."""
    api = MagicMock(name="provider_client")

    def _hist(*args, **kwargs):
        unit = kwargs.get("unit", args[1] if len(args) > 1 else "minutes")
        interval = kwargs.get("interval", args[2] if len(args) > 2 else 1)
        return _bars_for_spacing(_provider_minutes(unit, interval))

    def _intra(*args, **kwargs):
        interval = kwargs.get("interval", args[1] if len(args) > 1 else 1)
        return _bars_for_spacing(int(str(interval)))

    api.fetch_historical_data_v3.side_effect = _hist
    api.fetch_intraday_data_v3.side_effect = _intra
    return api


# ---------------------------------------------------------------------------
# Provider path per timeframe (explicit past window: historical only)
# ---------------------------------------------------------------------------

EXPECTED_HISTORICAL = {
    "1m": ("minutes", 1),
    "3m": ("minutes", 1),   # source 1m
    "5m": ("minutes", 5),
    "10m": ("minutes", 10),
    "15m": ("minutes", 15),
    "30m": ("minutes", 30),
    "1h": ("hours", 1),
    "2h": ("hours", 1),     # source 1h
    "3h": ("hours", 1),     # source 1h
    "4h": ("hours", 1),     # source 1h
    "1D": ("days", 1),
    "1W": ("weeks", 1),
    "1M": ("months", 1),
}

TARGET_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "10m": 10, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "3h": 180, "4h": 240,
}


class TestProviderPath:
    @pytest.mark.parametrize("tf_id", TIMEFRAME_IDS)
    def test_all_ids_registered(self, tf_id):
        assert tf_id in EXPECTED_HISTORICAL, f"registry id {tf_id!r} has no path expectation"

    @pytest.mark.parametrize("tf_id", sorted(EXPECTED_HISTORICAL))
    def test_historical_unit_interval(self, tf_id):
        api = _make_api()
        df = fetch_candles_for_timeframe(
            "RELIANCE", tf_id,
            from_date="2026-03-02", to_date="2026-03-06",
            api_client=api,
        )
        assert df is not None
        unit, interval = EXPECTED_HISTORICAL[tf_id]
        api.fetch_historical_data_v3.assert_called_once()
        _, kwargs = api.fetch_historical_data_v3.call_args
        assert kwargs["unit"] == unit
        assert kwargs["interval"] == interval
        assert kwargs["from_date"] == "2026-03-02"
        assert kwargs["to_date"] == "2026-03-06"
        api.fetch_intraday_data_v3.assert_not_called()
        assert_frame_invariants(df)

    @pytest.mark.parametrize("tf_id", sorted(TARGET_MINUTES))
    def test_intraday_spacing_matches_target(self, tf_id):
        api = _make_api()
        df = fetch_candles_for_timeframe(
            "RELIANCE", tf_id,
            from_date="2026-03-02", to_date="2026-03-06",
            api_client=api,
        )
        assert _median_diff_minutes(df) == pytest.approx(TARGET_MINUTES[tf_id], abs=0.5)

    def test_daily_spacing(self):
        api = _make_api()
        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", from_date="2026-01-05", to_date="2026-03-06",
            api_client=api,
        )
        assert (_median_diff_minutes(df) / 1440.0) == pytest.approx(1.0, abs=0.1)

    def test_weekly_spacing(self):
        api = _make_api()
        df = fetch_candles_for_timeframe(
            "RELIANCE", "1W", from_date="2025-01-05", to_date="2026-03-06",
            api_client=api,
        )
        assert (_median_diff_minutes(df) / 1440.0) == pytest.approx(7.0, abs=0.5)

    def test_monthly_spacing(self):
        api = _make_api()
        df = fetch_candles_for_timeframe(
            "RELIANCE", "1M", from_date="2024-01-05", to_date="2026-03-06",
            api_client=api,
        )
        assert 27.0 <= _median_diff_minutes(df) / 1440.0 <= 32.0

    def test_3m_resample_values(self):
        """1m source aggregated to exact 3m buckets (O first, H max, L min, C last, V sum)."""
        bars = _intraday_bars(6, "1min", start="2026-04-09 09:15:00")
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = bars
        df = fetch_candles_for_timeframe(
            "RELIANCE", "3m", from_date="2026-04-01", to_date="2026-04-02",
            api_client=api,
        )
        assert df is not None
        assert len(df) == 2
        assert df["open"].iloc[0] == pytest.approx(bars["open"].iloc[0])
        assert df["high"].iloc[0] == pytest.approx(bars["high"].iloc[:3].max())
        assert df["low"].iloc[0] == pytest.approx(bars["low"].iloc[:3].min())
        assert df["close"].iloc[0] == pytest.approx(bars["close"].iloc[2])
        assert df["volume"].iloc[0] == pytest.approx(bars["volume"].iloc[:3].sum())


# ---------------------------------------------------------------------------
# Today merge (native intraday with a window ending today)
# ---------------------------------------------------------------------------

class TestTodayMerge:
    def test_multi_day_window_merges_both_legs(self):
        from market_data.market_data import _IST

        hist = _intraday_bars(5, "1min", start="2026-04-01 09:15:00")
        tape = _intraday_bars(3, "1min", start="2026-04-02 09:15:00")
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = hist
        api.fetch_intraday_data_v3.return_value = tape

        today = datetime.now(_IST).strftime("%Y-%m-%d")
        df = fetch_candles_for_timeframe(
            "RELIANCE", "5m", from_date="2026-04-01", to_date=today,
            api_client=api,
        )
        assert df is not None
        assert len(df) == 8
        assert_frame_invariants(df)
        api.fetch_historical_data_v3.assert_called_once()
        _, intra_kwargs = api.fetch_intraday_data_v3.call_args
        assert intra_kwargs["interval"] == "5"

    def test_1h_intraday_interval_is_60(self):
        from market_data.market_data import _IST

        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _intraday_bars(3, "1h", start="2026-04-01 09:15:00")
        api.fetch_intraday_data_v3.return_value = _intraday_bars(2, "1h", start="2026-04-02 09:15:00")

        today = datetime.now(_IST).strftime("%Y-%m-%d")
        fetch_candles_for_timeframe(
            "RELIANCE", "1h", from_date="2026-04-01", to_date=today,
            api_client=api,
        )
        api.fetch_intraday_data_v3.assert_called_once_with(
            symbol="RELIANCE", interval="60"
        )

    def test_single_day_today_skips_historical(self):
        from market_data.market_data import _IST

        api = MagicMock()
        api.fetch_intraday_data_v3.return_value = _intraday_bars(10, "1min", start="2026-04-09 09:15:00")

        today = datetime.now(_IST).strftime("%Y-%m-%d")
        df = fetch_candles_for_timeframe(
            "RELIANCE", "5m", from_date=today, to_date=today,
            api_client=api,
        )
        api.fetch_intraday_data_v3.assert_called_once_with(
            symbol="RELIANCE", interval="5"
        )
        api.fetch_historical_data_v3.assert_not_called()
        assert df is not None
        assert len(df) == 10

    def test_daily_ending_today_never_touches_intraday(self):
        from market_data.market_data import _IST

        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _daily_bars("2026-03-31", 30)

        today = datetime.now(_IST).strftime("%Y-%m-%d")
        for tf_id in ("1D", "1W", "1M"):
            api.reset_mock()
            api.fetch_historical_data_v3.return_value = _daily_bars("2026-03-31", 30)
            df = fetch_candles_for_timeframe(
                "RELIANCE", tf_id, from_date="2026-01-05", to_date=today,
                api_client=api,
            )
            assert df is not None
            api.fetch_intraday_data_v3.assert_not_called()

    def test_partial_flag_without_today_window_fetches_no_tape(self):
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _daily_bars("2026-03-31", 30)
        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", from_date="2026-01-05", to_date="2026-03-31",
            include_partial_today=True, api_client=api,
        )
        assert df is not None
        assert len(df) == 30
        api.fetch_intraday_data_v3.assert_not_called()


# ---------------------------------------------------------------------------
# Synthetic partial-today bar on 1D
# ---------------------------------------------------------------------------

class TestPartialToday:
    def _history_and_tape(self):
        history = _daily_bars("2026-03-31", 30)
        tape = _intraday_bars(120, "1min", start="2026-04-09 09:15:00")
        return history, tape

    def test_appends_one_bar_with_correct_ohlcv(self):
        history, tape = self._history_and_tape()
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = history
        api.fetch_intraday_data_v3.return_value = tape

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60,
            include_partial_today=True, api_client=api,
        )
        assert df is not None
        assert len(df) == len(history) + 1
        assert_frame_invariants(df)
        last = df.iloc[-1]
        assert last["open"] == pytest.approx(float(tape["open"].iloc[0]))
        assert last["high"] == pytest.approx(float(tape["high"].max()))
        assert last["low"] == pytest.approx(float(tape["low"].min()))
        assert last["close"] == pytest.approx(float(tape["close"].iloc[-1]))
        assert last["volume"] == pytest.approx(float(tape["volume"].sum()))
        # Synthetic bar is anchored at the session's IST midnight (the official
        # daily convention is 18:30 UTC of the prior day).
        assert df.index[-1] == tape.index[-1].tz_convert("Asia/Kolkata").normalize().tz_convert("UTC")
        assert api.fetch_intraday_data_v3.called

    @pytest.mark.parametrize("tape", [None, pd.DataFrame()])
    def test_empty_tape_appends_nothing(self, tape):
        history, _ = self._history_and_tape()
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = history
        api.fetch_intraday_data_v3.return_value = tape

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60,
            include_partial_today=True, api_client=api,
        )
        assert df is not None
        assert len(df) == len(history)

    def test_official_bar_wins_over_synthetic(self):
        history, tape = self._history_and_tape()
        tape_day = tape.index[-1].tz_convert("UTC").normalize()
        official = _sane_frame(
            pd.DatetimeIndex([tape_day]).tz_localize(None).tz_localize("UTC"),
            base=999.0,
        )
        history = pd.concat([history, official]).sort_index()
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = history
        api.fetch_intraday_data_v3.return_value = tape

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60,
            include_partial_today=True, api_client=api,
        )
        assert df is not None
        assert len(df) == len(history)  # no duplicate for the session date
        assert df["open"].iloc[-1] == pytest.approx(999.0)  # official kept
        assert_frame_invariants(df)

    def test_flag_off_by_default(self):
        history, tape = self._history_and_tape()
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = history
        api.fetch_intraday_data_v3.return_value = tape

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api,
        )
        assert df is not None
        assert len(df) == len(history)
        api.fetch_intraday_data_v3.assert_not_called()


# ---------------------------------------------------------------------------
# Window computation
# ---------------------------------------------------------------------------

class TestWindow:
    def test_lookback_bars_sizes_window(self):
        from market_data.market_data import _IST

        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _intraday_bars(500, "1min", start="2026-04-01 09:15:00")

        today = datetime.now(_IST).strftime("%Y-%m-%d")
        df = fetch_candles_for_timeframe(
            "RELIANCE", "5m", lookback_bars=60, api_client=api,
        )
        assert df is not None
        _, kwargs = api.fetch_historical_data_v3.call_args
        expected_from = (
            datetime.strptime(today, "%Y-%m-%d") - timedelta(days=_lookback_days(5, 60))
        ).strftime("%Y-%m-%d")
        assert kwargs["to_date"] == today
        assert kwargs["from_date"] == expected_from

    def test_explicit_from_to_passthrough(self):
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _daily_bars("2026-03-31", 30)
        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", from_date="2026-01-06", to_date="2026-01-10",
            api_client=api,
        )
        assert df is not None
        _, kwargs = api.fetch_historical_data_v3.call_args
        assert kwargs["from_date"] == "2026-01-06"
        assert kwargs["to_date"] == "2026-01-10"

    def test_explicit_to_date_beats_as_of_date(self):
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _daily_bars("2026-03-31", 30)
        fetch_candles_for_timeframe(
            "RELIANCE", "1D", from_date="2026-01-06", to_date="2026-01-10",
            as_of_date="2026-02-10", api_client=api,
        )
        _, kwargs = api.fetch_historical_data_v3.call_args
        assert kwargs["to_date"] == "2026-01-10"

    def test_as_of_date_pins_to_date(self):
        api = MagicMock()
        api.fetch_historical_data_v3.return_value = _daily_bars("2026-03-31", 30)
        fetch_candles_for_timeframe(
            "RELIANCE", "1D", as_of_date="2026-02-10",
            lookback_bars=60, api_client=api,
        )
        _, kwargs = api.fetch_historical_data_v3.call_args
        expected_from = (
            datetime.strptime("2026-02-10", "%Y-%m-%d")
            - timedelta(days=_lookback_days(1440, 60))
        ).strftime("%Y-%m-%d")
        assert kwargs["to_date"] == "2026-02-10"
        assert kwargs["from_date"] == expected_from

    def test_unknown_timeframe_raises(self):
        with pytest.raises(ValueError, match="Unknown timeframe"):
            fetch_candles_for_timeframe("RELIANCE", "9m", api_client=MagicMock())

    @patch("market_data.market_data.get_api_client", return_value=None)
    def test_no_client_returns_none(self, _mock_client):
        assert (
            fetch_candles_for_timeframe("RELIANCE", "5m", lookback_bars=10) is None
        )

    def test_provider_error_returns_none(self):
        api = MagicMock()
        api.fetch_historical_data_v3.side_effect = Exception("HTTP 429 blocked")
        assert (
            fetch_candles_for_timeframe(
                "RELIANCE", "5m", from_date="2026-03-02", to_date="2026-03-06",
                api_client=api,
            )
            is None
        )
