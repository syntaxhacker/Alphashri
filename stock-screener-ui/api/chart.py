"""
Chart API — helpers for resampling candles, ORB zones, pivot points, and chart preview.
"""

import asyncio
from datetime import datetime, timedelta
from inspect import isawaitable
from typing import Dict, Any, List

import config
from fastapi import APIRouter, Query, HTTPException

from api.screener import _to_float, _sanitize_for_json
from api.utils import _ensure_datetime_index, _make_empty_chart_response

router = APIRouter(tags=["chart"])


def _is_weekend(d: datetime) -> bool:
    """Check if a date is Saturday or Sunday."""
    return d.weekday() >= 5


async def _get_last_trading_day(symbol: str) -> str:
    """
    Find the most recent trading day using:
    1. Weekend check (datetime.weekday)
    2. Trading holiday check from DB
    3. Fallback: Upstox data availability check
    Returns date string in YYYY-MM-DD format.
    """
    from db.database import SessionLocal
    from db.models.holiday import MarketHoliday, HolidayType

    today = datetime.now(config.IST).date()

    # Batch-load all trading holidays for the next 10 days in one query
    try:
        db = SessionLocal()
        start = today - timedelta(days=10)
        holidays = {
            h.date
            for h in db.query(MarketHoliday).filter(
                MarketHoliday.date >= start,
                MarketHoliday.date <= today,
                MarketHoliday.type == HolidayType.TRADING
            ).all()
        }
        db.close()
    except Exception:
        holidays = set()

    # Look back up to 10 days to find a trading day
    for i in range(10):
        candidate = today - timedelta(days=i)

        # Weekend check
        if _is_weekend(candidate):
            continue

        # Holiday check (in-memory, no DB query per day)
        if candidate in holidays:
            continue

        return candidate.strftime('%Y-%m-%d')

    # All checks failed, fallback: use yesterday
    return (today - timedelta(days=1)).strftime('%Y-%m-%d')


def _resample_candles(df, tf_minutes: int):
    df = _ensure_datetime_index(df)
    if df is None or df.empty or tf_minutes <= 1:
        return df

    agg_dict = {
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum',
    }

    available_cols = [c for c in agg_dict.keys() if c in df.columns]
    agg_dict = {k: v for k, v in agg_dict.items() if k in available_cols}

    resampled = df[available_cols].resample(f'{tf_minutes}min').agg(agg_dict).dropna()
    return resampled


def _calculate_orb_zones(df, or_minutes: int = 45):
    if df is None or df.empty:
        return []

    df = _ensure_datetime_index(df)

    zones = []

    market_open_minutes = 9 * 60 + 15
    or_end_minutes = market_open_minutes + or_minutes

    df_copy = df.copy()
    df_copy['date'] = df_copy.index.date

    for date, day_df in df_copy.groupby('date'):
        day_df_copy = day_df.copy()
        day_df_copy['minutes'] = day_df.index.hour * 60 + day_df.index.minute
        or_candles = day_df_copy[day_df_copy['minutes'] < or_end_minutes]

        if or_candles.empty:
            continue

        or_high = float(or_candles['high'].max())
        or_low = float(or_candles['low'].min())

        zones.append({
            'date': date.isoformat() if hasattr(date, 'isoformat') else str(date),
            'date_raw': date.isoformat() if hasattr(date, 'isoformat') else str(date),
            'or_high': round(or_high, 2),
            'or_low': round(or_low, 2),
            'or_end_time': f"{or_end_minutes // 60:02d}:{or_end_minutes % 60:02d}",
        })

    return zones


def _calculate_pivot_points(df):
    if df is None or df.empty:
        return []

    df = _ensure_datetime_index(df)

    pivots = []

    df_copy = df.copy()
    df_copy['date'] = df_copy.index.date

    daily_ohlc = df_copy.groupby('date').agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
    })

    dates = list(daily_ohlc.index)

    for i, date in enumerate(dates[1:], 1):
        prev = daily_ohlc.iloc[i - 1]
        prev_high = float(prev['high'])
        prev_low = float(prev['low'])
        prev_close = float(prev['close'])
        pp = (prev_high + prev_low + prev_close) / 3
        r1 = 2 * pp - prev_low
        s1 = 2 * pp - prev_high
        r2 = pp + (prev_high - prev_low)
        s2 = pp - (prev_high - prev_low)

        pivots.append({
            'date': date.isoformat() if hasattr(date, 'isoformat') else str(date),
            'date_raw': date.isoformat() if hasattr(date, 'isoformat') else str(date),
            'pp': round(pp, 2),
            'r1': round(r1, 2),
            's1': round(s1, 2),
            'r2': round(r2, 2),
            's2': round(s2, 2),
        })

    return pivots




def _calculate_52w_high(df):
    """Calculate 52-week high from the full historical data."""
    df = _ensure_datetime_index(df)

    if df is None or df.empty:
        return None

    if 'high' not in df.columns:
        return None

    return round(float(df['high'].max()), 2)

def _format_candles_for_chart(df):
    if df is None or df.empty:
        return []

    candles = []
    for row in df.itertuples():
        time_str = row.Index.strftime('%Y-%m-%dT%H:%M') if hasattr(row.Index, 'strftime') else str(row.Index)
        date_str = row.Index.strftime('%Y-%m-%d') if hasattr(row.Index, 'strftime') else str(row.Index)[:10]
        time_display = row.Index.strftime('%H:%M') if hasattr(row.Index, 'strftime') else ''

        candles.append({
            'time': time_str,
            'date': date_str,
            'time_str': time_display,
            'open': _to_float(getattr(row, 'open', 0)),
            'high': _to_float(getattr(row, 'high', 0)),
            'low': _to_float(getattr(row, 'low', 0)),
            'close': _to_float(getattr(row, 'close', 0)),
            'volume': _to_float(getattr(row, 'volume', 0)),
        })

    return candles


def _filter_to_last_n_trading_days(df, n: int):
    """Filter DataFrame to include only the last N trading days."""
    if df is None or df.empty:
        return df

    df_copy = df.copy()
    df_copy['__date'] = df_copy.index.date
    unique_dates = sorted(df_copy['__date'].unique(), reverse=True)

    if len(unique_dates) <= n:
        return df

    cutoff_date = unique_dates[n - 1]
    return df[df.index.date >= cutoff_date]


@router.get("/api/chart/preview/{symbol}")
async def get_chart_preview(
    symbol: str,
    tf: int = Query(15, ge=1, le=1440, description="Timeframe in minutes (1, 5, 15, 30, 60, 120, 240, 720, 1440)"),
    days: int = Query(1, ge=1, le=30, description="Days of history (default 1 for hover preview)"),
    or_minutes: int = Query(45, ge=15, le=240, description="Opening range period in minutes")
):
    from cache.redis_client import cache_get, cache_set, make_cache_key
    import config as app_config
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    import pandas as pd

    cache_key = make_cache_key("chart", symbol.upper(), tf=tf, days=days, or_minutes=or_minutes)
    cached = cache_get(cache_key)
    if cached is not None:
        cached["from_cache"] = True
        return cached

    api_key = app_config.UPSTOX_API_KEY
    api_secret = app_config.UPSTOX_API_SECRET

    if not api_key or not api_secret:
        return _make_empty_chart_response(
            symbol, tf, or_minutes,
            error='Upstox API credentials not configured'
        )

    try:
        api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)
    except Exception as e:
        return _make_empty_chart_response(
            symbol, tf, or_minutes,
            error=f'Failed to initialize API: {str(e)}'
        )

    try:
        # Compute the last trading day using weekend + holiday checks
        last_trading_day = await _get_last_trading_day(symbol)

        # Fetch enough calendar days to cover N trading days (+ buffer for weekends/holidays)
        calendar_days_back = days * 3  # 3x buffer is plenty since we're starting from a known trading day
        from_date = (datetime.strptime(last_trading_day, '%Y-%m-%d') - timedelta(days=calendar_days_back)).strftime('%Y-%m-%d')
        to_date = last_trading_day

        # Fetch historical data
        df = api.fetch_historical_data_v3(
            symbol=symbol, unit='minutes', interval=1,
            from_date=from_date, to_date=to_date
        )
        if isawaitable(df):
            df = await df

        # Supplement with intraday data if available
        try:
            df_intraday = api.fetch_intraday_data_v3(symbol=symbol, interval='1')
            if isawaitable(df_intraday):
                df_intraday = await df_intraday
            if df_intraday is not None and hasattr(df_intraday, 'empty') and not df_intraday.empty:
                if df is None or (hasattr(df, 'empty') and df.empty):
                    df = df_intraday
                else:
                    import pandas as pd
                    df = pd.concat([df, df_intraday]).drop_duplicates(keep='last').sort_index()
        except Exception:
            pass

        if df is None or not hasattr(df, 'empty') or df.empty:
            return _make_empty_chart_response(symbol, tf, or_minutes, high_52w=False)

        # Filter to the last N trading days
        df = _filter_to_last_n_trading_days(df, days)

        orb_zones = _calculate_orb_zones(df, or_minutes)
        pivot_levels = _calculate_pivot_points(df)
        df_tf = _resample_candles(df, tf)
        candles = _format_candles_for_chart(df_tf)

        high_52w = _calculate_52w_high(df)

        result = _sanitize_for_json({
            'symbol': symbol,
            'candles': candles,
            'orb_zones': orb_zones,
            'pivot_levels': pivot_levels,
            'high_52w': high_52w,
            'timeframe': tf,
            'or_minutes': or_minutes,
            'total_candles': len(candles),
        })

        cache_set(cache_key, result, ttl=60)
        return result

    except Exception as e:
        return _make_empty_chart_response(symbol, tf, or_minutes, error=str(e))
