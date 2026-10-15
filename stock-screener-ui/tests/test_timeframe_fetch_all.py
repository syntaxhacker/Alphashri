"""All-timeframe validation for the unified candle fetcher (mocked, CI-safe).

Covers ``market_data.market_data.fetch_candles_for_timeframe`` across every id
in ``chart_patterns.timeframes.TIMEFRAME_IDS`` with a mocked provider client —
no network access. All candle data is generated programmatically.

Skips cleanly (module level) when the fetcher is not yet implemented so CI
stays green while the implementation lands.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import numpy as np
import pandas as pd

try:
    from market_data.market_data import fetch_candles_for_timeframe
except ImportError:  # other agent still implementing -> CI stays green
    pytest.skip(
        "fetch_candles_for_timeframe not yet implemented",
        allow_module_level=True,
    )

from chart_patterns.timeframes import TIMEFRAME_IDS, get_timeframe


# ---------------------------------------------------------------------------
# Synthetic candle generation (no network, no stored fixtures)
# ---------------------------------------------------------------------------

def _make_bars(n: int, freq: str, seed: int = 7,
               end: pd.Timestamp | None = None) -> pd.DataFrame:
    """Generate ``n`` OHLCV bars ending at ``end`` (default: now, UTC).

    OHLC relations are sane by construction: high >= max(open, close) and
    low <= min(open, close).
    """
    end = end or pd.Timestamp.now(tz="UTC")
    idx = pd.date_range(end=end, periods=n, freq=freq, tz="UTC")
    rng = np.random.default_rng(seed)
    base = 100.0
    closes = base + np.cumsum(rng.normal(0, 0.2, size=n))
    opens = np.concatenate([[base], closes[:-1]])
    highs = np.maximum(opens, closes) + rng.uniform(0.01, 0.3, size=n)
    lows = np.minimum(opens, closes) - rng.uniform(0.01, 0.3, size=n)
    vols = rng.integers(100, 10_000, size=n)
    return pd.DataFrame(
        {
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": vols,
            "oi": np.zeros(n, dtype=int),
        },
        index=idx,
    )


def _provider_minutes(unit: str, interval) -> int:
    """Normalise a provider (unit, interval) pair to minutes per bar."""
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
    if unit.startswith("month"):
        return 43200
    raise ValueError(f"Unknown unit {unit!r}")


_FREQ_FOR_MINUTES = {
    1: "1min",
    3: "3min",
    5: "5min",
    10: "10min",
    15: "15min",
    30: "30min",
    60: "1h",
    120: "2h",
    180: "3h",
    240: "4h",
    1440: "B",      # business days (trading-day-like daily bars)
    10080: "W-FRI",  # weekly bars
    43200: "ME",     # month-end bars
}


def _bars_for_spacing(spacing_min: int, n: int = 1000) -> pd.DataFrame:
    freq = _FREQ_FOR_MINUTES.get(spacing_min, f"{spacing_min}min")
    return _make_bars(n, freq)


def _hist_side_effect(*args, **kwargs) -> pd.DataFrame:
    """Stand-in for ``fetch_historical_data_v3``: correctly-spaced bars for
    whatever native (unit, interval) the fetcher requests."""
    unit = kwargs.get("unit", args[1] if len(args) > 1 else "minutes")
    interval = kwargs.get("interval", args[2] if len(args) > 2 else 1)
    return _bars_for_spacing(_provider_minutes(unit, interval))


def _intra_side_effect(*args, **kwargs) -> pd.DataFrame:
    """Stand-in for ``fetch_intraday_data_v3``: bars at the requested minute
    interval."""
    interval = kwargs.get(
        "interval", kwargs.get("tf", args[1] if len(args) > 1 else 1)
    )
    return _bars_for_spacing(int(str(interval)))


@pytest.fixture()
def mock_api() -> MagicMock:
    """Provider client mock: arg-aware, returns correctly-spaced candles."""
    api = MagicMock(name="provider_client")
    api.fetch_historical_data_v3.side_effect = _hist_side_effect
    api.fetch_intraday_data_v3.side_effect = _intra_side_effect
    return api


def _provider_calls(api: MagicMock) -> list[tuple[str, int]]:
    """Normalised list of provider calls as (unit, interval) tuples."""
    out: list[tuple[str, int]] = []
    for name, call in (
        ("historical", api.fetch_historical_data_v3),
        ("intraday", api.fetch_intraday_data_v3),
    ):
        for c in call.call_args_list:
            a, k = c.args, c.kwargs
            if name == "intraday":
                iv = k.get("interval", k.get("tf", a[1] if len(a) > 1 else 1))
                out.append(("minutes", int(str(iv))))
            else:
                unit = k.get("unit", a[1] if len(a) > 1 else "minutes")
                iv = k.get("interval", a[2] if len(a) > 2 else 1)
                u = str(unit).lower()
                canon = next(
                    (c0 for c0 in ("minutes", "hours", "days", "weeks", "months")
                     if u.startswith(c0[:-1])),
                    u,
                )
                out.append((canon, int(str(iv))))
    return out


# ---------------------------------------------------------------------------
# Shared invariant assertions (mirror the live smoke harness)
# ---------------------------------------------------------------------------

def assert_frame_invariants(df: pd.DataFrame, *, ctx: str = "") -> None:
    """UTC index, strictly ascending, unique, OHLC sane."""
    tag = f"[{ctx}] " if ctx else ""
    assert df is not None, f"{tag}fetcher returned None"
    assert not df.empty, f"{tag}fetcher returned an empty frame"
    for col in ("open", "high", "low", "close", "volume"):
        assert col in df.columns, f"{tag}missing column {col!r}"
    assert df.index.tz is not None, f"{tag}index is tz-naive"
    assert str(df.index.tz) == "UTC", f"{tag}index tz={df.index.tz}, want UTC"
    assert df.index.is_monotonic_increasing, f"{tag}index not ascending"
    assert (df.index[1:] > df.index[:-1]).all(), f"{tag}index not strict"
    assert not df.index.has_duplicates, f"{tag}duplicate timestamps"
    eps = 1e-9
    hi = df[["open", "close"]].max(axis=1)
    lo = df[["open", "close"]].min(axis=1)
    sane = (df["high"] + eps >= hi) & (df["low"] - eps <= lo)
    assert bool(sane.all()), f"{tag}{(int((~sane).sum()))} OHLC violations"


def _median_diff_minutes(df: pd.DataFrame) -> float:
    diffs = df.index.to_series().diff().dropna().dt.total_seconds()
    return float(diffs.median() / 60.0)


def assert_target_spacing(df: pd.DataFrame, tf_id: str) -> None:
    """Median bar spacing matches the timeframe's calendar meaning."""
    spec = get_timeframe(tf_id)
    med_min = _median_diff_minutes(df)
    if spec.minutes < 1440:
        assert med_min == pytest.approx(spec.minutes, abs=0.5), (
            f"[{tf_id}] median spacing {med_min:.2f}m != {spec.minutes}m"
        )
    elif tf_id == "1D":
        assert (med_min / 1440.0) == pytest.approx(1.0, abs=0.1), (
            f"[1D] median spacing {med_min / 1440.0:.2f}d != 1d"
        )
    elif tf_id == "1W":
        assert (med_min / 1440.0) == pytest.approx(7.0, abs=0.5), (
            f"[1W] median spacing {med_min / 1440.0:.2f}d != 7d"
        )
    elif tf_id == "1M":
        assert 27.0 <= med_min / 1440.0 <= 32.0, (
            f"[1M] median spacing {med_min / 1440.0:.2f}d outside 27..32d"
        )


def _fetch(tf_id: str, mock_api: MagicMock, **kwargs) -> pd.DataFrame | None:
    """Call the fetcher with the mock as explicit client and as fallback."""
    with patch(
        "market_data.market_data.get_api_client", return_value=mock_api
    ):
        return fetch_candles_for_timeframe(
            "TMPV", tf_id, lookback_bars=60, api_client=mock_api, **kwargs
        )


# ---------------------------------------------------------------------------
# All 13 timeframes: invariants + target spacing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("tf_id", TIMEFRAME_IDS)
def test_timeframe_invariants_and_spacing(mock_api: MagicMock, tf_id: str):
    df = _fetch(tf_id, mock_api)
    assert_frame_invariants(df, ctx=tf_id)
    assert_target_spacing(df, tf_id)
    # The provider must actually have been consulted (no canned passthrough).
    assert (
        mock_api.fetch_historical_data_v3.called
        or mock_api.fetch_intraday_data_v3.called
    ), f"[{tf_id}] provider was never called"


# ---------------------------------------------------------------------------
# Non-native timeframes (3m/2h/3h/4h) come from their native source_tf
# ---------------------------------------------------------------------------

NON_NATIVE_SOURCE = {
    "3m": ("minutes", 1),  # resampled from 1m
    "2h": ("hours", 1),    # resampled from 1h
    "3h": ("hours", 1),    # resampled from 1h
    "4h": ("hours", 1),    # resampled from 1h
}


@pytest.mark.parametrize("tf_id,source", list(NON_NATIVE_SOURCE.items()))
def test_non_native_resampled_from_source(
    mock_api: MagicMock, tf_id: str, source: tuple[str, int]
):
    df = _fetch(tf_id, mock_api)
    assert_frame_invariants(df, ctx=tf_id)
    spec = get_timeframe(tf_id)
    assert not spec.native, f"[{tf_id}] registry says native; test is stale"
    assert spec.source_tf is not None
    assert _median_diff_minutes(df) == pytest.approx(spec.minutes, abs=0.5), (
        f"[{tf_id}] median spacing {_median_diff_minutes(df):.2f}m "
        f"!= target {spec.minutes}m"
    )
    calls = _provider_calls(mock_api)
    assert source in calls, (
        f"[{tf_id}] provider never fetched source_tf {source}; calls={calls}"
    )


# ---------------------------------------------------------------------------
# Native timeframes are fetched directly (no finer-source double resample)
# ---------------------------------------------------------------------------

NATIVE_PROVIDER_PARAMS = {
    "1m": ("minutes", 1),
    "5m": ("minutes", 5),
    "10m": ("minutes", 10),
    "15m": ("minutes", 15),
    "30m": ("minutes", 30),
    "1h": ("hours", 1),
    "1D": ("days", 1),
    "1W": ("weeks", 1),
    "1M": ("months", 1),
}

_INTRADAY_NATIVE = {"1m", "5m", "10m", "15m", "30m", "1h"}


@pytest.mark.parametrize("tf_id", sorted(NATIVE_PROVIDER_PARAMS))
def test_native_fetched_directly(mock_api: MagicMock, tf_id: str):
    df = _fetch(tf_id, mock_api)
    assert_frame_invariants(df, ctx=tf_id)
    assert_target_spacing(df, tf_id)
    spec = get_timeframe(tf_id)
    assert spec.native, f"[{tf_id}] registry says non-native; test is stale"
    unit, iv = NATIVE_PROVIDER_PARAMS[tf_id]
    calls = _provider_calls(mock_api)
    if tf_id in _INTRADAY_NATIVE:
        # Either the historical endpoint natively or today's intraday tape at
        # the same minute width — both are direct, no finer-source resample.
        ok = (unit, iv) in calls or ("minutes", spec.minutes) in calls
    else:
        ok = (unit, iv) in calls
    assert ok, (
        f"[{tf_id}] provider never fetched native {(unit, iv)}; calls={calls}"
    )


# ---------------------------------------------------------------------------
# 1D with include_partial_today=True merges today's 1-minute tape
# ---------------------------------------------------------------------------

def test_1d_include_partial_today_merges_tape():
    now = pd.Timestamp.now(tz="UTC")
    # Daily history deliberately ends several sessions ago so that "today"
    # can only appear via the partial-today merge.
    daily_idx = pd.bdate_range(
        end=(now - pd.offsets.BDay(5)).date(), periods=120, tz="UTC"
    )
    daily = _make_bars(len(daily_idx), freq="B", seed=11).set_axis(daily_idx)
    tape = _make_bars(120, "1min", seed=13)  # today's 1-minute tape
    api = MagicMock(name="provider_client")
    api.fetch_historical_data_v3.return_value = daily
    api.fetch_intraday_data_v3.return_value = tape

    with patch("market_data.market_data.get_api_client", return_value=api):
        df = fetch_candles_for_timeframe(
            "TMPV",
            "1D",
            lookback_bars=60,
            include_partial_today=True,
            api_client=api,
        )

    assert_frame_invariants(df, ctx="1D+partial")
    assert api.fetch_intraday_data_v3.called, (
        "[1D+partial] today's tape was never consulted"
    )
    assert df.index[-1].tz_convert("Asia/Kolkata").date() == now.tz_convert("Asia/Kolkata").date(), (
        f"[1D+partial] last session {df.index[-1].tz_convert('Asia/Kolkata').date()} "
        f"!= today {now.tz_convert('Asia/Kolkata').date()}"
    )
