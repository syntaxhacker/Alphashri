"""Candle fetching + disk caching for the chart-patterns engine.

Wraps the unified fetcher (``market_data.market_data.fetch_candles_for_timeframe``);
never forks the broker client. Resolves the native source timeframe and any
required resample target from ``chart_patterns.timeframes`` (CONTRACT.md §1).

Cache layout (mirrors ``api/paper/chart_cache.py``)::

    experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.pkl
    experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.meta

While the market is open, today's entry has a short TTL (intraday bars keep
moving); once the session is complete the entry is pinned to that session
(``meta["session"]``) so it stays fresh across weekends/holidays.
Historical data never expires.
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import tempfile
import threading
import time
from concurrent.futures import Future
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional, Union

import pandas as pd

from common.numbers import to_float
from market_data.market_data import _lookback_days, _resample_rule

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / "experiments" / "data" / "pattern_cache" / "candles"

#: Bump when the *content* semantics of a cached frame change (e.g. the daily
#: completed-session backfill from the 1-minute tape) so pre-existing entries on
#: disk are ignored rather than served as if still fresh — the session pin only
#: tracks *which* session a frame ends on, not what it contains.
CACHE_VERSION = 3
#: TTL for today's entry while the market is open. Completed-session bars
#: are immutable, and the in-progress session never enters the cache, so a
#: 5-minute window keeps repeat screens instant without serving stale data
#: across sessions (the session pin takes over once the market closes).
TODAY_TTL_SECONDS = 300
#: TTL for the candles-layer negative cache. A fetch that comes back
#: empty/None (symbol missing, Upstox down, 429 wall) is remembered for this
#: window so repeated chart clicks do not re-hammer the feed. Deliberately
#: shorter than the disk TTL: empty results are an unhealthy signal, and a
#: transient upstream failure should clear quickly. Non-empty frames are
#: never held here (they go to the disk cache instead) and exceptions are
#: never cached — each still propagates to its own caller.
EMPTY_RESULT_TTL_SECONDS = 90.0
_EMPTY_CACHE_MAX = 512
#: Default tolerance for completed 1D cache entries: the exact current
#: behaviour (a frame may end on the last completed session or one before it).
#: Analytical callers may pass a wider *bounded* tolerance explicitly; charts,
#: scans and replay must keep this default so they never serve an old frame.
DEFAULT_MAX_LAG_SESSIONS = 1

def _attr(spec: Any, name: str, default=None):
    if spec is None:
        return default
    if isinstance(spec, dict):
        return spec.get(name, default)
    return getattr(spec, name, default)


def _resolve_timeframe(tf_id: str):
    try:
        from chart_patterns.timeframes import get_timeframe
    except Exception as exc:  # pragma: no cover - integration env always has it
        raise RuntimeError("chart_patterns.timeframes unavailable") from exc
    return get_timeframe(tf_id)


def _is_today(date_str: str) -> bool:
    import config
    return date_str == datetime.now(config.IST).strftime("%Y-%m-%d")


def _asof_date_part(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text[:10] if text else None


def _asof_time_variant(value: Optional[str]) -> Optional[str]:
    """Cache-variant fragment for the time portion of an as-of value.

    Returns ``None`` for date-only values so their cache path is unchanged;
    an intraday as-of (``...THH:MM``) gets its own namespaced entry that can
    never poison the default cache.
    """
    text = str(value).strip() if value is not None else ""
    if len(text) <= 10:
        return None
    safe = "".join(c for c in text[10:] if c.isalnum())
    return f"to{safe}" if safe else "toT"


def parse_asof_datetime(value: str) -> datetime:
    """Parse an as-of/from value into an IST-aware ``datetime``.

    Accepts ``"YYYY-MM-DD"`` or ``"YYYY-MM-DDTHH:MM"`` (and ``:SS``); a
    date-only value means IST midnight. Raises ``ValueError`` on garbage.
    """
    text = str(value).strip() if value is not None else ""
    try:
        parsed = datetime.fromisoformat(text)
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"invalid date {value!r}; expected YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS]"
        ) from exc
    try:
        from trading.timezone import IST as _IST2
    except Exception:
        import config as _cfg

        _IST2 = getattr(_cfg, "IST", None)
    try:
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=_IST2)
        return parsed.astimezone(_IST2)
    except Exception as exc:
        raise ValueError(
            f"invalid date {value!r}; expected YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS]"
        ) from exc


def truncate_frame_to(df: pd.DataFrame, to_dt: datetime) -> Optional[pd.DataFrame]:
    """Return rows with index ``<= to_dt``, comparing in IST.

    Candle indexes are UTC; the comparison converts to IST first so an
    intraday ``to_dt`` truncates at the right bar. Never raises: falls back
    to the untruncated frame on any error.
    """
    if df is None or getattr(df, "empty", True):
        return df
    try:
        idx = df.index
        try:
            if idx.tz is None:
                idx_ist = idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
            else:
                idx_ist = idx.tz_convert("Asia/Kolkata")
        except Exception:
            idx_ist = idx
        return df[idx_ist <= to_dt]
    except Exception:
        return df


def _is_trading_day(d: date) -> bool:
    from trading import utils as trading_utils

    if d.weekday() >= 5:
        return False
    try:
        return not trading_utils.is_trading_holiday(d)
    except Exception:
        return True


def _now_ist() -> datetime:
    from trading.timezone import IST

    return datetime.now(IST)


def previous_trading_day(d: date) -> Optional[date]:
    """Most recent NSE session strictly before ``d``.

    Walks back over weekends and trading holidays; ``None`` when no session is
    found within a year (a broken holiday calendar, never a real date).
    """
    cursor = d - timedelta(days=1)
    for _ in range(365):
        if _is_trading_day(cursor):
            return cursor
        cursor -= timedelta(days=1)
    return None


def _last_completed_session(now: Optional[datetime] = None) -> date:
    """Last NSE session whose 15:30 IST close has passed.

    Returns today when ``now`` is at/after 15:30 IST on a trading day,
    else the most recent previous trading day (walks back over
    weekends/holidays). Self-contained: uses ``trading.utils`` +
    ``trading.timezone`` only (no ``trading.calendar`` dependency).
    """
    from trading.timezone import IST
    from trading.utils import MARKET_CLOSE

    if now is None:
        now = _now_ist()
    if isinstance(now, datetime):
        today = now.date()
        try:
            close = datetime(
                today.year, today.month, today.day,
                MARKET_CLOSE[0], MARKET_CLOSE[1],
                tzinfo=now.tzinfo if now.tzinfo is not None else IST,
            )
            after_close = now >= close
        except Exception:
            after_close = now.hour * 60 + now.minute >= 15 * 60 + 30
    else:
        today = now
        after_close = True
    if _is_trading_day(today) and after_close:
        return today
    return previous_trading_day(today) or (today - timedelta(days=1))


def current_session_date(now: Optional[datetime] = None) -> Optional[date]:
    """IST date of today's session, or ``None`` on a weekend/trading holiday.

    Deliberately not derived from :func:`_last_completed_session`: that helper
    only advances at the 15:30 close, so on a live Monday it still names the
    previous Friday. A chart wants "is there a session today", which is true all
    through the trading day.
    """
    today = _now_ist() if now is None else now
    if isinstance(today, datetime):
        today = today.date()
    return today if _is_trading_day(today) else None


def missing_today_bar(df: pd.DataFrame) -> bool:
    """True when a daily frame ends on the last completed session, not today.

    This is the append gate for the display edge, and it is deliberately *not*
    ``as_of < _last_completed_session()``: that helper only advances at the
    15:30 close, so on a live Monday it still names the previous Friday and a
    Friday frame looks complete for the whole session — the chart then served
    Friday until 15:30.

    Restricted to a one-session gap (``previous_trading_day``, so the
    Friday→Monday and holiday-bridge cases qualify). A frame further back is a
    lagging feed: appending one isolated bar would draw a hole under a chart
    that then claims to be current, so the stale frame is served as stale and
    the background refresh closes the gap. False on a weekend/holiday (no
    session) and when the frame already ends today (no duplicate). Never raises.
    """
    if df is None or getattr(df, "empty", True):
        return False
    session = current_session_date()
    last = frame_last_date(df)
    if session is None or not last:
        return False
    previous = previous_trading_day(session)
    return previous is not None and last == previous.isoformat()


def _cache_path(tf_id: str, symbol: str, as_of_date: Optional[str] = None,
               variant: Optional[str] = None) -> Path:
    """Cache file for a symbol/timeframe, keyed by date when historical.

    An explicitly passed ``as_of_date`` gets its own cache file so historical
    scans never read (or poison) today's cache; the default (today) path is
    unchanged. An optional ``variant`` (e.g. ``"lb250"``) namespaces scans that
    fetch a different history window so they cannot poison the default cache.
    """
    if as_of_date:
        safe = "".join(c for c in str(as_of_date) if c.isalnum() or c in ("-", "_"))
        base = f"{symbol.upper()}.{safe or 'nodate'}"
    else:
        base = symbol.upper()
    if variant:
        base = f"{base}.{variant}"
    return CACHE_DIR / str(tf_id) / f"{base}.v{CACHE_VERSION}.pkl"


def _read_cached(
    path: Path,
    is_today: bool,
    is_daily: bool = False,
    max_lag_sessions: int = DEFAULT_MAX_LAG_SESSIONS,
) -> Optional[pd.DataFrame]:
    """Read a disk entry, tolerating at most ``max_lag_sessions`` for 1D.

    Callers that need current bars keep the default; bounded analytical
    tolerances are opt-in so a lagging feed does not force a refetch storm.
    """
    if not path.exists():
        return None
    try:
        if is_today:
            meta_path = path.with_suffix(".meta")
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                session = _last_completed_session().isoformat()
                if is_daily:
                    # Completed daily sessions are immutable. A frame that
                    # reaches the last completed session stays valid for the
                    # whole session; we also tolerate a frame exactly one
                    # completed session behind (the official daily feed lags
                    # the tape, and a Fri->Mon bridge is one session).
                    #
                    # The old rule tolerated 3 *calendar* days, which cannot
                    # distinguish a weekend bridge from two genuinely missing
                    # sessions (a Monday frame served on Thursday). Count
                    # sessions instead; the threshold is caller-controlled but
                    # bounded so an unbounded frame can never be served.
                    meta_session = meta.get("session")
                    if meta_session != session:
                        try:
                            ref_date = date.fromisoformat(session)
                            meta_date = (
                                date.fromisoformat(str(meta_session))
                                if meta_session is not None else None
                            )
                        except (ValueError, TypeError):
                            return None
                        if meta_date is None or meta_date > ref_date:
                            return None
                        lag_sessions = 0
                        cursor = ref_date
                        while cursor > meta_date:
                            lag_sessions += 1
                            prev = previous_trading_day(cursor)
                            if prev is None or prev >= cursor:
                                return None
                            cursor = prev
                        if lag_sessions > max(0, int(max_lag_sessions)):
                            return None
                else:
                    from trading import utils as trading_utils

                    try:
                        market_open = trading_utils.is_market_open()
                    except Exception:
                        market_open = True
                    if market_open:
                        if time.time() - meta.get("ts", 0) > TODAY_TTL_SECONDS:
                            return None
                    elif meta.get("session") != session:
                        return None
            else:
                return None
        with open(path, "rb") as f:
            df = pickle.load(f)
        if not isinstance(df, pd.DataFrame) or df.empty:
            return None
        return df
    except Exception:
        return None


def _read_pickle_any(path: Path) -> Optional[pd.DataFrame]:
    try:
        if not path.exists():
            return None
        with open(path, "rb") as f:
            df = pickle.load(f)
        return df if isinstance(df, pd.DataFrame) and not df.empty else None
    except Exception:
        return None


def _merge_frames(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    merged = pd.concat([old, new])
    return merged[~merged.index.duplicated(keep="last")].sort_index()


def atomic_write_pickle(path: Path, frame: pd.DataFrame) -> None:
    """Write ``frame`` to ``path`` atomically (same-directory temp + fsync).

    The temp file is created next to the destination (so ``os.replace`` is a
    same-filesystem rename), flushed and fsynced, then swapped in. On any
    failure the previous file is left untouched and the temp file is removed;
    the exception propagates so callers can decide whether to retry/log.

    Used by :func:`_write_cached` and by the live-tail refresh so a reader
    never observes a half-written pickle during a concurrent refresh.
    """
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
        with os.fdopen(fd, "wb") as handle:
            pickle.dump(frame, handle)
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


def _write_cached(
    path: Path, df: pd.DataFrame, is_today: bool, session_pin: Optional[str] = None
) -> None:
    if df is None or df.empty:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_pickle(path, df)
        if is_today:
            # Pin to the frame's own last session when provided (1D): a frame
            # that stops short of the last completed session (the official
            # daily endpoint lags the tape) must not be stamped as current, or
            # the wall-clock session pin would serve it as fresh all session.
            stamp = session_pin or _last_completed_session().isoformat()
            with open(path.with_suffix(".meta"), "w") as f:
                json.dump({"ts": time.time(), "session": stamp}, f)
    except Exception:
        pass


def _fill_provenance(prov: dict, path: Path, hit: bool) -> None:
    """Populate a ``fetch_for_timeframe`` provenance out-param (never raises).

    ``prov["from_cache"]`` is True on a cache hit; ``cache_age_sec`` (now −
    the ``.meta`` ``ts``) and ``session_pin`` (the ``.meta`` ``session``) are
    filled when a ``.meta`` sidecar exists (today-path entries) and left None
    otherwise (historical entries carry no sidecar).
    """
    prov["from_cache"] = bool(hit)
    age = None
    session = None
    if hit:
        try:
            with open(path.with_suffix(".meta"), "r") as f:
                meta = json.load(f)
            ts = meta.get("ts") if isinstance(meta, dict) else None
            if isinstance(ts, (int, float)):
                age = max(0, int(time.time() - ts))
            sess = meta.get("session") if isinstance(meta, dict) else None
            session = str(sess) if sess else None
        except Exception:
            pass
    prov["cache_age_sec"] = age
    prov["session_pin"] = session
    prov["cache_session"] = session
    try:
        _lcs = _last_completed_session().isoformat()
    except Exception:
        _lcs = None
    # True when the served frame's meta session lags the last completed
    # session (within the daily tolerance) — callers can mark it stale.
    prov["session_stale"] = bool(hit and session and _lcs and session != _lcs)


def _normalize_filter(value: Optional[Union[str, Iterable[str]]]) -> Optional[set]:
    if value is None:
        return None
    if isinstance(value, str):
        items = [value]
    else:
        items = list(value)
    out = {str(v).upper() for v in items if str(v).strip()}
    return out or None


def clear_cache(
    symbols: Optional[Union[str, Iterable[str]]] = None,
    timeframe: Optional[Union[str, Iterable[str]]] = None,
) -> int:
    """Delete cached candle files (``*.pkl`` + ``*.meta``) under ``CACHE_DIR``.

    Filters by timeframe directory and/or symbol prefix (``"RELIANCE"``
    matches ``RELIANCE.pkl``, ``RELIANCE.<date>.pkl`` and lookback variants
    such as ``RELIANCE.lb250.pkl``). Returns the number of files removed;
    safe (returns 0) when nothing matches or the cache dir is absent.
    """
    try:
        if not CACHE_DIR.exists():
            return 0
    except Exception:
        return 0
    tf_filter = _normalize_filter(timeframe)
    sym_filter = _normalize_filter(symbols)
    removed = 0
    try:
        candidates: list[Path] = []
        for suffix in ("*.pkl", "*.meta"):
            if tf_filter:
                for tf in tf_filter:
                    candidates.extend((CACHE_DIR / tf).glob(suffix))
            else:
                candidates.extend(CACHE_DIR.glob(f"*/{suffix}"))
                candidates.extend(
                    p for p in CACHE_DIR.glob(suffix) if p.is_file()
                )
        for path in candidates:
            try:
                if not path.is_file():
                    continue
                if sym_filter is not None:
                    head = path.stem.upper().split(".")[0]
                    if head not in sym_filter:
                        continue
                path.unlink()
                removed += 1
            except Exception:
                continue
    except Exception:
        return removed
    return removed


def _resample(df: pd.DataFrame, tf_minutes: int) -> pd.DataFrame:
    """Resample OHLCV to ``tf_minutes``.

    Intraday targets are binned per exchange session, starting at that
    session's first supplied bar (09:15 for NSE), because a fixed IST-midnight
    grid produced off-session bins (e.g. 4h bars at 08:00/12:00/16:00, with a
    45-minute first bar). Daily/weekly/monthly targets keep the generic
    calendar-rule resample (``_resample_ohlcv``).
    """
    minutes = int(tf_minutes)
    if minutes < 1440:
        return _resample_session_binned(df, minutes)
    return _resample_ohlcv(
        df, _resample_rule(minutes), label="left", closed="left"
    )


def _infer_bar_step(index) -> Optional[pd.Timedelta]:
    """Typical spacing of the supplied bars (median positive diff), or None."""
    try:
        diffs = pd.Series(index).diff().dropna()
        diffs = diffs[diffs > pd.Timedelta(0)]
        if diffs.empty:
            return None
        step = diffs.median()
        return step if pd.notna(step) and step > pd.Timedelta(0) else None
    except Exception:
        return None


def _nse_session_close(first, last, step) -> Optional[pd.Timestamp]:
    """15:30 IST on ``first``'s date when the group looks like an NSE session.

    A group is treated as the NSE session only when it opens around 09:15 and
    its last bar does not run past the close by more than one source bar (the
    synthetic midnight-anchored test frames, for example, run to 20:00 and must
    keep their own scaling).
    """
    open_minutes = first.hour * 60 + first.minute
    if not (9 * 60 <= open_minutes <= 9 * 60 + 30):
        return None
    try:
        from trading.utils import MARKET_CLOSE

        close_hour, close_minute = MARKET_CLOSE
    except Exception:
        close_hour, close_minute = 15, 30
    close = first.normalize() + pd.Timedelta(hours=close_hour, minutes=close_minute)
    if last > close + (step or pd.Timedelta(0)):
        return None
    return close


def _aggregate_bin(chunk: pd.DataFrame, columns: list) -> dict:
    row = {}
    for name in columns:
        values = chunk[name]
        if name == "open":
            row[name] = values.iloc[0]
        elif name == "high":
            row[name] = values.max()
        elif name == "low":
            row[name] = values.min()
        elif name == "volume":
            row[name] = values.sum()
        else:
            row[name] = values.iloc[-1]
    return row


def _resample_session_binned(df: pd.DataFrame, tf_minutes: int) -> pd.DataFrame:
    """Aggregate intraday OHLCV into bins anchored to each session's first bar.

    The final bin of a session is merged into the previous bin when it covers
    less than 25% of the target width (e.g. NSE 3h: 12:15 + a 15:15-15:30
    stub becomes one 12:15 bar). Merging keeps the session's closing print in
    the series; dropping it would end the chart at 15:15. A single-bin session
    is never merged away. Never raises; returns ``df`` unchanged on failure.
    """
    if df is None or df.empty:
        return df
    agg = ("open", "high", "low", "close", "volume")
    available = [name for name in agg if name in df.columns]
    if "close" not in available:
        return df
    orig_tz = df.index.tz
    try:
        if orig_tz is None:
            ist_index = df.index.tz_localize("UTC").tz_convert("Asia/Kolkata")
        else:
            ist_index = df.index.tz_convert("Asia/Kolkata")
    except Exception:
        return df
    work = df.copy()
    work.index = ist_index
    width = pd.Timedelta(minutes=int(tf_minutes))
    step = _infer_bar_step(ist_index)
    timestamps: list = []
    rows: list = []
    try:
        for _session_date, group in work.groupby(ist_index.date):
            group = group.sort_index()
            if group.empty:
                continue
            first = group.index[0]
            last = group.index[-1]
            bins = [int(delta // width) for delta in (group.index - first)]
            bin_ids = sorted(set(bins))
            merge_last = False
            if len(bin_ids) > 1:
                final_start = first + width * bin_ids[-1]
                end = last + (step or width)
                session_close = _nse_session_close(first, last, step)
                if session_close is not None and end >= session_close:
                    end = session_close
                merge_last = (end - final_start) < width * 0.25
            for position, bin_id in enumerate(bin_ids):
                if merge_last and position >= len(bin_ids) - 2:
                    continue
                chunk = group[[b == bin_id for b in bins]]
                timestamps.append(first + width * bin_id)
                rows.append(_aggregate_bin(chunk, available))
            if merge_last:
                chunk = group[[b >= bin_ids[-2] for b in bins]]
                timestamps.append(first + width * bin_ids[-2])
                rows.append(_aggregate_bin(chunk, available))
    except Exception:
        return df
    if not rows:
        return df
    out = pd.DataFrame(rows, index=pd.DatetimeIndex(timestamps), columns=available)
    out = out.dropna(subset=["close"])
    try:
        if orig_tz is None:
            out.index = out.index.tz_convert("UTC").tz_localize(None)
        else:
            out.index = out.index.tz_convert(orig_tz)
    except Exception:
        pass
    return out


def _resample_ohlcv(
    df: pd.DataFrame, rule: str, *, label: str = "right", closed: str = "right"
) -> pd.DataFrame:
    """Resample an OHLCV frame to a pandas offset rule anchored to IST.

    ``rule`` is a raw pandas offset alias (e.g. ``"W-FRI"`` for weekly
    candles or ``"ME"`` for month-end). Aggregates open=first, high=max,
    low=min, close=last, volume=sum. The index is converted to IST before
    resampling so calendar rules label on IST boundaries, then returned in its
    original timezone. This is a calendar grid, not a session grid — intraday
    resampling must go through :func:`_resample`. Never raises; returns the
    input unchanged when it cannot be resampled.
    """
    if df is None or df.empty:
        return df
    agg = {
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }
    available = {k: v for k, v in agg.items() if k in df.columns}
    if "close" not in available:
        return df
    orig_tz = df.index.tz
    try:
        if orig_tz is None:
            ist_index = df.index.tz_localize("UTC").tz_convert("Asia/Kolkata")
        else:
            ist_index = df.index.tz_convert("Asia/Kolkata")
    except Exception:
        ist_index = df.index
    work = df.copy()
    work.index = ist_index
    out = work.resample(rule, label=label, closed=closed).agg(available)
    out = out.dropna(subset=["close"])
    try:
        if orig_tz is None:
            out.index = out.index.tz_convert("UTC").tz_localize(None)
        else:
            out.index = out.index.tz_convert(orig_tz)
    except Exception:
        pass
    return out


# Concurrent chart opens for the same symbol/timeframe must not each fire a
# broker fetch (10–14 s apiece, and the shared Upstox budget cannot take it).
# Two cheap guards live at this layer:
#
# * ``_INFLIGHT`` — a per-key singleflight. The first caller runs the fetch;
#   later callers wait on its ``Future`` and share the exact result (or, if
#   the fetch raised, get ``None`` instead of piling up duplicate requests).
# * ``_EMPTY_CACHE`` — a short monotonic-TTL negative cache for empty/None
#   results, scoped per session. Errors are deliberately NOT cached: a raise
#   means something is broken, not that the symbol has no data, and callers
#   (API retry, SSE worker) should see the failure each time.

_INFLIGHT: dict[tuple, Future] = {}
_INFLIGHT_LOCK = threading.Lock()
_EMPTY_CACHE: dict[tuple, float] = {}
_EMPTY_LOCK = threading.Lock()


def _fetch_key(symbol: str, tf_id: str, to_date: str, variant: Optional[str]) -> tuple:
    """Singleflight/negative-cache key: (symbol, timeframe, session, window).

    ``to_date`` doubles as the session for the live-edge path (today's IST
    date) and the pinned end date for historical windows; ``variant`` encodes
    lookback/from/as-of namespaces so different windows never coalesce.
    """
    return (str(symbol).upper(), str(tf_id), str(to_date), variant or "")


def _empty_cache_get(key: tuple) -> bool:
    now = time.monotonic()
    with _EMPTY_LOCK:
        expires = _EMPTY_CACHE.get(key)
        if expires is None:
            return False
        if now < expires:
            return True
        _EMPTY_CACHE.pop(key, None)
        return False


def _empty_cache_put(key: tuple) -> None:
    now = time.monotonic()
    with _EMPTY_LOCK:
        while len(_EMPTY_CACHE) >= _EMPTY_CACHE_MAX:
            _EMPTY_CACHE.pop(next(iter(_EMPTY_CACHE)), None)
        _EMPTY_CACHE[key] = now + EMPTY_RESULT_TTL_SECONDS


def clear_empty_cache() -> None:
    with _EMPTY_LOCK:
        _EMPTY_CACHE.clear()


def _is_empty_result(df: Optional[pd.DataFrame]) -> bool:
    return df is None or (isinstance(df, pd.DataFrame) and df.empty)


def _coalesced_fetch(key: tuple, fn, *, symbol: str, tf_id: str) -> Optional[pd.DataFrame]:
    """Run ``fn`` once per ``key``; concurrent callers share the outcome.

    The leader executes ``fn`` and re-raises on error (preserving the
    pre-existing caller contract). Waiters receive the leader's frame/None,
    or ``None`` when the leader raised — the same fail-soft shape the API's
    ``_fetch_candles_retry`` already expects. The in-flight slot is always
    released, and empty/None results are short-cached here (leader only).
    """
    started = time.monotonic()
    with _INFLIGHT_LOCK:
        fut = _INFLIGHT.get(key)
        if fut is None:
            fut = Future()
            _INFLIGHT[key] = fut
            leader = True
        else:
            leader = False
    if leader:
        try:
            result = fn()
        except BaseException as exc:
            with _INFLIGHT_LOCK:
                _INFLIGHT.pop(key, None)
            fut.set_exception(exc)
            logger.debug(
                "candles fetch failed symbol=%s tf=%s coalesced=0 elapsed=%.2fs error=%s",
                symbol, tf_id, time.monotonic() - started, exc,
            )
            raise
        if _is_empty_result(result):
            _empty_cache_put(key)
            result = None
        fut.set_result(result)
        with _INFLIGHT_LOCK:
            _INFLIGHT.pop(key, None)
        rows = 0 if result is None else len(result)
        logger.debug(
            "candles fetch done symbol=%s tf=%s coalesced=0 rows=%d elapsed=%.2fs",
            symbol, tf_id, rows, time.monotonic() - started,
        )
        return result
    logger.debug("candles fetch coalesced symbol=%s tf=%s (joined in-flight fetch)", symbol, tf_id)
    try:
        result = fut.result()
    except BaseException:
        logger.debug(
            "candles fetch coalesced symbol=%s tf=%s elapsed=%.2fs -> None (leader raised)",
            symbol, tf_id, time.monotonic() - started,
        )
        return None
    rows = 0 if result is None else len(result)
    logger.debug(
        "candles fetch coalesced symbol=%s tf=%s rows=%d elapsed=%.2fs",
        symbol, tf_id, rows, time.monotonic() - started,
    )
    return result


def fetch_for_timeframe(
    symbol: str,
    tf_id: str,
    as_of_date: Optional[str] = None,
    api_client=None,
    lookback_bars: Optional[int] = None,
    include_partial_today: bool = False,
    from_date: Optional[str] = None,
    force_refresh: bool = False,
    provenance: Optional[dict] = None,
    partial_bar: Optional[pd.DataFrame] = None,
    max_lag_sessions: int = DEFAULT_MAX_LAG_SESSIONS,
) -> Optional[pd.DataFrame]:
    """Fetch candles for a symbol at a registered timeframe id.

    Returns a tz-aware (UTC) DataFrame indexed by timestamp or ``None``.
    When ``lookback_bars`` is set, enough calendar history is fetched to cover
    N bars (variant cache key so the default cache is never poisoned); the
    caller slices to the last N bars before detection.

    ``from_date`` (``"YYYY-MM-DD"`` or a datetime whose date part is used)
    overrides the lookback-derived window start; ``as_of_date`` pins the
    window end (its date part; a time portion only affects replay truncation
    by callers). Either one namespaces the cache entry so a ``(from, to)``
    window or an intraday as-of never poisons the default cache. Behaviour
    is identical when both are ``None``. ``force_refresh=True`` skips the
    cache read (the fresh frame is still written back).

    On ``"1D"`` with a live-edge window the base frame already contains the
    core's completed-session backfill (missing recent sessions synthesized
    from the 1-minute tape). Those bars are ordinary completed-session data
    — immutable once the session closes — so caching them in the default
    entry is safe. Only the in-progress session stays out of the cache:

    ``max_lag_sessions`` widens the completed-session tolerance of a 1D cache
    hit. It exists for analytical readers that do not need the latest tape;
    callers that draw charts or trade keep the default. A cache hit is always
    returned as stored — no bars are synthesized from the wider tolerance.

    With ``include_partial_today=True`` on ``"1D"`` (used by the symbol
    chart), today's in-progress daily bar — aggregated from the 1-minute tape
    by the same helpers the unified fetcher uses — is appended unless the
    tape is empty or the official daily bar already exists (official wins).
    The synthetic bar is never written to the disk cache; the merged frame is
    flagged via ``df.attrs["partial_today"]`` so the API can mark the trailing
    series item ``is_partial``. The base frame is fetched through the unified
    ``fetch_candles_for_timeframe`` core only (never the legacy wrapper), so
    one tape fetch serves both the bar and the marker.
    """
    from market_data.market_data import fetch_candles_for_timeframe

    spec = _resolve_timeframe(tf_id)
    minutes = int(_attr(spec, "minutes", 0) or 0)
    source_tf = _attr(spec, "source_tf", None)
    max_lookback = int(_attr(spec, "max_lookback_days", 90) or 90)

    if lookback_bars is not None:
        days = _lookback_days(minutes, int(lookback_bars))
        variant = f"lb{int(lookback_bars)}"
    else:
        days = max_lookback
        variant = None
    # Explicit window bounds namespace the cache so replay windows never
    # poison (or read) the default entry. Unset bounds keep today's path.
    as_of_part = _asof_date_part(as_of_date)
    from_part = _asof_date_part(from_date)
    if from_part:
        variant = f"{variant}.from{from_part}" if variant else f"from{from_part}"
    time_variant = _asof_time_variant(as_of_date)
    if time_variant:
        variant = f"{variant}.{time_variant}" if variant else time_variant

    import config
    to_date = as_of_part or datetime.now(config.IST).strftime("%Y-%m-%d")
    if from_part:
        try:
            datetime.strptime(from_part, "%Y-%m-%d")
            eff_from = from_part
        except ValueError:
            eff_from = None
    else:
        eff_from = None
    if eff_from is None:
        try:
            eff_from = (
                datetime.strptime(to_date, "%Y-%m-%d") - timedelta(days=days)
            ).strftime("%Y-%m-%d")
        except ValueError:
            to_date = datetime.now(config.IST).strftime("%Y-%m-%d")
            eff_from = (
                datetime.strptime(to_date, "%Y-%m-%d") - timedelta(days=days)
            ).strftime("%Y-%m-%d")

    is_today = _is_today(to_date)
    cache_path = _cache_path(tf_id, symbol, as_of_part if as_of_part else None, variant=variant)
    cached = None if force_refresh else _read_cached(
        cache_path, is_today, is_daily=(tf_id == "1D"),
        max_lag_sessions=max_lag_sessions,
    )
    if provenance is not None:
        try:
            _fill_provenance(provenance, cache_path, cached is not None)
        except Exception:
            pass
    if cached is not None:
        df = cached
    else:
        fetch_key = _fetch_key(symbol, tf_id, to_date, variant)
        if not force_refresh and _empty_cache_get(fetch_key):
            # Negative hit: the feed produced nothing for this symbol/tf/session
            # recently. Force refreshes bypass this; disk-cached data never does.
            logger.debug(
                "candles empty-cache hit symbol=%s tf=%s coalesced=0 rows=0",
                symbol, tf_id,
            )
            df = None
        else:
            def _do_fetch() -> Optional[pd.DataFrame]:
                out = None
                # Incremental 1D top-up: when a stale entry lags the last completed
                # session, fetch only the missing tail instead of the whole window.
                if is_today and tf_id == "1D" and not source_tf and not force_refresh:
                    stale = _read_pickle_any(cache_path)
                    if stale is not None:
                        last_cached = frame_last_date(stale)
                        if last_cached and last_cached < _last_completed_session().isoformat():
                            tail = fetch_candles_for_timeframe(
                                symbol,
                                tf_id,
                                from_date=last_cached,
                                to_date=to_date,
                                api_client=api_client,
                            )
                            if tail is not None and not tail.empty:
                                out = _merge_frames(stale, tail)
                if out is None:
                    if source_tf:
                        src_spec = _resolve_timeframe(source_tf)
                        src_minutes = int(_attr(src_spec, "minutes", minutes) or minutes)
                        fetch_tf_id = source_tf
                    else:
                        src_minutes = minutes
                        fetch_tf_id = tf_id

                    out = fetch_candles_for_timeframe(
                        symbol,
                        fetch_tf_id,
                        from_date=eff_from,
                        to_date=to_date,
                        api_client=api_client,
                    )

                    if out is not None and not out.empty and source_tf and minutes and minutes != src_minutes:
                        out = _resample(out, minutes)

                if out is None or out.empty:
                    return None

                # Never cache a partial provider response. A transient fetch can return
                # only the current session (e.g. 8 bars of 15m) while the requested
                # window spans days; the short frame then feeds every caller for the
                # TTL and a pattern scan silently reports "no pattern" because it can
                # never reach the 60-bar detector minimum. Skip the write, still return
                # the frame so the caller can use whatever arrived.
                cacheable = True
                if lookback_bars and minutes < 1440:
                    cacheable = len(out) >= min(int(lookback_bars), 60)
                if cacheable:
                    _write_cached(
                        cache_path,
                        out,
                        is_today,
                        session_pin=(frame_last_date(out) if tf_id == "1D" else None),
                    )
                return out

            df = _coalesced_fetch(fetch_key, _do_fetch, symbol=symbol, tf_id=tf_id)
        if df is None:
            return None

    if include_partial_today and tf_id == "1D" and is_today:
        df = _with_partial_today(df, symbol, api_client, partial_bar=partial_bar)
    return df


def _today_is_session() -> bool:
    """True when today (IST) is an NSE trading day.

    Fail-open on a clock/holiday-calendar failure (the pre-existing behaviour):
    this only decides whether to *attempt* a tape fetch, and a fabricated empty
    session is worse than one wasted call.
    """
    try:
        return current_session_date() is not None
    except Exception:
        return True


_PARTIAL_CACHE: dict[tuple[str, str], tuple[float, Optional[pd.DataFrame]]] = {}
_PARTIAL_TTL_SECONDS = 30.0


def _cached_synthetic_today(api, symbol: str) -> Optional[pd.DataFrame]:
    """Today's synthetic bar, cached for a short window (30 s)."""
    from market_data.market_data import _synthetic_today_bar

    try:
        from trading.timezone import IST
        day = datetime.now(IST).strftime("%Y-%m-%d")
    except Exception:
        day = datetime.now().strftime("%Y-%m-%d")
    key = (str(symbol).upper(), day)
    hit = _PARTIAL_CACHE.get(key)
    if hit is not None and time.time() - hit[0] < _PARTIAL_TTL_SECONDS:
        return hit[1]
    synth = _synthetic_today_bar(api, str(symbol).upper())
    if len(_PARTIAL_CACHE) > 5000:
        _PARTIAL_CACHE.clear()
    _PARTIAL_CACHE[key] = (time.time(), synth)
    return synth


def _synthetic_bar_in_progress(bar: Optional[pd.DataFrame]) -> bool:
    """True when a tape-synthesized bar belongs to a session still trading.

    ``_last_completed_session()`` advances to today at the 15:30 IST close, so a
    bar dated after it can only be an in-progress session. Once the close has
    passed the bar is final and no longer partial. Never raises.
    """
    if bar is None or getattr(bar, "empty", True):
        return False
    session = frame_last_date(bar)
    if not session:
        return False
    try:
        last_done = _last_completed_session().isoformat()
    except Exception:
        return False
    return bool(session > last_done)


def with_partial_today(
    df: pd.DataFrame, symbol: str, api_client=None,
    partial_bar: Optional[pd.DataFrame] = None,
) -> Optional[pd.DataFrame]:
    """Public entry point for appending today's synthetic bar for display.

    The base frame is only read; the returned merged frame is flagged with
    ``partial_today`` (a synthetic bar was appended) and
    ``partial_today_in_progress`` (the session is still trading). The synthetic
    bar is never written to the disk cache — that write happens before this
    step in :func:`fetch_for_timeframe`. Never raises.
    """
    return _with_partial_today(df, symbol, api_client, partial_bar)


def _with_partial_today(
    df: pd.DataFrame, symbol: str, api_client=None,
    partial_bar: Optional[pd.DataFrame] = None,
) -> Optional[pd.DataFrame]:
    """Append today's synthetic daily bar.

    When ``partial_bar`` is supplied (pre-fetched by
    :func:`market_data.fetch_ohlc_batch` for the whole scan) it is used
    directly and no per-symbol intraday tape call is made. Otherwise the bar is
    synthesized from today's 1-minute tape (legacy path). The official daily
    bar wins; the merged frame is flagged via ``df.attrs["partial_today"]`` and
    ``df.attrs["partial_today_in_progress"]`` and must never be written to the
    disk cache. Never raises.
    """
    if df is None or df.empty:
        return df
    if not _today_is_session():
        return df
    try:
        from market_data.market_data import _concat_merge, _has_session_bar
    except Exception:
        return df
    bar = partial_bar
    if bar is None or getattr(bar, "empty", True):
        try:
            from market_data.market_data import get_api_client
            api = api_client if api_client is not None else get_api_client()
            if api is None:
                return df
            bar = _cached_synthetic_today(api, symbol)
        except Exception:
            return df
    if bar is None or bar.empty:
        return df
    if _has_session_bar(df, bar.index[0]):
        return df
    merged = _concat_merge(df, bar)
    if merged is None or merged.empty:
        return df
    try:
        merged.attrs["partial_today"] = True
        merged.attrs["partial_today_in_progress"] = _synthetic_bar_in_progress(bar)
    except Exception:
        pass
    return merged


def frame_last_date(df: pd.DataFrame) -> Optional[str]:
    """Return the last bar's IST session date as ``YYYY-MM-DD``.

    Candle indexes are UTC; a bar stamped 18:30 UTC or later belongs to the
    next IST session date, so formatting the raw UTC index mislabels it
    (e.g. a 1-Oct-IST bar reported as ``"2026-09-30"``). The return shape is
    unchanged (``Optional[str]`` in ``YYYY-MM-DD``), so callers storing
    ``data_through`` need no changes; only the 00:00-05:29 IST window reports
    a different (correct) date than before.
    """
    if df is None or df.empty:
        return None
    try:
        # pd.Timestamp(1) is 1970-01-01, so a plain RangeIndex/int index would
        # silently produce a confident (and wrong) 1970 session date. Candle
        # frames always carry a timestamp-like index; never invent one.
        if pd.api.types.is_numeric_dtype(df.index.dtype):
            return None
        ts = pd.Timestamp(df.index[-1])
        if ts.tz is None:
            ts = ts.tz_localize("UTC")
        return ts.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:
        return None


def candles_to_series(df: pd.DataFrame, limit: int = 300) -> list[dict]:
    """Convert a candle DataFrame into the API series shape ``{t,o,h,l,c,v}``."""
    if df is None or df.empty:
        return []
    out_df = df.tail(int(limit)) if limit and limit > 0 else df
    series: list[dict] = []
    for idx, row in out_df.iterrows():
        t = idx.isoformat() if hasattr(idx, "isoformat") else str(idx)
        series.append({
            "t": t,
            "o": _f(row.get("open")),
            "h": _f(row.get("high")),
            "l": _f(row.get("low")),
            "c": _f(row.get("close")),
            "v": _f(row.get("volume")),
        })
    return series


_f = to_float
