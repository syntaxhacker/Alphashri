from datetime import datetime

from .portfolio_models import SharedPosition, OrderSide

import config


def restore_state(portfolio, state: dict):
    portfolio.cash = state.get('cash', portfolio.initial_capital)
    portfolio.daily_pnl = state.get('daily_pnl', 0.0)
    portfolio.daily_trades = state.get('daily_trades', 0)


def restore_position(portfolio, pos_data: dict):
    symbol = pos_data['symbol']
    strategy_id = pos_data['strategy_id']
    key = f"{strategy_id}_{symbol}"

    if key in portfolio.positions:
        return

    pos = SharedPosition(
        symbol=symbol,
        side=OrderSide(pos_data['side']),
        quantity=pos_data['quantity'],
        entry_price=pos_data['entry_price'],
        stop_loss=pos_data['stop_loss'],
        take_profit=pos_data['take_profit'],
        entry_time=datetime.fromisoformat(pos_data['entry_time']),
        strategy_id=strategy_id,
        strategy_name=pos_data['strategy_name'],
        strategy_type=pos_data.get('strategy_type', ''),
        current_price=pos_data.get('current_price', pos_data['entry_price']),
        peak_price=pos_data.get('peak_price', pos_data['entry_price']),
        low_price=pos_data.get('low_price', pos_data['entry_price']),
        metadata=pos_data.get('metadata', {}),
    )

    portfolio.positions[key] = pos

    if strategy_id in portfolio.strategy_allocations:
        entry_value = pos.entry_price * pos.quantity
        portfolio.strategy_allocations[strategy_id].capital_used += entry_value
        portfolio.strategy_allocations[strategy_id].positions_count += 1


def reset_daily(portfolio):
    portfolio.daily_pnl = 0.0
    portfolio.daily_trades = 0
    portfolio.day_start = datetime.now(config.IST).date()
