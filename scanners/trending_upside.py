import argparse
from tradingview_screener import Query, Column
from rich.console import Console
from rich.table import Table
import pandas as pd
import time
import sys
import os

# Add path to import utils modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from utils.tv_utils import clean_and_deduplicate, format_change, format_rsi

console = Console()

SCREENER_PROFILES = {
    'trending': {
        'label': 'Trending',
        'description': 'Balanced trend + momentum candidates',
        'indicators': ['52W High'],
        'columns': ['symbol', 'score', 'touched_52w', 'tv_price', 'upstox_price', 'broker_diff', 'to_52w_high', 'recent_return_5d', 'perf_w', 'sector'],
        'default_sort': {'column': 'to_52w_high', 'direction': 'asc'}
    },
    'high_momentum': {
        'label': 'High Momentum',
        'description': 'Momentum scanner logic (RSI/MACD/volume)',
        'indicators': ['RSI', 'MACD', 'Volume'],
        'columns': ['symbol', 'score', 'rsi', 'day_change', 'volume_m', 'recent_return_5d', 'perf_w', 'sector'],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'buyer_interest': {
        'label': 'Buyer Interest',
        'description': 'Wick close + volume surge buyer pressure',
        'indicators': ['Wick%', 'Volume Surge'],
        'columns': ['symbol', 'score', 'wick_close_pct', 'volume_surge', 'rsi', 'day_change', 'volume_m', 'sector'],
        'default_sort': {'column': 'wick_close_pct', 'direction': 'desc'}
    },
    'buyer_interest_enhanced': {
        'label': 'Buyer Interest+',
        'description': 'Enhanced buyer/seller pattern setup',
        'indicators': ['Wick%', 'Volume Surge', 'Score'],
        'columns': ['symbol', 'score', 'rsi', 'wick_close_pct', 'volume_surge', 'adx', 'day_change', 'sector'],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'volatility_trend': {
        'label': 'Volatility Trend',
        'description': 'Volatility with trend confirmation',
        'indicators': ['ATR', 'RSI', 'ADX', 'Trend'],
        'columns': ['symbol', 'score', 'atr_pct', 'rsi', 'adx', 'day_change', 'perf_w', 'sector'],
        'default_sort': {'column': 'atr_pct', 'direction': 'desc'}
    },
    'nifty50_activity': {
        'label': 'Nifty50 Activity',
        'description': 'Nifty-style activity scoring',
        'indicators': ['Interest Score'],
        'columns': ['symbol', 'score', 'interest_score', 'day_change', 'volume_m', 'market_cap_b', 'sector'],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'near_52w_breakout': {
        'label': 'Near 52W',
        'description': '52-week high breakout candidate logic',
        'indicators': ['52W Gap %'],
        'columns': ['symbol', 'score', 'rsi', 'adx', 'day_change', 'to_52w_high', 'recent_return_5d', 'perf_w', 'sector'],
        'default_sort': {'column': 'to_52w_high', 'direction': 'asc'}
    },
    'touched_52w_high': {
        'label': 'Touched 52W',
        'description': 'Stocks that recently touched 52-week high',
        'indicators': ['52W High', 'Days Ago'],
        'columns': ['symbol', 'rsi', 'adx', 'day_change', 'recent_return_5d', 'high_52w', 'days_ago', 'perf_w', 'volume_m'],
        'default_sort': {'column': 'days_ago', 'direction': 'asc'}
    },
    'rsi_reversal': {
        'label': 'RSI Reversal',
        'description': 'Oversold/overbought reversal logic',
        'indicators': ['RSI', 'Stochastic'],
        'columns': ['symbol', 'score', 'rsi', 'stoch_k', 'day_change', 'volume_m', 'sector'],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'market_open_gap': {
        'label': 'Gap Open',
        'description': 'Market open gap scanner logic',
        'indicators': ['Gap%', 'Volume'],
        'columns': ['symbol', 'score', 'gap_pct', 'premarket_change', 'day_change', 'volume_m', 'sector'],
        'default_sort': {'column': 'gap_pct', 'direction': 'desc'}
    },
    'nifty_movers': {
        'label': 'Nifty Movers',
        'description': 'Weighted impact (market-cap × move) logic',
        'indicators': ['Impact Score', 'Market Cap'],
        'columns': ['symbol', 'score', 'impact_score', 'day_change', 'market_cap_b', 'volume_m', 'sector'],
        'default_sort': {'column': 'impact_score', 'direction': 'desc'}
    },
    'intraday_momentum': {
        'label': 'Intraday Momentum',
        'description': 'Stocks with rapid price runs in last 5/15/30 mins',
        'indicators': ['5-min Move', 'Volume'],
        'columns': ['symbol', 'score', 'move_pct', 'volume_m', 'rsi', 'day_change', 'sector'],
        'default_sort': {'column': 'move_pct', 'direction': 'desc'}
    },
}


def get_screener_profiles():
    return [
        {
            'id': key,
            'label': value['label'],
            'description': value['description'],
            'indicators': value.get('indicators', []),
            'columns': value.get('columns', []),
            'default_sort': value.get('default_sort', {}),
            'filters': value.get('filters', [])
        }
        for key, value in SCREENER_PROFILES.items()
    ]


def _safe_float(row, key, default=0.0):
    try:
        val = row.get(key, default)
        if pd.isna(val):
            return float(default)
        return float(val)
    except Exception:
        return float(default)


def _query_by_profile(profile, limit):
    fetch_limit = max(limit * 4, 120)

    if profile == 'high_momentum':
        return (
            Query()
            .select(
                'name', 'close', 'high', 'low', 'change', 'volume',
                'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal',
                'sector', 'description', 'update_mode', 'market_cap_basic',
                'price_52_week_high', 'Perf.W', 'ATR', 'ADX', 'relative_volume_10d_calc'
            )
            .set_markets('india')
            .where(
                Column('close') >= 10,
                Column('market_cap_basic') >= 500_000_000,
                Column('volume') > 500_000,
                Column('RSI').between(50, 80),
                Column('change') >= -5
            )
            .order_by('RSI', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'buyer_interest':
        return (
            Query()
            .select(
                'name', 'close', 'open', 'high', 'low', 'change', 'volume',
                'RSI', 'ADX', 'relative_volume_10d_calc',
                'sector', 'market_cap_basic', 'price_52_week_high',
                'Perf.W', 'ATR'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 2_000_000_000,
                Column('volume') > 100_000,
                Column('close') > 10,
                Column('RSI') > 40
            )
            .order_by('volume', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'buyer_interest_enhanced':
        return (
            Query()
            .select(
                'name', 'close', 'open', 'high', 'low', 'change', 'volume',
                'gap', 'RSI', 'ADX', 'relative_volume_10d_calc', 'Volatility.D',
                'sector', 'market_cap_basic', 'price_52_week_high',
                'Perf.W', 'ATR'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 2_000_000_000,
                Column('volume') > 150_000,
                Column('close') > 10
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'volatility_trend':
        return (
            Query()
            .select(
                'name', 'close', 'change', 'volume',
                'RSI', 'ADX', 'Volatility.D', 'ATR', 'Perf.W',
                'relative_volume_10d_calc', 'sector', 'market_cap_basic',
                'price_52_week_high'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 2_000_000_000,
                Column('volume') > 200_000,
                Column('close') > 10,
                Column('Volatility.D') > 1.0
            )
            .order_by('Volatility.D', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'nifty50_activity':
        return (
            Query()
            .select(
                'name', 'close', 'change', 'volume',
                'RSI', 'ADX', 'market_cap_basic', 'sector',
                'price_52_week_high', 'Perf.W', 'ATR', 'relative_volume_10d_calc'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 500_000_000,
                Column('close') > 20
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(80)
        )

    if profile == 'near_52w_breakout':
        return (
            Query()
            .select(
                'name', 'close', 'high', 'low', 'change', 'volume',
                'price_52_week_high', 'price_52_week_low', 'market_cap_basic',
                'RSI', 'sector', 'description', 'update_mode',
                'average_volume_10d_calc', 'SMA50', 'SMA200', 'Perf.W', 'ATR', 'ADX'
            )
            .set_markets('india')
            .where(
                Column('close') >= 10,
                Column('market_cap_basic') >= 500_000_000,
                Column('volume') > 1_000_000,
                Column('RSI').between(45, 75),
                Column('change') >= 0.5,
                Column('close') > Column('SMA50'),
                Column('SMA50') > Column('SMA200')
            )
            .order_by('RSI', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'touched_52w_high':
        return (
            Query()
            .select(
                'name', 'close', 'high', 'low', 'change', 'volume',
                'price_52_week_high', 'price_52_week_low', 'market_cap_basic',
                'RSI', 'sector', 'description', 'update_mode',
                'average_volume_10d_calc', 'SMA50', 'SMA200', 'Perf.W', 'ATR', 'ADX',
                'Perf.1M', 'Perf.3M'
            )
            .set_markets('india')
            .where(
                Column('close') >= 10,
                Column('market_cap_basic') >= 500_000_000,
                Column('volume') > 1_000_000,
                Column('price_52_week_high') > 0,
                Column('close').above_pct('price_52_week_high', 0.98)  # within 2% of 52w high
            )
            .order_by('volume', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'rsi_reversal':
        return (
            Query()
            .select(
                'name', 'close', 'change', 'volume', 'RSI', 'Stoch.K', 'Stoch.D',
                'market_cap_basic', 'sector', 'price_52_week_high', 'Perf.W', 'ATR', 'ADX'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 500_000_000,
                Column('volume') > 100_000,
                Column('close') > 20
            )
            .order_by('volume', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'market_open_gap':
        return (
            Query()
            .select(
                'name', 'close', 'open', 'gap', 'volume', 'premarket_change',
                'change', 'change_abs', 'market_cap_basic',
                'sector', 'price_52_week_high', 'Perf.W', 'ATR', 'ADX', 'relative_volume_10d_calc'
            )
            .set_markets('india')
            .where(
                Column('volume') > 10_000,
                Column('open') > 10,
                Column('market_cap_basic') > 1_000_000_000
            )
            .order_by('volume', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'nifty_movers':
        return (
            Query()
            .select(
                'name', 'close', 'change', 'market_cap_basic', 'volume',
                'description', 'sector', 'price_52_week_high', 'Perf.W', 'ATR', 'ADX'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 500_000_000,
                Column('close') > 20
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(fetch_limit)
        )

    if profile == 'intraday_momentum':
        return (
            Query()
            .select(
                'name', 'close', 'change', 'volume',
                'RSI', 'ADX', 'market_cap_basic', 'sector',
                'relative_volume_10d_calc', 'ATR'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') >= 500_000_000,
                Column('volume') > 500_000,
                Column('close') > 20,
                Column('relative_volume_10d_calc') > 0.5
            )
            .order_by('volume', ascending=False)
            .limit(fetch_limit)
        )

    return (
        Query()
        .select(
            'name', 'close', 'change', 'volume',
            'RSI', 'ADX', 'EMA20', 'EMA50', 'Mom',
            'relative_volume_10d_calc', 'sector', 'market_cap_basic',
            'price_52_week_high', 'Perf.W', 'Volatility.D',
            'return_on_equity', 'debt_to_equity',
            'MACD.macd', 'MACD.signal', 'Perf.1M', 'earnings_release_next_date',
            'ATR'
        )
        .set_markets('india')
        .where(
            Column('close') > 20,
            Column('close') > Column('EMA20'),
            Column('EMA20') > Column('EMA50'),
            Column('RSI') > 50,
            Column('ADX') > 20,
            Column('relative_volume_10d_calc') > 0.5,
            Column('market_cap_basic') > 50_000_000_000,
            Column('return_on_equity') > 10
        )
        .order_by('Mom', ascending=False)
        .limit(fetch_limit)
    )


def _score_trending(df):
    df['dist_52w'] = ((df['price_52_week_high'] - df['close']) / df['price_52_week_high']) * 100

    def calculate_score(row):
        score = 0
        rsi = _safe_float(row, 'RSI', 50)
        adx = _safe_float(row, 'ADX', 20)
        rvol = _safe_float(row, 'relative_volume_10d_calc', 0.5)
        dist = _safe_float(row, 'dist_52w', 10)

        if 50 <= rsi <= 70:
            score += 30
        elif 70 < rsi <= 80:
            score += 25
        else:
            score += 10

        if adx > 30:
            score += 20
        elif adx > 25:
            score += 15
        elif adx > 20:
            score += 10

        if rvol > 2.0:
            score += 20
        elif rvol > 1.5:
            score += 15
        else:
            score += 10

        if dist < 2:
            score += 30
        elif dist < 5:
            score += 25
        elif dist < 10:
            score += 15
        else:
            score += 5

        if _safe_float(row, 'MACD.macd', 0) > _safe_float(row, 'MACD.signal', 0):
            score += 10
        if _safe_float(row, 'Perf.1M', 0) > 5:
            score += 10

        if pd.notnull(row.get('earnings_release_next_date')):
            days_to_earnings = (_safe_float(row, 'earnings_release_next_date', 0) - time.time()) / 86400
            if 0 <= days_to_earnings < 3:
                score -= 50
        return score

    df['swing_score'] = df.apply(calculate_score, axis=1)
    return df.sort_values('swing_score', ascending=False)


def _score_high_momentum(df):
    def calculate_momentum(row):
        score = 0
        rsi = _safe_float(row, 'RSI', 50)
        rsi_prev = _safe_float(row, 'RSI[1]', rsi)
        macd = _safe_float(row, 'MACD.macd', 0)
        signal = _safe_float(row, 'MACD.signal', 0)
        change = _safe_float(row, 'change', 0)
        vol_m = _safe_float(row, 'volume', 0) / 1_000_000

        if rsi > 70:
            score += 20
        elif rsi > 60:
            score += 15
        elif rsi > 50:
            score += 10
        elif rsi > 40:
            score += 5

        if macd > signal and macd > 0:
            score += 15
        elif macd > signal:
            score += 10

        if rsi > rsi_prev and rsi > 50:
            score += 10
        elif rsi > 50:
            score += 5

        if vol_m > 10:
            score += 15
        elif vol_m > 5:
            score += 12
        elif vol_m > 2:
            score += 8
        elif vol_m > 1:
            score += 4

        if change > 0:
            score += 5
        if 55 <= rsi <= 70:
            score += 10
        elif 50 <= rsi <= 75:
            score += 5
        elif rsi > 75:
            score -= 5

        abs_change = abs(change)
        if abs_change < 3:
            score += 5
        elif abs_change > 8:
            score -= 5

        score += 10
        return min(score, 100)

    df['swing_score'] = df.apply(calculate_momentum, axis=1)
    return df.sort_values(['swing_score', 'RSI'], ascending=[False, False])


def _score_buyer_interest(df):
    out = df.copy()
    day_range = (out['high'] - out['low']).replace(0, pd.NA)
    out['wick_close_pct'] = (((out['close'] - out['low']) / day_range) * 100).fillna(50).clip(0, 100)
    out['volume_surge'] = out['relative_volume_10d_calc'].fillna(1).clip(lower=0)
    out = out[out['wick_close_pct'] >= 60].copy()
    if out.empty:
        return out

    out['swing_score'] = (
        (out['wick_close_pct'] * 0.55)
        + (out['volume_surge'].clip(upper=5) * 12)
        + (out['ADX'].fillna(20).clip(lower=0, upper=50) * 0.5)
        + (out['change'].fillna(0).clip(lower=-10, upper=10) * 1.2)
    ).clip(lower=0, upper=99)
    return out.sort_values(['swing_score', 'wick_close_pct', 'volume'], ascending=[False, False, False])


def _score_buyer_interest_enhanced(df):
    out = _score_buyer_interest(df)
    if out.empty:
        return out

    body = (out['close'] - out['open']).abs()
    rng = (out['high'] - out['low']).replace(0, pd.NA)
    out['body_pct'] = ((body / rng) * 100).fillna(20)
    out['upper_shadow_pct'] = ((out['high'] - out[['open', 'close']].max(axis=1)) / rng * 100).fillna(0)
    out['pattern_signal'] = 'NEUTRAL'
    out.loc[(out['body_pct'] >= 55) & (out['wick_close_pct'] >= 75), 'pattern_signal'] = 'STRONG_BULL'
    out.loc[(out['upper_shadow_pct'] >= 40) & (out['wick_close_pct'] <= 35), 'pattern_signal'] = 'STRONG_BEAR'
    out['swing_score'] += out['pattern_signal'].map({'STRONG_BULL': 15, 'STRONG_BEAR': -8, 'NEUTRAL': 0}).fillna(0)
    gap_series = out['gap'] if 'gap' in out.columns else pd.Series([0] * len(out), index=out.index)
    out['swing_score'] += (gap_series.fillna(0).abs().clip(upper=5) * 1.5)
    out['swing_score'] = out['swing_score'].clip(lower=0, upper=99)
    return out.sort_values(['swing_score', 'wick_close_pct', 'volume'], ascending=[False, False, False])


def _score_volatility_trend(df):
    out = df.copy()
    out['volatility_d'] = out['Volatility.D'].fillna(0)
    out['volume_surge'] = out['relative_volume_10d_calc'].fillna(1).clip(lower=0)
    out['trend_bias'] = ((out['ADX'].fillna(0) >= 20).astype(int) + (out['RSI'].fillna(50) >= 50).astype(int))
    out = out[(out['volatility_d'] >= 1.5) & (out['trend_bias'] >= 1)].copy()
    if out.empty:
        return out
    out['swing_score'] = (
        out['volatility_d'].clip(upper=12) * 7
        + out['ADX'].fillna(0).clip(upper=45) * 0.9
        + out['volume_surge'].clip(upper=5) * 6
        + out['Perf.W'].fillna(0).clip(lower=-20, upper=20) * 0.8
    ).clip(lower=0, upper=99)
    return out.sort_values(['swing_score', 'volatility_d'], ascending=[False, False])


def _score_nifty50_activity(df):
    out = df.copy()
    out = out.sort_values('market_cap_basic', ascending=False).head(50).copy()
    out['volume_m'] = out['volume'].fillna(0) / 1_000_000
    out['volume_surge'] = out['relative_volume_10d_calc'].fillna(1).clip(lower=0)
    out['interest_score'] = 0
    out.loc[out['volume_surge'] >= 2.0, 'interest_score'] += 100
    out.loc[out['volume_surge'] >= 1.2, 'interest_score'] += 20
    out.loc[(out['RSI'].fillna(50) >= 65) | (out['RSI'].fillna(50) <= 35), 'interest_score'] += 10
    out.loc[out['ADX'].fillna(0) >= 25, 'interest_score'] += 10
    out['swing_score'] = (
        out['interest_score']
        + out['change'].fillna(0).abs().clip(upper=8) * 3
        + out['volume_m'].clip(upper=20) * 1.2
    ).clip(lower=0, upper=99)
    return out.sort_values(['swing_score', 'market_cap_basic'], ascending=[False, False])


def _score_near_52w_breakout(df):
    out = df.copy()
    out['distance_to_high_pct'] = ((out['price_52_week_high'] - out['close']) / out['price_52_week_high']) * 100
    out = out[out['distance_to_high_pct'] <= 10].copy()
    if out.empty:
        return out

    out['volume_in_millions'] = (out['volume'] / 1_000_000).round(2)
    out['market_cap_billions'] = (out['market_cap_basic'] / 1_000_000_000).round(2)
    out['average_volume_10d_calc'] = out['average_volume_10d_calc'].fillna(out['volume'])
    out['rvol'] = (out['volume'] / out['average_volume_10d_calc']).round(2)
    out['swing_score'] = 0
    out.loc[out['distance_to_high_pct'] <= 3, 'swing_score'] += 50
    out['swing_score'] += (out['volume_in_millions'] * 2).astype(int)
    out.loc[out['rvol'] > 1.5, 'swing_score'] += 25
    out.loc[out['rvol'] > 2.0, 'swing_score'] += 15
    out['swing_score'] += (out['market_cap_billions'] * 3).astype(int)
    out.loc[out['RSI'] >= 60, 'swing_score'] += 30
    out.loc[out['change'] >= 2, 'swing_score'] += 20
    out['dist_52w'] = out['distance_to_high_pct']
    return out.sort_values(['swing_score', 'distance_to_high_pct'], ascending=[False, True])


def _score_rsi_reversal(df):
    bullish = df[(df['RSI'] < 35) & (df['Stoch.K'] < 25) & (df['change'] > 0)].copy()
    bearish = df[(df['RSI'] > 65) & (df['Stoch.K'] > 75) & (df['change'] < 0)].copy()
    if not bullish.empty:
        bullish['reversal_signal'] = 'BULLISH'
    if not bearish.empty:
        bearish['reversal_signal'] = 'BEARISH'
    out = pd.concat([bullish, bearish], ignore_index=True)
    if out.empty:
        return out
    out['dist_52w'] = ((out['price_52_week_high'] - out['close']) / out['price_52_week_high']) * 100
    out['swing_score'] = (
        (100 - (out['RSI'] - 50).abs() * 1.2)
        + out['change'].abs() * 2
    ).clip(lower=40, upper=95)
    return out.sort_values(['swing_score', 'volume'], ascending=[False, False])


def _score_market_open_gap(df):
    out = df.copy()
    out = out[out['gap'].abs() >= 1.0].copy()
    if out.empty:
        return out
    out['abs_gap'] = out['gap'].abs()
    out['dist_52w'] = ((out['price_52_week_high'] - out['close']) / out['price_52_week_high']) * 100
    out['swing_score'] = (
        out['abs_gap'] * 15
        + out['volume'].clip(lower=0) / 1_000_000
        + out['relative_volume_10d_calc'].fillna(1) * 8
    ).clip(upper=99)
    return out.sort_values(['abs_gap', 'volume'], ascending=[False, False])


def _score_nifty_movers(df):
    out = df.copy()
    out['market_cap_B'] = out['market_cap_basic'] / 1_000_000_000
    out['impact_score'] = (out['market_cap_basic'] * out['change']) / 100_000_000_000
    out['abs_impact'] = out['impact_score'].abs()
    out['dist_52w'] = ((out['price_52_week_high'] - out['close']) / out['price_52_week_high']) * 100
    out['swing_score'] = (out['abs_impact'] * 12).clip(lower=10, upper=99)
    return out.sort_values(['abs_impact', 'market_cap_basic'], ascending=[False, False])


def _normalize_for_verifier(df):
    if df.empty:
        return df

    out = df.copy()
    defaults = {
        'sector': '-',
        'price_52_week_high': out['close'] * 1.1,
        'ADX': out.get('RSI', pd.Series([25] * len(out), index=out.index)).fillna(25) * 0.5,
        'ATR': out['close'] * 0.012,
        'Perf.W': out.get('change', pd.Series([0] * len(out), index=out.index)).fillna(0),
        'change': out.get('change', pd.Series([0] * len(out), index=out.index)).fillna(0),
    }
    for key, val in defaults.items():
        if key not in out.columns:
            out[key] = val
        out[key] = out[key].fillna(val)
    return out


def _score_intraday_momentum(df):
    """Score for intraday momentum - base scoring, actual momentum calculated via API."""
    out = df.copy()
    out['volume_m'] = out['volume'].fillna(0) / 1_000_000
    out['volume_surge'] = out['relative_volume_10d_calc'].fillna(1).clip(lower=0)
    # Base score from TradingView data; real momentum calculated in API server
    out['swing_score'] = (
        out['volume_surge'].clip(upper=5) * 10
        + out['change'].fillna(0).abs().clip(upper=10) * 3
        + out['volume_m'].clip(upper=50) * 0.5
    ).clip(lower=0, upper=50).astype(int)
    return out.sort_values(['swing_score', 'volume'], ascending=[False, False])


def _score_by_profile(df, profile):
    if profile == 'intraday_momentum':
        return _score_intraday_momentum(df)
    if profile == 'high_momentum':
        return _score_high_momentum(df)
    if profile == 'buyer_interest':
        return _score_buyer_interest(df)
    if profile == 'buyer_interest_enhanced':
        return _score_buyer_interest_enhanced(df)
    if profile == 'volatility_trend':
        return _score_volatility_trend(df)
    if profile == 'nifty50_activity':
        return _score_nifty50_activity(df)
    if profile == 'near_52w_breakout':
        return _score_near_52w_breakout(df)
    if profile == 'rsi_reversal':
        return _score_rsi_reversal(df)
    if profile == 'market_open_gap':
        return _score_market_open_gap(df)
    if profile == 'nifty_movers':
        return _score_nifty_movers(df)
    return _score_trending(df)


def fetch_trending_stocks(limit=50, profile='trending'):
    """Unified query engine for all screener profiles."""
    try:
        profile = profile if profile in SCREENER_PROFILES else 'trending'
        query = _query_by_profile(profile, limit)
        _, df = query.get_scanner_data()
        if df.empty:
            return df

        df = clean_and_deduplicate(df)
        df = _score_by_profile(df, profile)
        if df.empty:
            return df

        df = _normalize_for_verifier(df)
        return df.head(limit)
    except Exception as e:
        console.print(f"[red]Error fetching data: {e}[/red]")
        return pd.DataFrame()


def fetch_intraday_snapshot(limit=120, min_cap=50_000_000_000, min_rvol=0.5, min_price=20):
    """Fetch a single intraday snapshot for India stocks."""
    try:
        query = (
            Query()
            .select(
                'name', 'close', 'change', 'volume',
                'RSI', 'ADX', 'relative_volume_10d_calc',
                'sector', 'market_cap_basic'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') > min_cap,
                Column('relative_volume_10d_calc') > min_rvol,
                Column('close') > min_price
            )
            .order_by('volume', ascending=False)
            .limit(limit)
        )

        _, df = query.get_scanner_data()
        if df.empty:
            return df
        return clean_and_deduplicate(df)
    except Exception as e:
        console.print(f"[red]Error fetching intraday snapshot: {e}[/red]")
        return pd.DataFrame()


def scan_intraday_3m(limit=120, lookback_seconds=180, min_move=0.2):
    """Compare two snapshots to find top 3-minute upside momentum stocks."""
    snap_1 = fetch_intraday_snapshot(limit=limit)
    if snap_1.empty:
        return pd.DataFrame()

    console.print(
        f"[dim]Captured baseline snapshot for {len(snap_1)} stocks. "
        f"Waiting {lookback_seconds}s for 3-minute momentum window...[/dim]"
    )
    time.sleep(lookback_seconds)

    snap_2 = fetch_intraday_snapshot(limit=limit)
    if snap_2.empty:
        return pd.DataFrame()

    merged = snap_1[['name', 'close', 'volume']].rename(
        columns={'close': 'close_t0', 'volume': 'volume_t0'}
    ).merge(
        snap_2,
        on='name',
        how='inner'
    )

    if merged.empty:
        return merged

    merged['move_3m_pct'] = ((merged['close'] - merged['close_t0']) / merged['close_t0']) * 100
    merged['vol_delta'] = merged['volume'] - merged['volume_t0']
    merged = merged[merged['move_3m_pct'] >= min_move].copy()

    if merged.empty:
        return merged

    merged['momentum_score'] = (
        (merged['move_3m_pct'] * 60)
        + (merged['relative_volume_10d_calc'].clip(lower=0, upper=5) * 8)
        + ((merged['RSI'] - 50).clip(lower=0) * 0.5)
        + ((merged['ADX'] - 20).clip(lower=0) * 0.5)
    )
    merged = merged.sort_values(['momentum_score', 'move_3m_pct', 'vol_delta'], ascending=False)

    return merged

def display_trending(df):
    """Display the trending stocks."""
    if df.empty:
        console.print("[yellow]No trending stocks found matching criteria.[/yellow]")
        return

    table = Table(title="🎯 TOP SWING TRADE CANDIDATES (Scored)", style="blue")
    
    table.add_column("Rank", style="dim", width=4)
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Price ₹", justify="right")
    table.add_column("Change %", justify="right")
    table.add_column("Score", justify="center", style="bold magenta")
    table.add_column("52W Dist", justify="right")
    table.add_column("RSI", justify="right")
    table.add_column("MACD", justify="center")
    table.add_column("Perf.1M", justify="right")
    table.add_column("ROE", justify="right")
    table.add_column("Sector", style="dim")

    rank = 1
    for _, row in df.iterrows():
        # Color code change
        change_str = format_change(row['change'])
        
        # Score visual
        score = row['swing_score']
        score_str = f"{score}/100"
        if score >= 80: score_str = f"[bold green]{score_str}[/bold green]"
        elif score >= 60: score_str = f"[yellow]{score_str}[/yellow]"
        
        # 52W Dist visual
        dist = row['dist_52w']
        dist_str = f"{dist:.1f}%"
        if dist < 2: dist_str = f"[bold green]🚀 {dist_str}[/bold green]"
        
        # RSI visual
        rsi_str = format_rsi(row['RSI'])

        # MACD visual
        macd_val = "Bullish" if row['MACD.macd'] > row['MACD.signal'] else "Bearish"
        macd_str = f"[green]{macd_val}[/green]" if macd_val == "Bullish" else f"[red]{macd_val}[/red]"

        # Perf 1M visual
        perf_1m = row['Perf.1M']
        perf_str = f"[green]+{perf_1m:.1f}%[/green]" if perf_1m > 0 else f"[red]{perf_1m:.1f}%[/red]"

        table.add_row(
            f"#{rank}",
            row['name'],
            f"{row['close']:.2f}",
            change_str,
            score_str,
            dist_str,
            rsi_str,
            macd_str,
            perf_str,
            f"{row['return_on_equity']:.1f}%",
            str(row['sector'])
        )
        rank += 1

    console.print(table)
    console.print(f"\n[dim]Score based on: Trend (ADX, MACD), Momentum (RSI, Perf.1M), Volume, and 52W Proximity.[/dim]")
    console.print(f"[dim]Filters: Market Cap > 5000Cr | ROE > 10% | Earnings Penalty applied (<3 days)[/dim]")


def display_intraday_3m(df):
    """Display 3-minute upside momentum results."""
    if df.empty:
        console.print("[yellow]No Indian stocks met the 3-minute upside momentum threshold.[/yellow]")
        return

    table = Table(title="⚡ INDIA: TOP UPSIDE MOMENTUM (LAST 3 MINUTES)", style="blue")
    table.add_column("Rank", style="dim", width=4)
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("3m Move %", justify="right")
    table.add_column("Price ₹", justify="right")
    table.add_column("Day Chg %", justify="right")
    table.add_column("Vol Δ", justify="right")
    table.add_column("RVol", justify="right")
    table.add_column("RSI", justify="right")
    table.add_column("ADX", justify="right")
    table.add_column("Sector", style="dim")

    for idx, (_, row) in enumerate(df.head(30).iterrows(), start=1):
        move_3m = f"[bold green]+{row['move_3m_pct']:.2f}%[/bold green]"
        day_change = format_change(row['change'])
        rsi_str = format_rsi(row['RSI'])

        table.add_row(
            f"#{idx}",
            row['name'],
            move_3m,
            f"{row['close']:.2f}",
            day_change,
            f"{int(row['vol_delta']):,}",
            f"{row['relative_volume_10d_calc']:.2f}",
            rsi_str,
            f"{row['ADX']:.1f}",
            str(row['sector']),
        )

    console.print(table)
    console.print("[dim]Method: Snapshot-to-snapshot price change over 180s (approx. last 3 minutes).[/dim]")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Trending Upside Scanner')
    parser.add_argument('--limit', type=int, default=50, help='Number of stocks to display')
    parser.add_argument(
        '--mode',
        choices=['swing', 'intraday-3m'],
        default='swing',
        help='Scan mode: swing (default) or intraday-3m snapshot comparison'
    )
    parser.add_argument(
        '--lookback-seconds',
        type=int,
        default=180,
        help='Lookback window in seconds for intraday-3m mode (default: 180)'
    )
    parser.add_argument(
        '--min-move',
        type=float,
        default=0.2,
        help='Minimum 3-minute upside move percent for intraday-3m mode (default: 0.2)'
    )
    args = parser.parse_args()

    if args.mode == 'intraday-3m':
        with console.status("[bold green]Running 3-minute intraday momentum scan...[/bold green]"):
            df = scan_intraday_3m(
                limit=args.limit,
                lookback_seconds=args.lookback_seconds,
                min_move=args.min_move
            )
        display_intraday_3m(df)
    else:
        with console.status("[bold green]Scanning for trending stocks...[/bold green]"):
            df = fetch_trending_stocks(args.limit)
        display_trending(df)
