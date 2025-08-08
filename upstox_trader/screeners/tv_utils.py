from typing import Optional


def calculate_alert_confidence(alert_type: str, volume_ratio: float, change_pct: float, rsi: Optional[float] = None) -> float:
    """
    Calculate confidence score for alerts with momentum confirmation.

    Mirrors the original TVScreenerUsage._calculate_alert_confidence logic to keep behavior identical.
    """
    confidence = 0.35  # Higher base confidence for FOMO mode earlier entries

    # RSI-based momentum confirmation - avoid buying at peaks (more aggressive)
    if rsi is not None:
        if rsi > 75:  # Overbought - very risky entry (lowered from 80)
            confidence -= 0.3
        elif rsi > 70:  # Getting overbought (lowered from 75)
            confidence -= 0.2
        elif rsi > 68:  # Slightly overbought - allow more momentum
            confidence -= 0.05
        elif 45 <= rsi <= 62:  # Sweet spot for momentum (narrower range)
            confidence += 0.15
        elif rsi < 30:  # Oversold - potential reversal but risky for FOMO
            confidence -= 0.1

    # Volume factor (higher volume = higher confidence)
    if volume_ratio > 4.0:
        confidence += 0.3
    elif volume_ratio > 3.0:
        confidence += 0.2
    elif volume_ratio > 2.0:
        confidence += 0.15
    elif volume_ratio > 1.5:
        confidence += 0.1

    # Price change factor
    if alert_type == 'VOLUME_SPIKE':
        if abs(change_pct) > 5:
            confidence += 0.25
        elif abs(change_pct) > 3:
            confidence += 0.2
        elif abs(change_pct) > 1.5:
            confidence += 0.1
    elif alert_type == 'PRICE_MOVE':
        if abs(change_pct) > 4:
            confidence += 0.25
        elif abs(change_pct) > 2.5:
            confidence += 0.15
    elif alert_type == 'SMART_FOMO':
        if change_pct > 3:
            confidence += 0.2
        elif change_pct > 1.5:
            confidence += 0.1
        # Historical validation bonus
        confidence += 0.15
    elif alert_type == 'EARLY_MOMENTUM':
        if change_pct > 2.5:
            confidence += 0.2
        elif change_pct > 1.5:
            confidence += 0.15
        # Early entry bonus
        confidence += 0.1
    elif alert_type == 'ACCUMULATION':
        # Controlled movement is preferred for accumulation
        if 0.5 < abs(change_pct) < 2:
            confidence += 0.2
        elif abs(change_pct) < 3:
            confidence += 0.1
        # Volume-based accumulation bonus
        confidence += 0.1
    elif alert_type == 'PREBREAKOUT':
        # Pre-breakout signals
        if change_pct > 2:
            confidence += 0.2
        elif change_pct > 1:
            confidence += 0.15
        # High RSI pre-breakout bonus
        confidence += 0.1
    elif alert_type == 'GAP_BREAKOUT':
        # Gap quality matters
        if 2 <= change_pct <= 8:
            confidence += 0.25  # Sweet spot for gaps
        elif 1 <= change_pct <= 15:
            confidence += 0.15
        # Volume confirmation bonus
        confidence += 0.1

    return min(confidence, 0.95)  # Cap at 95%


def get_progressive_trailing_buffer(profit_pct: float, volatility_adjustment: float = 0.0) -> float:
    """
    Calculate trailing stop buffer based on profit tiers with optional volatility adjustment.
    """
    base_buffer = 1.0  # Default

    if profit_pct >= 5.0:
        base_buffer = 0.3  # Very tight for big winners
    elif profit_pct >= 3.0:
        base_buffer = 0.4  # Aggressive for good profits
    elif profit_pct >= 2.0:
        base_buffer = 0.6  # Moderate tightening
    elif profit_pct >= 1.0:
        base_buffer = 0.8  # Start tightening

    # Add volatility adjustment (looser for volatile stocks)
    adjusted_buffer = base_buffer + volatility_adjustment

    # Cap the buffer between 0.2% and 1.5%
    return max(0.2, min(1.5, adjusted_buffer))


def get_acceleration_based_buffer(current_profit: float, highest_profit: float, time_since_entry_minutes: float) -> float:
    """
    Acceleration-based trailing stop buffer based on momentum acceleration and time.
    """
    profit_velocity = current_profit / max(1, time_since_entry_minutes)  # % per minute

    # Base buffer from progressive system
    base_buffer = get_progressive_trailing_buffer(current_profit)

    # Acceleration adjustment
    if profit_velocity > 0.1:  # Very fast gains (>0.1% per minute)
        acceleration_adjustment = -0.2  # Tighten significantly
    elif profit_velocity > 0.05:  # Fast gains
        acceleration_adjustment = -0.1  # Tighten moderately
    elif profit_velocity < 0.01:  # Slow gains
        acceleration_adjustment = 0.1   # Loosen slightly
    else:
        acceleration_adjustment = 0.0   # No change

    adjusted_buffer = base_buffer + acceleration_adjustment
    return max(0.2, min(1.0, adjusted_buffer))


def calculate_trading_charges(trade_value: float, trade_type: str = 'intraday') -> float:
    """
    Calculate realistic trading charges for Indian markets.
    """
    brokerage = min(trade_value * 0.0003, 20)
    stt = trade_value * 0.000125 if trade_type == 'intraday' else trade_value * 0.001
    exchange_charges = trade_value * 0.0000325
    gst = (brokerage + exchange_charges) * 0.18
    sebi_charges = max(1, trade_value / 100000)
    total_charges = brokerage + stt + exchange_charges + gst + sebi_charges
    return round(total_charges, 2)


def calculate_trend_target_probability(current_price: float, target_price: float, trend_strength: str, gap_direction: Optional[str]) -> float:
    """
    Calculate probability of reaching target based on trend and gap analysis.
    """
    distance_pct = abs((target_price - current_price) / current_price * 100)

    # Base probability based on distance
    if distance_pct < 1:
        base_prob = 85
    elif distance_pct < 2:
        base_prob = 70
    elif distance_pct < 3:
        base_prob = 55
    elif distance_pct < 5:
        base_prob = 40
    else:
        base_prob = 25

    target_direction = 'UP' if target_price > current_price else 'DOWN'

    # Trend multipliers
    trend_multiplier = 1.0
    if trend_strength == 'strong_bullish' and target_direction == 'UP':
        trend_multiplier = 1.3
    elif trend_strength == 'bullish' and target_direction == 'UP':
        trend_multiplier = 1.15
    elif trend_strength == 'strong_bearish' and target_direction == 'DOWN':
        trend_multiplier = 1.3
    elif trend_strength == 'bearish' and target_direction == 'DOWN':
        trend_multiplier = 1.15
    elif (trend_strength in ['strong_bullish', 'bullish'] and target_direction == 'DOWN') or \
         (trend_strength in ['strong_bearish', 'bearish'] and target_direction == 'UP'):
        trend_multiplier = 0.7

    # Gap direction alignment
    gap_multiplier = 1.0
    if gap_direction and target_direction:
        if (gap_direction == 'UP' and target_direction == 'DOWN') or \
           (gap_direction == 'DOWN' and target_direction == 'UP'):
            gap_multiplier = 1.2  # Gap fill scenario

    final_probability = min(95, base_prob * trend_multiplier * gap_multiplier)
    return round(final_probability, 1)


def calculate_level_strength(level: float, all_levels: list[float]) -> str:
    """
    Calculate strength of a support/resistance level based on touch frequency.
    """
    tolerance = 0.01  # 1% tolerance
    touches = sum(1 for l in all_levels if abs(l - level) / level <= tolerance)

    if touches >= 4:
        return 'strong'
    elif touches >= 2:
        return 'moderate'
    else:
        return 'weak'