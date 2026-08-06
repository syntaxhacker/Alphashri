"""Aggregated multi-bot dashboard endpoints."""

from datetime import datetime
from typing import Optional

from fastapi import Depends

from api.auth import get_current_user
from db.models import User
from db.models import Trade as TradeModel
from db.database import SessionLocal
from db.models.bot import BotConfig, StrategyConfig, bot_strategies
import config

from .paper_api import router, _get_user_id
from pathlib import Path


@router.get("/aggregated")
async def get_aggregated_dashboard(user: "User" = Depends(get_current_user)):
    user_id = _get_user_id(user)
    today = datetime.now(config.IST)

    with SessionLocal() as db:
        bots = db.query(BotConfig).filter(BotConfig.user_id == user_id).all()
        bot_ids = [b.id for b in bots]

        # Batch-load all strategies for all bots (through bot_strategies association table)
        strategies_by_bot: dict = {}
        if bot_ids:
            rows = db.query(
                bot_strategies.c.bot_id,
                bot_strategies.c.strategy_id,
                StrategyConfig.id,
                StrategyConfig.name,
                StrategyConfig.strategy_type,
            ).join(
                StrategyConfig, bot_strategies.c.strategy_id == StrategyConfig.id
            ).filter(
                bot_strategies.c.bot_id.in_(bot_ids)
            ).all()
            for row in rows:
                strategies_by_bot.setdefault(row.bot_id, []).append({
                    "id": row.id,
                    "name": row.name,
                    "strategy_type": row.strategy_type,
                })

        # Batch-load today's trades for all bots
        today_start = today.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start.replace(hour=23, minute=59, second=59)
        all_trades = db.query(TradeModel).filter(
            TradeModel.user_id == user_id,
            TradeModel.is_test == False,
            TradeModel.exit_time >= today_start,
            TradeModel.exit_time <= today_end,
        ).all() if bot_ids else []
        trades_by_strategy: dict = {}
        for t in all_trades:
            trades_by_strategy.setdefault(t.strategy_id, []).append(t)

    bot_data = []
    total_positions = 0
    total_daily_pnl = 0.0
    total_unrealized_pnl = 0.0
    total_value = 0.0

    for bot in bots:
        strategies = strategies_by_bot.get(bot.id, [])

        running = False
        pid = None
        try:
            pid_file = Path(f"/tmp/bot-{bot.uuid}-runner.pid")
            if pid_file.exists():
                pid = int(pid_file.read_text().strip())
                running = True
        except Exception:
            pass

        positions = []
        portfolio_data = {}
        try:
            from trading.paper_trader import get_paper_trader
            trader = get_paper_trader(user_id)
            trader_positions = trader.get_positions()
            for p in trader_positions:
                if str(p.get("strategy_id")) in [str(s["id"]) for s in strategies] or not strategies:
                    positions.append(p)
                    total_positions += 1
                    total_unrealized_pnl += float(p.get("pnl", 0))
                    total_value += float(p.get("current_price", 0)) * float(p.get("quantity", 0))
        except Exception:
            pass

        daily_pnl = 0.0
        strat_ids = [s["id"] for s in strategies]
        for sid in strat_ids:
            for t in trades_by_strategy.get(sid, []):
                daily_pnl += float(t.net_pnl or 0)

        total_daily_pnl += daily_pnl

        bot_data.append({
            "id": str(bot.uuid),
            "name": bot.name,
            "running": running,
            "pid": pid,
            "strategies": strategies,
            "position_count": len(positions),
            "daily_pnl": round(daily_pnl, 2),
            "unrealized_pnl": round(sum(float(p.get("pnl", 0)) for p in positions), 2),
            "positions": positions[:10],
        })

    return {
        "bots": bot_data,
        "summary": {
            "total_bots": len(bots),
            "running_bots": sum(1 for b in bot_data if b["running"]),
            "total_positions": total_positions,
            "total_daily_pnl": round(total_daily_pnl, 2),
            "total_unrealized_pnl": round(total_unrealized_pnl, 2),
            "total_value": round(total_value, 2),
        },
    }
