"""
Shared risk calculation utilities.

Extracted from risk_manager.py and global_risk_manager.py to eliminate
duplicate risk/reward and position sizing logic.
"""


def make_validation_result() -> dict:
    return {
        'valid': False,
        'shares': 0,
        'trade_value': 0,
        'risk_amount': 0,
        'risk_pct': 0,
        'reward_amount': 0,
        'reward_pct': 0,
        'rr_ratio': 0,
        'reason': '',
    }


def calculate_risk_reward(
    entry_price: float,
    stop_loss: float,
    take_profit: float,
    side: str = "BUY",
) -> tuple:
    """
    Calculate risk per share, reward per share, risk %, reward %, and R:R ratio.

    Returns:
        (risk, reward, risk_pct, reward_pct, rr_ratio)
    """
    if side == "BUY":
        risk = abs(entry_price - stop_loss)
        reward = abs(take_profit - entry_price)
    else:
        risk = abs(stop_loss - entry_price)
        reward = abs(entry_price - take_profit)

    risk_pct = risk / entry_price * 100
    reward_pct = reward / entry_price * 100
    rr_ratio = reward / risk if risk > 0 else 0

    return risk, reward, risk_pct, reward_pct, rr_ratio


def apply_risk_reward_to_result(
    result: dict,
    entry_price: float,
    stop_loss: float,
    take_profit: float,
    side: str = "BUY",
) -> dict | None:
    """
    Calculate risk/reward, populate result dict.

    Returns None to signal the check passed.
    """
    if entry_price <= 0:
        result['reason'] = "Invalid entry price"
        return result

    risk, reward, risk_pct, reward_pct, rr_ratio = calculate_risk_reward(
        entry_price, stop_loss, take_profit, side,
    )

    result['risk_pct'] = round(risk_pct, 2)
    result['reward_pct'] = round(reward_pct, 2)
    result['rr_ratio'] = round(rr_ratio, 2)

    return None


def calculate_position_size(
    capital: float,
    entry_price: float,
    risk_per_share: float,
    risk_per_trade_pct: float,
    max_capital_per_trade_pct: float,
    min_trade_value: float,
    max_trade_value: float,
) -> int:
    """
    Calculate position size based on risk and capital limits.

    Uses the smaller of:
    1. Risk-based sizing (risk_per_trade_pct of capital / risk_per_share)
    2. Max capital allocation (max_capital_per_trade_pct of capital / entry_price)

    Then clamps to min/max trade value.

    Returns:
        Number of shares (0 if invalid inputs).
    """
    if entry_price <= 0 or risk_per_share <= 0 or capital <= 0:
        return 0

    max_risk = capital * risk_per_trade_pct
    shares_by_risk = int(max_risk / risk_per_share)

    max_capital = capital * max_capital_per_trade_pct
    shares_by_capital = int(max_capital / entry_price)

    shares = min(shares_by_risk, shares_by_capital)

    if shares <= 0:
        return 0

    trade_value = shares * entry_price
    if trade_value < min_trade_value:
        shares = int(min_trade_value / entry_price)
        if risk_per_share > 0 and shares * risk_per_share > max_risk:
            return 0
        if shares * entry_price > max_capital or shares * entry_price > capital:
            return 0
    elif trade_value > max_trade_value:
        shares = int(max_trade_value / entry_price)

    return shares


def position_to_dict(pos, extra_fields: dict | None = None) -> dict:
    """
    Build a standard position dict from a SharedPosition.

    Args:
        pos: SharedPosition instance
        extra_fields: Optional dict of additional fields to merge
    """
    d = {
        'symbol': pos.symbol,
        'side': pos.side.value,
        'quantity': pos.quantity,
        'entry_price': pos.entry_price,
        'current_price': pos.current_price,
        'stop_loss': pos.stop_loss,
        'take_profit': pos.take_profit,
        'unrealized_pnl': pos.unrealized_pnl,
        'unrealized_pnl_pct': pos.unrealized_pnl_pct,
        'entry_time': pos.entry_time.isoformat(),
        'strategy_id': pos.strategy_id,
        'strategy_name': pos.strategy_name,
        'order_id': pos.metadata.get('upstox_order_id', ''),
    }
    if extra_fields:
        d.update(extra_fields)
    return d
