"""Intraday tripwire: robust statistics first, data plumbing last.

The value of this module is the *math*, so the math takes no I/O and no clock:
:func:`robust_sigma`, :func:`baseline_profile` and :func:`detect` are pure
functions over a DataFrame. That is what makes the tripwire unit-testable
against synthetic bars, and testable against real recorded bars, without a
network or a market being open.

Why median absolute deviation instead of standard deviation: a single 40% halt
bar poisons a mean/sigma for the rest of the day, and the tripwire exists to
*find* that bar, not to be blinded by it. ``1.4826 * MAD`` is the
normal-consistent scaling, so the reported z-score is comparable to a sigma.

Why per-minute-of-day baselines: opening prints, the 12:00 lull and the 15:50
imbalance all have wildly different variance. A single full-day sigma makes the
open permanently "abnormal" and the close never abnormal.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Sequence
from dataclasses import replace
from typing import Optional

import numpy as np
import pandas as pd

import config

from .contract import (
    ANOMALY_COOLDOWN_MIN,
    ANOMALY_MIN_ABS_RET,
    ANOMALY_RET_SIGMA,
    ANOMALY_VOL_MULT,
    Anomaly,
)

logger = logging.getLogger("event_radar.anomaly")

#: Floor for the robust sigma, in return units (5 bps).
#:
#: A dead-quiet name has a MAD of exactly 0, which would turn a 0.5% move into an
#: infinite z-score and page the user about rounding. 5 bps is below the tick
#: granularity of most liquid names, so a genuinely flat stock still needs a
#: real move to fire.
SIGMA_FLOOR = 0.0005

#: ``1.4826`` = 1 / Φ⁻¹(0.75): scales a MAD to a standard deviation.
_MAD_SCALE = 1.4826

#: Columns the matcher needs. fetch_*() normalises every source to these names.
_REQUIRED_COLUMNS = ("Open", "High", "Low", "Close", "Volume")

#: US session tz. A real ZoneInfo, not a fixed offset, so DST folds correctly.
_US_TZ = "America/New_York"


# --------------------------------------------------------------------------- #
# Pure math
# --------------------------------------------------------------------------- #


def robust_sigma(values: Sequence[float]) -> float:
    """``1.4826 * median(|x - median(x)|)``; ``0.0`` below 3 usable samples.

    Never raises: this is called in the poller's hot loop where a NaN-heavy
    window must degrade to "no baseline" rather than kill the tripwire.
    """
    try:
        clean = np.asarray(list(values), dtype=float)
    except (TypeError, ValueError):
        return 0.0
    clean = clean[np.isfinite(clean)]
    if clean.size < 3:
        return 0.0
    median = float(np.median(clean))
    deviation = float(np.median(np.abs(clean - median)))
    return _MAD_SCALE * deviation


def _minute_of_day(index: pd.Index) -> np.ndarray:
    """``hh * 60 + mm`` for every bar, in the index's own timezone."""
    return (index.hour * 60 + index.minute).to_numpy()


def _session_of(index: pd.Index) -> np.ndarray:
    """Session (calendar day) per bar, in the index's own timezone.

    Using the frame's own tz is deliberate: ``fetch_us_1m`` returns New York
    bars and ``fetch_india_1m`` returns IST bars, so "session" always means the
    exchange's day. Converting everything to UTC would split the Indian session
    across two dates.
    """
    return np.asarray(index.date)


def baseline_profile(bars: pd.DataFrame) -> dict[int, tuple[float, float]]:
    """Per-minute-of-day ``(median_volume, robust_sigma_of_return)``.

    ``bars`` must be 1-minute OHLCV with a tz-aware ``DatetimeIndex`` spanning
    at least two sessions — the first session can only supply volumes, not
    returns (the first bar of a session has no previous bar *within* the
    session, and returns are computed per session on purpose: an overnight gap
    is not intraday volatility).

    A minute seen in fewer than three sessions gets ``sigma = 0.0`` from
    :func:`robust_sigma`; :func:`detect` then substitutes :data:`SIGMA_FLOOR`.
    """
    if bars is None or len(bars) == 0:
        return {}
    missing = [column for column in _REQUIRED_COLUMNS if column not in bars.columns]
    if missing:
        logger.warning("anomaly: baseline frame missing columns %s", missing)
        return {}

    close = bars["Close"].astype(float)
    volume = bars["Volume"].astype(float)
    sessions = _session_of(bars.index)

    # pct_change inside each session: the first bar contributes NaN, which is
    # exactly the "no return yet" we want to drop.
    returns = close.groupby(sessions).pct_change()

    frame = pd.DataFrame(
        {
            "minute": _minute_of_day(bars.index),
            "volume": volume.to_numpy(dtype=float),
            "ret": returns.to_numpy(dtype=float),
        }
    )

    profile: dict[int, tuple[float, float]] = {}
    for minute, group in frame.groupby("minute", sort=True):
        minute_volume = float(group["volume"].median())
        sigma = robust_sigma(group["ret"].to_numpy(dtype=float))
        profile[int(minute)] = (minute_volume, sigma)
    return profile


def _symbol_of(bars: pd.DataFrame, symbol: Optional[str]) -> str:
    """``symbol=`` wins; otherwise the frame's ``attrs`` (set by fetch_*)."""
    if symbol:
        return str(symbol).upper()
    try:
        from_attrs = bars.attrs.get("symbol")
    except AttributeError:  # pragma: no cover - plain DataFrame always has attrs
        from_attrs = None
    return str(from_attrs).upper() if from_attrs else ""


def detect(
    bars: pd.DataFrame,
    profile: dict[int, tuple[float, float]],
    *,
    ret_sigma: float = ANOMALY_RET_SIGMA,
    vol_mult: float = ANOMALY_VOL_MULT,
    min_abs_ret: float = ANOMALY_MIN_ABS_RET,
    symbol: Optional[str] = None,
) -> list[Anomaly]:
    """Evaluate the LAST session in ``bars`` against ``profile``.

    Returns chronological anomalies. Every threshold is imported from the
    contract, never redeclared here — the UI prints them in the tooltip.

    ``ret`` is measured against the *previous bar*, including the prior
    session's last bar for the day's open, because the overnight gap is a real
    move that the tripwire must be able to report.
    """
    if bars is None or len(bars) < 2 or not profile:
        return []
    missing = [column for column in _REQUIRED_COLUMNS if column not in bars.columns]
    if missing:
        logger.warning("anomaly: detect frame missing columns %s", missing)
        return []

    close = bars["Close"].astype(float)
    volume = bars["Volume"].astype(float)
    returns = close.pct_change()
    sessions = _session_of(bars.index)
    last_session = sessions.max()

    ticker = _symbol_of(bars, symbol)
    minute_of_day = _minute_of_day(bars.index)

    close_values = close.to_numpy(dtype=float)
    volume_values = volume.to_numpy(dtype=float)
    return_values = returns.to_numpy(dtype=float)

    found: list[Anomaly] = []
    for position in range(len(bars)):
        if sessions[position] != last_session:
            continue

        bar_volume = volume_values[position]
        if not np.isfinite(bar_volume) or bar_volume <= 0:
            # A halted/empty bar has no signal, and dividing by a zero median
            # below would be meaningless.
            continue

        entry = profile.get(int(minute_of_day[position]))
        if entry is None:
            # No baseline for this minute (short history, half-day session).
            # Judging it would mean inventing a baseline.
            continue
        median_volume, sigma = entry
        if median_volume <= 0:
            continue
        if sigma <= 0:
            sigma = SIGMA_FLOOR

        bar_return = return_values[position]
        if not np.isfinite(bar_return):
            continue
        if abs(bar_return * 100.0) < min_abs_ret:
            continue
        if abs(bar_return) < ret_sigma * sigma:
            continue
        if bar_volume < vol_mult * median_volume:
            continue

        z_score = bar_return / sigma
        volume_ratio = bar_volume / median_volume
        found.append(
            Anomaly(
                symbol=ticker,
                ts=bars.index[position].isoformat(),
                price=round(float(close_values[position]), 4),
                ret_pct=round(bar_return * 100.0, 2),
                ret_sigma=round(z_score, 2),
                vol_ratio=round(volume_ratio, 2),
                has_known_event=False,
                suspected=f"volume {volume_ratio:.1f}x, {abs(z_score):.1f} sigma",
            )
        )
    return found


def _parse_ts(value: str) -> Optional[dt.datetime]:
    try:
        stamp = dt.datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=dt.timezone.utc)


def apply_cooldown(
    anomalies: Sequence[Anomaly], cooldown_min: int = ANOMALY_COOLDOWN_MIN
) -> list[Anomaly]:
    """Keep the first mover, then mute the symbol for ``cooldown_min``.

    A single news event produces a cluster of abnormal bars (the first print,
    the follow-through, the halt resume). Alerting on each one trains the user
    to ignore the alert, so the tripwire reports the *ignition* only.
    """
    window = dt.timedelta(minutes=max(0, int(cooldown_min)))
    last_kept: dict[str, dt.datetime] = {}
    kept: list[Anomaly] = []

    # Sort a copy: callers pass read-only sequences and frozen dataclasses.
    ordered = sorted(
        list(anomalies),
        key=lambda anomaly: _parse_ts(anomaly.ts) or dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc),
    )
    for anomaly in ordered:
        stamp = _parse_ts(anomaly.ts)
        if stamp is None:
            continue
        previous = last_kept.get(anomaly.symbol)
        if previous is not None and stamp - previous < window:
            continue
        last_kept[anomaly.symbol] = stamp
        kept.append(anomaly)
    return kept


# --------------------------------------------------------------------------- #
# Data plumbing (lazy imports: this module must import cleanly in CI)
# --------------------------------------------------------------------------- #


def _normalise_frame(frame: pd.DataFrame, market: str, symbol: str) -> pd.DataFrame:
    """Same column names, same tz, from any vendor frame."""
    renamed = {
        column: column.capitalize()
        for column in frame.columns
        if column.capitalize() in _REQUIRED_COLUMNS
    }
    frame = frame.rename(columns=renamed)
    frame = frame[[column for column in _REQUIRED_COLUMNS if column in frame.columns]]
    index = frame.index
    if not isinstance(index, pd.DatetimeIndex):
        index = pd.DatetimeIndex(index)
    if index.tz is None:
        index = index.tz_localize(_US_TZ if market == "us" else config.IST)
    elif market == "us":
        index = index.tz_convert(_US_TZ)
    else:
        index = index.tz_convert(config.IST)
    normalised = frame.copy()
    normalised.index = index
    normalised.attrs["symbol"] = symbol.upper()
    return normalised.sort_index()


def fetch_us_1m(symbol: str, days: int = 8) -> pd.DataFrame:
    """US 1-minute bars from yfinance (Yahoo caps 1-min history at 8 days).

    Lazy import so ``import api.event_radar.anomaly`` stays cheap and CI-safe
    (no yfinance/network at import time).
    """
    ticker = symbol.strip().upper()
    try:
        import yfinance as yf
    except ImportError as exc:  # pragma: no cover - dependency is pinned
        raise RuntimeError("yfinance_unavailable") from exc

    frame = yf.Ticker(ticker).history(period=f"{int(days)}d", interval="1m", prepost=False)
    if frame is None or len(frame) == 0:
        raise RuntimeError(f"no intraday data for {ticker}")
    return _normalise_frame(frame, "us", ticker)


def fetch_india_1m(symbol: str) -> pd.DataFrame:
    """NSE 1-minute bars via the house Upstox wrapper, normalised like the US frame."""
    ticker = symbol.strip().upper()
    try:
        from market_data.market_data import fetch_candles
    except ImportError as exc:  # pragma: no cover - dependency is pinned
        raise RuntimeError("market_data_unavailable") from exc

    today = dt.datetime.now(config.IST).date()
    from_date = (today - dt.timedelta(days=8)).isoformat()
    frame = fetch_candles(ticker, 1, from_date, today.isoformat())
    if frame is None or len(frame) == 0:
        raise RuntimeError(f"no intraday data for {ticker}")
    return _normalise_frame(frame, "india", ticker)


def scan_symbol(symbol: str, market: str = "us") -> list[Anomaly]:
    """Fetch, profile on the history, detect on the last session, cool down.

    A symbol with fewer than two sessions of 1-minute history cannot be scored
    (no baseline) and returns an empty list rather than guessing.
    """
    frame = fetch_us_1m(symbol) if (market or "").lower() == "us" else fetch_india_1m(symbol)
    if frame is None or len(frame) < 2:
        return []

    sessions = _session_of(frame.index)
    unique_sessions = np.unique(sessions)
    if unique_sessions.size < 2:
        return []

    last_session = unique_sessions.max()
    baseline = frame[sessions != last_session]
    profile = baseline_profile(baseline)
    if not profile:
        return []

    found = detect(frame, profile, symbol=symbol)
    if market and str(market).lower() == "india":
        found = [replace(anomaly, exchange="NSE") for anomaly in found]
    else:
        found = [replace(anomaly, exchange="NASDAQ") for anomaly in found]
    return apply_cooldown(found)


__all__ = [
    "SIGMA_FLOOR",
    "apply_cooldown",
    "baseline_profile",
    "detect",
    "fetch_india_1m",
    "fetch_us_1m",
    "robust_sigma",
    "scan_symbol",
]
