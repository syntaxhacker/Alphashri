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
"""

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
    240: "4h",
    1440: "1D",
    10080: "1W",
    43200: "1ME",
}

_IST = config.IST

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

    Args:
        symbol: Trading symbol (e.g., "RELIANCE")
        tf: Timeframe in minutes (1, 5, 15, 30, 60, 1440)
        from_date: Start date "YYYY-MM-DD"
        to_date: End date "YYYY-MM-DD"
        resample_to: If set, resample fetched data to this TF (in minutes).
                     Useful for fetching 5m data and resampling to 15m/1h.
        api_client: Optional UpstoxAPI instance. If None, uses get_api_client().

    Returns:
        DataFrame with UTC DatetimeIndex and columns: open, high, low, close, volume, oi
        Returns None on error.
    """
    if tf not in _TF_TO_UPSTOX:
        raise ValueError(f"Unsupported tf={tf}. Supported: {list(_TF_TO_UPSTOX.keys())}")

    api = api_client or get_api_client()
    if api is None:
        return None

    unit, interval = _TF_TO_UPSTOX[tf]

    try:
        today_str = datetime.now(_IST).strftime("%Y-%m-%d")

        # Single-day window for today: today's session is still in progress, so
        # the historical endpoint has nothing complete to add — fetch only
        # intraday and skip the extra historical call. Multi-day windows keep
        # the historical + intraday merge below.
        single_day_today = from_date == to_date == today_str
        if single_day_today and tf <= 60:
            # The V3 intraday endpoint is minutes-based: `/minutes/{n}` where n is
            # the target timeframe in minutes. Using the unit's interval value here
            # would send 1 for tf=60 (unit "hours"), i.e. 1-minute candles.
            try:
                df = api.fetch_intraday_data_v3(
                    symbol=symbol.upper(),
                    interval=str(tf),
                )
            except Exception:
                df = None
            # Historical covers the completed sessions in the lookback window but
            # omits the in-progress one; the intraday endpoint supplies today's bars.
            # Fetch both for a window ending today and splice them — otherwise a
            # multi-day lookback collapses to today's handful of bars.
        else:
            df = api.fetch_historical_data_v3(
                symbol=symbol.upper(),
                unit=unit,
                interval=interval,
                to_date=to_date,
                from_date=from_date,
            )
            if to_date == today_str and tf <= 60:
                try:
                    intraday = api.fetch_intraday_data_v3(
                        symbol=symbol.upper(),
                        interval=str(tf),
                    )
                except Exception:
                    intraday = None
                df = _concat_merge(df, intraday)
    except Exception:
        return None

    if df is None or df.empty:
        return None

    df = _normalize_tz(df)

    if resample_to is not None and resample_to != tf:
        df = _resample(df, resample_to)

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
