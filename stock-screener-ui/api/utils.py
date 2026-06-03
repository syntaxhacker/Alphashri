"""
api/utils.py — Shared helpers for API layer to reduce DRY clones.

Centralizes:
- Data normalizers (_to_float, _sanitize_for_json, _ensure_datetime_index)
- Common response builders (_make_empty_chart_response)

These were duplicated across api/screener_api/screener_models.py, api/sector.py,
api/chart.py, backtest/api.py etc.

Imported by chart, backtest routes (indirectly), screener, sector, etc.
"""

from typing import Any, Dict, Optional
import math


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
