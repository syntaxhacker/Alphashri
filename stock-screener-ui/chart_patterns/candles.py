"""Candle fetching + disk caching for the chart-patterns engine.

Wraps the existing Upstox V3 transport (``market_data.market_data.fetch_candles``);
never forks the broker client. Resolves the native source timeframe and any
required resample target from ``chart_patterns.timeframes`` (CONTRACT.md §1).

Cache layout (mirrors ``api/paper/chart_cache.py``)::

    experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.pkl
    experiments/data/pattern_cache/candles/{tf}/{SYMBOL}.meta

Today's data has a 60s TTL; historical data never expires.
"""
from __future__ import annotations

import json
import pickle
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

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


def _cache_path(tf_id: str, symbol: str) -> Path:
    return CACHE_DIR / str(tf_id) / f"{symbol.upper()}.pkl"


def _read_cached(path: Path, is_today: bool) -> Optional[pd.DataFrame]:
    if not path.exists():
        return None
    try:
        if is_today:
            meta_path = path.with_suffix(".meta")
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                if time.time() - meta.get("ts", 0) > TODAY_TTL_SECONDS:
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
                json.dump({"ts": time.time()}, f)
    except Exception:
        pass


def _resample(df: pd.DataFrame, tf_minutes: int) -> pd.DataFrame:
    """Resample OHLCV to tf_minutes using a rule map covering non-native targets."""
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
    out = df.resample(rule, label="left", closed="left").agg(available)
    return out.dropna(subset=["close"])


def fetch_for_timeframe(
    symbol: str,
    tf_id: str,
    as_of_date: Optional[str] = None,
    api_client=None,
) -> Optional[pd.DataFrame]:
    """Fetch candles for a symbol at a registered timeframe id.

    Returns a tz-aware (UTC) DataFrame indexed by timestamp or ``None``.
    """
    from market_data.market_data import fetch_candles

    spec = _resolve_timeframe(tf_id)
    minutes = int(_attr(spec, "minutes", 0) or 0)
    source_tf = _attr(spec, "source_tf", None)
    max_lookback = int(_attr(spec, "max_lookback_days", 90) or 90)

    import config
    to_date = as_of_date or datetime.now(config.IST).strftime("%Y-%m-%d")
    try:
        from_date = (
            datetime.strptime(to_date, "%Y-%m-%d") - timedelta(days=max_lookback)
        ).strftime("%Y-%m-%d")
    except ValueError:
        to_date = datetime.now(config.IST).strftime("%Y-%m-%d")
        from_date = (
            datetime.strptime(to_date, "%Y-%m-%d") - timedelta(days=max_lookback)
        ).strftime("%Y-%m-%d")

    is_today = _is_today(to_date)
    cache_path = _cache_path(tf_id, symbol)
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
        if value is None:
            return default
        out = float(value)
        if out != out:  # NaN
            return default
        return out
    except Exception:
        return default
