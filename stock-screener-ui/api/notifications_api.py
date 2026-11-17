from fastapi import APIRouter, Query
from pydantic import BaseModel
from datetime import datetime

import config
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
        # `total` is the all-time row count (used to page the history panel).
        # The bell must not announce it: surge rows accumulate for ever, so it
        # grows into the thousands and stops being a meaningful "new alerts"
        # signal. `today_count` is the bounded, session-relevant number.
        total = db.query(PriceSurgeEvent).count()
        today_start = datetime.now(config.IST).replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = db.query(PriceSurgeEvent).filter(
            PriceSurgeEvent.created_at >= today_start
        ).count()
        events = (
            db.query(PriceSurgeEvent)
            .order_by(PriceSurgeEvent.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return {
            "total": total,
            "today_count": today_count,
            "offset": offset,
            "limit": limit,
            "events": [e.to_dict() for e in events],
        }
    finally:
        db.close()
