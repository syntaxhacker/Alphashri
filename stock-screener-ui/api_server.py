#!/usr/bin/env python3
"""
Fast API server for stock screener UI.
Serves screener data as JSON.
"""
import sys
import os
import json
import math
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from concurrent.futures import ThreadPoolExecutor, as_completed

# Add project root and scanners to path
_script_dir = Path(__file__).parent.absolute()
_project_root = _script_dir.parent
_scanners_dir = _project_root / 'scanners'
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_scanners_dir))
sys.path.insert(0, str(_script_dir))  # For backtest module

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
import trending_upside

# Import backtest module
from backtest.api import BacktestRequestHandler

# Thread pool for parallel API calls
MAX_WORKERS = 10  # Concurrent API calls for stock data

# Backtest request handler (global instance for caching)
_backtest_handler = BacktestRequestHandler()

PROFILES_WITH_52W_BUCKETS = {'trending', 'near_52w_breakout'}
PROFILE_META = {
    'trending': {
        'section_labels': {'primary': '🎯 APPROACHING 52W HIGH', 'secondary': '✅ ALREADY TOUCHED 52W HIGH'},
        'filters': [],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'high_momentum': {
        'section_labels': {'primary': '🚀 MOMENTUM CANDIDATES', 'secondary': '✅ STRONGER MOMENTUM SETUPS'},
        'filters': [
            {'key': 'min_rsi', 'label': 'RSI ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 55},
            {'key': 'min_volume_m', 'label': 'Vol M ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.5, 'default': 1}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'buyer_interest': {
        'section_labels': {'primary': '🟢 BUYER INTEREST', 'secondary': '✅ STRONGER BUYER SETUPS'},
        'filters': [
            {'key': 'min_wick_pct', 'label': 'Wick % ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 70},
            {'key': 'min_vol_surge', 'label': 'Vol Surge ≥', 'type': 'number', 'min': 0, 'max': 10, 'step': 0.1, 'default': 1.0}
        ],
        'default_sort': {'column': 'wick_close_pct', 'direction': 'desc'}
    },
    'buyer_interest_enhanced': {
        'section_labels': {'primary': '🟢 BUYER/SELLER INTEREST+', 'secondary': '✅ TOP CONVICTION SETUPS'},
        'filters': [
            {'key': 'direction', 'label': 'Direction', 'type': 'select', 'options': ['both', 'bullish', 'bearish'], 'default': 'both'},
            {'key': 'min_score', 'label': 'Score ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 5, 'default': 50},
            {'key': 'min_vol_surge', 'label': 'Vol Surge ≥', 'type': 'number', 'min': 0, 'max': 10, 'step': 0.1, 'default': 1.0}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'volatility_trend': {
        'section_labels': {'primary': '⚡ VOLATILITY TREND', 'secondary': '✅ HIGH QUALITY VOLATILITY SETUPS'},
        'filters': [
            {'key': 'trend', 'label': 'Trend', 'type': 'select', 'options': ['all', 'bullish', 'bearish', 'strong_trend'], 'default': 'all'},
            {'key': 'min_atr_pct', 'label': 'ATR% ≥', 'type': 'number', 'min': 0, 'max': 20, 'step': 0.1, 'default': 2.0},
            {'key': 'min_rsi', 'label': 'RSI ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 45}
        ],
        'default_sort': {'column': 'atr_pct', 'direction': 'desc'}
    },
    'nifty50_activity': {
        'section_labels': {'primary': '🔥 NIFTY50 ACTIVITY', 'secondary': '✅ MOST ACTIVE NIFTY SETUPS'},
        'filters': [
            {'key': 'min_interest_score', 'label': 'Interest ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 20}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'near_52w_breakout': {
        'section_labels': {'primary': '🎯 NEAR 52W BREAKOUT', 'secondary': '✅ TOUCHED 52W HIGH'},
        'filters': [
            {'key': 'max_52w_gap', 'label': '52W Gap ≤', 'type': 'number', 'min': -5, 'max': 20, 'step': 0.1, 'default': 3}
        ],
        'default_sort': {'column': 'to_52w_high', 'direction': 'asc'}
    },
    'rsi_reversal': {
        'section_labels': {'primary': '🔄 REVERSAL CANDIDATES', 'secondary': '✅ STRONGER REVERSAL SETUPS'},
        'filters': [
            {'key': 'max_rsi', 'label': 'RSI ≤', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 70},
            {'key': 'min_stoch_k', 'label': 'Stoch K ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 0}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'market_open_gap': {
        'section_labels': {'primary': '📈 GAP OPEN CANDIDATES', 'secondary': '✅ LARGER GAP MOVERS'},
        'filters': [
            {'key': 'min_gap_pct', 'label': 'Gap % ≥', 'type': 'number', 'min': 0, 'max': 25, 'step': 0.1, 'default': 1},
            {'key': 'min_volume_m', 'label': 'Vol M ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.5, 'default': 1}
        ],
        'default_sort': {'column': 'gap_pct', 'direction': 'desc'}
    },
    'nifty_movers': {
        'section_labels': {'primary': '📊 NIFTY MOVERS', 'secondary': '✅ HIGHEST IMPACT MOVERS'},
        'filters': [
            {'key': 'min_impact', 'label': 'Impact ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.1, 'default': 1},
            {'key': 'min_cap_b', 'label': 'Cap B ≥', 'type': 'number', 'min': 0, 'max': 5000, 'step': 1, 'default': 50}
        ],
        'default_sort': {'column': 'impact_score', 'direction': 'desc'}
    }
}


def _to_float(value, default=0.0):
    try:
        if value is None:
            return default
        out = float(value)
        if not math.isfinite(out):
            return default
        return out
    except Exception:
        return default


def _sanitize_for_json(obj):
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    return obj


def _profile_meta(screener):
    return PROFILE_META.get(screener, PROFILE_META['trending'])


def _passes_profile_filters(screener, stock_data, profile_filters):
    if not profile_filters:
        return True

    def num(key, default=0.0):
        return _to_float(profile_filters.get(key), default)

    if screener == 'market_open_gap':
        return abs(_to_float(stock_data.get('gap_pct'), 0)) >= num('min_gap_pct', 1) and _to_float(stock_data.get('volume_m'), 0) >= num('min_volume_m', 0)
    if screener == 'high_momentum':
        return _to_float(stock_data.get('rsi'), 0) >= num('min_rsi', 0) and _to_float(stock_data.get('volume_m'), 0) >= num('min_volume_m', 0)
    if screener == 'buyer_interest':
        return _to_float(stock_data.get('wick_close_pct'), 0) >= num('min_wick_pct', 0) and _to_float(stock_data.get('volume_surge'), 0) >= num('min_vol_surge', 0)
    if screener == 'buyer_interest_enhanced':
        # Direction filter based on wick position (where stock closed in day's range)
        # Bullish: wick >= 60% (closed in upper portion = buyers in control)
        # Bearish: wick <= 40% (closed in lower portion = sellers in control)
        direction = profile_filters.get('direction', 'both')
        wick_pct = _to_float(stock_data.get('wick_close_pct'), 50)

        is_bullish_sentiment = wick_pct >= 60
        is_bearish_sentiment = wick_pct <= 40

        if direction == 'bullish' and not is_bullish_sentiment:
            return False
        if direction == 'bearish' and not is_bearish_sentiment:
            return False
        # Score filter
        if _to_float(stock_data.get('score'), 0) < num('min_score', 0):
            return False
        # Volume filter only
        return _to_float(stock_data.get('volume_surge'), 0) >= num('min_vol_surge', 0)
    if screener == 'volatility_trend':
        # Basic ATR% and RSI filters
        if _to_float(stock_data.get('atr_pct'), 0) < num('min_atr_pct', 0):
            return False
        if _to_float(stock_data.get('rsi'), 0) < num('min_rsi', 0):
            return False
        # Trend filter
        trend = profile_filters.get('trend', 'all')
        is_bullish = stock_data.get('is_bullish', False)
        sentiment = stock_data.get('sentiment', '')
        adx = _to_float(stock_data.get('adx'), 0)
        perfw = _to_float(stock_data.get('perf_w'), 0)

        if trend == 'bullish':
            # Bullish: bullish candle AND (bullish sentiment OR positive weekly performance)
            if not is_bullish:
                return False
            if sentiment not in ['bullish', 'lean_bull'] and perfw <= 0:
                return False
        elif trend == 'bearish':
            # Bearish: bearish candle AND (bearish sentiment OR negative weekly performance)
            if is_bullish:
                return False
            if sentiment not in ['bearish', 'lean_bear'] and perfw >= 0:
                return False
        elif trend == 'strong_trend':
            # Strong trend: high ADX (>25) indicates trending market
            if adx < 25:
                return False
        # 'all' passes through
        return True
    if screener == 'nifty50_activity':
        return _to_float(stock_data.get('interest_score'), 0) >= num('min_interest_score', 0)
    if screener == 'near_52w_breakout':
        return _to_float(stock_data.get('to_52w_high'), 100) <= num('max_52w_gap', 100)
    if screener == 'rsi_reversal':
        return _to_float(stock_data.get('rsi'), 100) <= num('max_rsi', 100) and _to_float(stock_data.get('stoch_k'), 0) >= num('min_stoch_k', 0)
    if screener == 'nifty_movers':
        return abs(_to_float(stock_data.get('impact_score'), 0)) >= num('min_impact', 0) and _to_float(stock_data.get('market_cap_b'), 0) >= num('min_cap_b', 0)
    return True


def _build_rationale(screener, stock_data):
    gap = _to_float(stock_data.get('gap_pct'), 0)
    pre = _to_float(stock_data.get('premarket_change'), 0)
    vol = _to_float(stock_data.get('volume_m'), 0)
    rsi = _to_float(stock_data.get('rsi'), 0)
    stoch_k = _to_float(stock_data.get('stoch_k'), 0)
    day = _to_float(stock_data.get('day_change'), 0)
    impact = _to_float(stock_data.get('impact_score'), 0)
    cap_b = _to_float(stock_data.get('market_cap_b'), 0)
    score = _to_float(stock_data.get('score'), 0)
    gap52 = _to_float(stock_data.get('to_52w_high'), 0)
    ret5d = _to_float(stock_data.get('recent_return_5d'), 0)
    perfw = _to_float(stock_data.get('perf_w'), 0)

    if screener == 'market_open_gap':
        return f"Gap {gap:+.2f}% | Pre {pre:+.2f}% | Vol {vol:.2f}M"
    if screener == 'rsi_reversal':
        signal = stock_data.get('reversal_signal') or 'MIXED'
        return f"{signal} reversal | RSI {rsi:.1f} | StochK {stoch_k:.1f} | Day {day:+.2f}%"
    if screener == 'nifty_movers':
        return f"Impact {impact:+.2f} | Cap {cap_b:.1f}B | Day {day:+.2f}%"
    if screener == 'high_momentum':
        return f"Score {int(score)} | RSI {rsi:.1f} | Vol {vol:.2f}M | Day {day:+.2f}%"
    if screener == 'buyer_interest' or screener == 'buyer_interest_enhanced':
        wick = _to_float(stock_data.get('wick_close_pct'), 0)
        surge = _to_float(stock_data.get('volume_surge'), 0)
        return f"Wick {wick:.0f}% | VolSurge {surge:.2f}x | RSI {rsi:.1f} | ADX {_to_float(stock_data.get('adx'), 0):.1f}"
    if screener == 'volatility_trend':
        return f"ATR% {_to_float(stock_data.get('atr_pct'), 0):.2f}% | ADX {_to_float(stock_data.get('adx'), 0):.1f} | RSI {rsi:.1f} | PerfW {perfw:+.1f}%"
    if screener == 'nifty50_activity':
        return f"Interest {_to_float(stock_data.get('interest_score'), 0):.0f} | VolSurge {_to_float(stock_data.get('volume_surge'), 0):.2f}x | RSI {rsi:.1f} | Day {day:+.2f}%"
    return f"Score {int(score)} | 52W gap {gap52:+.2f}% | 5D {ret5d:+.1f}% | PerfW {perfw:+.1f}%"


def _summary_items_for(screener, approaching, touched):
    rows = approaching + touched
    if not rows:
        return []

    def avg(key):
        vals = [_to_float(r.get(key), 0) for r in rows]
        return sum(vals) / len(vals) if vals else 0.0

    if screener == 'market_open_gap':
        gap_up = sum(1 for r in rows if _to_float(r.get('gap_pct'), 0) >= 0)
        gap_down = len(rows) - gap_up
        max_gap = max((_to_float(r.get('gap_pct'), 0) for r in rows), default=0.0)
        return [
            {'label': 'Avg Gap', 'value': f"{avg('gap_pct'):+.2f}%"},
            {'label': 'Max Gap', 'value': f"{max_gap:+.2f}%"},
            {'label': 'Gap Up/Down', 'value': f"{gap_up}/{gap_down}"}
        ]

    if screener == 'rsi_reversal':
        bullish = sum(1 for r in rows if str(r.get('reversal_signal', '')).upper() == 'BULLISH')
        bearish = sum(1 for r in rows if str(r.get('reversal_signal', '')).upper() == 'BEARISH')
        return [
            {'label': 'Bullish', 'value': str(bullish)},
            {'label': 'Bearish', 'value': str(bearish)},
            {'label': 'Avg RSI', 'value': f"{avg('rsi'):.1f}"}
        ]

    if screener == 'nifty_movers':
        net_impact = sum(_to_float(r.get('impact_score'), 0) for r in rows)
        top_sector = '-'
        sector_scores = {}
        for r in rows:
            sector = str(r.get('sector', '-'))
            sector_scores[sector] = sector_scores.get(sector, 0.0) + abs(_to_float(r.get('impact_score'), 0))
        if sector_scores:
            top_sector = max(sector_scores.items(), key=lambda x: x[1])[0]
        return [
            {'label': 'Net Impact', 'value': f"{net_impact:+.2f}"},
            {'label': 'Top Sector', 'value': top_sector},
            {'label': 'Avg Impact', 'value': f"{avg('impact_score'):.2f}"}
        ]

    if screener == 'high_momentum':
        return [
            {'label': 'Avg Score', 'value': f"{avg('score'):.1f}"},
            {'label': 'Avg RSI', 'value': f"{avg('rsi'):.1f}"},
            {'label': 'Avg Vol M', 'value': f"{avg('volume_m'):.2f}"}
        ]

    if screener == 'buyer_interest' or screener == 'buyer_interest_enhanced':
        return [
            {'label': 'Avg Wick', 'value': f"{avg('wick_close_pct'):.1f}%"},
            {'label': 'Avg Vol Surge', 'value': f"{avg('volume_surge'):.2f}x"},
            {'label': 'Avg RSI', 'value': f"{avg('rsi'):.1f}"}
        ]

    if screener == 'volatility_trend':
        return [
            {'label': 'Avg ATR%', 'value': f"{avg('atr_pct'):.2f}%"},
            {'label': 'Avg ADX', 'value': f"{avg('adx'):.1f}"},
            {'label': 'Avg Perf.W', 'value': f"{avg('perf_w'):+.1f}%"}
        ]

    if screener == 'nifty50_activity':
        return [
            {'label': 'Avg Interest', 'value': f"{avg('interest_score'):.1f}"},
            {'label': 'Avg Vol Surge', 'value': f"{avg('volume_surge'):.2f}x"},
            {'label': 'Avg Day %', 'value': f"{avg('day_change'):+.2f}%"}
        ]

    return [
        {'label': 'Avg Score', 'value': f"{avg('score'):.1f}"},
        {'label': 'Avg 52W Gap', 'value': f"{avg('to_52w_high'):+.2f}%"},
        {'label': 'Rows', 'value': str(len(rows))}
    ]


def estimate_days_to_52w(current_price, high_52w, adx, atr, recent_return_5d, perf_w):
    """Estimate days to reach 52-week high based on trend strength and momentum."""
    if current_price >= high_52w:
        return 0, "HIGH"

    gap_pct = ((high_52w - current_price) / current_price) * 100
    if gap_pct > 15:
        return None, None

    momentum_score = (recent_return_5d + perf_w) / 2
    daily_move_pct = (atr / current_price) * 100 if atr > 0 else 0

    trend_multiplier = 1.0
    if adx >= 40:
        trend_multiplier = 1.5
    elif adx >= 25:
        trend_multiplier = 1.2
    elif adx < 20:
        trend_multiplier = 0.7

    if momentum_score > 0:
        daily_gain_pct = max(daily_move_pct * trend_multiplier, (momentum_score / 5) * trend_multiplier)
    else:
        daily_gain_pct = daily_move_pct * trend_multiplier * 0.5

    if daily_gain_pct <= 0.01:
        return None, None

    estimated_days = gap_pct / daily_gain_pct

    confidence = "LOW"
    if adx >= 35 and momentum_score > 2:
        confidence = "HIGH"
    elif adx >= 25 or (momentum_score > 1 and perf_w > 0):
        confidence = "MED"

    return round(estimated_days), confidence


def _process_single_stock(row_data, screener, use_api, api, use_intraday, use_52w_buckets, profile_filters):
    """Process a single stock row and return stock_data or None."""
    symbol = row_data['name']
    tv_price = row_data['close']

    # Skip expensive stocks
    if tv_price >= 7000:
        return None

    # Demo mode - use TradingView data only
    if not use_api:
        try:
            tv_52w_high = float(row_data.get('price_52_week_high', tv_price * 1.1))
            adx = float(row_data.get('ADX', 25))
            atr = float(row_data.get('ATR', tv_price * 0.01))
            perf_w = float(row_data.get('Perf.W', 2))
            change = float(row_data.get('change', 0))
            recent_return = change

            # Simulate broker diff as small random value
            import random
            broker_diff = round(random.uniform(-0.5, 0.5), 2)

            upstox_price = tv_price * (1 + broker_diff / 100)
            tv_open = _to_float(row_data.get('open'), tv_price)
            tv_high = _to_float(row_data.get('high'), max(tv_price, tv_open))
            tv_low = _to_float(row_data.get('low'), min(tv_price, tv_open))
            day_range = tv_high - tv_low
            wick_close_pct = (((tv_price - tv_low) / day_range) * 100) if day_range > 0 else 50.0
            volume_surge = _to_float(row_data.get('relative_volume_10d_calc'), 1.0)
            atr = _to_float(row_data.get('ATR'), 0.0)
            atr_pct = (atr / tv_price * 100) if tv_price > 0 else 0.0
            adx_val = _to_float(row_data.get('ADX'), adx)
            interest_score = _to_float(row_data.get('interest_score'), row_data.get('swing_score', adx))

            # Estimate if near 52W high based on TV data
            to_52w_high = ((tv_52w_high - upstox_price) / tv_52w_high) * 100

            est_days, confidence = estimate_days_to_52w(upstox_price, tv_52w_high, adx, atr, recent_return, perf_w)

            touched_52w = to_52w_high < 0.1

            # Determine if bullish (close > open)
            is_bullish = tv_price >= tv_open

            # Determine sentiment based on wick position
            if wick_close_pct >= 70:
                sentiment = 'bullish'
            elif wick_close_pct >= 55:
                sentiment = 'lean_bull'
            elif wick_close_pct <= 30:
                sentiment = 'bearish'
            elif wick_close_pct <= 45:
                sentiment = 'lean_bear'
            else:
                sentiment = 'neutral'

            stock_data = {
                'symbol': symbol,
                'score': min(99, int(adx + (recent_return if recent_return > 0 else 0) * 2)),
                'tv_price': round(tv_price, 2),
                'upstox_price': round(upstox_price, 2),
                'broker_diff': broker_diff,
                'high_52w': round(tv_52w_high, 2),
                'to_52w_high': round(to_52w_high, 2),
                'recent_return_5d': round(recent_return, 1),
                'perf_w': round(perf_w, 1),
                'sector': str(row_data.get('sector', '-')),
                'touched_52w': touched_52w,
                'day_change': round(_to_float(row_data.get('change'), 0), 2),
                'rsi': round(_to_float(row_data.get('RSI'), 0), 1),
                'stoch_k': round(_to_float(row_data.get('Stoch.K'), 0), 1),
                'wick_close_pct': round(_to_float(wick_close_pct, 50), 1),
                'volume_surge': round(_to_float(volume_surge, 1), 2),
                'atr_pct': round(_to_float(atr_pct, 0), 2),
                'adx': round(_to_float(adx_val, 0), 1),
                'interest_score': round(_to_float(interest_score, 0), 1),
                'gap_pct': round(_to_float(row_data.get('gap'), 0), 2),
                'premarket_change': round(_to_float(row_data.get('premarket_change'), 0), 2),
                'impact_score': round(_to_float(row_data.get('impact_score'), 0), 2),
                'market_cap_b': round(_to_float(row_data.get('market_cap_basic'), 0) / 1_000_000_000, 2),
                'volume_m': round(_to_float(row_data.get('volume'), 0) / 1_000_000, 2),
                'reversal_signal': str(row_data.get('reversal_signal', '')),
                'is_bullish': is_bullish,
                'sentiment': sentiment,
            }
            stock_data['rationale'] = _build_rationale(screener, stock_data)

            if not touched_52w and est_days is not None:
                stock_data['time_to_52w'] = {'days': est_days, 'confidence': confidence}

            if _passes_profile_filters(screener, stock_data, profile_filters):
                return (stock_data, 'touched' if (use_52w_buckets and touched_52w) else 'approaching')
            return None

        except Exception:
            return None

    # Full API mode - requires API client
    instrument_key = api.get_instrument_key(symbol)
    if not instrument_key:
        return ('blacklist', symbol)

    try:
        if use_intraday:
            df_hist = api.fetch_intraday_data_v3(symbol=symbol, interval='1')
            if df_hist is None or df_hist.empty:
                return None
        else:
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - __import__('datetime').timedelta(days=5)).strftime('%Y-%m-%d')
            df_hist = api.fetch_historical_data_v3(
                symbol=symbol, unit='minutes', interval=1,
                to_date=to_date, from_date=from_date
            )

        if df_hist is not None and not df_hist.empty:
            upstox_price = float(df_hist['close'].iloc[-1])
            start_price = float(df_hist['close'].iloc[0])
            current_candle = df_hist.iloc[-1]
            c_high = _to_float(current_candle.get('high'), upstox_price)
            c_low = _to_float(current_candle.get('low'), upstox_price)
            c_close = _to_float(current_candle.get('close'), upstox_price)
            c_range = c_high - c_low
            wick_close_pct = (((c_close - c_low) / c_range) * 100) if c_range > 0 else 50.0
            avg_vol = _to_float(df_hist['volume'].tail(10).mean(), 0)
            cur_vol = _to_float(current_candle.get('volume'), 0)
            volume_surge = (cur_vol / avg_vol) if avg_vol > 0 else 1.0

            diff_pct = ((upstox_price - tv_price) / tv_price) * 100
            recent_return = ((upstox_price - start_price) / start_price) * 100

            tv_52w_high = float(row_data.get('price_52_week_high', 0))
            recent_high = float(df_hist['high'].max())

            high_diff_pct = ((recent_high - upstox_price) / recent_high) * 100

            adx = float(row_data.get('ADX', 0))
            atr = float(row_data.get('ATR', 0))
            atr_pct = (atr / tv_price * 100) if tv_price > 0 else 0.0
            perf_w = float(row_data.get('Perf.W', 0))
            interest_score = _to_float(row_data.get('interest_score'), row_data.get('swing_score', 0))

            est_days, confidence = estimate_days_to_52w(upstox_price, recent_high, adx, atr, recent_return, perf_w)

            touched_52w = False
            if tv_52w_high > 0:
                if recent_high >= tv_52w_high:
                    touched_52w = True
                elif (tv_52w_high - recent_high) / tv_52w_high < 0.001:
                    touched_52w = True

            # Determine if bullish (close > open)
            c_open = _to_float(current_candle.get('open'), c_close)
            is_bullish = c_close >= c_open

            # Determine sentiment based on wick position
            if wick_close_pct >= 70:
                sentiment = 'bullish'
            elif wick_close_pct >= 55:
                sentiment = 'lean_bull'
            elif wick_close_pct <= 30:
                sentiment = 'bearish'
            elif wick_close_pct <= 45:
                sentiment = 'lean_bear'
            else:
                sentiment = 'neutral'

            stock_data = {
                'symbol': symbol,
                'score': int(row_data.get('swing_score', 0)),
                'tv_price': round(tv_price, 2),
                'upstox_price': round(upstox_price, 2),
                'broker_diff': round(diff_pct, 2),
                'high_52w': round(tv_52w_high, 2),
                'to_52w_high': round(high_diff_pct, 2),
                'recent_return_5d': round(recent_return, 1),
                'perf_w': round(perf_w, 1),
                'sector': str(row_data.get('sector', '-')),
                'touched_52w': touched_52w,
                'day_change': round(_to_float(row_data.get('change'), 0), 2),
                'rsi': round(_to_float(row_data.get('RSI'), 0), 1),
                'stoch_k': round(_to_float(row_data.get('Stoch.K'), 0), 1),
                'wick_close_pct': round(_to_float(wick_close_pct, 50), 1),
                'volume_surge': round(_to_float(volume_surge, 1), 2),
                'atr_pct': round(_to_float(atr_pct, 0), 2),
                'adx': round(_to_float(adx, 0), 1),
                'interest_score': round(_to_float(interest_score, 0), 1),
                'gap_pct': round(_to_float(row_data.get('gap'), 0), 2),
                'premarket_change': round(_to_float(row_data.get('premarket_change'), 0), 2),
                'impact_score': round(_to_float(row_data.get('impact_score'), 0), 2),
                'market_cap_b': round(_to_float(row_data.get('market_cap_basic'), 0) / 1_000_000_000, 2),
                'volume_m': round(_to_float(row_data.get('volume'), 0) / 1_000_000, 2),
                'reversal_signal': str(row_data.get('reversal_signal', '')),
                'is_bullish': is_bullish,
                'sentiment': sentiment,
            }
            stock_data['rationale'] = _build_rationale(screener, stock_data)

            if not touched_52w and est_days is not None:
                stock_data['time_to_52w'] = {'days': est_days, 'confidence': confidence}

            if _passes_profile_filters(screener, stock_data, profile_filters):
                return (stock_data, 'touched' if (use_52w_buckets and touched_52w) else 'approaching')
            return None

    except Exception:
        return None

    return None


def fetch_screener_data(provider='upstox', mode='historical', screener='trending', profile_filters=None):
    """Fetch screener data - similar to verify_stocks() but returns JSON."""
    # Try to get API client, fall back to demo mode if config missing
    try:
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
        use_api = True
    except ValueError:
        # No config - use demo mode with TradingView data only
        use_api = False

    use_intraday = (mode == 'intraday')
    use_52w_buckets = screener in PROFILES_WITH_52W_BUCKETS

    # Note: v3 intraday/historical APIs don't require authentication
    # Auth is only needed for trading operations, not market data

    tv_df = trending_upside.fetch_trending_stocks(limit=120, profile=screener)
    if tv_df.empty:
        return {
            'approaching': [],
            'touched': [],
            'last_updated': datetime.now().isoformat(),
            'provider': provider,
            'mode': mode,
            'screener': screener,
            'profile_meta': _profile_meta(screener),
            'summary': []
        }

    approaching = []
    touched = []
    blacklisted_symbols = set()

    # Prepare row data for parallel processing
    rows_data = [row.to_dict() for _, row in tv_df.iterrows()]

    # Process stocks in parallel using ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all tasks
        futures = {
            executor.submit(
                _process_single_stock,
                row_data, screener, use_api, api, use_intraday, use_52w_buckets, profile_filters
            ): row_data
            for row_data in rows_data
        }

        # Collect results as they complete
        for future in as_completed(futures):
            try:
                result = future.result()
                if result is None:
                    continue
                elif isinstance(result, tuple):
                    if result[0] == 'blacklist':
                        blacklisted_symbols.add(result[1])
                    elif result[1] == 'touched':
                        touched.append(result[0])
                    elif result[1] == 'approaching':
                        approaching.append(result[0])
            except Exception:
                pass

    return {
        'approaching': approaching,
        'touched': touched,
        'last_updated': datetime.now().isoformat(),
        'provider': provider,
        'mode': mode,
        'screener': screener,
        'profile_meta': _profile_meta(screener),
        'summary': _summary_items_for(screener, approaching, touched),
        'demo_mode': not use_api
    }


class ScreenerHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        path = parsed.path.rstrip('/')

        # Backtest API routes
        if path.startswith('/api/backtest'):
            response = _backtest_handler.handle_request('GET', path, params)
            self.send_json(response)
            return

        if parsed.path == '/api/screener':
            provider = params.get('provider', ['upstox'])[0]
            mode = params.get('mode', ['intraday'])[0]
            screener = params.get('screener', ['trending'])[0]
            # Accept filters with pf_ prefix OR direct filter names (for convenience)
            profile_filters = {k[3:]: v[0] for k, v in params.items() if k.startswith('pf_')}
            # Also accept direct filter names like 'trend', 'direction', etc.
            direct_filter_keys = ['trend', 'direction', 'min_atr_pct', 'min_rsi', 'min_score', 'min_vol_surge', 'max_52w_gap', 'max_rsi', 'min_stoch_k', 'min_gap_pct', 'min_volume_m', 'min_wick_pct', 'min_interest_score', 'min_impact', 'min_cap_b']
            for key in direct_filter_keys:
                if key in params and key not in profile_filters:
                    profile_filters[key] = params[key][0]

            # Fetch new data (no caching)
            data = fetch_screener_data(provider, mode, screener, profile_filters)
            data['applied_profile_filters'] = profile_filters

            self.send_json(data)
        elif parsed.path == '/api/screeners':
            self.send_json({
                'default': 'trending',
                'screeners': trending_upside.get_screener_profiles(),
                'meta_by_id': PROFILE_META
            })

        elif parsed.path == '/health':
            self.send_json({'status': 'ok', 'timestamp': datetime.now().isoformat()})

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not Found')

    def do_OPTIONS(self):
        """Handle OPTIONS preflight requests for CORS."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        """Handle POST requests."""
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # Only handle backtest routes
        if not path.startswith('/api/backtest'):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not Found')
            return

        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body_data = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'

        try:
            body = json.loads(body_data)
        except json.JSONDecodeError:
            self.send_json({'error': 'Invalid JSON body'})
            return

        # Handle backtest request
        response = _backtest_handler.handle_request('POST', path, {}, body)
        self.send_json(response)

    def send_json(self, data):
        try:
            safe_data = _sanitize_for_json(data)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(safe_data, allow_nan=False).encode())
        except BrokenPipeError:
            # Client closed connection before response was sent (e.g., switched screeners)
            pass
        except ConnectionResetError:
            # Client reset the connection
            pass

    def log_message(self, format, *args):
        pass  # Silence logs


def run_server(port=8765):
    server = HTTPServer(('localhost', port), ScreenerHandler)
    print(f'🚀 Stock Screener API running on http://localhost:{port}')
    print(f'   Screener API: http://localhost:{port}/api/screener')
    print(f'   Backtest API: http://localhost:{port}/api/backtest/strategies')
    print(f'   UI should be served from: bun run dev')
    server.serve_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    run_server(args.port)
