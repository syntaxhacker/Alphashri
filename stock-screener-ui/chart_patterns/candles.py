"""Candle fetching + disk caching for the chart-patterns engine.

Wraps the unified fetcher (``market_data.market_data.fetch_candles_for_timeframe``);
never forks the broker client. Resolves the native source timeframe and any
required resample target from ``chart_patterns.timeframes`` (CONTRACT.md §1).

Cache layout (mirrors ``api/paper/chart_cache.py``)::

    experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.pkl
    experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.meta

Today's data has a 60s TTL while the market is open; once the session is
complete the entry is pinned to that session (``meta["session"]``) so it
stays fresh across weekends/holidays. Historical data never expires.
"""
from __future__ import annotations

import json
import pickle
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional, Union

import pandas as pd

from market_data.market_data import _lookback_days

CACHE_DIR = Path(__file__).resolve().parent.parent / "experiments" / "data" / "pattern_cache" / "candles"

#: Bump when the *content* semantics of a cached frame change (e.g. the daily
#: completed-session backfill from the 1-minute tape) so pre-existing entries on
#: disk are ignored rather than served as if still fresh — the session pin only
#: tracks *which* session a frame ends on, not what it contains.
CACHE_VERSION = 2
TODAY_TTL_SECONDS = 60

# Target minutes -> pandas resample rule for targets that are NOT native Upstox
# units (3m is fetched as 1m; 2h/3h/4h are fetched as 1h then resampled).
_RESAMPLE_RULE = {
    3: "3min",
    120: "2h",
    180: "3h",
    240: "4h",
}


def _attr(spec: Any, name: str, default=None):
    """Read a field from a TFSpec dataclass, namedtuple or dict."""
    if spec is None:
        return default
    if isinstance(spec, dict):
        return spec.get(name, default)
    return getattr(spec, name, default)


def _resolve_timeframe(tf_id: str):
    try:
        from chart_patterns.timeframes import get_timeframe  # local import: Agent 1 module
    except Exception as exc:  # pragma: no cover - integration env always has it
        raise RuntimeError("chart_patterns.timeframes unavailable") from exc
    return get_timeframe(tf_id)


def _is_today(date_str: str) -> bool:
    import config
    return date_str == datetime.now(config.IST).strftime("%Y-%m-%d")


def _asof_date_part(value: Optional[str]) -> Optional[str]:
    """Date (``YYYY-MM-DD``) portion of an as-of/from value, else ``None``."""
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
    """Weekday that is not an NSE trading holiday."""
    from trading import utils as trading_utils

    if d.weekday() >= 5:
        return False
    try:
        return not trading_utils.is_trading_holiday(d)
    except Exception:
        return True


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
        now = datetime.now(IST)
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
    d = today - timedelta(days=1)
    for _ in range(365):
        if _is_trading_day(d):
            return d
        d -= timedelta(days=1)
    return d


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


def _read_cached(path: Path, is_today: bool) -> Optional[pd.DataFrame]:
    if not path.exists():
        return None
    try:
        if is_today:
            meta_path = path.with_suffix(".meta")
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                from trading import utils as trading_utils

                try:
                    market_open = trading_utils.is_market_open()
                except Exception:
                    market_open = True
                if market_open:
                    if time.time() - meta.get("ts", 0) > TODAY_TTL_SECONDS:
                        return None
                elif meta.get("session") != _last_completed_session().isoformat():
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


def _write_cached(path: Path, df: pd.DataFrame, is_today: bool) -> None:
    if df is None or df.empty:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(df, f)
        if is_today:
            with open(path.with_suffix(".meta"), "w") as f:
                json.dump(
                    {"ts": time.time(), "session": _last_completed_session().isoformat()},
                    f,
                )
    except Exception:
        pass


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
                # Tolerate stray files directly under CACHE_DIR.
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
    """Resample OHLCV to tf_minutes using a rule map covering non-native targets.

    Bins are anchored to the IST session (Asia/Kolkata midnight), not UTC
    midnight: the index is converted to IST before ``resample`` and back to its
    original timezone after, so 2h/3h/3min bins align with the NSE session open.
    """
    rule = _RESAMPLE_RULE.get(int(tf_minutes))
    if rule is None or df is None or df.empty:
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
    out = work.resample(rule, label="left", closed="left").agg(available)
    out = out.dropna(subset=["close"])
    try:
        if orig_tz is None:
            out.index = out.index.tz_convert("UTC").tz_localize(None)
        else:
            out.index = out.index.tz_convert(orig_tz)
    except Exception:
        pass
    return out


def fetch_for_timeframe(
    symbol: str,
    tf_id: str,
    as_of_date: Optional[str] = None,
    api_client=None,
    lookback_bars: Optional[int] = None,
    include_partial_today: bool = False,
    from_date: Optional[str] = None,
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
    is identical when both are ``None``.

    On ``"1D"`` with a live-edge window the base frame already contains the
    core's completed-session backfill (missing recent sessions synthesized
    from the 1-minute tape). Those bars are ordinary completed-session data
    — immutable once the session closes — so caching them in the default
    entry is safe. Only the in-progress session stays out of the cache:

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
    cached = _read_cached(cache_path, is_today)
    if cached is not None:
        df = cached
    else:
        if source_tf:
            src_spec = _resolve_timeframe(source_tf)
            src_minutes = int(_attr(src_spec, "minutes", minutes) or minutes)
            fetch_tf_id = source_tf
        else:
            src_minutes = minutes
            fetch_tf_id = tf_id

        df = fetch_candles_for_timeframe(
            symbol,
            fetch_tf_id,
            from_date=eff_from,
            to_date=to_date,
            api_client=api_client,
        )

        if df is not None and not df.empty and source_tf and minutes and minutes != src_minutes:
            df = _resample(df, minutes)

        if df is None or df.empty:
            return None

        _write_cached(cache_path, df, is_today)

    if include_partial_today and tf_id == "1D" and is_today:
        df = _with_partial_today(df, symbol, api_client)
    return df


def _with_partial_today(
    df: pd.DataFrame, symbol: str, api_client=None
) -> Optional[pd.DataFrame]:
    """Append today's synthetic daily bar aggregated from the 1-minute tape.

    Returns ``df`` unchanged when the tape is empty (pre-market/holiday) or
    the official daily bar for the session already exists (official wins).
    The merged frame is flagged via ``df.attrs["partial_today"]`` and must
    never be written to the disk cache — callers append after ``_write_cached``.
    """
    if df is None or df.empty:
        return df
    try:
        from market_data.market_data import (
            _concat_merge,
            _has_session_bar,
            _synthetic_today_bar,
            get_api_client,
        )
    except Exception:
        return df
    try:
        api = api_client if api_client is not None else get_api_client()
        if api is None:
            return df
        synth = _synthetic_today_bar(api, str(symbol).upper())
        if synth is None or synth.empty:
            return df
        if _has_session_bar(df, synth.index[0]):
            return df
        merged = _concat_merge(df, synth)
        if merged is None or merged.empty:
            return df
        try:
            merged.attrs["partial_today"] = True
        except Exception:
            pass
        return merged
    except Exception:
        return df


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


def _f(value: Any, default: float = 0.0) -> float:
    try:
        import math

        if value is None:
            return default
        out = float(value)
        if out != out or math.isinf(out):  # NaN or +/-Inf
            return default
        return out
    except Exception:
        return default
