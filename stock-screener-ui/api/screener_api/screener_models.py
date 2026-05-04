import math
from typing import Optional, Dict, Any, List


MAX_WORKERS = 10

PROFILES_WITH_52W_BUCKETS = {'trending', 'near_52w_breakout', 'touched_52w_high'}

PROFILE_META = {
    'trending': {
        'section_labels': {'primary': '🎯 APPROACHING 52W HIGH', 'secondary': '✅ ALREADY TOUCHED 52W HIGH'},
        'filters': [],
        'default_sort': {'column': 'to_52w_high', 'direction': 'asc'}
    },
    'high_momentum': {
        'section_labels': {'primary': '🚀 MOMENTUM CANDIDATES', 'secondary': '✅ STRONGER MOMENTUM SETUPS'},
        'filters': [
            {'key': 'rsi_range', 'label': 'RSI Range', 'type': 'range', 'min': 0, 'max': 100, 'step': 1, 'rangeDefault': [30, 80]},
            {'key': 'min_volume_m', 'label': 'Vol M ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.5, 'default': 1}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'}
    },
    'buyer_interest': {
        'section_labels': {'primary': '🟢 BUYER INTEREST', 'secondary': '✅ STRONGER BUYER SETUPS'},
        'filters': [
            {'key': 'wick_pct_range', 'label': 'Wick % Range', 'type': 'range', 'min': 0, 'max': 100, 'step': 1, 'rangeDefault': [50, 100]},
            {'key': 'min_vol_surge', 'label': 'Vol Surge ≥', 'type': 'number', 'min': 0, 'max': 10, 'step': 0.1, 'default': 1.0}
        ],
        'default_sort': {'column': 'wick_close_pct', 'direction': 'desc'}
    },
    'buyer_interest_enhanced': {
        'section_labels': {'primary': '🟢 BUYER/SELLER INTEREST+', 'secondary': '✅ TOP CONVICTION SETUPS'},
        'filters': [
            {'key': 'direction', 'label': 'Direction', 'type': 'select', 'options': ['both', 'bullish', 'bearish'], 'default': 'both'},
            {'key': 'score_range', 'label': 'Score Range', 'type': 'range', 'min': 0, 'max': 100, 'step': 5, 'rangeDefault': [40, 100]},
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
    'touched_52w_high': {
        'section_labels': {'primary': '✅ ALREADY TOUCHED 52W', 'secondary': '📈 AT 52-WEEK HIGH'},
        'filters': [],
        'default_sort': {'column': 'days_ago', 'direction': 'asc'}
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
