from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from datetime import datetime

from db.database import SessionLocal
from db.models.price_surge import PriceSurgeEvent

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


class RecordSurgeRequest(BaseModel):
    symbol: str
    move_pct: float
    direction: str
    price: float | None = None
    screener_id: str
    screen_label: str


@router.post("/surge")
async def record_surge(body: RecordSurgeRequest):
    db = SessionLocal()
    try:
        event = PriceSurgeEvent(
            symbol=body.symbol.upper(),
            move_pct=body.move_pct,
            direction=body.direction,
            price=body.price,
            screener_id=body.screener_id,
            screen_label=body.screen_label,
        )
        db.add(event)
        db.commit()
        return {"status": "ok", "id": event.id}
    except Exception as e:
        db.rollback()
        return {"status": "error", "detail": str(e)}
    finally:
        db.close()


@router.get("/surge")
async def get_surges(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    db = SessionLocal()
    try:
        total = db.query(PriceSurgeEvent).count()
        events = (
            db.query(PriceSurgeEvent)
            .order_by(PriceSurgeEvent.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return {"total": total, "offset": offset, "limit": limit, "events": [e.to_dict() for e in events]}
    finally:
        db.close()
