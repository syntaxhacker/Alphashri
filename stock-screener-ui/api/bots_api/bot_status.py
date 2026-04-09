import asyncio
from datetime import datetime
from typing import Optional, List

from fastapi import HTTPException, Depends
from sqlalchemy.orm import Session

from api.auth import get_current_user

from .bots_router import (
    router,
    get_db,
    get_user_id,
    get_bot_by_uuid,
    load_bot_snapshot,
    is_bot_running,
    SessionLocal,
)
from .requests import BotResponse, BotStatusResponse


def _get_db_available():
    import api.bots
    return api.bots._db_available


def _sync_list_available_strategies(db: Session) -> list:
    from db.models import StrategyConfig
    
    strategies = db.query(StrategyConfig).filter(
        StrategyConfig.is_active == True
    ).all()
    return [
        {
            "id": s.uuid,
            "name": s.name,
            "strategy_type": s.strategy_type,
            "is_template": s.is_template,
            "is_default": s.is_default,
            "sl_pct": s.sl_pct,
            "tp_pct": s.tp_pct,
            "max_positions": s.max_positions,
        }
        for s in strategies
    ]


def _sync_list_bots(user_id: int, db: Session) -> list:
    from db.models import BotConfig
    from .bots_router import bot_to_response
    
    bots = db.query(BotConfig).filter(BotConfig.user_id == user_id).order_by(BotConfig.name).all()
    return [bot_to_response(bot, user_id, db=db) for bot in bots]


def _sync_get_bot_status(bot_uuid: str, user_id: int, db: Session) -> BotStatusResponse:
    bot = get_bot_by_uuid(bot_uuid, user_id, db)
    running, pid = is_bot_running(user_id, bot.id)
    status_unknown = running is None
    running = bool(running)
    snapshot = load_bot_snapshot(bot.id, user_id)
    if not snapshot:
        return BotStatusResponse(
            bot_id=bot.uuid,
            bot_name=bot.name,
            running=running,
            pid=pid,
            status_unknown=status_unknown,
            portfolio={
                "initial_capital": 1000000,
                "cash": 1000000,
                "total_value": 1000000,
                "total_pnl": 0,
                "total_pnl_pct": 0,
            },
            strategies={},
            positions=[],
            last_update=datetime.now().isoformat(),
        )
    return BotStatusResponse(
        bot_id=bot.uuid,
        bot_name=bot.name,
        running=running,
        pid=pid,
        status_unknown=status_unknown,
        portfolio=snapshot.get('portfolio') if snapshot else None,
        strategies=snapshot.get('strategies') if snapshot else None,
        positions=snapshot.get('positions') if snapshot else None,
        last_update=snapshot.get('timestamp') if snapshot else None,
    )


@router.get("/available-strategies")
async def list_available_strategies(
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _get_db_available():
        raise HTTPException(status_code=500, detail="Database not available")

    if db is None:
        with SessionLocal() as db:
            return await asyncio.to_thread(_sync_list_available_strategies, db)

    return await asyncio.to_thread(_sync_list_available_strategies, db)


@router.get("", response_model=List[BotResponse])
async def list_bots(
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _get_db_available():
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    if db is None:
        with SessionLocal() as session:
            return await asyncio.to_thread(_sync_list_bots, user_id, session)

    return await asyncio.to_thread(_sync_list_bots, user_id, db)


@router.get("/{bot_id}/status", response_model=BotStatusResponse)
async def get_bot_status(
    bot_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _get_db_available():
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        return await asyncio.to_thread(_sync_get_bot_status, bot_id, user_id, db)
    finally:
        if close_db:
            db.close()
