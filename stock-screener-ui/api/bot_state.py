import json
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from db.models import Position, BotRuntimeState, StrategyRuntimeState, BotConfig, StrategyConfig, bot_strategies
from cache.redis_client import get_redis_client
from config import IST


def get_bot_state(bot_id: int, user_id: int, db) -> Optional[dict]:
    bot = db.query(BotConfig).filter(BotConfig.id == bot_id, BotConfig.user_id == user_id).first()
    if not bot:
        return None

    bot_runtime = db.query(BotRuntimeState).filter(BotRuntimeState.bot_id == bot_id).first()

    positions = db.query(Position).filter(
        Position.bot_id == bot_id,
        Position.is_test == False,
    ).all()

    positions_list = []
    for p in positions:
        pos_dict = p.to_dict()
        pos_dict['strategy_type'] = getattr(p, 'strategy_type', '') or ''
        pos_dict['peak_price'] = getattr(p, 'peak_price', 0.0) or 0.0
        pos_dict['low_price'] = getattr(p, 'low_price', 0.0) or 0.0

        if p.current_price and p.entry_price and p.quantity:
            side = -1 if (p.side or 'BUY') == 'SELL' else 1
            computed_pnl = round(side * (p.current_price - p.entry_price) * p.quantity, 2)
            computed_pct = round(side * ((p.current_price - p.entry_price) / p.entry_price) * 100, 4) if p.entry_price else 0.0
            if not pos_dict.get('unrealized_pnl'):
                pos_dict['unrealized_pnl'] = computed_pnl
            if not pos_dict.get('unrealized_pnl_pct'):
                pos_dict['unrealized_pnl_pct'] = computed_pct

        positions_list.append(pos_dict)

    strategies_rows = db.execute(
        bot_strategies.select().where(bot_strategies.c.bot_id == bot_id)
    ).fetchall()

    strategies = {}
    max_daily_loss_pct = 0.03

    # Batch-load all strategies and runtime states for this bot
    strategy_ids = [row.strategy_id for row in strategies_rows]
    cfg_map = {}
    if strategy_ids:
        for c in db.query(StrategyConfig).filter(StrategyConfig.id.in_(strategy_ids)).all():
            cfg_map[c.id] = c
    rt_map = {}
    if strategy_ids:
        for r in db.query(StrategyRuntimeState).filter(
            StrategyRuntimeState.bot_id == bot_id,
            StrategyRuntimeState.strategy_id.in_(strategy_ids),
        ).all():
            rt_map[r.strategy_id] = r

    for row in strategies_rows:
        sid = row.strategy_id
        strategy_cfg = cfg_map.get(sid)
        if not strategy_cfg:
            continue

        if hasattr(strategy_cfg, 'max_daily_loss_pct') and strategy_cfg.max_daily_loss_pct:
            max_daily_loss_pct = max(max_daily_loss_pct, strategy_cfg.max_daily_loss_pct)

        s_runtime = rt_map.get(sid)

        allocation_pct = row.capital_allocation_pct
        allocated_capital = bot_runtime.cash * allocation_pct if bot_runtime else 0
        capital_used = s_runtime.capital_used if s_runtime else 0
        available_capital = max(0, allocated_capital - capital_used) if allocated_capital > 0 else 0

        strat_positions = [p for p in positions_list if p.get('strategy_id') == sid]
        unrealized_pnl = sum(p.get('unrealized_pnl', 0) or 0 for p in strat_positions)

        strategies[str(sid)] = {
            'id': sid,
            'name': strategy_cfg.name,
            'status': s_runtime.status if s_runtime else 'pending',
            'signals_generated': s_runtime.signals_generated if s_runtime else 0,
            'trades_executed': s_runtime.trades_executed if s_runtime else 0,
            'last_scan_time': s_runtime.last_scan_time.isoformat() if s_runtime and s_runtime.last_scan_time else None,
            'portfolio_status': {
                'strategy_id': sid,
                'strategy_name': strategy_cfg.name,
                'allocation_pct': allocation_pct,
                'allocated_capital': allocated_capital,
                'capital_used': capital_used,
                'available_capital': available_capital,
                'capital_used_pct': (capital_used / allocated_capital * 100) if allocated_capital > 0 else 0,
                'positions_count': len(strat_positions),
                'max_positions': row.max_positions,
                'unrealized_pnl': unrealized_pnl,
                'realized_pnl': s_runtime.realized_pnl if s_runtime else 0,
                'total_pnl': unrealized_pnl + (s_runtime.realized_pnl if s_runtime else 0),
                'trades_count': s_runtime.trades_executed if s_runtime else 0,
            },
            'scan_items': [],
        }

    total_capital_used = sum(s.get('portfolio_status', {}).get('capital_used', 0) for s in strategies.values())
    position_value = sum(p.get('current_price', 0) * p.get('quantity', 0) for p in positions_list)
    unrealized_pnl = sum(p.get('unrealized_pnl', 0) or 0 for p in positions_list)
    cash = bot_runtime.cash if bot_runtime else (bot.max_total_capital_pct * 1000000)
    realized_pnl = bot_runtime.realized_pnl if bot_runtime else 0
    initial_capital = bot.max_total_capital_pct * 1000000
    total_value = cash + position_value
    total_pnl = total_value - initial_capital
    total_pnl_pct = (total_pnl / initial_capital * 100) if initial_capital > 0 else 0

    scan_items = []
    if bot_runtime and getattr(bot_runtime, 'scan_items', None):
        try:
            scan_items = json.loads(bot_runtime.scan_items)
        except Exception:
            pass
    watchlist = []
    strategy_watchlists = {}
    if bot_runtime and getattr(bot_runtime, 'watchlist', None):
        try:
            parsed = json.loads(bot_runtime.watchlist)
            if isinstance(parsed, dict):
                watchlist = parsed.get("shared", [])
                strategy_watchlists = parsed.get("per_strategy", {})
            elif isinstance(parsed, list):
                watchlist = parsed
        except Exception:
            pass
    if not scan_items:
        try:
            client = get_redis_client()
            if client:
                raw = client.get(f"bot:{bot_id}:scan_items")
                if raw:
                    scan_items = json.loads(raw)
        except Exception:
            pass

    for item in scan_items:
        sid = item.get('strategy_id')
        if sid is not None and str(sid) in strategies:
            strategies[str(sid)]['scan_items'].append(item)

    return {
        'timestamp': bot_runtime.updated_at.isoformat() if bot_runtime and bot_runtime.updated_at else datetime.now(IST).isoformat(),
        'bot_id': bot.id,
        'bot_name': bot.name,
        'running': True,
        'watchlist': watchlist,
        'strategy_watchlists': strategy_watchlists,
        'portfolio': {
            'initial_capital': initial_capital,
            'cash': cash,
            'capital_used': total_capital_used,
            'position_value': position_value,
            'unrealized_pnl': unrealized_pnl,
            'realized_pnl': realized_pnl,
            'total_value': total_value,
            'total_pnl': total_pnl,
            'total_pnl_pct': total_pnl_pct,
            'total_positions': len(positions_list),
            'total_trades': sum(s.get('trades_executed', 0) for s in strategies.values()),
            'daily_pnl': bot_runtime.daily_pnl if bot_runtime else 0,
            'daily_trades': bot_runtime.daily_trades if bot_runtime else 0,
            'max_daily_loss_pct': max_daily_loss_pct,
            'daily_loss_limit_exceeded': (
                abs(bot_runtime.daily_pnl) >= initial_capital * max_daily_loss_pct
            ) if bot_runtime and bot_runtime.daily_pnl < 0 else False,
            'strategies_count': len(strategies),
        },
        'strategies': strategies,
        'positions': positions_list,
        'scan_items': scan_items,
    }
