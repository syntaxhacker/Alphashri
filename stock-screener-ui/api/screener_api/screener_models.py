import math
from typing import Optional, Dict, Any, List


MAX_WORKERS = 10

PROFILES_WITH_52W_BUCKETS = {'trending', 'near_52w_breakout', 'touched_52w_high'}

PROFILE_META = {
    'trending': {
        'section_labels': {'primary': '🎯 APPROACHING 52W HIGH', 'secondary': '✅ ALREADY TOUCHED 52W HIGH'},
        'section_descriptions': {'primary': 'Stocks nearing their 52-week high with strong momentum and volume confirmation', 'secondary': 'Stocks that have touched or broken out of their 52-week high'},
        'filters': [],
        'default_sort': {'column': 'to_52w_high', 'direction': 'asc'},
        'score_formula': 'RSI (30pts) + ADX (20pts) + RVOL (20pts) + 52W distance (30pts) + MACD cross (10pts) + 1M perf (10pts)'
    },
    'high_momentum': {
        'section_labels': {'primary': '🚀 MOMENTUM CANDIDATES', 'secondary': '✅ STRONGER MOMENTUM SETUPS'},
        'section_descriptions': {'primary': 'Stocks with strong RSI, MACD and volume momentum signals', 'secondary': 'High-conviction momentum setups with the highest composite scores'},
        'filters': [
            {'key': 'rsi_range', 'label': 'RSI Range', 'type': 'range', 'min': 0, 'max': 100, 'step': 1, 'rangeDefault': [30, 80]},
            {'key': 'min_volume_m', 'label': 'Vol M ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.5, 'default': 1}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'},
        'score_formula': 'RSI tier + MACD signal cross + RSI rising + Volume tier + Change bonus + RSI sweet spot bonus'
    },
    'buyer_interest': {
        'section_labels': {'primary': '🟢 BUYER INTEREST', 'secondary': '✅ STRONGER BUYER SETUPS'},
        'section_descriptions': {'primary': 'Stocks showing aggressive buyer interest identified by wick close and volume surge patterns', 'secondary': 'Top buyer conviction setups with the strongest combined signals'},
        'filters': [
            {'key': 'wick_pct_range', 'label': 'Wick % Range', 'type': 'range', 'min': 0, 'max': 100, 'step': 1, 'rangeDefault': [50, 100]},
            {'key': 'min_vol_surge', 'label': 'Vol Surge ≥', 'type': 'number', 'min': 0, 'max': 10, 'step': 0.1, 'default': 1.0}
        ],
        'default_sort': {'column': 'wick_close_pct', 'direction': 'desc'},
        'score_formula': 'Wick/Close × 0.55 + Vol Surge × 12 + ADX × 0.5 + Price Change × 1.2'
    },
    'buyer_interest_enhanced': {
        'section_labels': {'primary': '🟢 BUYER/SELLER INTEREST+', 'secondary': '✅ TOP CONVICTION SETUPS'},
        'section_descriptions': {'primary': 'Enhanced detection of buyer and seller interest with directional filtering', 'secondary': 'Highest conviction setups combining buyer and seller strength signals'},
        'filters': [
            {'key': 'direction', 'label': 'Direction', 'type': 'select', 'options': ['both', 'bullish', 'bearish'], 'default': 'both'},
            {'key': 'score_range', 'label': 'Score Range', 'type': 'range', 'min': 0, 'max': 100, 'step': 5, 'rangeDefault': [40, 100]},
            {'key': 'min_vol_surge', 'label': 'Vol Surge ≥', 'type': 'number', 'min': 0, 'max': 10, 'step': 0.1, 'default': 1.0}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'},
        'score_formula': 'Buyer/Base score + Pattern signal adjustment + Gap boost'
    },
    'volatility_trend': {
        'section_labels': {'primary': '⚡ VOLATILITY TREND', 'secondary': '✅ HIGH QUALITY VOLATILITY SETUPS'},
        'section_descriptions': {'primary': 'High ATR stocks with strong trending behavior and volume confirmation', 'secondary': 'Best volatility-based setups with trend alignment and quality filters'},
        'filters': [
            {'key': 'trend', 'label': 'Trend', 'type': 'select', 'options': ['all', 'bullish', 'bearish', 'strong_trend'], 'default': 'all'},
            {'key': 'min_atr_pct', 'label': 'ATR% ≥', 'type': 'number', 'min': 0, 'max': 20, 'step': 0.1, 'default': 2.0},
            {'key': 'min_rsi', 'label': 'RSI ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 45}
        ],
        'default_sort': {'column': 'atr_pct', 'direction': 'desc'},
        'score_formula': 'ATR% + Trend strength + RSI + Volume confirmation + Bollinger squeeze'
    },
    'nifty50_activity': {
        'section_labels': {'primary': '🔥 NIFTY50 ACTIVITY', 'secondary': '✅ MOST ACTIVE NIFTY SETUPS'},
        'section_descriptions': {'primary': 'Most active Nifty 50 stocks ranked by interest score and market activity', 'secondary': 'Nifty 50 stocks with the strongest activity and interest signals'},
        'filters': [
            {'key': 'min_interest_score', 'label': 'Interest ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 20}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'},
        'score_formula': 'Volume score + Price change score + ATR contribution + Relative strength'
    },
    'near_52w_breakout': {
        'section_labels': {'primary': '🎯 NEAR 52W BREAKOUT', 'secondary': '✅ TOUCHED 52W HIGH'},
        'section_descriptions': {'primary': 'Stocks within striking distance of their 52-week high with breakout potential', 'secondary': 'Stocks that have successfully broken out to new 52-week highs'},
        'filters': [
            {'key': 'max_52w_gap', 'label': '52W Gap ≤', 'type': 'number', 'min': -5, 'max': 20, 'step': 0.1, 'default': 3}
        ],
        'default_sort': {'column': 'to_52w_high', 'direction': 'asc'},
        'score_formula': '52W proximity + Volume surge + RSI momentum + ADX trend strength'
    },
    'touched_52w_high': {
        'section_labels': {'primary': '✅ ALREADY TOUCHED 52W', 'secondary': '📈 AT 52-WEEK HIGH'},
        'section_descriptions': {'primary': 'Stocks that have recently touched or crossed their 52-week high', 'secondary': 'Stocks currently trading at or very near their 52-week high'},
        'filters': [],
        'default_sort': {'column': 'days_ago', 'direction': 'asc'},
        'score_formula': 'Return 5D + Volume surge + RSI momentum + Days since touched recency'
    },
    'rsi_reversal': {
        'section_labels': {'primary': '🔄 REVERSAL CANDIDATES', 'secondary': '✅ STRONGER REVERSAL SETUPS'},
        'section_descriptions': {'primary': 'Oversold or overbought stocks showing potential reversal patterns via RSI and stochastic', 'secondary': 'Reversal candidates with the strongest technical confirmation signals'},
        'filters': [
            {'key': 'max_rsi', 'label': 'RSI ≤', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 70},
            {'key': 'min_stoch_k', 'label': 'Stoch K ≥', 'type': 'number', 'min': 0, 'max': 100, 'step': 1, 'default': 0}
        ],
        'default_sort': {'column': 'score', 'direction': 'desc'},
        'score_formula': 'RSI reversal + Stochastic crossover + Volume divergence + Price change'
    },
    'market_open_gap': {
        'section_labels': {'primary': '📈 GAP OPEN CANDIDATES', 'secondary': '✅ LARGER GAP MOVERS'},
        'section_descriptions': {'primary': 'Stocks with significant gap-up or gap-down openings in the current session', 'secondary': 'Top gap movers ranked by gap percentage and volume confirmation'},
        'filters': [
            {'key': 'min_gap_pct', 'label': 'Gap % ≥', 'type': 'number', 'min': 0, 'max': 25, 'step': 0.1, 'default': 1},
            {'key': 'min_volume_m', 'label': 'Vol M ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.5, 'default': 1}
        ],
        'default_sort': {'column': 'gap_pct', 'direction': 'desc'},
        'score_formula': 'Gap% + Premarket volume + Premarket change intensity + Gap direction'
    },
    'nifty_movers': {
        'section_labels': {'primary': '📊 NIFTY MOVERS', 'secondary': '✅ HIGHEST IMPACT MOVERS'},
        'section_descriptions': {'primary': 'Stocks with the highest impact on Nifty index movement sorted by impact score', 'secondary': 'Nifty movers with the strongest index impact and market capitalization'},
        'filters': [
            {'key': 'min_impact', 'label': 'Impact ≥', 'type': 'number', 'min': 0, 'max': 200, 'step': 0.1, 'default': 1},
            {'key': 'min_cap_b', 'label': 'Cap B ≥', 'type': 'number', 'min': 0, 'max': 5000, 'step': 1, 'default': 50}
        ],
        'default_sort': {'column': 'impact_score', 'direction': 'desc'},
        'score_formula': 'Impact score + Price change + Market cap weight + Volume intensity'
    },
    'intraday_momentum': {
        'section_labels': {'primary': '⚡ INTRADAY MOMENTUM', 'secondary': '✅ TOP MOMENTUM RUNS'},
        'section_descriptions': {'primary': 'Stocks with strong price movement within the current trading session', 'secondary': 'Best intraday momentum runs with the highest move percentage'},
        'filters': [
            {'key': 'lookback_minutes', 'label': 'Lookback', 'type': 'select', 'options': [5, 10, 15, 30], 'default': 15},
            {'key': 'min_move_pct', 'label': 'Move % ≥', 'type': 'number', 'min': 0, 'max': 20, 'step': 0.1, 'default': 0.5}
        ],
        'default_sort': {'column': 'move_pct', 'direction': 'desc'},
        'score_formula': 'Move% × 2 + RSI acceleration + Volume surge + ADX trend'
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
