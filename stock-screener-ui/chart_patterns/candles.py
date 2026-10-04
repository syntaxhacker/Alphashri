"""Candle fetching + disk caching for the chart-patterns engine.

Wraps the existing Upstox V3 transport (``market_data.market_data.fetch_candles``);
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
import math
import pickle
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional, Union

import pandas as pd

CACHE_DIR = Path(__file__).resolve().parent.parent / "experiments" / "data" / "pattern_cache" / "candles"
TODAY_TTL_SECONDS = 60

# Target minutes -> pandas resample rule for targets that are NOT native Upstox
# units (3m is fetched as 1m; 2h/3h are fetched as 1h then resampled).
_RESAMPLE_RULE = {
    3: "3min",
    120: "2h",
    180: "3h",
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
    return CACHE_DIR / str(tf_id) / f"{base}.pkl"


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


def _lookback_days(spec_minutes: int, lookback_bars: int) -> int:
    """Calendar days needed to cover ``lookback_bars`` of ``spec_minutes`` bars."""
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


def fetch_for_timeframe(
    symbol: str,
    tf_id: str,
    as_of_date: Optional[str] = None,
    api_client=None,
    lookback_bars: Optional[int] = None,
) -> Optional[pd.DataFrame]:
    """Fetch candles for a symbol at a registered timeframe id.

    Returns a tz-aware (UTC) DataFrame indexed by timestamp or ``None``.
    When ``lookback_bars`` is set, enough calendar history is fetched to cover
    N bars (variant cache key so the default cache is never poisoned); the
    caller slices to the last N bars before detection.
    """
    from market_data.market_data import fetch_candles

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

    import config
    to_date = as_of_date or datetime.now(config.IST).strftime("%Y-%m-%d")
    try:
        from_date = (
            datetime.strptime(to_date, "%Y-%m-%d") - timedelta(days=days)
        ).strftime("%Y-%m-%d")
    except ValueError:
        to_date = datetime.now(config.IST).strftime("%Y-%m-%d")
        from_date = (
            datetime.strptime(to_date, "%Y-%m-%d") - timedelta(days=days)
        ).strftime("%Y-%m-%d")

    is_today = _is_today(to_date)
    cache_path = _cache_path(tf_id, symbol, as_of_date if as_of_date else None, variant=variant)
    cached = _read_cached(cache_path, is_today)
    if cached is not None:
        return cached

    if source_tf:
        src_spec = _resolve_timeframe(source_tf)
        src_minutes = int(_attr(src_spec, "minutes", minutes) or minutes)
    else:
        src_minutes = minutes

    df = fetch_candles(
        symbol=symbol,
        tf=src_minutes,
        from_date=from_date,
        to_date=to_date,
        resample_to=None,
        api_client=api_client,
    )

    if df is not None and not df.empty and source_tf and minutes and minutes != src_minutes:
        df = _resample(df, minutes)

    if df is None or df.empty:
        return None

    _write_cached(cache_path, df, is_today)
    return df


def frame_last_date(df: pd.DataFrame) -> Optional[str]:
    """Return the last bar's date as ``YYYY-MM-DD`` (handles tz-aware index)."""
    if df is None or df.empty:
        return None
    try:
        idx = df.index[-1]
        if hasattr(idx, "strftime"):
            return idx.strftime("%Y-%m-%d")
        return str(idx)[:10]
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
