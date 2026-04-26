from typing import Optional, List, Dict, Tuple
from tradingview_screener import Query, col
import pandas as pd
import numpy as np

from .constants import QueryConfig
from .utils import (
    apply_market_cap_filter,
    apply_price_filter,
    build_market_aware_query,
    create_base_query
)


def get_watch_data_fomo(self, market_cap_filter=None, max_price=None, min_price=None) -> pd.DataFrame:
    """FOMO mode query - Original high volume breakouts"""
    base_query = create_base_query(QueryConfig.FOMO_FIELDS, self.market)
    query = build_market_aware_query(base_query, self.market, 'fomo')
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    query = apply_price_filter(query, max_price, min_price)
    
    total_rows, df = (
        query
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(QueryConfig.DEFAULT_LIMIT)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_accumulation(self, market_cap_filter=None, max_price=None, min_price=None) -> pd.DataFrame:
    """Accumulation mode query - Stocks in accumulation patterns"""
    query = (
        Query()
        .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'EMA20', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 50,
            col('volume') > 200000,
            col('relative_volume_10d_calc').between(0.8, 1.8),
            col('RSI').between(40, 65),
            col('close') > col('EMA20'),
            col('market_cap_basic') > 5e8,
            col('exchange') == 'NSE'
        )
    )
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    query = apply_price_filter(query, max_price, min_price)
    
    total_rows, df = (
        query
        .order_by('RSI', ascending=False)
        .limit(25)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_smart_fomo(self, market_cap_filter=None, max_price=None, min_price=None) -> pd.DataFrame:
    """Smart FOMO mode - Enhanced with historical upside potential filtering"""
    query = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'market_cap_basic', 'price_52_week_high',
                'Perf.W', 'Perf.3M', 'EMA20', 'EMA50', 'MACD.macd', 'MACD.signal', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 50,
            col('volume') > 500000,
            col('relative_volume_10d_calc') > 2.0,
            (col('change').between(1, 8) | col('change').between(-8, -1)),
            col('RSI').between(40, 75),
            col('market_cap_basic') > 1e9,
            col('exchange') == 'NSE',
            col('Perf.W') < 15,
            col('Perf.3M') < 50,
            col('close') > col('EMA20'),
            col('EMA20') > col('EMA50')
        )
    )
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    query = apply_price_filter(query, max_price, min_price)
    
    total_rows, df = (
        query
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(30)
        .get_scanner_data(cookies=self.cookies)
    )
    
    if not df.empty:
        smart_fomo_stocks = []
        for _, row in df.iterrows():
            symbol = row.get('ticker', '') or row.get('name', '')
            if hasattr(self, '_check_historical_upside') and self._check_historical_upside(symbol, row.get('close', 0)):
                smart_fomo_stocks.append(row)
        
        if smart_fomo_stocks:
            df = pd.DataFrame(smart_fomo_stocks).head(25)
        else:
            df = pd.DataFrame()
    
    return df


def get_watch_data_momentum(self, market_cap_filter=None, max_price=None, min_price=None) -> pd.DataFrame:
    """Momentum mode - Early momentum detection"""
    query = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 30,
            col('volume') > 100000,
            col('relative_volume_10d_calc').between(1.1, 2.5),
            col('change').between(0.5, 4),
            col('RSI') > col('RSI[1]'),
            col('RSI').between(35, 70),
            col('MACD.macd') > col('MACD.signal'),
            col('market_cap_basic') > 2e8,
            col('exchange') == 'NSE'
        )
    )
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    query = apply_price_filter(query, max_price, min_price)
    
    total_rows, df = (
        query
        .order_by('change', ascending=False)
        .limit(25)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_optimized_gap(self) -> pd.DataFrame:
    """Optimized Gap mode - 15-minute proven strategy"""
    total_rows, df = (
        Query()
        .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'Volatility.D', 'price_52_week_high', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 50,
            col('change') > 1,
            col('change') < 15,
            col('volume') > 500000,
            col('relative_volume_10d_calc') > 2.0,
            col('RSI') < 85,
            col('RSI') > 25,
            col('exchange') == 'NSE',
            col('market_cap_basic') > 2e8,
            col('Volatility.D') < 0.08,
            col('price_52_week_high') > col('close')
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(20)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_heavy_breakout(self) -> pd.DataFrame:
    """Heavy Breakout mode - Stocks ready for channel analysis"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'open', 'high', 'low', 'volume', 'change',
                'relative_volume_10d_calc', 'RSI', 'Volatility.D', 'ATR',
                'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 100,
            col('volume') > 300000,
            col('relative_volume_10d_calc') > 0.8,
            col('market_cap_basic') > 5e8,
            col('Volatility.D') > 0.015,
            col('ATR') > 2,
            col('RSI').between(35, 75),
            col('exchange') == 'NSE'
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(30)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_scalping(self) -> pd.DataFrame:
    """Scalping mode - Ultra-fast 1-3% moves with high liquidity"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'ATR', 'BB.upper', 'BB.lower', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 50,
            col('volume') > 1000000,
            col('market_cap_basic') > 10e8,
            col('relative_volume_10d_calc') > 0.8,
            col('Volatility.D') > 0.015,
            col('ATR') > 2,
            col('exchange') == 'NSE'
        )
        .order_by('volume', ascending=False)
        .limit(15)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_momentum_scalper(self) -> pd.DataFrame:
    """Momentum Scalper mode - Second-level delta detection"""
    total_rows, df_candidates = (
        Query()
        .select('name', 'ticker', 'close', 'open', 'volume', 'change', 'change_abs', 'relative_volume_10d_calc',
                'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'MACD.hist', 'Mom',
                'Volatility.D', 'ATR', 'BB.upper', 'BB.lower', 'EMA20', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 100,
            col('volume') > 2000000,
            col('market_cap_basic') > 20e8,
            col('relative_volume_10d_calc') > 1.0,
            col('change_abs') > 0.5,
            col('Volatility.D') > 0.02,
            col('ATR') > 3,
            col('RSI').between(35, 85),
            col('MACD.hist') > -5,
            col('exchange') == 'NSE'
        )
        .order_by('change_abs', ascending=False)
        .limit(20)
        .get_scanner_data(cookies=self.cookies)
    )
    return df_candidates


def get_watch_data_sector_scalper(self) -> pd.DataFrame:
    """Sector Scalper mode - Correlation catch-up opportunities"""
    total_rows, df_all = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'change_abs', 'relative_volume_10d_calc',
                'RSI', 'sector', 'industry', 'market_cap_basic', 'Perf.W', 'Perf.3M', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 50,
            col('volume') > 500000,
            col('market_cap_basic') > 5e8,
            col('relative_volume_10d_calc') > 0.8,
            col('change_abs') > 0.3,
            col('exchange') == 'NSE'
        )
        .order_by('change_abs', ascending=False)
        .limit(200)
        .get_scanner_data(cookies=self.cookies)
    )
    return df_all


def get_watch_data_short_squeeze(self) -> pd.DataFrame:
    """Short Squeeze mode - Over-shorted stocks ready to explode"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'RSI[1]', 'Perf.W', 'Perf.3M', 'price_52_week_low',
                'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 30,
            col('volume') > 1000000,
            col('market_cap_basic') > 3e8,
            col('relative_volume_10d_calc') > 2.0,
            col('RSI') < 35,
            col('RSI') > col('RSI[1]'),
            col('Perf.W') < -5,
            col('Perf.3M') < -15,
            col('exchange') == 'NSE'
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(15)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_breakout_failure(self) -> pd.DataFrame:
    """Breakout Failure mode - Short failed breakouts"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'high', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'price_52_week_high', 'BB.upper', 'MACD.macd', 'MACD.signal',
                'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 100,
            col('volume') > 800000,
            col('market_cap_basic') > 10e8,
            col('relative_volume_10d_calc') > 1.5,
            col('RSI') > 70,
            col('change') > 2,
            col('high') > col('BB.upper'),
            col('MACD.macd') < col('MACD.signal'),
            col('exchange') == 'NSE'
        )
        .order_by('RSI', ascending=False)
        .limit(12)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_exhaustion_reversal(self) -> pd.DataFrame:
    """Exhaustion Reversal mode - Short momentum exhaustion"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Perf.W', 'Perf.3M', 'Volatility.D', 'price_52_week_high',
                'BB.upper', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 150,
            col('volume') > 500000,
            col('market_cap_basic') > 5e8,
            col('relative_volume_10d_calc') > 1.2,
            col('RSI') > 80,
            col('Perf.W') > 10,
            col('Perf.3M') > 20,
            col('Volatility.D') > 0.04,
            col('close') > (col('price_52_week_high') - (col('price_52_week_high') * 0.05)),
            col('exchange') == 'NSE'
        )
        .order_by('RSI', ascending=False)
        .limit(10)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_morning_fade(self) -> pd.DataFrame:
    """Morning Fade mode - Short gap-ups that fail to hold"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'open', 'high', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'premarket_change', 'gap', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 80,
            col('volume') > 600000,
            col('market_cap_basic') > 5e8,
            col('relative_volume_10d_calc') > 1.3,
            col('gap') > 2,
            col('change') < (col('gap') - 1.0),
            col('RSI') > 65,
            col('high') < col('open') + (col('open') * 0.03),
            col('exchange') == 'NSE'
        )
        .order_by('gap', ascending=False)
        .limit(12)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_reversal(self) -> pd.DataFrame:
    """Reversal mode - Counter-trend opportunities"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Stoch.K', 'BB.upper', 'BB.lower', 'price_52_week_high',
                'price_52_week_low', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 75,
            col('volume') > 400000,
            col('market_cap_basic') > 3e8,
            col('relative_volume_10d_calc') > 1.0,
            (col('RSI') > 75) | (col('RSI') < 25),
            col('exchange') == 'NSE'
        )
        .order_by('RSI', ascending=True)
        .limit(20)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_volume_surge(self) -> pd.DataFrame:
    """Volume Surge mode - Unusual activity detector"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'average_volume_10d_calc', 'RSI', 'MACD.macd', 'MACD.signal',
                'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 40,
            col('volume') > 200000,
            col('market_cap_basic') > 1e8,
            col('relative_volume_10d_calc') > 3.0,
            col('change').between(-15, 15),
            col('exchange') == 'NSE'
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(25)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_channel_play(self) -> pd.DataFrame:
    """Channel Play mode - Range-bound trading opportunities"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'BB.upper', 'BB.lower', 'EMA20', 'EMA50', 'Volatility.D',
                'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 60,
            col('volume') > 300000,
            col('market_cap_basic') > 2e8,
            col('relative_volume_10d_calc').between(0.7, 2.0),
            col('RSI').between(30, 70),
            col('Volatility.D').between(0.02, 0.06),
            col('change').between(-3, 3),
            col('exchange') == 'NSE'
        )
        .order_by('volume', ascending=False)
        .limit(20)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_sector_momentum(self) -> pd.DataFrame:
    """Sector Momentum mode - Industry group moves"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Perf.W', 'Perf.3M', 'sector', 'industry', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 50,
            col('volume') > 250000,
            col('market_cap_basic') > 2e8,
            col('relative_volume_10d_calc') > 1.1,
            col('RSI') > 50,
            col('Perf.W') > 2,
            col('change') > 0.5,
            col('exchange') == 'NSE'
        )
        .order_by('Perf.W', ascending=False)
        .limit(25)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_quick_profit(self) -> pd.DataFrame:
    """Quick Profit mode - 1-2% fast scalps"""
    total_rows, df = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'MACD.macd', 'MACD.signal', 'EMA20', 'Volatility.D',
                'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 40,
            col('volume') > 800000,
            col('market_cap_basic') > 5e8,
            col('relative_volume_10d_calc') > 1.3,
            col('RSI').between(45, 75),
            col('change').between(0.5, 4),
            col('Volatility.D') > 0.02,
            col('exchange') == 'NSE'
        )
        .order_by('change', ascending=False)
        .limit(15)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_fomo_momentum(self, market_cap_filter=None, max_price=None, min_price=None) -> pd.DataFrame:
    """FOMO Momentum mode - Gap & intraday 0.8-6% momentum"""
    base_query = create_base_query(QueryConfig.MOMENTUM_FIELDS, self.market)
    query = build_market_aware_query(base_query, self.market, 'fomo_momentum', custom_min_price=min_price, custom_max_price=max_price)
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    
    total_rows, df = (
        query
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(QueryConfig.DEFAULT_LIMIT)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_realtime_momentum(self, market_cap_filter=None) -> pd.DataFrame:
    """Realtime Momentum mode - Live 1min/3min price action"""
    base_query = create_base_query(QueryConfig.REALTIME_MOMENTUM_FIELDS, self.market)
    query = build_market_aware_query(base_query, self.market, 'realtime_momentum')
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    
    total_rows, df = (
        query
        .order_by('Volatility.D', ascending=False)
        .limit(QueryConfig.REALTIME_LIMIT)
        .get_scanner_data(cookies=self.cookies)
    )
    return df


def get_watch_data_prebreakout(self, market_cap_filter=None, max_price=None, min_price=None) -> pd.DataFrame:
    """Pre-breakout default mode"""
    query = (
        Query()
        .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'RSI[1]', 'EMA20', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
        .set_markets(self.market)
        .where(
            col('close') > 30,
            col('volume') > 100000,
            col('market_cap_basic') > 2e8,
            col('relative_volume_10d_calc').between(0.8, 3.0),
            col('RSI').between(35, 75),
            col('change').between(-3, 6),
            col('exchange') == 'NSE'
        )
    )
    
    if market_cap_filter:
        query = apply_market_cap_filter(query, market_cap_filter)
    query = apply_price_filter(query, max_price, min_price)
    
    total_rows, df = (
        query
        .order_by('RSI', ascending=False)
        .limit(25)
        .get_scanner_data(cookies=self.cookies)
    )
    return df
