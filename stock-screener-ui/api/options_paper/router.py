"""Options paper book endpoints: ``/api/options-paper``."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.auth import get_current_user
from db.database import get_db
from db.models import User
from db.models.options_paper import OptionPaperPosition

from . import service
from .schemas import (
    AddLegRequest,
    ChainSnapshotOut,
    CloseRequest,
    OptionPaperOrderRequest,
    OptionPaperOrderResultOut,
    OptionPaperPositionListOut,
    OptionPaperPositionOut,
    OptionReplayResultOut,
    ReplaySessionListOut,
)

logger = logging.getLogger("options_paper.router")

router = APIRouter(prefix="/api/options-paper", tags=["Options Paper"])


def _owned(db: Session, position_id: int, user_id: int) -> OptionPaperPosition:
    position = (
        db.query(OptionPaperPosition)
        .filter(OptionPaperPosition.id == position_id, OptionPaperPosition.user_id == user_id)
        .first()
    )
    if position is None:
        raise HTTPException(status_code=404, detail="Option paper position not found")
    return position


@router.post("/orders", response_model=OptionPaperOrderResultOut, summary="Place a multi-leg options paper order")
async def place_order(
    payload: OptionPaperOrderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Place a live or backdated paper structure; ``dryRun`` previews without writing."""
    try:
        return await service.place_order(db, user.id, payload)
    except service.OrderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception:
        logger.exception("failed to place options paper order for user %s", user.id)
        raise HTTPException(status_code=500, detail="Failed to place paper order") from None


@router.get("/positions", response_model=OptionPaperPositionListOut, summary="List options paper positions")
def list_positions(
    status: Literal["open", "closed", "expired", "all"] = Query("open"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    service.settle_expired(db, user.id)
    query = db.query(OptionPaperPosition).filter(OptionPaperPosition.user_id == user.id)
    if status != "all":
        query = query.filter(OptionPaperPosition.status == status)
    positions = query.order_by(OptionPaperPosition.id.desc()).limit(500).all()
    return {"positions": [service.serialize_position(db, pos) for pos in positions]}


@router.get("/positions/{position_id}", response_model=OptionPaperPositionOut, summary="Get one options paper position")
def get_position(
    position_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    service.settle_expired(db, user.id)
    return service.serialize_position(db, _owned(db, position_id, user.id))


@router.post("/positions/{position_id}/close", response_model=OptionPaperPositionOut, summary="Close an options paper position")
def close_position(
    position_id: int,
    payload: CloseRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    position = _owned(db, position_id, user.id)
    try:
        return service.close_position(db, position, (payload or CloseRequest()).premiums)
    except service.OrderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post(
    "/positions/{position_id}/legs",
    response_model=OptionPaperPositionOut,
    summary="Add a staggered leg to an options paper position",
)
async def add_leg(
    position_id: int,
    payload: AddLegRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Price one extra leg at its own entry time; no Trade is booked yet."""
    position = _owned(db, position_id, user.id)
    try:
        return await service.add_leg(db, position, payload)
    except service.OrderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:
        logger.exception("failed to add leg to options paper position %s", position_id)
        raise HTTPException(status_code=500, detail=f"Failed to add leg: {exc}") from None


@router.get("/replay/sessions", response_model=ReplaySessionListOut, summary="List replayable option chain sessions")
def replay_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return {"sessions": service.replay_sessions(db)}


@router.get("/replay/{position_id}", response_model=OptionReplayResultOut, summary="Recompute replay frames for a position")
def replay_position(
    position_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    position = _owned(db, position_id, user.id)
    return service.replay_for_position(db, position)


@router.get("/chain-at", response_model=ChainSnapshotOut, summary="Get a historical option chain quote")
def chain_at(
    underlying: str = Query(...),
    date: str = Query(...),
    time: str = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        expiry = service.resolve_expiry(db, underlying, date)
        return service.chain_at(db, underlying, expiry, date, time)
    except (service.OrderError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
