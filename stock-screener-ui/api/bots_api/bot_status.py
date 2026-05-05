import asyncio
from datetime import datetime
from typing import List

from fastapi import HTTPException, Depends
from sqlalchemy.orm import Session

from api.auth import get_current_user

from api.bot_state import get_bot_state

from .bots_router import (
    router,
    get_db,
    get_user_id,
    get_bot_by_uuid,
    is_bot_running,
    _db_available,
    SessionLocal,
)
from .requests import BotResponse, BotStatusResponse, BotSummaryResponse, BotSummaryStrategy


def _get_db_available():
    return _db_available


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
            "or_minutes": s.or_minutes,
            "min_or_range_pct": s.min_or_range_pct,
            "max_or_range_pct": s.max_or_range_pct,
            "max_distance_from_or_pct": s.max_distance_from_or_pct,
            "cooldown_minutes": s.cooldown_minutes,
            "enable_shorts": s.enable_shorts,
            "eod_exit_hour": s.eod_exit_hour,
            "eod_exit_minute": s.eod_exit_minute,
            "pivot_type": s.pivot_type,
            "breakout_buffer_pct": s.breakout_buffer_pct,
            "entry_threshold_pct": s.entry_threshold_pct,
            "enable_trailing_stop": s.enable_trailing_stop,
            "trailing_stop_pct": s.trailing_stop_pct,
            "max_holding_days": s.max_holding_days,
            "cooldown_days": s.cooldown_days,
            "ema_fast_period": s.ema_fast_period,
            "ema_slow_period": s.ema_slow_period,
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
    state = get_bot_state(bot.id, user_id, db)
    if not state:
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
        portfolio=state.get('portfolio'),
        strategies=state.get('strategies'),
        positions=state.get('positions'),
        last_update=state.get('timestamp'),
    )


def _sync_list_bots_summary(user_id: int, db: Session) -> list:
    from db.models import BotConfig, Position, StrategyConfig
    from sqlalchemy import func, text

    bots = db.query(BotConfig).filter(BotConfig.user_id == user_id).order_by(BotConfig.name).all()
    if not bots:
        return []

    bot_ids = [b.id for b in bots]

    position_counts = {}
    if bot_ids:
        placeholders = ",".join(":" + str(i) for i in range(len(bot_ids)))
        params = {"uid": user_id}
        for i, bid in enumerate(bot_ids):
            params[str(i)] = bid
        rows = db.execute(
            text(
                f"SELECT bot_id, COUNT(*) as cnt FROM positions "
                f"WHERE user_id = :uid AND (is_test = 0 OR is_test IS NULL) "
                f"AND bot_id IN ({placeholders}) GROUP BY bot_id"
            ),
            params,
        ).fetchall()
        for row in rows:
            position_counts[row[0]] = row[1]

    result = []
    for bot in bots:
        running, pid = is_bot_running(user_id, bot.id)
        status_unknown = running is None
        running = bool(running)

        if running:
            status = "RUNNING"
        elif status_unknown:
            status = "UNKNOWN"
        else:
            status = "STOPPED"

        strategies = []
        strat_rows = db.execute(
            text(
                "SELECT bs.strategy_id, sc.uuid, sc.name, sc.strategy_type "
                "FROM bot_strategies bs "
                "JOIN strategy_configs sc ON sc.id = bs.strategy_id "
                "WHERE bs.bot_id = :bot_id"
            ),
            {"bot_id": bot.id},
        ).fetchall()
        for sr in strat_rows:
            strategies.append(BotSummaryStrategy(
                id=sr.uuid,
                name=sr.name,
                strategy_type=sr.strategy_type,
            ))

        result.append(BotSummaryResponse(
            id=bot.uuid,
            name=bot.name,
            is_active=bot.is_active,
            running=running,
            pid=pid,
            status=status,
            position_count=position_counts.get(bot.id, 0),
            strategies=strategies,
        ))

    return result


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


@router.get("/summary", response_model=List[BotSummaryResponse])
async def list_bots_summary(
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _get_db_available():
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    if db is None:
        with SessionLocal() as session:
            return await asyncio.to_thread(_sync_list_bots_summary, user_id, session)

    return await asyncio.to_thread(_sync_list_bots_summary, user_id, db)


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
