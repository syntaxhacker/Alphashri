"""
Activity feed endpoint — recent trade events for the live terminal.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends

from api.auth import get_current_user
from db.models import User
import config

from .paper_api import router, _get_user_id


_in_memory_events: dict[int, list[dict]] = {}


def push_event(user_id: int, event_type: str, data: dict):
    if user_id not in _in_memory_events:
        _in_memory_events[user_id] = []
    event = {
        "type": event_type,
        "timestamp": datetime.now(config.IST).isoformat(),
        **data,
    }
    _in_memory_events[user_id].append(event)
    if len(_in_memory_events[user_id]) > 500:
        _in_memory_events[user_id] = _in_memory_events[user_id][-200:]


@router.get("/activity/feed")
async def get_activity_feed(
    since: Optional[str] = None,
    limit: int = 50,
    user: "User" = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    events: list[dict] = []

    from db.database import SessionLocal
    from db.models import Trade as TradeModel
    cutoff = datetime.now(config.IST) - timedelta(days=7)
    try:
        db = SessionLocal()
        query = db.query(TradeModel).filter(
            TradeModel.user_id == user_id,
            TradeModel.is_test == False,
            TradeModel.exit_time.isnot(None),
        )
        if since:
            try:
                since_dt = datetime.fromisoformat(since)
                query = query.filter(TradeModel.exit_time > since_dt)
            except (ValueError, TypeError):
                pass
        query = query.filter(TradeModel.exit_time >= cutoff)
        query = query.order_by(TradeModel.exit_time.desc()).limit(limit * 2)
        trades = query.all()

        for t in trades:
            direction = "LONG" if t.side.upper() == "BUY" else "SHORT"
            events.append({
                "type": "trade_exit",
                "timestamp": str(t.exit_time) if t.exit_time else "",
                "symbol": t.symbol,
                "side": t.side,
                "direction": direction,
                "quantity": t.quantity,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "pnl": t.pnl,
                "pnl_pct": t.pnl_pct,
                "net_pnl": t.net_pnl,
                "exit_reason": t.exit_reason or "",
                "strategy_name": t.strategy_name or "",
                "hold_duration_minutes": int((t.exit_time - t.entry_time).total_seconds() / 60) if t.exit_time and t.entry_time else 0,
                "trade_id": f"TRADE-{t.id:06d}",
            })
    except Exception:
        pass
    finally:
        try:
            db.close()
        except Exception:
            pass

    mem_events = _in_memory_events.get(user_id, [])
    for e in mem_events:
        events.append(e)

    events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return {
        "events": events[:limit],
        "total": len(events),
    }
