import asyncio
import uuid as uuid_module
from typing import Optional

from fastapi import HTTPException, Depends
from sqlalchemy.orm import Session
from rich.console import Console

from api.auth import get_current_user

from .bots_router import (
    router,
    get_db,
    get_user_id,
    get_bot_by_uuid,
    get_strategy_by_uuid,
    bot_to_response,
    is_bot_running,
    stop_bot_process,
    _db_available,
    SessionLocal,
)
from .requests import BotCreate, BotUpdate, BotResponse

console = Console()


def _sync_create_bot(request_dict: dict, user_id: int, db: Session) -> BotResponse:
    from db.models import BotConfig, bot_strategies
    
    existing = db.query(BotConfig).filter(
        BotConfig.name == request_dict['name'],
        BotConfig.user_id == user_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Bot with name '{request_dict['name']}' already exists")

    total_allocation = sum(s['capital_allocation_pct'] for s in request_dict['strategies'])
    if round(total_allocation, 4) > 1.0:
        raise HTTPException(
            status_code=400,
            detail=f"Total capital allocation ({total_allocation:.0%}) exceeds 100%"
        )

    bot = BotConfig(
        uuid=str(uuid_module.uuid4()),
        name=request_dict['name'],
        user_id=user_id,
        is_active=request_dict['is_active'],
        max_total_positions=request_dict['max_total_positions'],
        max_total_capital_pct=request_dict['max_total_capital_pct'],
    )
    db.add(bot)
    db.flush()

    for alloc in request_dict['strategies']:
        strategy = get_strategy_by_uuid(alloc['strategy_id'], db)
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy.id,
                max_positions=alloc['max_positions'],
                capital_allocation_pct=alloc['capital_allocation_pct'],
            )
        )

    db.commit()
    db.refresh(bot)
    console.print(f"[green]Created bot: {bot.name} (ID: {bot.id})[/green]")
    return bot_to_response(bot, user_id, db=db)


def _sync_update_bot(bot_id: str, request_dict: dict, user_id: int, db: Session) -> BotResponse:
    from db.models import BotConfig, bot_strategies
    
    bot = get_bot_by_uuid(bot_id, user_id, db)

    if request_dict.get('name') is not None:
        existing = db.query(BotConfig).filter(
            BotConfig.name == request_dict['name'],
            BotConfig.user_id == user_id,
            BotConfig.id != bot.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Bot with name '{request_dict['name']}' already exists")
        bot.name = request_dict['name']

    if request_dict.get('is_active') is not None:
        bot.is_active = request_dict['is_active']

    if request_dict.get('max_total_positions') is not None:
        bot.max_total_positions = request_dict['max_total_positions']

    if request_dict.get('max_total_capital_pct') is not None:
        bot.max_total_capital_pct = request_dict['max_total_capital_pct']

    if request_dict.get('strategies') is not None:
        total_allocation = sum(s['capital_allocation_pct'] for s in request_dict['strategies'])
        if round(total_allocation, 4) > 1.0:
            raise HTTPException(
                status_code=400,
                detail=f"Total capital allocation ({total_allocation:.0%}) exceeds 100%"
            )

        db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot.id))

        for alloc in request_dict['strategies']:
            strategy = get_strategy_by_uuid(alloc['strategy_id'], db)
            if not strategy:
                raise HTTPException(status_code=400, detail=f"Strategy {alloc['strategy_id']} not found")

            db.execute(
                bot_strategies.insert().values(
                    bot_id=bot.id,
                    strategy_id=strategy.id,
                    max_positions=alloc['max_positions'],
                    capital_allocation_pct=alloc['capital_allocation_pct'],
                )
            )

    db.commit()
    db.refresh(bot)
    console.print(f"[green]Updated bot: {bot.name} (UUID: {bot.uuid})[/green]")
    return bot_to_response(bot, user_id, db=db)


def _sync_delete_bot(bot_id: str, user_id: int, db: Session) -> dict:
    from db.models import bot_strategies
    
    bot = get_bot_by_uuid(bot_id, user_id, db)
    running, pid = is_bot_running(user_id, bot.id)
    if running:
        stop_bot_process(user_id, bot.id)
    db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot.id))
    db.delete(bot)
    db.commit()
    console.print(f"[yellow]Deleted bot: {bot.name} (UUID: {bot_id})[/yellow]")
    return {"message": f"Bot {bot_id} deleted successfully"}


@router.post("", response_model=BotResponse)
async def create_bot(
    request: BotCreate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        request_dict = request.model_dump()
        return await asyncio.to_thread(_sync_create_bot, request_dict, user_id, db)
    finally:
        if close_db:
            db.close()


@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(
    bot_id: str,
    request: BotUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        request_dict = request.model_dump(exclude_none=True)
        return await asyncio.to_thread(_sync_update_bot, bot_id, request_dict, user_id, db)
    finally:
        if close_db:
            db.close()


@router.delete("/{bot_id}")
async def delete_bot(
    bot_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        return await asyncio.to_thread(_sync_delete_bot, bot_id, user_id, db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(
    bot_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    if db is None:
        with SessionLocal() as session:
            bot = get_bot_by_uuid(bot_id, user_id, session)
            return bot_to_response(bot, user_id, db=session)

    bot = get_bot_by_uuid(bot_id, user_id, db)
    return bot_to_response(bot, user_id, db=db)
