"""Live-tail refresh for India symbol charts (Phase 1 backend core).

The chart endpoint already serves a completed-session base frame from
``chart_patterns.candles``.  This module refreshes only the *tail* of that
frame from the provider, merges it with the cached frame, and writes the
result back atomically.  It deliberately does **not** replace the full fetch
path, change cache keys/versions or synthesize a daily "today" bar.

Public interface
----------------
``TailMerge``
    Frozen result object returned by both merge/fetch entry points::

        TailMerge(
            frame: pd.DataFrame,
            appended: int,
            updated: int,
            cache_through: datetime | None,
            latest_bar: datetime | None,
            provider_called: bool,
            error: str | None,
        )

    ``appended`` counts timestamps that were not in ``cached``; ``updated``
    counts overlapping timestamps whose OHLC values changed (tail wins).
    ``cache_through`` is the cached frame's last bar (before merge) and
    ``latest_bar`` the merged frame's last bar.  Timestamps are UTC datetimes.
    On ``1D`` both frame and cache stay completed-session only (the display
    layer appends today's synthetic bar itself).

``merge_candle_tail(cached, tail) -> TailMerge``
    Pure, null-safe merge: UTC-normalize both indexes, concatenate, drop
    duplicate timestamps keeping the tail row, sort ascending.  Never touches
    the network or disk.

``fetch_live_tail(symbol, timeframe, cached, *, now=None, cache_path=None)
-> TailMerge``
    Fetch one overlapping tail for an NSE/India chart, merge it with
    ``cached``, persist the completed frame through ``atomic_write_pickle``
    (with the existing ``.meta`` sidecar refreshed) and return the result.
    ``cache_path`` targets the exact on-disk entry to read/merge/write (the
    API passes its ``lb{N}`` variant); when omitted, the default live-edge
    entry ``candles._cache_path(timeframe, symbol)`` is used.
    Only ``1D`` and intraday timeframes are refreshed; ``1W``/``1M`` return
    ``cached`` unchanged.  On ``1D`` the frame stays completed-session only:
    today's in-progress session is filtered out before merge/write and the
    display layer owns its synthetic today bar.  A partial/synthetic daily
    bar is therefore neither returned nor persisted.  Provider failure
    returns the cached frame with ``provider_called=True`` and a short
    ``error`` string.

    Operational guards:

    * ``CHART_TAIL_REFRESH=0`` (also ``false``/``no``/``off``) is a kill
      switch: return ``cached``, ``provider_called=False``, no network/disk.
    * Outside the NSE session (weekend/holiday/pre-open/after-close) return
      ``cached`` without a provider call.
    * One in-flight future per ``(symbol, timeframe)`` coalesces concurrent
      opens into a single provider call.
    * Failed refreshes get a short per-key cooldown (15s, 30s, 60s, then
      120s).  Cooldown only skips the provider; no long-lived error cache.
    * Provider calls are bounded by a global semaphore (default 4, clamped
      3–5 via ``CHART_TAIL_MAX_CONCURRENCY``).

    Cache writes target ``cache_path`` when supplied (the exact live-edge
    variant the caller read), else the default entry
    ``candles._cache_path(timeframe, symbol)``.  The write lock re-reads that
    exact path so a slow same-timestamp write cannot clobber a newer
    on-disk correction: when the disk's last bar is at least as new as the
    frame's and the disk changed while the fetch was in flight, on-disk
    overlapping rows win and only missing timestamps are filled.  The returned
    frame is likewise reconciled with that disk state, so discarded stale
    values never reach the API's series or labels.

``atomic_write_pickle(path, frame) -> None``
    Same-directory temp file, flush + fsync, then ``os.replace``.  The
    previous file survives any failure and the temp file is cleaned up.
    Delegates to :mod:`chart_patterns.candles` so there is one implementation.

The module is intentionally India-only: it uses the NSE holiday/session
helpers from :mod:`chart_patterns.candles` and never handles the US path.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import os
import tempfile
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

import market_data.market_data as md
from chart_patterns import candles
from chart_patterns._ist_date import ist_date, ist_datetime, ist_session_date

logger = logging.getLogger(__name__)

__all__ = [
    "TailMerge",
    "merge_candle_tail",
    "fetch_live_tail",
    "atomic_write_pickle",
]


def atomic_write_pickle(path: Path, frame: pd.DataFrame) -> None:
    """Atomically write ``frame`` (delegates to :mod:`chart_patterns.candles`).

    One implementation serves both this module's live-tail writes and the
    existing candles cache.  Kept as a module-level function so callers/tests
    can patch either ``tail_refresh.atomic_write_pickle`` or the candles
    helper and have the live-edge write honour it.
    """
    candles.atomic_write_pickle(path, frame)


#: Overlapping bar updates are compared on these columns (volume-only changes
#: still trigger a cache rewrite in ``fetch_live_tail``).
_OHLC_COLUMNS = ("open", "high", "low", "close")

#: Consecutive provider failures back off for 15 / 30 / 60 / 120 seconds.
FAILURE_COOLDOWNS_SEC: tuple[float, ...] = (15.0, 30.0, 60.0, 120.0)

#: Default provider-call concurrency, clamped to the requested 3–5 range.
_DEFAULT_MAX_CONCURRENCY = 4


@dataclass(frozen=True)
class TailMerge:
    """Result of a tail merge/refresh (see the module docstring)."""

    frame: pd.DataFrame
    appended: int
    updated: int
    cache_through: datetime | None
    latest_bar: datetime | None
    provider_called: bool
    error: str | None


# ---------------------------------------------------------------------------
# Frame/index helpers
# ---------------------------------------------------------------------------

def _empty_frame() -> pd.DataFrame:
    return pd.DataFrame(index=pd.DatetimeIndex([], tz="UTC"))


def _normalize_frame(frame: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """UTC-normalize a candle frame, dedupe (last wins) and sort.

    Returns ``None`` for ``None``/empty/non-frame input.  Rows whose index
    cannot be parsed as a timestamp are dropped rather than turned into a
    confident 1970 bar.
    """
    if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
        return None
    out = frame.copy()
    try:
        index = pd.DatetimeIndex(
            pd.to_datetime(out.index, utc=True, errors="coerce")
        )
    except Exception:
        return None
    valid = ~index.isna()
    if not bool(valid.all()):
        out = out.loc[valid]
        index = index[valid]
        if out.empty:
            return None
    out.index = index
    if out.index.has_duplicates:
        out = out[~out.index.duplicated(keep="last")]
    return out.sort_index()


def _last_timestamp(frame: Optional[pd.DataFrame]) -> Optional[pd.Timestamp]:
    if frame is None or frame.empty:
        return None
    try:
        return pd.Timestamp(frame.index[-1])
    except Exception:
        return None


def _frames_equivalent(
    left: Optional[pd.DataFrame], right: Optional[pd.DataFrame]
) -> bool:
    """Whether two frames carry the same bars (index + shared columns).

    Used as a fetch-recency marker at equal last timestamps: a disk frame
    identical to the caller's starting snapshot means no later refresh landed
    while the provider call was in flight.
    """
    if left is None or right is None or left.empty or right.empty:
        return False
    if len(left) != len(right) or not left.index.equals(right.index):
        return False
    columns = [column for column in left.columns if column in right.columns]
    if not columns:
        return False
    try:
        return bool(left[columns].astype(float).equals(right[columns].astype(float)))
    except Exception:
        return False


def _as_datetime(value: Optional[pd.Timestamp]) -> Optional[datetime]:
    if value is None:
        return None
    try:
        stamp = pd.Timestamp(value)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        return stamp.tz_convert("UTC").to_pydatetime()
    except Exception:
        return None


def _cached_result(
    cached: Optional[pd.DataFrame],
    *,
    provider_called: bool = False,
    error: Optional[str] = None,
) -> TailMerge:
    """A no-change result built from ``cached`` (UTC-normalized)."""
    normalized = _normalize_frame(cached)
    if normalized is None:
        return TailMerge(
            frame=_empty_frame(),
            appended=0,
            updated=0,
            cache_through=None,
            latest_bar=None,
            provider_called=provider_called,
            error=error,
        )
    last = _as_datetime(_last_timestamp(normalized))
    return TailMerge(
        frame=normalized,
        appended=0,
        updated=0,
        cache_through=last,
        latest_bar=last,
        provider_called=provider_called,
        error=error,
    )


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def merge_candle_tail(
    cached: pd.DataFrame | None, tail: pd.DataFrame | None
) -> TailMerge:
    """Merge a provider tail into ``cached``, newer rows winning.

    Null-safe.  The returned ``frame`` is UTC-indexed, duplicate-free and
    sorted.  ``appended`` counts net-new timestamps; ``updated`` counts
    overlapping timestamps whose OHLC values changed.  No I/O.
    """
    old = _normalize_frame(cached)
    new = _normalize_frame(tail)

    if old is None and new is None:
        return TailMerge(
            frame=_empty_frame(),
            appended=0,
            updated=0,
            cache_through=None,
            latest_bar=None,
            provider_called=False,
            error=None,
        )
    if old is None:
        merged = new.copy()
        assert merged is not None
        return TailMerge(
            frame=merged,
            appended=int(len(merged)),
            updated=0,
            cache_through=None,
            latest_bar=_as_datetime(_last_timestamp(merged)),
            provider_called=False,
            error=None,
        )
    if new is None:
        merged = old.copy()
        return TailMerge(
            frame=merged,
            appended=0,
            updated=0,
            cache_through=_as_datetime(_last_timestamp(old)),
            latest_bar=_as_datetime(_last_timestamp(merged)),
            provider_called=False,
            error=None,
        )

    merged = pd.concat([old, new])
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()

    appended = int(len(merged.index.difference(old.index)))

    updated = 0
    common = merged.index.intersection(old.index)
    if len(common):
        columns = [
            column
            for column in _OHLC_COLUMNS
            if column in old.columns and column in merged.columns
        ]
        if columns:
            old_rows = old.reindex(common)[columns]
            new_rows = merged.reindex(common)[columns]
            same = old_rows.eq(new_rows) | (old_rows.isna() & new_rows.isna())
            updated = int((~same.all(axis=1)).sum())

    return TailMerge(
        frame=merged,
        appended=appended,
        updated=updated,
        cache_through=_as_datetime(_last_timestamp(old)),
        latest_bar=_as_datetime(_last_timestamp(merged)),
        provider_called=False,
        error=None,
    )


# ---------------------------------------------------------------------------
# Session/clock helpers
# ---------------------------------------------------------------------------

def _now_ist(now: Optional[datetime] = None) -> datetime:
    if now is None:
        now = candles._now_ist()
    return ist_datetime(now)


def _refresh_window_open(now_ist: datetime) -> bool:
    """True only inside the NSE cash session (weekend/holiday-aware).

    Uses the same canonical predicate as the API/cache layers so a closed
    market never triggers a provider call.  Fail-open on a calendar error: a
    broken holiday table should not freeze the chart (the fetch itself is
    still bounded by the caller's timeout).
    """
    try:
        if not candles._is_trading_day(now_ist.date()):
            return False
    except Exception:
        pass
    try:
        from trading.utils import is_market_open

        return bool(is_market_open(now_ist))
    except Exception:
        return True


def _kill_switch_on() -> bool:
    value = str(os.environ.get("CHART_TAIL_REFRESH", "1")).strip().lower()
    return value in {"0", "false", "no", "off"}


def _completed_daily_only(
    frame: Optional[pd.DataFrame], now_ist: datetime
) -> Optional[pd.DataFrame]:
    """Drop the in-progress (or future) daily session from ``frame``.

    Daily bars are stamped 18:30 UTC of the prior calendar day, so the cutoff
    is compared in IST session dates.  During the session the cutoff is the
    previous completed session; after 15:30 it is today.  Returns the input
    unchanged when the session date cannot be resolved (fail-open).
    """
    if frame is None or frame.empty:
        return frame
    try:
        last_done = candles._last_completed_session(now_ist)
    except Exception:
        return frame
    if last_done is None:
        return frame

    keep: list[bool] = []
    for value in frame.index:
        session_date = ist_date(value)
        keep.append(session_date is None or session_date <= last_done)
    if all(keep):
        return frame
    return frame.loc[keep]


def _provider_start_date(last_cached: pd.Timestamp, minutes: int) -> str:
    start = last_cached - pd.Timedelta(minutes=int(minutes))
    return ist_session_date(start)


def _fetch_provider_tail(
    symbol: str,
    timeframe: str,
    from_date: str,
    to_date: str,
) -> Optional[pd.DataFrame]:
    """Provider fetch hook (tests monkeypatch this or market_data).

    Uses the daily path without ``include_partial_today``: the core refresh
    never synthesizes today's 1D bar (the display layer does that).
    """
    return md.fetch_candles_for_timeframe(
        symbol,
        timeframe,
        from_date=from_date,
        to_date=to_date,
    )


# ---------------------------------------------------------------------------
# Concurrency / cooldown state
# ---------------------------------------------------------------------------

_INFLIGHT: dict[tuple[str, str], Future] = {}
_INFLIGHT_LOCK = threading.Lock()


@dataclass
class _CooldownState:
    failures: int
    until: float
    error: Optional[str]


_COOLDOWNS: dict[tuple[str, str], _CooldownState] = {}
_COOLDOWN_LOCK = threading.Lock()

_WRITE_LOCK = threading.Lock()


def _configured_concurrency() -> int:
    try:
        raw = int(os.environ.get("CHART_TAIL_MAX_CONCURRENCY", str(_DEFAULT_MAX_CONCURRENCY)))
    except (TypeError, ValueError):
        raw = _DEFAULT_MAX_CONCURRENCY
    return max(3, min(5, raw))


_PROVIDER_SEMAPHORE = threading.BoundedSemaphore(_configured_concurrency())


def _reset_state() -> None:
    """Clear in-flight/cooldown state (tests and operator resets)."""
    with _INFLIGHT_LOCK:
        _INFLIGHT.clear()
    with _COOLDOWN_LOCK:
        _COOLDOWNS.clear()


def _cooldown_active(key: tuple[str, str]) -> bool:
    now = time.monotonic()
    with _COOLDOWN_LOCK:
        state = _COOLDOWNS.get(key)
        if state is None:
            return False
        if now < state.until:
            return True
        # Keep the consecutive-failure count for the next backoff step but
        # drop the old error: no long-lived error cache.
        state.error = None
        return False


def _record_failure(key: tuple[str, str], message: str) -> None:
    now = time.monotonic()
    with _COOLDOWN_LOCK:
        previous = _COOLDOWNS.get(key)
        failures = (previous.failures if previous is not None else 0) + 1
        index = min(failures - 1, len(FAILURE_COOLDOWNS_SEC) - 1)
        delay = FAILURE_COOLDOWNS_SEC[index] if FAILURE_COOLDOWNS_SEC else 0.0
        _COOLDOWNS[key] = _CooldownState(
            failures=failures,
            until=now + max(0.0, float(delay)),
            error=message,
        )
    logger.debug("chart tail refresh cooldown key=%s failures=%d error=%s", key, failures, message)


def _record_success(key: tuple[str, str]) -> None:
    with _COOLDOWN_LOCK:
        _COOLDOWNS.pop(key, None)


# ---------------------------------------------------------------------------
# Cache persistence
# ---------------------------------------------------------------------------

def _atomic_write_json(path: Path, payload: dict) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Optional[Path] = None
    try:
        fd, tmp_name = tempfile.mkstemp(
            dir=str(destination.parent),
            prefix=f".{destination.name}.",
            suffix=".tmp",
        )
        tmp_path = Path(tmp_name)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(tmp_path), str(destination))
        tmp_path = None
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _meta_session(frame: pd.DataFrame, timeframe: str, now_ist: datetime) -> Optional[str]:
    if timeframe == "1D":
        return candles.frame_last_date(frame)
    try:
        return candles._last_completed_session(now_ist).isoformat()
    except Exception:
        return None


def _persist_completed(
    path: Path,
    timeframe: str,
    frame: pd.DataFrame,
    now_ist: datetime,
    *,
    fetched_from: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Write the completed frame + existing-style ``.meta`` sidecar.

    Under the write lock, re-read the exact destination and merge it with
    ``frame`` so a slower caller holding an older snapshot cannot clobber a
    newer refresh that already landed.  If the disk frame is strictly ahead,
    leave it alone.  Equal last timestamps carry no recency information, so
    the caller's starting snapshot (``fetched_from``) decides: when disk has
    changed since that snapshot, on-disk OHLC wins and only timestamps the
    disk lacks are filled in; when disk is value-equivalent to the snapshot,
    the just-fetched frame is newer and its overlapping bars may land.

    Returns the frame that is authoritative after reconciliation — the frame
    written, or the newer on-disk frame when the incoming write is stale — so
    the caller never reports a value that was deliberately discarded here.
    """
    if frame is None or frame.empty:
        return frame
    path = Path(path)
    with _WRITE_LOCK:
        current = candles._read_pickle_any(path)
        if current is not None and str(timeframe) == "1D":
            current = _completed_daily_only(current, now_ist)
        if current is not None:
            current_last = _last_timestamp(current)
            frame_last = _last_timestamp(frame)
            if (
                current_last is not None
                and frame_last is not None
                and current_last > frame_last
            ):
                return current
            elif (
                current_last is not None
                and frame_last is not None
                and current_last == frame_last
                and not _frames_equivalent(current, fetched_from)
            ):
                # Equal last bar and the disk moved since the fetch began:
                # keep on-disk OHLC and fill only the gaps the disk lacks. A
                # stale slower tail cannot overwrite a newer correction.
                frame = merge_candle_tail(frame, current).frame
            else:
                frame = merge_candle_tail(current, frame).frame
        session = _meta_session(frame, timeframe, now_ist)
        atomic_write_pickle(path, frame)
        if session:
            _atomic_write_json(
                path.with_suffix(".meta"),
                {"ts": time.time(), "session": session},
            )
    return frame


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def _refresh_locked(
    symbol: str,
    timeframe: str,
    cached: pd.DataFrame,
    now_ist: datetime,
    key: tuple[str, str],
    cache_path: Path,
) -> TailMerge:
    """Leader path: fetch one tail, merge, persist to ``cache_path``."""
    is_daily = str(timeframe) == "1D"
    cached_view = _completed_daily_only(cached, now_ist) if is_daily else cached
    if cached_view is None or cached_view.empty:
        return _cached_result(
            cached,
            provider_called=False,
            error="no completed cached frame",
        )
    last_cached = _last_timestamp(cached_view)
    if last_cached is None:
        return _cached_result(cached, error="cached frame has no timestamp")

    spec = candles._resolve_timeframe(timeframe)
    minutes = int(getattr(spec, "minutes", 0) or 0)
    from_date = _provider_start_date(last_cached, minutes)
    to_date = now_ist.strftime("%Y-%m-%d")

    try:
        with _PROVIDER_SEMAPHORE:
            raw_tail = _fetch_provider_tail(
                symbol,
                timeframe,
                from_date,
                to_date,
            )
    except Exception as exc:  # noqa: BLE001 - provider failure is fail-soft
        message = str(exc) or type(exc).__name__
        _record_failure(key, message)
        logger.warning(
            "chart tail refresh failed symbol=%s timeframe=%s from=%s to=%s error=%s",
            symbol, timeframe, from_date, to_date, message,
        )
        return _cached_result(cached, provider_called=True, error=message)

    tail = _normalize_frame(raw_tail)
    if tail is None:
        message = "provider returned no candles"
        _record_failure(key, message)
        return _cached_result(cached, provider_called=True, error=message)

    if is_daily:
        # Completed-session only: today's in-progress daily bar (official or
        # synthetic) never enters the tail merge or the cache.
        tail = _completed_daily_only(tail, now_ist)
        if tail is None or tail.empty:
            _record_success(key)
            return _cached_result(cached_view, provider_called=True)

    tail_last = _last_timestamp(tail)
    if tail_last is not None and tail_last < last_cached:
        message = "provider tail older than cached frame"
        _record_failure(key, message)
        logger.info(
            "chart tail refresh ignored stale provider symbol=%s timeframe=%s "
            "provider_last=%s cached_last=%s",
            symbol, timeframe, tail_last, last_cached,
        )
        return _cached_result(cached, provider_called=True, error=message)

    merged = merge_candle_tail(cached_view, tail)
    _record_success(key)

    error: Optional[str] = None
    effective = merged.frame
    # A successful provider call always confirms the completed frame, even
    # when it carried no net-new bar: rewrite it so the cache's ``.meta``
    # freshness stamp advances and repeated polls do not re-hit the feed.
    if not merged.frame.empty:
        try:
            effective = _persist_completed(
                cache_path,
                timeframe,
                merged.frame,
                now_ist,
                fetched_from=cached_view,
            )
        except Exception as exc:  # noqa: BLE001 - cache write must not lose the frame
            error = f"cache write failed: {exc}"
            logger.warning(
                "chart tail cache write failed symbol=%s timeframe=%s error=%s",
                symbol, timeframe, exc,
            )

    # Report the disk-reconciled frame so a discarded stale write can never
    # surface as a fresh value in the API payload or its freshness labels.
    result = merge_candle_tail(cached_view, effective)
    return dataclasses.replace(result, provider_called=True, error=error)


def fetch_live_tail(
    symbol: str,
    timeframe: str,
    cached: pd.DataFrame,
    *,
    now: datetime | None = None,
    cache_path: Path | None = None,
) -> TailMerge:
    """Fetch and merge a live tail for an India/NSE chart (see module docs).

    The provider call starts one target bar before ``cached``'s last bar so
    the overlap proves continuity; dedupe keeps the provider's newer row.
    ``cache_path`` is the exact on-disk entry to read/merge/write (e.g. the
    API's ``lb500`` variant); ``None`` uses the default live-edge path.
    ``cached`` is not mutated.  On any guard/failure the returned ``frame``
    is the UTC-normalized cached frame, never an empty replacement.
    """
    normalized_cached = _normalize_frame(cached)
    if normalized_cached is None:
        return TailMerge(
            frame=_empty_frame(),
            appended=0,
            updated=0,
            cache_through=None,
            latest_bar=None,
            provider_called=False,
            error="no cached frame",
        )

    if _kill_switch_on():
        return _cached_result(normalized_cached)

    try:
        spec = candles._resolve_timeframe(timeframe)
    except Exception as exc:
        return _cached_result(normalized_cached, error=f"unsupported timeframe: {exc}")

    minutes = int(getattr(spec, "minutes", 0) or 0)
    if minutes <= 0:
        return _cached_result(normalized_cached, error="unsupported timeframe")
    if minutes >= 1440 and str(timeframe) != "1D":
        # Weekly/monthly bars close on their own period; the normal chart
        # fetch owns them.  Tail refresh is 1D + intraday only.
        return _cached_result(normalized_cached)

    try:
        now_ist = _now_ist(now)
    except Exception as exc:  # noqa: BLE001 - bad injected clock is fail-soft
        return _cached_result(normalized_cached, error=f"invalid now: {exc}")
    if not _refresh_window_open(now_ist):
        return _cached_result(normalized_cached)

    symbol_u = str(symbol).strip().upper()
    target_path = (
        Path(cache_path)
        if cache_path is not None
        else candles._cache_path(timeframe, symbol_u)
    )
    key = (symbol_u, str(timeframe))
    if _cooldown_active(key):
        return _cached_result(normalized_cached)

    with _INFLIGHT_LOCK:
        future = _INFLIGHT.get(key)
        if future is None:
            future = Future()
            _INFLIGHT[key] = future
            leader = True
        else:
            leader = False

    if not leader:
        try:
            return future.result()
        except Exception as exc:  # noqa: BLE001 - a waiter never invents data
            return _cached_result(
                normalized_cached,
                provider_called=True,
                error=str(exc) or type(exc).__name__,
            )

    try:
        try:
            result = _refresh_locked(
                symbol_u,
                str(timeframe),
                normalized_cached,
                now_ist,
                key,
                target_path,
            )
        except Exception as exc:  # noqa: BLE001 - leader must always publish
            message = str(exc) or type(exc).__name__
            _record_failure(key, message)
            logger.exception(
                "chart tail refresh crashed symbol=%s timeframe=%s", symbol, timeframe,
            )
            result = _cached_result(
                normalized_cached,
                provider_called=True,
                error=message,
            )
        future.set_result(result)
    finally:
        with _INFLIGHT_LOCK:
            if _INFLIGHT.get(key) is future:
                _INFLIGHT.pop(key, None)
    return result
