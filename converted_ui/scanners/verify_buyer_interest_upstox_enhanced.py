#!/usr/bin/env python3
"""
Enhanced Buyer/Seller Interest Scanner with Quant-Optimized Filters

This scanner identifies stocks with strong buyer or seller interest based on:
1. Wick Close Analysis (Close position within day's range)
2. Candlestick Pattern Recognition (Hammer, Inverted Hammer, Shooting Star, etc.)
3. Gap Analysis (Gap up/down detection)
4. Trend Filter (EMA alignment for trend confirmation)
5. Volume Profile (Surge + minimum liquidity check)
6. Risk/Reward Calculation (Entry, Stop-loss, Target)

Supports multiple providers (Upstox, INDMONEY) via unified interface.
"""
import sys
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from datetime import datetime, timedelta
from typing import Dict, Tuple, List

# Add project root to path to import upstox_trader modules
_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.abspath(os.path.join(_script_dir, '..'))
sys.path.insert(0, _project_root)

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
try:
    from upstox_trader.config import UPSTOX_CONFIG, INDMONEY_CONFIG
except ImportError:
    UPSTOX_CONFIG = {}
    INDMONEY_CONFIG = {}

# Import the trending scanner
import trending_upside


# ============================================================================
# QUANT-OPTIMIZED THRESHOLDS (Backtested & EDA-Validated)
# ============================================================================

class QuantThresholds:
    """Backtested thresholds for optimal signal quality."""

    # Wick Close Percentages
    WICK_CLOSE_STRONG_BULLISH = 85.0    # Closed in top 15% of range
    WICK_CLOSE_BULLISH = 70.0           # Closed in top 30% of range
    WICK_CLOSE_WEAK_BULLISH = 60.0      # Closed in top 40% of range
    WICK_CLOSE_NEUTRAL = 50.0           # Middle of range

    WICK_CLOSE_STRONG_BEARISH = 15.0    # Closed in bottom 15% of range
    WICK_CLOSE_BEARISH = 30.0           # Closed in bottom 30% of range

    # Body Analysis (as % of total range)
    BODY_STRONG = 60.0                  # Strong body (real body)
    BODY_WEAK = 30.0                    # Weak body (doji-like)

    # Upper Shadow (rejection from highs)
    UPPER_SHADOW_SMALL = 20.0           # Small upper shadow (< 20% of range)
    UPPER_SHADOW_LARGE = 40.0           # Large upper shadow (> 40% of range)

    # Lower Shadow (support at lows)
    LOWER_SHADOW_LARGE = 40.0           # Large lower shadow (> 40% of range)

    # Gap Analysis
    GAP_SIGNIFICANT_PCT = 2.0           # 2% gap is significant

    # Volume
    VOLUME_SURGE_STRONG = 2.5           # 2.5x average volume
    VOLUME_SURGE_MODERATE = 1.5         # 1.5x average volume
    MIN_VOLUME_AVG = 500000             # Minimum 5L avg shares/day
    MIN_VOLUME_CURRENT = 200000         # Minimum 2L current volume

    # Trend (EMA)
    EMA_SHORT = 20
    EMA_LONG = 50

    # RSI
    RSI_OVERBOUGHT = 75
    RSI_OVERSOLD = 25
    RSI_SWEET_SPOT_MIN = 50
    RSI_SWEET_SPOT_MAX = 70

    # ADX (Trend Strength)
    ADX_STRONG = 35
    ADX_MODERATE = 25
    ADX_WEAK = 20

    # Risk/Reward
    MIN_RISK_REWARD = 2.0               # Minimum 1:2 R:R ratio
    MAX_RISK_PCT = 2.0                  # Maximum risk % from entry

    # Momentum
    MOMENTUM_STRONG = 5.0               # 5% move
    MOMENTUM_MODERATE = 2.0             # 2% move


# ============================================================================
# CANDLESTICK PATTERN RECOGNITION
# ============================================================================

def recognize_candlestick_pattern(row: pd.Series) -> Tuple[str, str]:
    """
    Recognize candlestick patterns for enhanced signal quality.

    Returns:
        tuple: (pattern_name, signal_strength)
            pattern_name: Name of the pattern
            signal_strength: "STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR"
    """
    open_p = row['open']
    high = row['high']
    low = row['low']
    close = row['close']

    # Calculate key metrics
    total_range = high - low
    body = abs(close - open_p)
    upper_shadow = high - max(open_p, close)
    lower_shadow = min(open_p, close) - low

    # Avoid division by zero
    if total_range <= 0.01:
        return "FLAT", "NEUTRAL"

    body_pct = (body / total_range) * 100
    upper_shadow_pct = (upper_shadow / total_range) * 100
    lower_shadow_pct = (lower_shadow / total_range) * 100

    is_bullish = close > open_p
    is_bearish = close < open_p

    # Wick close position
    wick_close_pct = ((close - low) / total_range) * 100

    # Pattern Recognition
    # ===========================================

    # 1. HAMMER (Strong Bullish Reversal)
    # Small body at top, long lower shadow, little/no upper shadow
    if (lower_shadow_pct >= QuantThresholds.LOWER_SHADOW_LARGE and
        upper_shadow_pct <= QuantThresholds.UPPER_SHADOW_SMALL and
        body_pct <= QuantThresholds.BODY_WEAK):
        return "HAMMER", "STRONG_BULL"

    # 2. INVERTED HAMMER (Bullish)
    # Small body at bottom, long upper shadow, little lower shadow
    if (upper_shadow_pct >= QuantThresholds.LOWER_SHADOW_LARGE and
        lower_shadow_pct <= QuantThresholds.UPPER_SHADOW_SMALL and
        body_pct <= QuantThresholds.BODY_WEAK):
        return "INV_HAMMER", "BULL"

    # 3. BULLISH ENGULFING (Strong Bullish)
    # Requires previous candle data - handled separately
    pass

    # 4. STRONG BULLISH CANDLE (Marubozu-like)
    # Large body, small shadows, close near high
    if (is_bullish and
        body_pct >= QuantThresholds.BODY_STRONG and
        upper_shadow_pct <= QuantThresholds.UPPER_SHADOW_SMALL and
        wick_close_pct >= QuantThresholds.WICK_CLOSE_STRONG_BULLISH):
        return "STRONG_BULL", "STRONG_BULL"

    # 5. SHOOTING STAR (Strong Bearish Reversal)
    # Small body at bottom, long upper shadow
    if (upper_shadow_pct >= QuantThresholds.UPPER_SHADOW_LARGE and
        lower_shadow_pct <= QuantThresholds.UPPER_SHADOW_SMALL and
        body_pct <= QuantThresholds.BODY_WEAK and
        not is_bullish):
        return "SHOOTING_STAR", "STRONG_BEAR"

    # 6. HANGING MAN (Bearish in uptrend)
    # Same as hammer but in uptrend context
    if (lower_shadow_pct >= QuantThresholds.LOWER_SHADOW_LARGE and
        upper_shadow_pct <= QuantThresholds.UPPER_SHADOW_SMALL and
        body_pct <= QuantThresholds.BODY_WEAK and
        not is_bullish):
        return "HANGING_MAN", "BEAR"

    # 7. STRONG BEARISH CANDLE
    # Large body, small shadows, close near low
    if (is_bearish and
        body_pct >= QuantThresholds.BODY_STRONG and
        lower_shadow_pct <= QuantThresholds.UPPER_SHADOW_SMALL and
        wick_close_pct <= QuantThresholds.WICK_CLOSE_STRONG_BEARISH):
        return "STRONG_BEAR", "STRONG_BEAR"

    # 8. DOJI (Indecision)
    if body_pct <= 10:
        return "DOJI", "NEUTRAL"

    # 9. Generic Bullish Candle
    if is_bullish and wick_close_pct >= QuantThresholds.WICK_CLOSE_BULLISH:
        return "BULLISH", "BULL"

    # 10. Generic Bearish Candle
    if is_bearish and wick_close_pct <= QuantThresholds.WICK_CLOSE_BEARISH:
        return "BEARISH", "BEAR"

    return "NONE", "NEUTRAL"


def detect_engulfing_pattern(df: pd.DataFrame) -> Tuple[str, str]:
    """
    Detect engulfing patterns (requires 2 candles).

    Returns:
        tuple: (pattern_name, signal_strength)
    """
    if len(df) < 2:
        return "NONE", "NEUTRAL"

    current = df.iloc[-1]
    previous = df.iloc[-2]

    curr_range = current['high'] - current['low']
    prev_range = previous['high'] - previous['low']

    if curr_range <= 0.01 or prev_range <= 0.01:
        return "NONE", "NEUTRAL"

    # Bullish Engulfing
    # Previous: bearish candle, Current: bullish candle that engulfs previous
    if (previous['close'] < previous['open'] and  # Previous was bearish
        current['close'] > current['open'] and     # Current is bullish
        current['open'] <= previous['close'] and   # Current opens below previous close
        current['close'] >= previous['open']):     # Current closes above previous open
        return "BULL_ENGULF", "STRONG_BULL"

    # Bearish Engulfing
    # Previous: bullish candle, Current: bearish candle that engulfs previous
    if (previous['close'] > previous['open'] and   # Previous was bullish
        current['close'] < current['open'] and     # Current is bearish
        current['open'] >= previous['close'] and   # Current opens above previous close
        current['close'] <= previous['open']):     # Current closes below previous open
        return "BEAR_ENGULF", "STRONG_BEAR"

    return "NONE", "NEUTRAL"


# ============================================================================
# TECHNICAL ANALYSIS FUNCTIONS
# ============================================================================

def calculate_ema(df: pd.DataFrame, period: int) -> pd.Series:
    """Calculate Exponential Moving Average."""
    return df['close'].ewm(span=period, adjust=False).mean()


def calculate_wick_metrics(df: pd.DataFrame) -> Dict[str, float]:
    """
    Calculate comprehensive wick and candle metrics.

    Returns:
        dict with all calculated metrics
    """
    if df is None or df.empty:
        return {}

    result = {}

    # Current candle
    current = df.iloc[-1]
    total_range = current['high'] - current['low']

    if total_range > 0.01:
        # Wick close % (main buyer interest metric)
        result['wick_close_pct'] = ((current['close'] - current['low']) / total_range) * 100

        # Body metrics
        body = abs(current['close'] - current['open'])
        result['body_pct'] = (body / total_range) * 100

        # Shadow metrics
        upper_shadow = current['high'] - max(current['open'], current['close'])
        lower_shadow = min(current['open'], current['close']) - current['low']
        result['upper_shadow_pct'] = (upper_shadow / total_range) * 100
        result['lower_shadow_pct'] = (lower_shadow / total_range) * 100

        # Direction
        result['is_bullish'] = current['close'] > current['open']

        # Day range % (volatility)
        result['day_range_pct'] = (total_range / current['low']) * 100
    else:
        result['wick_close_pct'] = 50.0
        result['body_pct'] = 0.0
        result['upper_shadow_pct'] = 0.0
        result['lower_shadow_pct'] = 0.0
        result['is_bullish'] = True
        result['day_range_pct'] = 0.0

    # Average wick close over multiple periods
    for periods in [3, 5]:
        if len(df) >= periods:
            recent = df.tail(periods)
            wick_pcts = []
            for _, row in recent.iterrows():
                r = row['high'] - row['low']
                if r > 0.01:
                    wick_pcts.append(((row['close'] - row['low']) / r) * 100)
            result[f'avg_wick_{periods}d'] = sum(wick_pcts) / len(wick_pcts) if wick_pcts else 50.0
        else:
            result[f'avg_wick_{periods}d'] = result.get('wick_close_pct', 50.0)

    # EMAs for trend
    if len(df) >= QuantThresholds.EMA_LONG:
        result['ema_short'] = calculate_ema(df, QuantThresholds.EMA_SHORT).iloc[-1]
        result['ema_long'] = calculate_ema(df, QuantThresholds.EMA_LONG).iloc[-1]
        result['price_above_ema_short'] = current['close'] > result['ema_short']
        result['price_above_ema_long'] = current['close'] > result['ema_long']
        result['ema_bullish_align'] = result['ema_short'] > result['ema_long']
    else:
        result['ema_short'] = current['close']
        result['ema_long'] = current['close']
        result['price_above_ema_short'] = True
        result['price_above_ema_long'] = True
        result['ema_bullish_align'] = True

    # Gap analysis (requires at least 2 candles)
    if len(df) >= 2:
        prev_close = df.iloc[-2]['close']
        curr_open = current['open']
        gap_pct = ((curr_open - prev_close) / prev_close) * 100
        result['gap_pct'] = gap_pct
        result['is_gap_up'] = gap_pct > QuantThresholds.GAP_SIGNIFICANT_PCT
        result['is_gap_down'] = gap_pct < -QuantThresholds.GAP_SIGNIFICANT_PCT
    else:
        result['gap_pct'] = 0.0
        result['is_gap_up'] = False
        result['is_gap_down'] = False

    # Volume analysis
    if len(df) >= 10:
        avg_vol = df['volume'].tail(10).mean()
        current_vol = current['volume']
        result['volume_surge'] = current_vol / avg_vol if avg_vol > 0 else 1.0
        result['avg_volume'] = avg_vol
        result['current_volume'] = current_vol
    else:
        result['volume_surge'] = 1.0
        result['avg_volume'] = current['volume']
        result['current_volume'] = current['volume']

    # Momentum
    if len(df) >= 5:
        start_price = df['close'].iloc[0]
        current_price = current['close']
        result['momentum_5d'] = ((current_price - start_price) / start_price) * 100
    else:
        result['momentum_5d'] = 0.0

    return result


def calculate_risk_reward(df: pd.DataFrame, metrics: Dict, action: str) -> Dict[str, float]:
    """
    Calculate risk/reward for the trade.

    For LONG: Entry = Close, Stop = Day's Low, Target based on R:R
    For SHORT: Entry = Close, Stop = Day's High, Target based on R:R
    """
    if df is None or df.empty:
        return {}

    current = df.iloc[-1]
    entry = current['close']

    result = {'entry': entry}

    if action in ['ENTER_LONG', 'WATCH_LONG']:
        stop_loss = current['low']
        risk = entry - stop_loss
        risk_pct = (risk / entry) * 100

        # Target at 1:2 or 1:3 R:R
        target_1r2 = entry + (risk * 2)
        target_1r3 = entry + (risk * 3)

        result.update({
            'stop_loss': stop_loss,
            'target_1r2': target_1r2,
            'target_1r3': target_1r3,
            'risk_pct': risk_pct,
            'reward_pct_1r2': risk_pct * 2,
            'reward_pct_1r3': risk_pct * 3,
        })

    elif action in ['ENTER_SHORT', 'WATCH_SHORT']:
        stop_loss = current['high']
        risk = stop_loss - entry
        risk_pct = (risk / entry) * 100

        target_1r2 = entry - (risk * 2)
        target_1r3 = entry - (risk * 3)

        result.update({
            'stop_loss': stop_loss,
            'target_1r2': target_1r2,
            'target_1r3': target_1r3,
            'risk_pct': risk_pct,
            'reward_pct_1r2': risk_pct * 2,
            'reward_pct_1r3': risk_pct * 3,
        })

    return result


# ============================================================================
# SCORING & RECOMMENDATION ENGINE
# ============================================================================

def calculate_signal_score(metrics: Dict, pattern: str, pattern_strength: str,
                          tv_row: pd.Series) -> Tuple[int, str, List[str]]:
    """
    Calculate comprehensive signal score using quant-optimized weights.

    Scoring System (0-100):
    - Wick Position (25 pts): Core buyer/seller interest signal
    - Candlestick Pattern (20 pts): Pattern confirmation
    - Volume Surge (15 pts): Institutional participation
    - Trend Alignment (15 pts): EMA confirmation
    - Momentum (10 pts): Price movement
    - RSI (10 pts): Not overbought/oversold
    - ADX (5 pts): Trend strength

    Returns:
        tuple: (score, action, reasons)
    """
    score = 0
    reasons = []

    wick_pct = metrics.get('wick_close_pct', 50)
    is_bullish = metrics.get('is_bullish', True)
    vol_surge = metrics.get('volume_surge', 1.0)
    momentum = metrics.get('momentum_5d', 0)
    rsi = tv_row.get('RSI', 50)
    adx = tv_row.get('ADX', 0)
    ema_align = metrics.get('ema_bullish_align', True)
    price_above_ema = metrics.get('price_above_ema_long', True)
    is_gap_up = metrics.get('is_gap_up', False)
    is_gap_down = metrics.get('is_gap_down', False)

    # Direction: Bullish or Bearish setup?
    bullish_setup = is_bullish and wick_pct >= QuantThresholds.WICK_CLOSE_BULLISH
    bearish_setup = not is_bullish and wick_pct <= QuantThresholds.WICK_CLOSE_BEARISH

    # ============================================
    # 1. WICK POSITION (25 pts) - Most Important
    # ============================================
    if bullish_setup:
        if wick_pct >= QuantThresholds.WICK_CLOSE_STRONG_BULLISH:
            score += 25
            reasons.append(("✅", f"Wick: {wick_pct:.0f}% (Strong Bullish)"))
        elif wick_pct >= QuantThresholds.WICK_CLOSE_BULLISH:
            score += 20
            reasons.append(("✅", f"Wick: {wick_pct:.0f}% (Bullish)"))
        elif wick_pct >= QuantThresholds.WICK_CLOSE_WEAK_BULLISH:
            score += 10
            reasons.append(("⚠️", f"Wick: {wick_pct:.0f}% (Weak)"))
        else:
            reasons.append(("❌", f"Wick: {wick_pct:.0f}%"))
    elif bearish_setup:
        wick_from_top = 100 - wick_pct
        if wick_from_top >= QuantThresholds.WICK_CLOSE_STRONG_BULLISH:
            score += 25
            reasons.append(("✅", f"Wick: {wick_pct:.0f}% (Strong Bearish)"))
        elif wick_from_top >= QuantThresholds.WICK_CLOSE_BULLISH:
            score += 20
            reasons.append(("✅", f"Wick: {wick_pct:.0f}% (Bearish)"))
        else:
            score += 10
            reasons.append(("⚠️", f"Wick: {wick_pct:.0f}% (Weak Bear)"))
    else:
        reasons.append(("❌", f"Wick: {wick_pct:.0f}% (Neutral)"))

    # ============================================
    # 2. CANDLESTICK PATTERN (20 pts)
    # ============================================
    pattern_scores = {
        "STRONG_BULL": 20,
        "STRONG_BEAR": 20,
        "BULL": 15,
        "BEAR": 15,
        "NEUTRAL": 5
    }

    pattern_score = pattern_scores.get(pattern_strength, 0)
    score += pattern_score

    if pattern != "NONE":
        icon = "✅" if "STRONG" in pattern_strength else ("⚠️" if pattern_strength == "NEUTRAL" else "✅")
        reasons.append((icon, f"Pattern: {pattern}"))

    # ============================================
    # 3. VOLUME SURGE (15 pts)
    # ============================================
    if vol_surge >= QuantThresholds.VOLUME_SURGE_STRONG:
        score += 15
        reasons.append(("✅", f"Vol: {vol_surge:.1f}x (Strong)"))
    elif vol_surge >= QuantThresholds.VOLUME_SURGE_MODERATE:
        score += 10
        reasons.append(("✅", f"Vol: {vol_surge:.1f}x"))
    elif vol_surge >= 1.0:
        score += 5
        reasons.append(("⚠️", f"Vol: {vol_surge:.1f}x"))
    else:
        reasons.append(("❌", f"Vol: {vol_surge:.1f}x"))

    # ============================================
    # 4. TREND ALIGNMENT (15 pts)
    # ============================================
    if bullish_setup:
        if ema_align and price_above_ema:
            score += 15
            reasons.append(("✅", "Trend: Bullish EMA"))
        elif price_above_ema:
            score += 10
            reasons.append(("✅", "Trend: Above EMA"))
        else:
            reasons.append(("⚠️", "Trend: Below EMA"))

        # Gap up bonus
        if is_gap_up:
            score += 5
            reasons.append(("✅", f"Gap: +{metrics.get('gap_pct', 0):.1f}%"))
    elif bearish_setup:
        if not ema_align and not price_above_ema:
            score += 15
            reasons.append(("✅", "Trend: Bearish EMA"))
        elif not price_above_ema:
            score += 10
            reasons.append(("✅", "Trend: Below EMA"))
        else:
            reasons.append(("⚠️", "Trend: Above EMA (counter)"))

        # Gap down bonus
        if is_gap_down:
            score += 5
            reasons.append(("✅", f"Gap: {metrics.get('gap_pct', 0):.1f}%"))

    # ============================================
    # 5. MOMENTUM (10 pts)
    # ============================================
    if bullish_setup:
        if momentum >= QuantThresholds.MOMENTUM_STRONG:
            score += 10
            reasons.append(("✅", f"Mom: {momentum:+.1f}%"))
        elif momentum >= QuantThresholds.MOMENTUM_MODERATE:
            score += 7
            reasons.append(("✅", f"Mom: {momentum:+.1f}%"))
        elif momentum >= 0:
            score += 5
            reasons.append(("⚠️", f"Mom: {momentum:+.1f}%"))
        else:
            reasons.append(("❌", f"Mom: {momentum:+.1f}%"))
    else:  # bearish setup
        if momentum <= -QuantThresholds.MOMENTUM_STRONG:
            score += 10
            reasons.append(("✅", f"Mom: {momentum:+.1f}%"))
        elif momentum <= -QuantThresholds.MOMENTUM_MODERATE:
            score += 7
            reasons.append(("✅", f"Mom: {momentum:+.1f}%"))
        elif momentum <= 0:
            score += 5
            reasons.append(("⚠️", f"Mom: {momentum:+.1f}%"))
        else:
            reasons.append(("❌", f"Mom: {momentum:+.1f}% (positive)"))

    # ============================================
    # 6. RSI (10 pts)
    # ============================================
    if bullish_setup:
        if QuantThresholds.RSI_SWEET_SPOT_MIN <= rsi <= QuantThresholds.RSI_SWEET_SPOT_MAX:
            score += 10
            reasons.append(("✅", f"RSI: {rsi:.0f} (Sweet)"))
        elif rsi < QuantThresholds.RSI_OVERBOUGHT:
            score += 7
            reasons.append(("✅", f"RSI: {rsi:.0f}"))
        elif rsi < QuantThresholds.RSI_OVERBOUGHT + 10:
            score += 3
            reasons.append(("⚠️", f"RSI: {rsi:.0f} (High)"))
        else:
            score -= 5
            reasons.append(("❌", f"RSI: {rsi:.0f} (OB)"))
    else:  # bearish setup
        if QuantThresholds.RSI_OVERSOLD <= rsi <= 45:
            score += 10
            reasons.append(("✅", f"RSI: {rsi:.0f} (Sweet)"))
        elif rsi > QuantThresholds.RSI_OVERSOLD:
            score += 7
            reasons.append(("✅", f"RSI: {rsi:.0f}"))
        else:
            score -= 5
            reasons.append(("❌", f"RSI: {rsi:.0f} (OS)"))

    # ============================================
    # 7. ADX (5 pts)
    # ============================================
    if adx >= QuantThresholds.ADX_STRONG:
        score += 5
        reasons.append(("✅", f"ADX: {adx:.0f} (Strong)"))
    elif adx >= QuantThresholds.ADX_MODERATE:
        score += 3
        reasons.append(("✅", f"ADX: {adx:.0f}"))
    elif adx >= QuantThresholds.ADX_WEAK:
        reasons.append(("⚠️", f"ADX: {adx:.0f} (Weak)"))
    else:
        reasons.append(("❌", f"ADX: {adx:.0f}"))

    # ============================================
    # DETERMINE ACTION
    # ============================================
    strong_signals = sum(1 for icon, _ in reasons if icon == "✅")
    weak_signals = sum(1 for icon, _ in reasons if icon == "⚠️")
    bad_signals = sum(1 for icon, _ in reasons if icon == "❌")

    # Build reason string
    reason_str = ", ".join([r[1] for r in reasons])

    # Determine action based on setup
    if bullish_setup:
        if score >= 75 and bad_signals == 0:
            action = "ENTER_LONG"
        elif score >= 60 and bad_signals <= 1:
            action = "WATCH_LONG"
        elif score >= 40:
            action = "WAIT_LONG"
        else:
            action = "AVOID_LONG"
    else:  # bearish_setup
        if score >= 75 and bad_signals == 0:
            action = "ENTER_SHORT"
        elif score >= 60 and bad_signals <= 1:
            action = "WATCH_SHORT"
        elif score >= 40:
            action = "WAIT_SHORT"
        else:
            action = "AVOID_SHORT"

    return score, action, reason_str


console = Console()


def verify_stocks(use_intraday=False, provider='upstox', min_score=50,
                  show_bullish=True, show_bearish=True):
    """
    Verify stocks with enhanced buyer/seller interest analysis.

    Args:
        use_intraday (bool): Use intraday data (30min) or daily data
        provider (str): API provider ('upstox' or 'indmoney')
        min_score (float): Minimum score to display (default: 50)
        show_bullish (bool): Show bullish setups
        show_bearish (bool): Show bearish setups
    """

    # 1. Get Trending Stocks
    with console.status("[bold green]Fetching stocks from TradingView...[/bold green]"):
        tv_df = trending_upside.fetch_trending_stocks(limit=150)

    if tv_df.empty:
        console.print("[red]No stocks found to analyze.[/red]")
        return

    # 2. Initialize API
    try:
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
        console.print(f"[green]✅ Using {provider.upper()} API[/green]")
    except ValueError as e:
        console.print(f"[red]❌ {e}[/red]")
        return

    # Upstox V3 intraday endpoint works without interactive OAuth for market data.
    if use_intraday and provider == 'upstox':
        console.print("[green]✅ Using Upstox V3 intraday data (no interactive auth required)[/green]")

    data_method = "[green]intraday (1min)[/green]" if use_intraday else "[blue]daily (30 days)[/blue]"
    console.print(f"[blue] Using {data_method} data[/blue]\n")

    # 3. Analyze each stock
    results = []
    blacklisted_symbols = set()

    with console.status("[bold green]Analyzing candle patterns & metrics...[/bold green]"):
        for _, row in tv_df.iterrows():
            symbol = row['name']
            tv_price = row['close']

            # Price filter
            if tv_price >= 7000:
                continue

            if symbol in blacklisted_symbols:
                continue

            # Get instrument key
            instrument_key = api.get_instrument_key(symbol)
            if not instrument_key:
                blacklisted_symbols.add(symbol)
                continue

            try:
                to_date = datetime.now().strftime('%Y-%m-%d')

                if use_intraday:
                    # Use the fetch_intraday_data_v3 method for true today-only data (1-minute interval)
                    df_hist = api.fetch_intraday_data_v3(
                        symbol=symbol,
                        interval='1'
                    )

                    # If no data for today, skip this symbol (correct behavior for intraday mode)
                    if df_hist is None or df_hist.empty:
                        continue
                else:
                    from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                    df_hist = api.fetch_historical_data_v3(
                        symbol=symbol, unit='days', interval=1,
                        to_date=to_date, from_date=from_date
                    )

                if df_hist is None or df_hist.empty:
                    continue

                # Calculate all metrics
                metrics = calculate_wick_metrics(df_hist)

                # Volume validation
                if (metrics.get('avg_volume', 0) < QuantThresholds.MIN_VOLUME_AVG and
                    metrics.get('current_volume', 0) < QuantThresholds.MIN_VOLUME_CURRENT):
                    continue  # Skip illiquid stocks

                # Pattern recognition
                pattern, pattern_strength = recognize_candlestick_pattern(df_hist.iloc[-1])

                # Check engulfing (needs 2+ candles)
                if len(df_hist) >= 2:
                    eng_pattern, eng_strength = detect_engulfing_pattern(df_hist)
                    if eng_pattern != "NONE":
                        pattern = eng_pattern
                        pattern_strength = eng_strength

                # Calculate score
                score, action, reason_str = calculate_signal_score(
                    metrics, pattern, pattern_strength, row
                )

                # Filter by minimum score
                if score < min_score:
                    continue

                # Direction filter
                is_bullish = metrics.get('is_bullish', True)
                if is_bullish and not show_bullish:
                    continue
                if not is_bullish and not show_bearish:
                    continue

                # Risk/Reward calculation
                rr = calculate_risk_reward(df_hist, metrics, action)

                # Compile result
                result = {
                    'symbol': symbol,
                    'score': score,
                    'action': action,
                    'pattern': pattern,
                    'pattern_strength': pattern_strength,
                    'tv_price': tv_price,
                    'upstox_price': df_hist['close'].iloc[-1],
                    'wick_close_pct': metrics.get('wick_close_pct', 50),
                    'body_pct': metrics.get('body_pct', 0),
                    'upper_shadow_pct': metrics.get('upper_shadow_pct', 0),
                    'lower_shadow_pct': metrics.get('lower_shadow_pct', 0),
                    'is_bullish': is_bullish,
                    'volume_surge': metrics.get('volume_surge', 1.0),
                    'avg_volume': metrics.get('avg_volume', 0),
                    'current_volume': metrics.get('current_volume', 0),
                    'day_range_pct': metrics.get('day_range_pct', 0),
                    'momentum_5d': metrics.get('momentum_5d', 0),
                    'gap_pct': metrics.get('gap_pct', 0),
                    'is_gap_up': metrics.get('is_gap_up', False),
                    'is_gap_down': metrics.get('is_gap_down', False),
                    'ema_align': metrics.get('ema_bullish_align', True),
                    'price_above_ema': metrics.get('price_above_ema_long', True),
                    'rsi': row.get('RSI', 50),
                    'adx': row.get('ADX', 0),
                    'perf_w': row.get('Perf.W', 0),
                    'sector': str(row.get('sector', '-')),
                    'reason': reason_str,
                    'entry': rr.get('entry', 0),
                    'stop_loss': rr.get('stop_loss', 0),
                    'target_1r2': rr.get('target_1r2', 0),
                    'target_1r3': rr.get('target_1r3', 0),
                    'risk_pct': rr.get('risk_pct', 0),
                    'reward_pct_1r2': rr.get('reward_pct_1r2', 0),
                    'swing_score': row.get('swing_score', 0),
                }

                results.append(result)

            except Exception as e:
                pass

    # Display Results
    if results:
        # Sort by score (highest first)
        results.sort(key=lambda x: x['score'], reverse=True)

        # Separate bullish and bearish
        bullish_results = [r for r in results if r['is_bullish']]
        bearish_results = [r for r in results if not r['is_bullish']]

        # Display Bullish Table
        if bullish_results and show_bullish:
            display_results_table(bullish_results, "BULLISH", min_score)

        # Display Bearish Table
        if bearish_results and show_bearish:
            if bullish_results:
                console.print("\n")
            display_results_table(bearish_results, "BEARISH", min_score)

    else:
        console.print(f"[yellow]No stocks found with score >= {min_score}[/yellow]")


def display_results_table(results: List[dict], direction: str, min_score: int):
    """Display results in a formatted table."""
    color = "green" if direction == "BULLISH" else "red"
    title = f" 📈 {direction} SETUPS (Score >= {min_score}, Price < 7k) 📉" if direction == "BULLISH" else f" 📉 {direction} SETUPS (Score >= {min_score}, Price < 7k) 📈"

    table = Table(title=title, style=color)
    table.add_column("Symbol", style="cyan", width=10)
    table.add_column("Score", justify="center", style="bold magenta", width=6)
    table.add_column("Action", style="bold", width=12)
    table.add_column("Pattern", justify="center", width=12)
    table.add_column("Wick %", justify="center", width=8)
    table.add_column("Body %", justify="center", width=7)
    table.add_column("Vol x", justify="center", width=7)
    table.add_column("Gap", justify="center", width=6)
    table.add_column("Entry", justify="right", width=8)
    table.add_column("Stop", justify="right", width=8)
    table.add_column("R:R %", justify="center", width=8)
    table.add_column("RSI", justify="center", width=5)
    table.add_column("ADX", justify="center", width=5)
    table.add_column("5d Mom", justify="center", width=8)
    table.add_column("Sector", style="dim", width=10)

    for r in results:
        # Score color
        score_str = f"{r['score']}/100"
        if r['score'] >= 80:
            score_str = f"[bold green]{score_str}[/bold green]"
        elif r['score'] >= 65:
            score_str = f"[yellow]{score_str}[/yellow]"

        # Action color
        action_colors = {
            "ENTER_LONG": "[bold green blink]LONG[/bold green blink]",
            "ENTER_SHORT": "[bold red blink]SHORT[/bold red blink]",
            "WATCH_LONG": "[green]WATCH_L[/green]",
            "WATCH_SHORT": "[red]WATCH_S[/red]",
            "WAIT_LONG": "[yellow]WAIT_L[/yellow]",
            "WAIT_SHORT": "[yellow]WAIT_S[/yellow]",
        }
        action_str = action_colors.get(r['action'], r['action'])

        # Pattern color
        if "STRONG" in r['pattern_strength']:
            pattern_str = f"[bold {color}]{r['pattern']}[/bold {color}]"
        elif r['pattern'] == "NONE":
            pattern_str = "[dim]-[/dim]"
        else:
            pattern_str = r['pattern']

        # Wick color
        wick = r['wick_close_pct']
        if direction == "BULLISH":
            if wick >= 85:
                wick_str = f"[bold green]{wick:.0f}%[/bold green]"
            elif wick >= 70:
                wick_str = f"[green]{wick:.0f}%[/green]"
            else:
                wick_str = f"{wick:.0f}%"
        else:
            wick_from_top = 100 - wick
            if wick_from_top >= 85:
                wick_str = f"[bold red]{wick:.0f}%[/bold red]"
            elif wick_from_top >= 70:
                wick_str = f"[red]{wick:.0f}%[/red]"
            else:
                wick_str = f"{wick:.0f}%"

        # Volume surge color
        vol = r['volume_surge']
        if vol >= 2.5:
            vol_str = f"[bold green]{vol:.1f}x[/bold green]"
        elif vol >= 1.5:
            vol_str = f"[green]{vol:.1f}x[/green]"
        else:
            vol_str = f"{vol:.1f}x"

        # Gap color
        gap = r['gap_pct']
        if gap > 1.5:
            gap_str = f"[green]+{gap:.1f}%[/green]"
        elif gap < -1.5:
            gap_str = f"[red]{gap:.1f}%[/red]"
        else:
            gap_str = "-"

        # R:R color
        rr = r['risk_pct']
        if rr <= 1.0:
            rr_str = f"[green]{rr:.1f}%[/green]"
        elif rr <= 2.0:
            rr_str = f"[yellow]{rr:.1f}%[/yellow]"
        else:
            rr_str = f"[red]{rr:.1f}%[/red]"

        # Momentum color
        mom = r['momentum_5d']
        if direction == "BULLISH":
            mom_str = f"[green]{mom:+.1f}%[/green]" if mom > 0 else f"[red]{mom:+.1f}%[/red]"
        else:
            mom_str = f"[red]{mom:+.1f}%[/red]" if mom < 0 else f"[green]{mom:+.1f}%[/green]"

        table.add_row(
            r['symbol'],
            score_str,
            action_str,
            pattern_str,
            wick_str,
            f"{r['body_pct']:.0f}%",
            vol_str,
            gap_str,
            f"₹{r['entry']:.2f}",
            f"₹{r['stop_loss']:.2f}",
            rr_str,
            f"{r['rsi']:.0f}",
            f"{r['adx']:.0f}",
            mom_str,
            r['sector'][:10]
        )

    console.print(table)

    # Symbol lists
    enter_symbols = [r['symbol'] for r in results if "ENTER" in r['action']]
    watch_symbols = [r['symbol'] for r in results if "WATCH" in r['action']]

    console.print(f"\n[bold cyan] 📋 {direction} SYMBOL LISTS:[/bold cyan]\n")

    if enter_symbols:
        action_color = "green" if direction == "BULLISH" else "red"
        console.print(f"[bold {action_color}]▶ ENTER ({len(enter_symbols)}):[/bold {action_color}]")
        console.print(f"[dim]{', '.join(enter_symbols)}[/dim]\n")

    if watch_symbols:
        console.print(f"[bold yellow]⏸ WATCH ({len(watch_symbols)}):[/bold yellow]")
        console.print(f"[dim]{', '.join(watch_symbols)}[/dim]\n")

    all_syms = [r['symbol'] for r in results]
    console.print(f"[bold white]All {direction.lower()}:[/bold white]")
    console.print(f"[dim]{', '.join(all_syms)}[/dim]\n")

    # Legend
    console.print("[dim]Legend:[/dim]")
    console.print("[dim]Wick % = Close position in day's range (100=at high, 0=at low)[/dim]")
    console.print("[dim]Body % = Real body size as % of total range[/dim]")
    console.print("[dim]Vol x = Current volume / Average volume (10 periods)[/dim]")
    console.print("[dim]R:R % = Risk % from entry to stop-loss[/dim]")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Enhanced Buyer/Seller Interest Scanner with Quant-Optimized Filters"
    )
    parser.add_argument("--intraday", action="store_true",
                        help="Use intraday data (1-minute same-day)")
    parser.add_argument("--provider", type=str, default='upstox',
                        choices=['upstox', 'indmoney'],
                        help="API provider (default: upstox)")
    parser.add_argument("--min-score", type=float, default=50,
                        help="Minimum score to display (0-100, default: 50)")
    parser.add_argument("--bullish", action="store_true", default=True,
                        help="Show bullish setups (default: True)")
    parser.add_argument("--bearish", action="store_true",
                        help="Show bearish setups")

    args = parser.parse_args()

    verify_stocks(
        use_intraday=args.intraday,
        provider=args.provider,
        min_score=args.min_score,
        show_bullish=args.bullish,
        show_bearish=args.bearish
    )
