from typing import Optional, Tuple


def get_tighter_trailing_buffer(profit_pct: float, is_ultra_quick: bool = False, is_tv_alert: bool = False) -> float:
    """MUCH TIGHTER trailing buffer for aggressive profit locking"""
    if is_tv_alert:
        if profit_pct >= 0.5:
            return 0.05
        elif profit_pct >= 0.3:
            return 0.1
        else:
            return 0.15
    
    if is_ultra_quick:
        if profit_pct >= 2.0:
            return 0.1
        elif profit_pct >= 1.5:
            return 0.15
        elif profit_pct >= 1.0:
            return 0.2
        elif profit_pct >= 0.8:
            return 0.25
        else:
            return 0.3
    
    if profit_pct >= 2.0:
        return 0.2
    elif profit_pct >= 1.5:
        return 0.25
    elif profit_pct >= 1.0:
        return 0.3
    elif profit_pct >= 0.8:
        return 0.35
    elif profit_pct >= 0.6:
        return 0.4
    elif profit_pct >= 0.4:
        return 0.45
    else:
        return 0.5


def check_confirmed_downtrend(
    current_price: float,
    vwap: float,
    volume_ratio: float,
    change: float,
    ema20: float,
    ema50: float
) -> Tuple[bool, str]:
    """
    Check if confirmed downtrend exists for short positions.
    
    Returns: (is_downtrend, description)
    """
    price_below_vwap = current_price < vwap
    bearish_volume = volume_ratio > 1.2 and change < 1.0
    below_ema20 = current_price < ema20
    ema_bearish = ema20 < ema50
    
    confirmed_downtrend = price_below_vwap or bearish_volume or (below_ema20 and ema_bearish)
    
    description = f"Price<VWAP:{price_below_vwap}, BearishVol:{bearish_volume}, BelowEMA:{below_ema20 and ema_bearish}"
    
    return confirmed_downtrend, description


def estimate_trading_charges(trade_value: float, trade_type: str = 'intraday') -> float:
    """
    Estimate trading charges with fallback when tv_utils not available.
    """
    try:
        from . import tv_utils
        return tv_utils.calculate_trading_charges(trade_value, trade_type)
    except Exception:
        rate = 0.00035 if trade_type == 'intraday' else 0.0005
        return trade_value * rate
