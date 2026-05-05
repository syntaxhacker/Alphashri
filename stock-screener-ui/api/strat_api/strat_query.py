import asyncio
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import StrategyConfig, BotConfig, User
from api.auth import get_current_user


def _load_all_trades(user_id: int) -> list:
    """Load all trades from all journal files for a user."""
    import json
    from pathlib import Path

    journals_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)
    if not journals_dir.exists():
        return []

    all_trades = []
    for journal_file in journals_dir.glob("journal_*.json"):
        try:
            with open(journal_file) as f:
                data = json.load(f)
            trades = data.get("trades", [])
            all_trades.extend(trades)
        except Exception:
            continue

    return all_trades


def _sync_list_strategies(db, include_templates, strategy_type):
    query = db.query(StrategyConfig)
    if not include_templates:
        query = query.filter(StrategyConfig.is_template == False)
    if strategy_type:
        query = query.filter(StrategyConfig.strategy_type == strategy_type)
    strategies = query.order_by(StrategyConfig.strategy_type, StrategyConfig.name).all()
    return strategies


def _sync_list_templates(db):
    templates = db.query(StrategyConfig).filter(
        StrategyConfig.is_template == True,
        StrategyConfig.is_active == True,
    ).order_by(StrategyConfig.name).all()
    return templates


def _sync_list_all_variations(db):
    variations = db.query(StrategyConfig).filter(
        StrategyConfig.is_active == True,
    ).order_by(StrategyConfig.is_template.desc(), StrategyConfig.strategy_type, StrategyConfig.name).all()
    return variations


def _sync_get_strategy(db, strategy_id):
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()
    variations = []
    if strategy and strategy.is_template:
        variations = db.query(StrategyConfig).filter(
            StrategyConfig.parent_id == strategy_id,
            StrategyConfig.is_active == True,
        ).all()
    return strategy, variations


def _sync_get_strategy_performance(db, strategy_id):
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()
    return strategy


def _sync_get_strategy_trades(db, strategy_id):
    strategy = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()
    return strategy


def _sync_get_strategy_variations(db, strategy_id):
    parent = db.query(StrategyConfig).filter(
        StrategyConfig.id == strategy_id
    ).first()
    variations = []
    if parent:
        variations = db.query(StrategyConfig).filter(
            StrategyConfig.parent_id == strategy_id,
            StrategyConfig.is_active == True,
        ).order_by(StrategyConfig.name).all()
    return parent, variations


def _sync_list_bots(db):
    bots = db.query(BotConfig).order_by(BotConfig.name).all()
    return bots


def _sync_get_bot(db, bot_id):
    from api.bots_api.bots_router import resolve_bot_id
    numeric_id = resolve_bot_id(bot_id, db)
    if numeric_id is None:
        return None
    bot = db.query(BotConfig).filter(BotConfig.id == numeric_id).first()
    return bot


async def list_strategies(
    include_templates: bool = False,
    strategy_type: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all strategy configurations."""
    strategies = await asyncio.to_thread(_sync_list_strategies, db, include_templates, strategy_type)

    return {
        "strategies": [s.to_dict() for s in strategies],
        "count": len(strategies),
    }


async def list_templates(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all active template strategies."""
    templates = await asyncio.to_thread(_sync_list_templates, db)

    return {
        "templates": [t.to_dict() for t in templates],
        "count": len(templates),
    }


async def list_all_variations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all strategy variations and templates for selection."""
    variations = await asyncio.to_thread(_sync_list_all_variations, db)

    return [v.to_dict() for v in variations]


async def get_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a specific strategy by ID."""
    strategy, variations = await asyncio.to_thread(_sync_get_strategy, db, strategy_id)

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    return {
        "strategy": strategy.to_dict(),
        "variations": [v.to_dict() for v in variations],
    }


async def get_strategy_performance(
    strategy_id: int,
    include_test: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get performance statistics for a strategy."""
    strategy = await asyncio.to_thread(_sync_get_strategy_performance, db, strategy_id)

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    user_id = user.id if user else 1
    all_trades = _load_all_trades(user_id)

    strategy_trades = [t for t in all_trades if t.get('strategy_id') == strategy_id]

    if not include_test:
        strategy_trades = [t for t in strategy_trades if not t.get('is_test', False)]

    total_trades = len(strategy_trades)
    winners = len([t for t in strategy_trades if t.get('net_pnl', 0) > 0])
    losers = len([t for t in strategy_trades if t.get('net_pnl', 0) < 0])
    win_rate = (winners / total_trades * 100) if total_trades > 0 else 0
    total_pnl = sum(t.get('pnl', 0) for t in strategy_trades)
    net_pnl = sum(t.get('net_pnl', 0) for t in strategy_trades)

    test_trades = len([t for t in strategy_trades if t.get('is_test', False)])

    return {
        "strategy_id": strategy_id,
        "strategy_name": strategy.name,
        "total_trades": total_trades,
        "winners": winners,
        "losers": losers,
        "win_rate": round(win_rate, 1),
        "total_pnl": round(total_pnl, 2),
        "net_pnl": round(net_pnl, 2),
        "test_trades": test_trades,
        "has_test_data": test_trades > 0,
    }


async def get_strategy_trades(
    strategy_id: int,
    limit: int = 50,
    include_test: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get trades for a specific strategy."""
    strategy = await asyncio.to_thread(_sync_get_strategy_trades, db, strategy_id)

    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    user_id = user.id if user else 1
    all_trades = _load_all_trades(user_id)
    strategy_trades = [t for t in all_trades if t.get('strategy_id') == strategy_id]

    if not include_test:
        strategy_trades = [t for t in strategy_trades if not t.get('is_test', False)]

    strategy_trades.sort(key=lambda t: t.get('exit_time', ''), reverse=True)

    return {
        "strategy_id": strategy_id,
        "strategy_name": strategy.name,
        "trades": strategy_trades[:limit],
        "total": len(strategy_trades),
    }


async def get_strategy_variations(
    strategy_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get all variations of a template strategy."""
    parent, variations = await asyncio.to_thread(_sync_get_strategy_variations, db, strategy_id)

    if not parent:
        raise HTTPException(status_code=404, detail="Strategy not found")

    if not parent.is_template:
        raise HTTPException(status_code=400, detail="Not a template strategy")

    return {
        "parent": parent.to_dict(),
        "variations": [v.to_dict() for v in variations],
        "count": len(variations),
    }


async def list_bots(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all bot configurations."""
    bots = await asyncio.to_thread(_sync_list_bots, db)

    return {
        "bots": [b.to_dict() for b in bots],
        "count": len(bots),
    }


async def get_bot(
    bot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a specific bot configuration."""
    bot = await asyncio.to_thread(_sync_get_bot, db, bot_id)

    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    return {
        "bot": bot.to_dict(),
    }
