import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

import config
from api.auth import get_current_user
from db.database import SessionLocal
from db.models import User
from db.models.price_surge import PriceSurgeEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


class RecordSurgeRequest(BaseModel):
    symbol: str
    move_pct: float
    direction: str
    price: float | None = None
    screener_id: str
    screen_label: str


# Both handlers are sync `def` on purpose: FastAPI runs them on the anyio worker
# pool, so the SQLite write/read never blocks the event loop, and the DB work
# does not compete with the default executor that the TV scans saturate.
@router.post("/surge")
def record_surge(body: RecordSurgeRequest, _user: User = Depends(get_current_user)):
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
    except Exception:
        db.rollback()
        # Client gets a fixed string; the traceback stays in the server log.
        logger.exception("Failed to record price surge for %s", body.symbol)
        return {"status": "error", "detail": "Could not record surge event"}
    finally:
        db.close()


@router.get("/surge")
def get_surges(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _user: User = Depends(get_current_user),
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
