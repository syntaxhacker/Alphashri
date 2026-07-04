"""Chart data formatting and processing utilities."""

from datetime import datetime
from typing import Optional


def format_candles_for_chart(df, include_volume: bool = True) -> list:
    """Convert OHLC DataFrame to chart-friendly dict list."""
    candles = []
    for row in df.itertuples():
        candle = {
            "time": row.Index.isoformat() if hasattr(row.Index, 'isoformat') else str(row.Index),
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
        }
        if include_volume and hasattr(row, 'volume'):
            candle["volume"] = row.volume
        candles.append(candle)
    return candles


def calc_hold_duration(entry_time_str: str, exit_time_str: str) -> Optional[int]:
    """Calculate holding duration in minutes."""
    if not entry_time_str or not exit_time_str:
        return None
    try:
        et = datetime.fromisoformat(entry_time_str)
        xt = datetime.fromisoformat(exit_time_str)
        return int((xt - et).total_seconds() / 60)
    except (ValueError, TypeError):
        return None
