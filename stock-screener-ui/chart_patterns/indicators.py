"""Chart indicator series aligned to the displayed candle window.

Everything here is pure and side-effect free: the API passes the exact candle
list it is about to return, so every series is ``len(candles)`` long and the
frontend never derives a value itself.

Public payload (:func:`compute_indicators`)::

    {
      "aligned": "candles",
      "timeframe": "1D",
      "session": "Asia/Kolkata",
      "partial_last": false,
      "series": [{"id": "sma20", "values": [12.3, null, ...]}],
      "crosses": [{"t": "<candle t>", "kind": "golden|death"}],
    }

Rules pinned by the backend contract:

* SMA 20/50/200 use rolling sums over close; warm-up values are ``None``.
* Bollinger 20,2 uses the population sigma (``ddof=0``); a flat window
  collapses upper/lower onto the middle band.
* Golden/death crosses compare SMA50 vs SMA200 with
  ``eps = 1e-9 * max(1, |fast|, |slow|)``. Equality alone is never an event.
  Events start at index 200 and a cross on the trailing partial bar is
  suppressed.
* VWAP is intraday-only, resets on each exchange-local session and is omitted
  entirely for ``1D``/``1W``/``1M``. Zero-volume bars carry the previous value;
  an all-zero session is ``None``. A session whose first observed bar is after
  the exchange open is left entirely ``None``: without the opening bars its
  cumulative price/volume would be wrong. Callers that have earlier bars pass
  them as ``warmup`` to :func:`compute_indicators`, which anchors the first
  displayed session at its true open.
* Invalid price bars (non-finite, ``<= 0``, ``high < low``) poison any window
  that contains them. No ``NaN``/``Infinity`` ever leaves this module.
"""

from __future__ import annotations

from typing import Optional, Sequence

import numpy as np
import pandas as pd

MARKET_SESSIONS = {
    "india": "Asia/Kolkata",
    "usa": "America/New_York",
}

#: Exchange-local opening time (hour, minute) per session label. Used only to
#: decide whether the first observed bar can anchor a session VWAP.
SESSION_OPENS = {
    "Asia/Kolkata": (9, 15),
    "America/New_York": (9, 30),
}

INTRADAY_TIMEFRAMES = frozenset(
    {"1m", "3m", "5m", "10m", "15m", "30m", "1h", "2h", "3h", "4h"}
)

SMA_PERIODS = (20, 50, 200)
BOLLINGER_PERIOD = 20
BOLLINGER_STD = 2.0
CROSS_EARLIEST_INDEX = 200
_CROSS_EPS_FACTOR = 1e-9


def session_for_market(market: Optional[str]) -> str:
    """Exchange session label for a chart market (defaults to India)."""
    return MARKET_SESSIONS.get(str(market or "india").strip().lower(), "Asia/Kolkata")


def _float_or_nan(value) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return float("nan")
    return out


def sma(values: Sequence[float], period: int) -> np.ndarray:
    """Simple moving average with warm-up nulls (pure rolling sums).

    A window containing a non-finite/non-positive value stays ``NaN`` so an
    invalid bar can never be silently averaged as zero.
    """
    arr = np.asarray(values, dtype=float)
    n = arr.size
    out = np.full(n, np.nan, dtype=float)
    if period <= 0 or n < period:
        return out
    valid = np.isfinite(arr) & (arr > 0)
    safe = np.where(valid, arr, 0.0)
    sums = np.concatenate(([0.0], np.cumsum(safe, dtype=float)))
    counts = np.concatenate(([0], np.cumsum(valid, dtype=np.int64)))
    window_sums = sums[period:] - sums[:-period]
    window_counts = counts[period:] - counts[:-period]
    means = window_sums / float(period)
    out[period - 1:] = np.where(window_counts == period, means, np.nan)
    return out


def bollinger_bands(
    values: Sequence[float],
    period: int = BOLLINGER_PERIOD,
    num_std: float = BOLLINGER_STD,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Bollinger bands ``(upper, middle, lower)`` with population sigma.

    The variance is a second pass around the rolling mean, which keeps a flat
    window exactly collapsed (``upper == middle == lower``) instead of leaving
    a catastrophic-cancellation residue from ``E[x^2] - E[x]^2``.
    """
    arr = np.asarray(values, dtype=float)
    n = arr.size
    upper = np.full(n, np.nan, dtype=float)
    middle = np.full(n, np.nan, dtype=float)
    lower = np.full(n, np.nan, dtype=float)
    if period <= 0 or n < period:
        return upper, middle, lower
    valid = np.isfinite(arr) & (arr > 0)
    safe = np.where(valid, arr, 0.0)
    sums = np.concatenate(([0.0], np.cumsum(safe, dtype=float)))
    counts = np.concatenate(([0], np.cumsum(valid, dtype=np.int64)))
    window_sums = sums[period:] - sums[:-period]
    window_counts = counts[period:] - counts[:-period]
    all_valid = window_counts == period
    means = window_sums / float(period)
    # Compute the deviation around each window's own mean. Windows with any
    # invalid bar are ignored anyway, so the zero-filled placeholder is safe.
    from numpy.lib.stride_tricks import sliding_window_view

    windows = sliding_window_view(safe, period)
    deviations = windows - means[:, None]
    variances = np.mean(deviations * deviations, axis=1)
    variances = np.where(np.isfinite(variances) & (variances >= 0.0), variances, 0.0)
    sigmas = np.sqrt(variances) * float(num_std)
    middle[period - 1:] = np.where(all_valid, means, np.nan)
    upper[period - 1:] = np.where(all_valid, means + sigmas, np.nan)
    lower[period - 1:] = np.where(all_valid, means - sigmas, np.nan)
    return upper, middle, lower


def detect_sma_crosses(
    fast: Sequence[float],
    slow: Sequence[float],
    times: Sequence[str],
    *,
    earliest_index: int = 0,
    partial_last: bool = False,
) -> list[dict]:
    """Golden/death events between two aligned series.

    ``prev <= 0 && gap > eps`` is golden; ``prev >= 0 && gap < -eps`` is death,
    with ``eps = 1e-9 * max(1, |fast|, |slow|)`` on the event bar. Equality
    alone emits nothing. ``earliest_index`` is a contract floor (the indicator
    payload passes 200); ``partial_last`` suppresses an event on the trailing
    bar, which is still forming.
    """
    fast_arr = np.asarray(fast, dtype=float)
    slow_arr = np.asarray(slow, dtype=float)
    n = min(fast_arr.size, slow_arr.size)
    if n < 2:
        return []
    times_list = list(times)
    crosses: list[dict] = []
    start = max(int(earliest_index), 1)
    for i in range(start, n):
        if partial_last and i == n - 1:
            continue
        fast_i = fast_arr[i]
        slow_i = slow_arr[i]
        fast_prev = fast_arr[i - 1]
        slow_prev = slow_arr[i - 1]
        if not (
            np.isfinite(fast_i)
            and np.isfinite(slow_i)
            and np.isfinite(fast_prev)
            and np.isfinite(slow_prev)
        ):
            continue
        gap = float(fast_i - slow_i)
        prev_gap = float(fast_prev - slow_prev)
        eps = _CROSS_EPS_FACTOR * max(1.0, abs(float(fast_i)), abs(float(slow_i)))
        kind = None
        if prev_gap <= 0.0 and gap > eps:
            kind = "golden"
        elif prev_gap >= 0.0 and gap < -eps:
            kind = "death"
        if kind is None:
            continue
        t = times_list[i] if i < len(times_list) else str(i)
        crosses.append({"t": str(t), "kind": kind})
    return crosses


def _candle_list(candles) -> list:
    """Accept the wire candle list or a normalized OHLCV DataFrame."""
    if not isinstance(candles, pd.DataFrame):
        return list(candles or [])
    frame = candles
    columns = {str(col).lower(): col for col in frame.columns}
    if not {"open", "high", "low", "close"}.issubset(columns):
        return []
    times = frame["t"] if "t" in frame.columns else frame.index
    out: list[dict] = []
    for i, (stamp, open_, high, low, close) in enumerate(
        zip(
            times,
            frame[columns["open"]],
            frame[columns["high"]],
            frame[columns["low"]],
            frame[columns["close"]],
        )
    ):
        volume = frame[columns["volume"]].iloc[i] if "volume" in columns else None
        out.append(
            {
                "t": stamp.isoformat() if hasattr(stamp, "isoformat") else stamp,
                "o": open_,
                "h": high,
                "l": low,
                "c": close,
                "v": volume,
            }
        )
    return out


def _candle_arrays(candles: Sequence) -> tuple[np.ndarray, ...]:
    """Extract ``(t, open, high, low, close, volume)`` from the wire candles."""
    n = len(candles)
    opens = np.full(n, np.nan, dtype=float)
    highs = np.full(n, np.nan, dtype=float)
    lows = np.full(n, np.nan, dtype=float)
    closes = np.full(n, np.nan, dtype=float)
    volumes = np.full(n, np.nan, dtype=float)
    times: list = []
    for i, candle in enumerate(candles):
        if not isinstance(candle, dict):
            times.append(str(i))
            continue
        times.append(candle.get("t", str(i)))
        opens[i] = _float_or_nan(candle.get("o"))
        highs[i] = _float_or_nan(candle.get("h"))
        lows[i] = _float_or_nan(candle.get("l"))
        closes[i] = _float_or_nan(candle.get("c"))
        volumes[i] = _float_or_nan(candle.get("v"))
    return times, opens, highs, lows, closes, volumes


def invalid_price_mask(
    opens: Sequence[float],
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
) -> np.ndarray:
    """True where a candle cannot be used for price math.

    Contract: non-finite, non-positive or ``high < low``. The open is included
    because the wire candle is a full OHLC bar; a broken open invalidates the
    bar even when close-only indicators would otherwise ignore it.
    """
    o = np.asarray(opens, dtype=float)
    h = np.asarray(highs, dtype=float)
    l = np.asarray(lows, dtype=float)
    c = np.asarray(closes, dtype=float)
    finite = np.isfinite(o) & np.isfinite(h) & np.isfinite(l) & np.isfinite(c)
    positive = (o > 0) & (h > 0) & (l > 0) & (c > 0)
    ordered = h >= l
    return ~(finite & positive & ordered)


def _session_key(value, session: str):
    """Exchange-local calendar date for a candle timestamp, or ``None``."""
    try:
        ts = pd.Timestamp(value)
    except (TypeError, ValueError, OverflowError):
        return None
    try:
        if ts.tzinfo is None:
            # Naive wire timestamps are exchange-local wall time (the backend
            # emits tz-aware values; this is a defensive fallback).
            ts = ts.tz_localize(session)
        return ts.tz_convert(session).date()
    except Exception:
        return None


def _session_anchored(value, session: str) -> bool:
    """True when ``value`` is at/before the exchange open (session visible).

    The first bar of a session can anchor its VWAP only if no earlier
    same-session bar exists. A window that starts mid-session cannot recover
    the morning's price/volume, so its VWAP stays ``None`` rather than being
    computed from a partial cumulative.
    """
    open_hm = SESSION_OPENS.get(session)
    if open_hm is None:
        return True
    try:
        ts = pd.Timestamp(value)
        if ts.tzinfo is None:
            ts = ts.tz_localize(session)
        else:
            ts = ts.tz_convert(session)
    except (TypeError, ValueError, OverflowError):
        return True
    return (ts.hour * 60 + ts.minute) <= (open_hm[0] * 60 + open_hm[1])


def compute_vwap(
    candles: Sequence,
    session: str = "Asia/Kolkata",
    timeframe: Optional[str] = None,
    *,
    market: Optional[str] = None,
) -> Optional[np.ndarray]:
    """Session-reset VWAP over the supplied candles, or ``None`` when omitted.

    ``timeframe`` is checked here so callers cannot accidentally draw an
    intraday VWAP on a daily/weekly/monthly chart. Zero-volume bars carry the
    previous in-session value; an invalid bar is ``NaN``; a session with no
    usable volume is entirely ``NaN``. A session whose first supplied bar is
    after the exchange open is also entirely ``NaN`` — the missing opening
    trades make the cumulative wrong, and a partial session must not be
    presented as the day's VWAP.
    """
    if market is not None:
        session = session_for_market(market)
    # Accept both positional orders (candles, session, timeframe) and
    # (candles, timeframe, session) — the payload path always uses keywords.
    if str(session) in INTRADAY_TIMEFRAMES:
        if timeframe is None:
            timeframe, session = str(session), "Asia/Kolkata"
        elif str(timeframe) not in INTRADAY_TIMEFRAMES:
            session, timeframe = str(timeframe), str(session)
    if timeframe is None and str(session) in {"1D", "1W", "1M"}:
        return None
    if timeframe is not None and str(timeframe) not in INTRADAY_TIMEFRAMES:
        return None
    candles = _candle_list(candles)
    times, opens, highs, lows, closes, volumes = _candle_arrays(candles)
    n = len(candles)
    out = np.full(n, np.nan, dtype=float)
    invalid = invalid_price_mask(opens, highs, lows, closes)
    current_key = object()
    cumulative_pv = 0.0
    cumulative_vol = 0.0
    previous_value = float("nan")
    anchored = True
    for i in range(n):
        key = _session_key(times[i], session)
        if key is None:
            out[i] = np.nan
            continue
        if key != current_key:
            current_key = key
            cumulative_pv = 0.0
            cumulative_vol = 0.0
            previous_value = float("nan")
            anchored = _session_anchored(times[i], session)
        if not anchored:
            out[i] = np.nan
            continue
        volume = float(volumes[i])
        if invalid[i] or not np.isfinite(volume) or volume < 0.0:
            out[i] = np.nan
            continue
        if volume == 0.0:
            # Inside a session, a no-trade bar holds the last VWAP; before the
            # first trade (or in an all-zero session) it stays null.
            out[i] = previous_value
            continue
        typical = (float(highs[i]) + float(lows[i]) + float(closes[i])) / 3.0
        if not np.isfinite(typical) or typical <= 0.0:
            out[i] = np.nan
            continue
        cumulative_pv += typical * volume
        cumulative_vol += volume
        value = cumulative_pv / cumulative_vol if cumulative_vol > 0.0 else float("nan")
        out[i] = value
        previous_value = value
    return out


def _values_to_json(values: np.ndarray) -> list[Optional[float]]:
    """Finite floats stay numbers; everything else becomes ``null``."""
    out: list[Optional[float]] = []
    for value in np.asarray(values, dtype=float):
        out.append(float(value) if np.isfinite(value) else None)
    return out


def _normalise_partial_last(candles: Sequence, partial_last: Optional[bool]) -> bool:
    if partial_last is not None:
        return bool(partial_last)
    if not candles:
        return False
    last = candles[-1]
    return bool(isinstance(last, dict) and last.get("is_partial"))


def compute_indicators(
    candles: Sequence,
    timeframe: Optional[str],
    session: Optional[str] = None,
    *,
    warmup: Optional[Sequence] = None,
    partial_last: Optional[bool] = None,
    market: Optional[str] = None,
) -> dict:
    """Build the full ``indicators`` payload for a displayed candle window.

    ``warmup`` carries earlier bars from the same source frame (the bars just
    before a tail-clamped display window). Only VWAP uses them: it needs the
    session from its opening bar, while SMA/Bollinger/crosses stay exactly
    aligned to the displayed candles and keep their warm-up nulls.
    """
    candles = _candle_list(candles)
    timeframe = str(timeframe or "")
    session = str(session or session_for_market(market))
    partial = _normalise_partial_last(candles, partial_last)
    times, opens, highs, lows, closes, _volumes = _candle_arrays(candles)
    invalid = invalid_price_mask(opens, highs, lows, closes)
    clean_close = np.where(invalid, np.nan, closes)

    series: list[dict] = []
    sma_by_period: dict[int, np.ndarray] = {}
    for period in SMA_PERIODS:
        values = sma(clean_close, period)
        sma_by_period[period] = values
        series.append({"id": f"sma{period}", "values": _values_to_json(values)})

    upper, middle, lower = bollinger_bands(clean_close)
    series.extend(
        [
            {"id": "bbUpper", "values": _values_to_json(upper)},
            {"id": "bbMiddle", "values": _values_to_json(middle)},
            {"id": "bbLower", "values": _values_to_json(lower)},
        ]
    )

    if timeframe in INTRADAY_TIMEFRAMES:
        warmup_candles = _candle_list(warmup) if warmup else []
        computed = compute_vwap(
            list(warmup_candles) + candles, session=session, timeframe=timeframe
        )
        if computed is not None:
            displayed = computed[len(warmup_candles):]
            series.append({"id": "vwap", "values": _values_to_json(displayed)})

    crosses = detect_sma_crosses(
        sma_by_period[50],
        sma_by_period[200],
        times,
        earliest_index=CROSS_EARLIEST_INDEX,
        partial_last=partial,
    )
    return {
        "aligned": "candles",
        "timeframe": timeframe,
        "session": session,
        "partial_last": partial,
        "series": series,
        "crosses": crosses,
    }


# Backwards-friendly aliases for callers that use the shorter names.
vwap = compute_vwap
detect_crosses = detect_sma_crosses
bollinger = bollinger_bands

__all__ = [
    "BOLLINGER_PERIOD",
    "BOLLINGER_STD",
    "CROSS_EARLIEST_INDEX",
    "INTRADAY_TIMEFRAMES",
    "MARKET_SESSIONS",
    "SMA_PERIODS",
    "bollinger",
    "bollinger_bands",
    "compute_indicators",
    "compute_vwap",
    "detect_crosses",
    "detect_sma_crosses",
    "invalid_price_mask",
    "session_for_market",
    "sma",
    "vwap",
]
