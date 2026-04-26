import asyncio
from typing import Optional

from fastapi import HTTPException, Depends
from sqlalchemy.orm import Session

from api.auth import get_current_user

from .bots_router import (
    router,
    get_db,
    get_user_id,
    get_bot_by_uuid,
    get_strategy_by_uuid,
    _db_available,
    SessionLocal,
)


@router.post("/{bot_id}/strategies/{strategy_id}/start")
async def start_strategy(
    bot_id: str,
    strategy_id: str,
    user=Depends(get_current_user)
):
    return {
        "message": "Strategy control requires bot restart. Stop the bot, update config, and restart.",
        "bot_id": bot_id,
        "strategy_id": strategy_id,
    }


@router.post("/{bot_id}/strategies/{strategy_id}/stop")
async def stop_strategy(
    bot_id: str,
    strategy_id: str,
    user=Depends(get_current_user)
):
    return {
        "message": "Strategy control requires bot restart. Stop the bot, update config, and restart.",
        "bot_id": bot_id,
        "strategy_id": strategy_id,
    }
