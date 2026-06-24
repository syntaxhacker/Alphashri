"""
api/utils.py — Shared helpers for API layer to reduce DRY clones.

Centralizes:
- Data normalizers (_to_float, _sanitize_for_json, _ensure_datetime_index)
- Common response builders (_make_empty_chart_response)
- Cache helpers for JSON+TTL meta-file caches (_get_cache_path, _get_cache_meta_path, _read_cache, _write_cache)
  Used by correlation.py and sector.py to eliminate ~26-line duplicate cache logic.
- make_cache_helpers factory to bind the above per-module without duplicating the 4 thin wrapper defs (~16-line clone).
- Common data processing: _compute_pearson_correlation_matrix for sector/correlation corr calcs
  (eliminates the 6/10-line clones of diff/log/corrcoef/align logic).

These were duplicated across api/screener_api/screener_models.py, api/sector.py,
api/chart.py, backtest/api.py etc.

Imported by chart, backtest routes (indirectly), screener, sector, etc.
"""

from pathlib import Path
from typing import Any, Dict, Optional, Callable
import json
import math
import time


def _to_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float; return default on None/NaN/Inf/error."""
    try:
        if value is None:
            return default
        out = float(value)
        if not math.isfinite(out):
            return default
        return out
    except Exception:
        return default


def _sanitize_for_json(obj: Any) -> Any:
    """Recursively sanitize objects for JSON serialization.

    - NaN/Inf floats -> None
    - Objects with .isoformat() (datetime, etc) -> ISO string
    - Preserves other types
    """
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    return obj


def _ensure_datetime_index(df: Any) -> Any:
    """Normalize pandas DataFrame to DatetimeIndex.

    Handles common cases:
    - index already DatetimeIndex
    - 'date' or 'time' column present -> set as index
    - other index -> pd.to_datetime

    Returns the (possibly new) df or original if None/empty.
    Safe for non-df inputs (returns as-is).
    """
    import pandas as pd

    if df is None:
        return df
    # support objects that quack like df
    if hasattr(df, 'empty') and df.empty:
        return df
    if not hasattr(df, 'index') or not hasattr(df, 'columns'):
        return df

    if not isinstance(df.index, pd.DatetimeIndex):
        if 'date' in df.columns:
            df = df.set_index('date')
        elif 'time' in df.columns:
            df = df.set_index('time')
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
    return df


def _make_empty_chart_response(
    symbol: str,
    tf: int,
    or_minutes: int,
    error: Optional[str] = None,
    high_52w: bool = True,
) -> Dict[str, Any]:
    """Build the standard empty / error response shape for /api/chart/preview.

    Used to eliminate ~14-line duplicated dict literals in chart.py error paths.
    Preserves exact original keys and presence/absence of 'high_52w'.
    """
    resp: Dict[str, Any] = {
        'symbol': symbol,
        'candles': [],
        'orb_zones': [],
        'pivot_levels': [],
        'timeframe': tf,
        'or_minutes': or_minutes,
        'total_candles': 0,
    }
    if high_52w:
        resp['high_52w'] = None
    if error is not None:
        resp['error'] = error
    return resp


# ===== Shared JSON + TTL meta cache helpers =====
# Eliminates duplicate _get_cache_*, _read_cache, _write_cache (and related)
# between api/correlation.py and api/sector.py (was ~26 lines / 247 tokens clone).

def _get_cache_path(cache_dir: Path, key: str) -> Path:
    return cache_dir / f"{key}.json"


def _get_cache_meta_path(cache_dir: Path, key: str) -> Path:
    return cache_dir / f"{key}.meta"


def _read_cache(cache_dir: Path, key: str, ttl_seconds: int = 300) -> Optional[dict]:
    """Read from JSON cache if present and not expired per .meta file."""
    path = _get_cache_path(cache_dir, key)
    if not path.exists():
        return None
    try:
        meta_path = _get_cache_meta_path(cache_dir, key)
        if meta_path.exists():
            with open(meta_path, "r") as f:
                meta = json.load(f)
            if time.time() - meta.get("ts", 0) > ttl_seconds:
                return None
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _write_cache(cache_dir: Path, key: str, data: dict) -> None:
    """Write data to JSON cache + update .meta timestamp. Ensures dir exists."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    with open(_get_cache_path(cache_dir, key), "w") as f:
        json.dump(data, f)
    with open(_get_cache_meta_path(cache_dir, key), "w") as f:
        json.dump({"ts": time.time()}, f)


def make_cache_helpers(
    cache_dir: Path, ttl_seconds: int = 300
) -> tuple[
    Callable[[str], Path],
    Callable[[str], Path],
    Callable[[str], Optional[dict]],
    Callable[[str, dict], None],
]:
    """Factory returning bound cache helpers (get_path, get_meta, read, write) for given dir+ttl.

    Eliminates the repeated thin-wrapper 4-def blocks (~16 lines) between
    api/correlation.py and api/sector.py that were just delegating to the shared _utils_*.
    Callers do:
        _get_cache_path, _get_cache_meta_path, _read_cache, _write_cache = make_cache_helpers(CACHE_DIR, CACHE_TTL_SECONDS)
    """
    def _get(key: str) -> Path:
        return _get_cache_path(cache_dir, key)

    def _get_meta(key: str) -> Path:
        return _get_cache_meta_path(cache_dir, key)

    def _read(key: str) -> Optional[dict]:
        return _read_cache(cache_dir, key, ttl_seconds)

    def _write(key: str, data: dict) -> None:
        _write_cache(cache_dir, key, data)

    return _get, _get_meta, _read, _write


def _compute_pearson_correlation_matrix(
    dfs: Dict[str, Any],
) -> tuple[Optional[list[list[float]]], Optional[list[str]], Optional[Any]]:
    """Compute Pearson corr matrix on log returns of overlapping 'close' series.

    This was the ~6-10 line duplicated block (diff/log/corrcoef/nan/round list + intersect)
    in api/correlation.py:_compute_correlation and api/sector.py:_compute_correlation_matrix.

    Returns (corr_list, symbols, common_index) or (None, None, None) on failure.
    """
    import numpy as np
    import pandas as pd

    if not dfs or len(dfs) < 2:
        return None, None, None

    symbols = list(dfs.keys())
    all_dfs = [dfs[s] for s in symbols]

    # intersect indices (assume pandas Index with .intersection)
    all_indices = all_dfs[0].index
    for df in all_dfs[1:]:
        all_indices = all_indices.intersection(df.index)

    if len(all_indices) < 2:
        return None, None, None

    close_matrix = np.column_stack([
        df.loc[all_indices, "close"].values for df in all_dfs
    ])

    returns = np.diff(np.log(close_matrix), axis=0)

    with np.errstate(invalid="ignore", divide="ignore"):
        corr_matrix = np.corrcoef(returns, rowvar=False)

    corr_matrix = np.nan_to_num(corr_matrix, nan=0.0)
    corr_list = [[round(float(v), 6) for v in row] for row in corr_matrix]

    return corr_list, symbols, all_indices
