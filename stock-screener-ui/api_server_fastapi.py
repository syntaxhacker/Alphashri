#!/usr/bin/env python3
"""
FastAPI server for stock screener UI with auto-reload.
Serves screener data and backtest API as JSON.

Run with: uvicorn api_server_fastapi:app --reload --port 8765
"""
import sys
import os
import math
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

# Add project root and scanners to path
_script_dir = Path(__file__).parent.absolute()
_project_root = _script_dir.parent
_scanners_dir = _project_root / 'scanners'
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_scanners_dir))
sys.path.insert(0, str(_script_dir))

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
import trending_upside

# Import backtest module
from backtest.api import BacktestRequestHandler, handle_get_strategies, handle_get_costs, handle_run_backtest

# Thread pool for parallel API calls
MAX_WORKERS = 10

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
    },
    'intraday_momentum': {
        'section_labels': {'primary': '⚡ INTRADAY MOMENTUM', 'secondary': '✅ TOP MOMENTUM RUNS'},
        'filters': [
            {'key': 'lookback_minutes', 'label': 'Lookback', 'type': 'select', 'options': [5, 10, 15, 30], 'default': 15},
            {'key': 'min_move_pct', 'label': 'Move % ≥', 'type': 'number', 'min': 0, 'max': 20, 'step': 0.1, 'default': 0.5}
        ],
        'default_sort': {'column': 'move_pct', 'direction': 'desc'}
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
        direction = profile_filters.get('direction', 'both')
        wick_pct = _to_float(stock_data.get('wick_close_pct'), 50)
        is_bullish_sentiment = wick_pct >= 60
        is_bearish_sentiment = wick_pct <= 40
        if direction == 'bullish' and not is_bullish_sentiment:
            return False
        if direction == 'bearish' and not is_bearish_sentiment:
            return False
        if _to_float(stock_data.get('score'), 0) < num('min_score', 0):
            return False
        return _to_float(stock_data.get('volume_surge'), 0) >= num('min_vol_surge', 0)
    if screener == 'volatility_trend':
        if _to_float(stock_data.get('atr_pct'), 0) < num('min_atr_pct', 0):
            return False
        if _to_float(stock_data.get('rsi'), 0) < num('min_rsi', 0):
            return False
        trend = profile_filters.get('trend', 'all')
        is_bullish = stock_data.get('is_bullish', False)
        sentiment = stock_data.get('sentiment', '')
        adx = _to_float(stock_data.get('adx'), 0)
        perfw = _to_float(stock_data.get('perf_w'), 0)
        if trend == 'bullish':
            if not is_bullish:
                return False
            if sentiment not in ['bullish', 'lean_bull'] and perfw <= 0:
                return False
        elif trend == 'bearish':
            if is_bullish:
                return False
            if sentiment not in ['bearish', 'lean_bear'] and perfw >= 0:
                return False
        elif trend == 'strong_trend':
            if adx < 25:
                return False
        return True
    if screener == 'nifty50_activity':
        return _to_float(stock_data.get('interest_score'), 0) >= num('min_interest_score', 0)
    if screener == 'near_52w_breakout':
        return _to_float(stock_data.get('to_52w_high'), 100) <= num('max_52w_gap', 100)
    if screener == 'rsi_reversal':
        return _to_float(stock_data.get('rsi'), 100) <= num('max_rsi', 100) and _to_float(stock_data.get('stoch_k'), 0) >= num('min_stoch_k', 0)
    if screener == 'nifty_movers':
        return abs(_to_float(stock_data.get('impact_score'), 0)) >= num('min_impact', 0) and _to_float(stock_data.get('market_cap_b'), 0) >= num('min_cap_b', 0)
    if screener == 'intraday_momentum':
        return abs(_to_float(stock_data.get('move_pct'), 0)) >= num('min_move_pct', 0)
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
    if screener == 'intraday_momentum':
        move = _to_float(stock_data.get('move_pct'), 0)
        lookback = stock_data.get('lookback_minutes', 15)
        return f"Move {move:+.2f}% ({lookback}m) | VolSurge {_to_float(stock_data.get('volume_surge'), 0):.2f}x | RSI {rsi:.1f}"
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

    if screener == 'intraday_momentum':
        max_move = max((_to_float(r.get('move_pct'), 0) for r in rows), default=0.0)
        return [
            {'label': 'Avg Move', 'value': f"{avg('move_pct'):+.2f}%"},
            {'label': 'Max Move', 'value': f"{max_move:+.2f}%"},
            {'label': 'Avg Vol Surge', 'value': f"{avg('volume_surge'):.2f}x"}
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
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import random

    symbol = row_data['name']
    tv_price = row_data['close']

    if tv_price >= 7000:
        return None

    if not use_api:
        try:
            tv_52w_high = float(row_data.get('price_52_week_high', tv_price * 1.1))
            adx = float(row_data.get('ADX', 25))
            atr = float(row_data.get('ATR', tv_price * 0.01))
            perf_w = float(row_data.get('Perf.W', 2))
            change = float(row_data.get('change', 0))
            recent_return = change
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
            to_52w_high = ((tv_52w_high - upstox_price) / tv_52w_high) * 100
            est_days, confidence = estimate_days_to_52w(upstox_price, tv_52w_high, adx, atr, recent_return, perf_w)
            touched_52w = to_52w_high < 0.1
            is_bullish = tv_price >= tv_open

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

    # Full API mode
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
            c_open = _to_float(current_candle.get('open'), c_close)
            is_bullish = c_close >= c_open

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
                'move_pct': 0.0,
                'lookback_minutes': 15,
            }

            # Calculate intraday momentum for intraday_momentum screener
            if screener == 'intraday_momentum':
                lookback_minutes = int(profile_filters.get('lookback_minutes', 15)) if profile_filters else 15
                stock_data['lookback_minutes'] = lookback_minutes
                try:
                    df_5m = api.fetch_intraday_data_v3(symbol=symbol, interval='5')
                    if df_5m is not None and len(df_5m) >= 2:
                        candles_back = max(1, lookback_minutes // 5)
                        if len(df_5m) > candles_back:
                            current = float(df_5m['close'].iloc[-1])
                            past = float(df_5m['close'].iloc[-(candles_back + 1)])
                            move_pct = ((current - past) / past) * 100 if past > 0 else 0.0
                            stock_data['move_pct'] = round(move_pct, 2)
                            stock_data['score'] = min(99, int(
                                abs(move_pct) * 15 +
                                volume_surge * 5 +
                                max(0, _to_float(row_data.get('RSI'), 50) - 50)
                            ))
                except Exception:
                    pass

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
    """Fetch screener data."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    try:
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
        use_api = True
    except ValueError:
        use_api = False

    use_intraday = (mode == 'intraday')
    use_52w_buckets = screener in PROFILES_WITH_52W_BUCKETS

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
    rows_data = [row.to_dict() for _, row in tv_df.iterrows()]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(
                _process_single_stock,
                row_data, screener, use_api, api, use_intraday, use_52w_buckets, profile_filters
            ): row_data
            for row_data in rows_data
        }

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


# Pydantic models for backtest API
class BacktestRunRequest(BaseModel):
    strategy: str = 'orb'
    symbols: List[str]
    params: Dict[str, Any] = {}
    days: int = 90
    include_costs: bool = True


# FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f'🚀 Stock Screener API starting...')
    # Preload instruments at startup
    _load_instruments()
    yield

app = FastAPI(title="Stock Screener API", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount historical sector dashboard static files.
_sector_dashboard_dir = _project_root / 'historical_sector_cycles'
if _sector_dashboard_dir.exists():
    app.mount("/sector", StaticFiles(directory=str(_sector_dashboard_dir), html=True), name="sector_dashboard")


@app.get("/health")
async def health():
    return {'status': 'ok', 'timestamp': datetime.now().isoformat()}


@app.get("/api/screeners")
async def get_screeners():
    return {
        'default': 'trending',
        'screeners': trending_upside.get_screener_profiles(),
        'meta_by_id': PROFILE_META
    }


@app.get("/api/screener")
async def get_screener_data(
    provider: str = Query(default='upstox'),
    mode: str = Query(default='intraday'),
    screener: str = Query(default='trending'),
    trend: Optional[str] = Query(default=None),
    direction: Optional[str] = Query(default=None),
    min_atr_pct: Optional[float] = Query(default=None),
    min_rsi: Optional[float] = Query(default=None),
    min_score: Optional[float] = Query(default=None),
    min_vol_surge: Optional[float] = Query(default=None),
    max_52w_gap: Optional[float] = Query(default=None),
    max_rsi: Optional[float] = Query(default=None),
    min_stoch_k: Optional[float] = Query(default=None),
    min_gap_pct: Optional[float] = Query(default=None),
    min_volume_m: Optional[float] = Query(default=None),
    min_wick_pct: Optional[float] = Query(default=None),
    min_interest_score: Optional[float] = Query(default=None),
    min_impact: Optional[float] = Query(default=None),
    min_cap_b: Optional[float] = Query(default=None),
):
    profile_filters = {}
    if trend is not None:
        profile_filters['trend'] = trend
    if direction is not None:
        profile_filters['direction'] = direction
    if min_atr_pct is not None:
        profile_filters['min_atr_pct'] = min_atr_pct
    if min_rsi is not None:
        profile_filters['min_rsi'] = min_rsi
    if min_score is not None:
        profile_filters['min_score'] = min_score
    if min_vol_surge is not None:
        profile_filters['min_vol_surge'] = min_vol_surge
    if max_52w_gap is not None:
        profile_filters['max_52w_gap'] = max_52w_gap
    if max_rsi is not None:
        profile_filters['max_rsi'] = max_rsi
    if min_stoch_k is not None:
        profile_filters['min_stoch_k'] = min_stoch_k
    if min_gap_pct is not None:
        profile_filters['min_gap_pct'] = min_gap_pct
    if min_volume_m is not None:
        profile_filters['min_volume_m'] = min_volume_m
    if min_wick_pct is not None:
        profile_filters['min_wick_pct'] = min_wick_pct
    if min_interest_score is not None:
        profile_filters['min_interest_score'] = min_interest_score
    if min_impact is not None:
        profile_filters['min_impact'] = min_impact
    if min_cap_b is not None:
        profile_filters['min_cap_b'] = min_cap_b

    data = fetch_screener_data(provider, mode, screener, profile_filters)
    data['applied_profile_filters'] = profile_filters
    return _sanitize_for_json(data)


# Backtest API routes
@app.get("/api/backtest/strategies")
async def get_strategies():
    return handle_get_strategies()


@app.get("/api/backtest/costs")
async def get_costs():
    return handle_get_costs()


@app.get("/api/backtest/progress")
async def get_progress():
    return _backtest_handler.progress_state


@app.post("/api/backtest/run")
async def run_backtest(
    request: BacktestRunRequest,
    include_chart_data: bool = Query(False, description="Include candle/chart data in response (default: False for smaller responses)")
):
    body = request.model_dump()
    _backtest_handler.progress_state['running'] = True
    _backtest_handler.progress_state['current'] = 0
    _backtest_handler.progress_state['total'] = len(body.get('symbols', []))
    _backtest_handler.progress_state['message'] = 'Starting...'

    result = handle_run_backtest(body, _backtest_handler.progress_state)

    if 'error' not in result:
        # Always cache data for chart endpoint
        _backtest_handler.backtest_cache = {
            'candles': result.get('candles', {}),
            'chart_data': result.get('chart_data', {}),
            'config': result.get('config', {}),
            'results': result.get('results', []),
        }

    _backtest_handler.progress_state['running'] = False

    # Build response - exclude large data by default
    response = {
        'strategy': result.get('strategy'),
        'config': result.get('config'),
        'results': result.get('results'),
        'totals': result.get('totals'),
        'skipped_stocks': result.get('skipped_stocks', []),
        'run_time': result.get('run_time'),
    }

    # Only include chart data if explicitly requested
    if include_chart_data:
        # Build full chart data using chart_data module (includes pivot_levels, orb_zones, etc.)
        from backtest.chart_data import build_chart_data_for_symbol
        candles = result.get('candles', {})
        chart_data_raw = result.get('chart_data', {})
        or_minutes = result.get('config', {}).get('params', {}).get('or_minutes', 45)

        full_chart_data = {}
        for symbol, trades_data in chart_data_raw.items():
            if symbol in candles and trades_data.get('trades'):
                full_chart_data[symbol] = build_chart_data_for_symbol(
                    symbol, candles[symbol], trades_data['trades'], or_minutes
                )

        response['candles'] = candles
        response['chart_data'] = full_chart_data

    return _sanitize_for_json(response)


@app.get("/api/backtest/chart/{symbol}")
async def get_chart_data(symbol: str):
    from backtest.chart_data import build_chart_data_for_symbol

    if symbol not in _backtest_handler.backtest_cache.get('candles', {}):
        raise HTTPException(status_code=404, detail=f'No chart data for {symbol}')

    if symbol not in _backtest_handler.backtest_cache.get('chart_data', {}):
        raise HTTPException(status_code=404, detail=f'No trade data for {symbol}')

    try:
        candles_df = _backtest_handler.backtest_cache['candles'][symbol]
        trades = _backtest_handler.backtest_cache['chart_data'][symbol]['trades']
        or_minutes = _backtest_handler.backtest_cache.get('config', {}).get('params', {}).get('or_minutes', 45)

        chart_data = build_chart_data_for_symbol(symbol, candles_df, trades, or_minutes)
        return _sanitize_for_json(chart_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/backtest/results")
async def get_results():
    return {
        'results': _backtest_handler.backtest_cache.get('results', []),
        'config': _backtest_handler.backtest_cache.get('config', {}),
    }


# ============================================
# Symbol Search API
# ============================================

# Cache for instruments (loaded once)
_instruments_cache: List[Dict] = []
_instruments_loaded = False

def _load_instruments():
    """Load NSE instruments from cache file."""
    global _instruments_cache, _instruments_loaded

    if _instruments_loaded:
        return _instruments_cache

    # Try multiple paths for instruments file
    instrument_paths = [
        _project_root / 'upstox_trader' / 'config_and_utils' / 'nse_instruments.json',
        _script_dir / 'nse_instruments.json',
        Path(__file__).parent.parent / 'upstox_trader' / 'config_and_utils' / 'nse_instruments.json',
    ]

    for path in instrument_paths:
        if path.exists():
            try:
                import json
                with open(path, 'r') as f:
                    _instruments_cache = json.load(f)
                _instruments_loaded = True
                print(f"✅ Loaded {len(_instruments_cache)} instruments from {path}")
                return _instruments_cache
            except Exception as e:
                print(f"⚠️ Failed to load instruments from {path}: {e}")

    print("⚠️ No instruments file found. Symbol search will return empty results.")
    _instruments_loaded = True
    return _instruments_cache


@app.get("/api/symbols/search")
async def search_symbols(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results")
):
    """
    Search for stock symbols by trading symbol or company name.
    Returns NSE_EQ stocks only (equity segment).
    """
    instruments = _load_instruments()

    if not instruments:
        return {"results": [], "query": q, "total": 0}

    query_lower = q.lower()

    # Filter NSE_EQ stocks with EQ instrument type
    results = []
    for inst in instruments:
        if inst.get('segment') != 'NSE_EQ' or inst.get('instrument_type') != 'EQ':
            continue

        symbol = inst.get('trading_symbol', '')
        name = inst.get('name', '')

        # Case-insensitive search in symbol and name
        symbol_match = query_lower in symbol.lower()
        name_match = query_lower in name.lower()

        if symbol_match or name_match:
            # Calculate match score (prefix match is better)
            symbol_lower = symbol.lower()
            if symbol_lower.startswith(query_lower):
                score = 100  # Exact prefix match
            elif symbol_lower == query_lower:
                score = 95   # Exact match
            elif symbol_match:
                score = 80   # Contains match
            else:
                score = 50   # Name match

            results.append({
                'symbol': symbol,
                'name': name,
                'isin': inst.get('isin', ''),
                'score': score,
            })

    # Sort by score (descending) then by symbol length (ascending)
    results.sort(key=lambda x: (-x['score'], len(x['symbol'])))

    # Limit results
    results = results[:limit]

    # Remove score from output
    for r in results:
        del r['score']

    return {"results": results, "query": q, "total": len(results)}


# Include paper trading router
try:
    from api.paper_trading import router as paper_trading_router
    app.include_router(paper_trading_router)
    print("✅ Paper trading API loaded at /api/paper")
except Exception as e:
    print(f"⚠️ Could not load paper trading API: {e}")


# ============================================
# News API
# ============================================

# Import news module
_news_module_path = _project_root / 'moneycontrol-scraper'
if str(_news_module_path) not in sys.path:
    sys.path.insert(0, str(_news_module_path))

try:
    from news_api import fetch_news, fetch_article_content, NEWS_SOURCES
    _news_available = True
    print("✅ News API module loaded")
except ImportError as e:
    _news_available = False
    print(f"⚠️ News API module not available: {e}")


@app.get("/api/news")
async def get_news(
    source: str = Query(default='moneycontrol', description="News source identifier"),
    limit: int = Query(default=25, ge=1, le=100, description="Max number of items")
):
    """
    Fetch latest news from specified source.
    Returns list of news items with headline, description, source, and timestamp.
    """
    if not _news_available:
        raise HTTPException(status_code=503, detail="News API not available")

    try:
        news = fetch_news(source=source, limit=limit)
        return {
            'items': news,
            'source': source,
            'total': len(news),
            'fetchedAt': datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/news/article")
async def get_news_article(url: str = Query(..., description="Article URL to fetch")):
    """
    Fetch full content of a specific news article.
    """
    if not _news_available:
        raise HTTPException(status_code=503, detail="News API not available")

    try:
        article = fetch_article_content(url)
        if 'error' in article:
            raise HTTPException(status_code=500, detail=article['error'])
        return article
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/news/sources")
async def get_news_sources():
    """
    Get list of available news sources.
    """
    if not _news_available:
        return {'sources': []}

    return {'sources': NEWS_SOURCES}


if __name__ == '__main__':
    print(f'🚀 Stock Screener FastAPI running on http://localhost:8765')
    print(f'   API docs: http://localhost:8765/docs')
    print(f'   Screener API: http://localhost:8765/api/screener')
    print(f'   Backtest API: http://localhost:8765/api/backtest/strategies')
    print(f'   Paper Trading API: http://localhost:8765/api/paper/portfolio')
    uvicorn.run(app, host="localhost", port=8765, reload=True)
