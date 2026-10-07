"""
Universal market data fetching utility.

Single source of truth for fetching OHLCV candles from Upstox V3 API.
Supports multiple timeframes, resampling, and unified intraday/historical dispatch.

Usage:
    from market_data.market_data import fetch_candles, get_api_client

    # Fetch 5-minute candles for 15 days
    df = fetch_candles("RELIANCE", tf=5, from_date="2026-03-25", to_date="2026-04-09")

    # Fetch 1-minute candles and resample to 15-minute
    df = fetch_candles("TCS", tf=1, from_date="2026-04-09", to_date="2026-04-09", resample_to=15)

    # Unified timeframe fetch (all 13 ids, provider aggregation inside)
    df = fetch_candles_for_timeframe("INFY", "15m", lookback_bars=60)
"""

import math
import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import pandas as pd

_BASE = str(Path(__file__).parent.parent)
sys.path.insert(0, str(Path(_BASE).parent))  # for upstox_trader
sys.path.insert(0, _BASE)

import config

_TF_TO_UPSTOX: Dict[int, tuple] = {
    1: ("minutes", 1),
    3: ("minutes", 1),  # 3m via 1m resample
    5: ("minutes", 5),
    10: ("minutes", 10),
    15: ("minutes", 15),
    30: ("minutes", 30),
    60: ("hours", 1),
    240: ("hours", 4),
    1440: ("days", 1),
    10080: ("weeks", 1),
    43200: ("months", 1),
}

_RESAMPLE_RULE: Dict[int, str] = {
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
    1440: "1D",
    10080: "1W",
    43200: "1ME",
}

# Native minutes -> registered timeframe id (chart_patterns.timeframes).
_MINUTES_TO_TF_ID: Dict[int, str] = {
    1: "1m",
    3: "3m",
    5: "5m",
    10: "10m",
    15: "15m",
    30: "30m",
    60: "1h",
    120: "2h",
    180: "3h",
    240: "4h",
    1440: "1D",
    10080: "1W",
    43200: "1M",
}

_IST = config.IST

#: Lookback (calendar days) for the 1D completed-session backfill. The
#: official Upstox daily endpoint lags the minute tape by >= 1 session (live
#: verified 2026-10-06: daily ended Oct 1 while the 1m tape had Oct 5), so a
#: 1D window ending today is topped up from the recent 1-minute tape. Sessions
#: older than this are never synthesized (the official endpoint owns history).
_DAILY_BACKFILL_LOOKBACK_DAYS = 10

_client_cache = None


def get_api_client():
    """Get an UpstoxAPI client. Tries env credentials first, falls back to DB token."""
    global _client_cache
    if _client_cache is not None:
        return _client_cache

    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    from backtest.utils import get_upstox_client_from_db

    try:
        _client_cache = UpstoxAPI(
            api_key=config.UPSTOX_API_KEY,
            api_secret=config.UPSTOX_API_SECRET,
            quiet=True,
        )
        return _client_cache
    except Exception:
        pass

    client = get_upstox_client_from_db()
    if isinstance(client, tuple):
        _client_cache = client[0] if client[0] else None
    else:
        _client_cache = client
    return _client_cache


def _lookback_days(spec_minutes: int, lookback_bars: int) -> int:
    """Calendar days needed to cover ``lookback_bars`` of ``spec_minutes`` bars.

    Shared helper (single definition): ``chart_patterns.candles`` imports it
    from here so both window computations use the same formula.
    """
    minutes = int(spec_minutes or 0)
    if minutes >= 43200:  # 1M
        bars_per_day = 1.0 / 30.0
    elif minutes >= 10080:  # 1W
        bars_per_day = 1.0 / 7.0
    elif minutes >= 1440:  # 1D (5 trading days per 7 calendar days)
        bars_per_day = 5.0 / 7.0
    else:  # intraday: ~375 trading minutes per NSE session
        bars_per_day = max(1.0, 375.0 / minutes) if minutes > 0 else 1.0
    days = math.ceil(lookback_bars / bars_per_day * 1.5)
    return max(1, min(3650, days))


def fetch_candles_for_timeframe(
    symbol: str,
    timeframe: str,
    *,
    lookback_bars: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    as_of_date: str | None = None,
    include_partial_today: bool = False,
    api_client=None,
) -> Optional[pd.DataFrame]:
    """Fetch OHLCV candles for every registered timeframe from one method.

    This is the single place that selects and combines the provider's
    multiple APIs (Upstox V3 historical + intraday). Callers never pick an
    endpoint; they only name a timeframe id from
    ``chart_patterns.timeframes`` (``"1m"|"3m"|"5m"|"10m"|"15m"|"30m"|
    "1h"|"2h"|"3h"|"4h"|"1D"|"1W"|"1M"``).

    Provider selection per timeframe:

    - native intraday (``<= 60m``): historical candles plus today's
      intraday tape when the window ends today, spliced with
      :func:`_concat_merge` (later/intraday bars win on overlap).
    - native daily/weekly/monthly (``>= 1440m``): historical only. On
      ``"1D"`` with a window ending today, sessions present in the recent
      1-minute tape but missing from the official daily frame (the daily
      endpoint lags the minute tape by >= 1 session) are backfilled as
      ordinary completed-session bars (always, not opt-in) — except the
      tape is not fetched at all when the frame already ends at the last
      completed session. With ``include_partial_today=True`` on ``"1D"``,
      one synthetic bar for the current session (aggregated from today's
      1-minute tape, never a "daily intraday" fetch) is appended unless the
      official daily bar for that date already exists (official wins);
      today's rows are reused from the backfill tape when it carries them
      so the provider sees at most one extra call.
    - non-native (registry ``source_tf`` set: ``3m`` from ``1m``,
      ``2h``/``3h`` from ``1h``): the source timeframe is fetched as above
      then resampled to the target width.

    Window: explicit ``from_date``/``to_date`` win when given; otherwise
    ``to_date`` defaults to ``as_of_date`` (historical pin) or today (IST)
    and ``from_date`` is derived via :func:`_lookback_days` from
    ``lookback_bars`` (or the registry ``max_lookback_days`` when
    ``lookback_bars`` is None).

    Args:
        symbol: Trading symbol (e.g., "RELIANCE").
        timeframe: Registered timeframe id (e.g., "15m", "1h", "1D").
        lookback_bars: Bars of history the window must cover (window sizing
            only; the full window frame is returned, callers slice).
        from_date: Window start "YYYY-MM-DD" (overrides lookback sizing).
        to_date: Window end "YYYY-MM-DD" (overrides ``as_of_date``/today).
        as_of_date: Historical pin for ``to_date`` when ``to_date`` is None.
        include_partial_today: Append the synthetic current-session bar on
            "1D" (opt-in; off by default).
        api_client: Optional UpstoxAPI instance. If None, uses
            get_api_client().

    Returns:
        DataFrame with UTC DatetimeIndex and OHLCV columns, de-duplicated
        by timestamp (last wins), sorted ascending. Returns None on error.
        The frame is NOT cached or sliced; callers do that.

    Raises:
        ValueError: when ``timeframe`` is not a registered id.
    """
    from chart_patterns.timeframes import get_timeframe  # lazy: package __init__ is heavy

    spec = get_timeframe(timeframe)  # raises ValueError on unknown id
    minutes = int(spec.minutes)
    source_tf = spec.source_tf
    max_lookback = int(spec.max_lookback_days or 90)

    today_str = datetime.now(_IST).strftime("%Y-%m-%d")
    eff_to = to_date or as_of_date or today_str
    if from_date is not None:
        eff_from = from_date
    else:
        if lookback_bars is not None:
            days = _lookback_days(minutes, int(lookback_bars))
        else:
            days = max_lookback
        try:
            eff_from = (
                datetime.strptime(eff_to, "%Y-%m-%d") - timedelta(days=days)
            ).strftime("%Y-%m-%d")
        except ValueError:
            eff_to = today_str
            eff_from = (
                datetime.strptime(eff_to, "%Y-%m-%d") - timedelta(days=days)
            ).strftime("%Y-%m-%d")

    api = api_client or get_api_client()
    if api is None:
        return None

    sym = symbol.upper()
    try:
        if source_tf is not None:
            src_minutes = int(get_timeframe(source_tf).minutes)
            base = _fetch_native_window(api, sym, src_minutes, eff_from, eff_to, today_str)
            if base is None or base.empty:
                return None
            df = _resample(base, minutes) if minutes != src_minutes else base
        elif minutes <= 60:
            df = _fetch_native_window(api, sym, minutes, eff_from, eff_to, today_str)
        else:
            df = _fetch_historical_window(api, sym, minutes, eff_from, eff_to)
            if (
                df is not None
                and not df.empty
                and timeframe == "1D"
                and eff_to == today_str
            ):
                # Live edge: the official daily frame lags the minute tape by
                # >= 1 session, so top up missing *completed* sessions first.
                # Today's in-progress session stays opt-in (see below).
                # The tape is fetched at most once and skipped entirely when
                # the frame already ends at the last completed session.
                df = _daily_live_edge(
                    api, sym, df, today_str,
                    include_partial_today=bool(include_partial_today),
                )
    except Exception:
        return None

    if df is None or df.empty:
        return None

    df = _normalize_tz(df)
    if df.index.has_duplicates:
        df = df[~df.index.duplicated(keep="last")]
    if not df.index.is_monotonic_increasing:
        df = df.sort_index()
    return df


def fetch_candles(
    symbol: str,
    tf: int,
    from_date: str,
    to_date: str,
    resample_to: Optional[int] = None,
    api_client=None,
) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV candles for a symbol.

    Thin wrapper over :func:`fetch_candles_for_timeframe` (signature
    unchanged): maps the minute width to its registered timeframe id and
    applies ``resample_to`` when given.

    Args:
        symbol: Trading symbol (e.g., "RELIANCE")
        tf: Timeframe in minutes (1, 3, 5, 15, 30, 60, 120, 180, 240, 1440, ...)
        from_date: Start date "YYYY-MM-DD"
        to_date: End date "YYYY-MM-DD"
        resample_to: If set, resample fetched data to this TF (in minutes).
                     Useful for fetching 5m data and resampling to 15m/1h.
        api_client: Optional UpstoxAPI instance. If None, uses get_api_client().

    Returns:
        DataFrame with UTC DatetimeIndex and columns: open, high, low, close, volume, oi
        Returns None on error.
    """
    tf_id = _MINUTES_TO_TF_ID.get(tf)
    if tf_id is None:
        raise ValueError(f"Unsupported tf={tf}. Supported: {sorted(_MINUTES_TO_TF_ID)}")

    df = fetch_candles_for_timeframe(
        symbol,
        tf_id,
        from_date=from_date,
        to_date=to_date,
        api_client=api_client,
    )

    if df is None or df.empty:
        return None

    if resample_to is not None and resample_to != tf:
        df = _resample(df, resample_to)

    return df


def _fetch_native_window(
    api,
    symbol: str,
    tf_minutes: int,
    from_date: str,
    to_date: str,
    today_str: str,
) -> Optional[pd.DataFrame]:
    """Fetch one intraday-capable window: historical plus today's tape.

    Single-day windows for today hit only the intraday endpoint (the
    historical endpoint has nothing complete to add); multi-day windows
    ending today splice both legs via :func:`_concat_merge`. Both legs are
    floored to the minute first so sub-minute provider timestamp jitter
    cannot defeat the overlap de-duplication.
    """
    unit, interval = _TF_TO_UPSTOX[tf_minutes]

    # Single-day window for today: today's session is still in progress, so
    # the historical endpoint has nothing complete to add — fetch only
    # intraday and skip the extra historical call. Multi-day windows keep
    # the historical + intraday merge below.
    single_day_today = from_date == to_date == today_str
    if single_day_today:
        # The V3 intraday endpoint is minutes-based: `/minutes/{n}` where n is
        # the target timeframe in minutes. Using the unit's interval value here
        # would send 1 for tf=60 (unit "hours"), i.e. 1-minute candles.
        try:
            return api.fetch_intraday_data_v3(
                symbol=symbol,
                interval=str(tf_minutes),
            )
        except Exception:
            return None

    # Historical covers the completed sessions in the lookback window but
    # omits the in-progress one; the intraday endpoint supplies today's bars.
    # Fetch both for a window ending today and splice them — otherwise a
    # multi-day lookback collapses to today's handful of bars.
    try:
        df = api.fetch_historical_data_v3(
            symbol=symbol,
            unit=unit,
            interval=interval,
            to_date=to_date,
            from_date=from_date,
        )
    except Exception:
        return None
    if to_date == today_str:
        try:
            intraday = api.fetch_intraday_data_v3(
                symbol=symbol,
                interval=str(tf_minutes),
            )
        except Exception:
            intraday = None
        df = _concat_merge(_floor_to_minute(df), _floor_to_minute(intraday))
    return df


def _fetch_historical_window(
    api,
    symbol: str,
    tf_minutes: int,
    from_date: str,
    to_date: str,
) -> Optional[pd.DataFrame]:
    """Fetch one window via the historical endpoint only (tf > 60m)."""
    unit, interval = _TF_TO_UPSTOX[tf_minutes]
    try:
        return api.fetch_historical_data_v3(
            symbol=symbol,
            unit=unit,
            interval=interval,
            to_date=to_date,
            from_date=from_date,
        )
    except Exception:
        return None


def _daily_last_session_date(df: pd.DataFrame):
    """IST session date (``datetime.date``) of the frame's last bar, else None.

    Daily bars are stamped 18:30 UTC of the prior day, so the UTC calendar
    date is wrong — normalize through IST first. Never raises.
    """
    try:
        if df is None or getattr(df, "empty", True):
            return None
        return pd.Timestamp(df.index[-1]).tz_convert(_IST).normalize().date()
    except Exception:
        try:
            return pd.Timestamp(df.index[-1]).date()
        except Exception:
            return None


def _fetch_backfill_tape(api, symbol: str, today_str: str) -> Optional[pd.DataFrame]:
    """Fetch the recent 1-minute tape used for the 1D live edge.

    Single chunk (10 days < the 30-day minutes chunk size): one HTTP call.
    Returns the tz-normalized, sorted tape, or None on any failure.
    """
    try:
        window_from = (
            datetime.strptime(today_str, "%Y-%m-%d")
            - timedelta(days=_DAILY_BACKFILL_LOOKBACK_DAYS)
        ).strftime("%Y-%m-%d")
        tape = api.fetch_historical_data_v3(
            symbol=symbol,
            unit="minutes",
            interval=1,
            to_date=today_str,
            from_date=window_from,
        )
    except Exception:
        return None
    if tape is None or tape.empty:
        return None
    try:
        tape = _normalize_tz(tape).sort_index()
    except Exception:
        return None
    return None if tape.empty else tape


def _tape_session_rows(tape: pd.DataFrame, session_date) -> Optional[pd.DataFrame]:
    """Rows of ``tape`` belonging to one IST ``session_date`` (a date)."""
    try:
        day = pd.Timestamp(session_date).tz_localize("UTC").tz_convert(_IST).normalize()
        rows = tape[tape.index.tz_convert(_IST).normalize() == day]
        return rows if not rows.empty else None
    except Exception:
        return None


def _synthesize_bar_from_tape(tape: pd.DataFrame) -> Optional[pd.DataFrame]:
    """Aggregate one session's 1-minute tape into a single daily bar.

    O = first open, H = max high, L = min low, C = last close, V = summed
    volume. Indexed at the tape session's IST midnight — the official daily
    convention (18:30 UTC of the prior day) — so the bar lands on the exact
    index the official bar will use and dedupe can't leave a duplicate.
    Returns None when the tape is empty. Never fetches a "daily intraday" —
    callers supply the 1-minute tape.
    """
    if tape is None or tape.empty:
        return None
    tape = _normalize_tz(tape).sort_index()
    if tape.empty:
        return None
    row = {
        "open": float(tape["open"].iloc[0]),
        "high": float(tape["high"].max()),
        "low": float(tape["low"].min()),
        "close": float(tape["close"].iloc[-1]),
    }
    if "volume" in tape.columns:
        row["volume"] = float(tape["volume"].sum())
    if "oi" in tape.columns:
        try:
            row["oi"] = float(tape["oi"].iloc[-1])
        except Exception:
            pass
    # Anchor at the session's IST midnight — the official daily convention is
    # 18:30 UTC of the prior day — so the synthetic bar lands on the exact index
    # the official bar will use and dedupe can't leave a duplicate.
    day = tape.index[-1].tz_convert(_IST).normalize().tz_convert("UTC")
    return pd.DataFrame([row], index=pd.DatetimeIndex([day]))


def _backfill_completed_daily_sessions(
    api, symbol: str, df: pd.DataFrame, today_str: str,
    tape: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Top up a live-edge 1D frame with completed sessions missing from it.

    The official daily endpoint lags the minute tape by >= 1 session, so a
    session present in the recent 1-minute tape but absent from the daily
    frame gets a synthesized OHLCV bar (same aggregation as
    :func:`_synthesize_bar_from_tape`). Only sessions up to the last
    *completed* session are backfilled — the in-progress session stays
    opt-in via ``include_partial_today`` — and only sessions within
    ``_DAILY_BACKFILL_LOOKBACK_DAYS`` of today (the official endpoint owns
    older history; this also ignores stale mock tapes). Backfilled bars are
    ordinary completed-session bars: never flagged partial and safe to cache.
    Never raises: returns ``df`` unchanged on any failure. No-op when ``df``
    is empty (error contract: empty stays empty).

    ``tape`` is an already-fetched 1-minute tape (normalized or not); when
    None it is fetched once via :func:`_fetch_backfill_tape`. Passing the
    tape lets the 1D live edge share one fetch between the backfill and the
    opt-in synthetic today bar instead of hitting the provider twice.
    """
    if df is None or df.empty:
        return df
    try:
        today_date = datetime.strptime(today_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return df
    # Backfill through the last *completed* session — not merely "before
    # today": between the 15:30 close and midnight the just-closed session is
    # already final, and the official daily endpoint lags it by >= 1 session.
    # The in-progress session still stays opt-in via ``include_partial_today``.
    try:
        from chart_patterns.candles import _last_completed_session

        last_done = _last_completed_session()
    except Exception:
        last_done = None
    if tape is None:
        tape = _fetch_backfill_tape(api, symbol, today_str)
    if tape is None or tape.empty:
        return df
    try:
        tape = _normalize_tz(tape).sort_index()
    except Exception:
        return df
    if tape.empty:
        return df
    try:
        session_days = tape.index.tz_convert(_IST).normalize()
    except Exception:
        return df
    parts: list[pd.DataFrame] = [df]
    for day, group in tape.groupby(session_days):
        try:
            session_date = pd.Timestamp(day).tz_convert(_IST).date()
        except Exception:
            continue
        cutoff = last_done if last_done is not None else (today_date - timedelta(days=1))
        if session_date > cutoff:
            continue  # in-progress/future session stays opt-in (include_partial_today)
        if (today_date - session_date).days > _DAILY_BACKFILL_LOOKBACK_DAYS:
            continue  # official history, not a recent gap
        if _has_session_bar(df, group.index[0]):
            continue  # official bar already covers this session
        bar = _synthesize_bar_from_tape(group)
        if bar is not None and not bar.empty:
            parts.append(bar)
    if len(parts) == 1:
        return df
    try:
        return _concat_merge(*parts)
    except Exception:
        return df


def _daily_live_edge(
    api, symbol: str, df: pd.DataFrame, today_str: str,
    include_partial_today: bool,
) -> pd.DataFrame:
    """Apply the 1D live edge: gap backfill + optional synthetic today bar.

    Fast path (the common case): when the official daily frame already ends
    at the last completed session there is no gap to fill, so the 1-minute
    tape is never fetched — unless ``include_partial_today`` needs today's
    rows (one intraday call). Slow path: fetch the 10-day 1-minute tape
    once and share it between the completed-session backfill and the
    synthetic today bar, so the provider sees at most two calls (one without
    the flag) instead of three. Never raises: returns ``df`` unchanged on
    any failure.
    """
    if df is None or df.empty:
        return df
    try:
        today_date = datetime.strptime(today_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return df
    try:
        from chart_patterns.candles import (  # lazy: candles imports this module
            _last_completed_session,
        )
        last_done = _last_completed_session()
    except Exception:
        last_done = None
    try:
        last_bar = _daily_last_session_date(df)
    except Exception:
        last_bar = None

    tape: Optional[pd.DataFrame] = None
    if (
        last_done is not None
        and last_bar is not None
        and last_bar >= last_done
        and not include_partial_today
    ):
        return df  # current: no gap, no tape fetch
    if last_done is not None and last_bar is not None and last_bar >= last_done:
        tape = None  # current, but the flag below still needs today's rows
    else:
        tape = _fetch_backfill_tape(api, symbol, today_str)
        if tape is not None and not tape.empty:
            df = _backfill_completed_daily_sessions(
                api, symbol, df, today_str, tape=tape
            )
    if include_partial_today and not _has_session_bar(df, pd.Timestamp.now(tz="UTC")):
        # Reuse today's rows from the already-fetched tape when present
        # (the historical minutes leg can carry the in-progress session);
        # otherwise fall back to one intraday fetch.
        synth: Optional[pd.DataFrame] = None
        if tape is not None and not tape.empty:
            try:
                today_rows = _tape_session_rows(tape, today_date)
                synth = _synthesize_bar_from_tape(today_rows)
            except Exception:
                synth = None
        if (synth is None or synth.empty):
            # Tape had no rows for today (usual: the historical leg omits
            # the in-progress session) — one intraday fetch, as before.
            synth = _synthetic_today_bar(api, symbol)
        if (
            synth is not None
            and not synth.empty
            and not _has_session_bar(df, synth.index[0])
        ):
            try:
                df = _concat_merge(df, synth)
            except Exception:
                pass
    return df


def _synthetic_today_bar(api, symbol: str) -> Optional[pd.DataFrame]:
    """Aggregate today's 1-minute intraday tape into a single daily bar.

    O = first open, H = max high, L = min low, C = last close, V = summed
    volume. Indexed at the tape day (UTC midnight). Returns None when the
    tape is empty (pre-market/holiday) or the fetch fails. Never fetches a
    "daily intraday" — the 1-minute tape is the only source.
    """
    try:
        tape = api.fetch_intraday_data_v3(symbol=symbol, interval="1")
    except Exception:
        return None
    return _synthesize_bar_from_tape(tape)


def _has_session_bar(df: pd.DataFrame, ts) -> bool:
    """True when the frame already holds a bar on the UTC date of ``ts``.

    The official daily bar wins over the synthetic one, compared by
    calendar date so differing timestamp conventions cannot duplicate it.
    """
    try:
        # Compare by IST session date: the official daily bar is stamped at
        # 18:30 UTC of the prior day, so a UTC-date compare would miss it.
        day = pd.Timestamp(ts).tz_convert(_IST).normalize()
        return bool((df.index.tz_convert(_IST).normalize() == day).any())
    except Exception:
        return False


def _floor_to_minute(df: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """Return a copy of the frame with its index floored to the minute."""
    if df is None or getattr(df, "empty", True):
        return df
    try:
        out = df.copy()
        out.index = out.index.floor("min")
        return out
    except Exception:
        return df


def _normalize_tz(df: pd.DataFrame) -> pd.DataFrame:
    # NOTE: Assumes naive index from Upstox is already in UTC.
    # If Upstox ever returns naive IST data, this would shift times by +5:30.
    # Currently Upstox returns tz-aware data so the else branch is the normal path.
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")
    return df


def _concat_merge(*frames: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """Concatenate candle frames into one series, normalizing tz and
    de-duplicating by timestamp (later frames win) so historical bars and today's
    intraday bars form a single continuous frame."""
    parts: list[pd.DataFrame] = []
    for frame in frames:
        if frame is None or getattr(frame, "empty", True):
            continue
        try:
            parts.append(_normalize_tz(frame))
        except Exception:
            parts.append(frame)
    if not parts:
        return None
    out = pd.concat(parts)
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def _resample(df: pd.DataFrame, tf_minutes: int) -> pd.DataFrame:
    if df.empty:
        return df
    rule = _RESAMPLE_RULE.get(tf_minutes)
    if rule is None:
        return df
    agg = {c: "first" if c == "open" else "sum" if c == "volume" else "last" if c == "close" else "max" if c == "high" else "min" if c == "low" else "last" for c in df.columns}
    agg["high"] = "max"
    agg["low"] = "min"
    agg["close"] = "last"
    agg["volume"] = "sum"
    result = (
        df.resample(rule, label="left", closed="left")
        .agg(agg)
        .dropna(subset=["close"])
    )
    return result


def resample_candles(df: pd.DataFrame, tf_minutes: int) -> pd.DataFrame:
    """Resample a DataFrame of candles to a different timeframe.

    Args:
        df: DataFrame with DatetimeIndex and OHLCV columns
        tf_minutes: Target timeframe in minutes (1, 5, 15, 30, 60)

    Returns:
        Resampled DataFrame
    """
    return _resample(df, tf_minutes)
