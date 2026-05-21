"""
Activity feed endpoint — recent trade events for the live terminal.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends

from api.auth import get_current_user
from db.models import User
from trading.journal import TradeJournal, get_journal
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

    journal = get_journal(user_id)
    known_trade_ids = {t.trade_id for t in journal.trades}

    today = datetime.now(config.IST)
    journal_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)
    for i in range(7):
        day = today - timedelta(days=i)
        date_str = day.strftime('%Y%m%d')
        journal_file = journal_dir / f"journal_{date_str}.json"
        if not journal_file.exists():
            continue
        try:
            tj = TradeJournal(user_id=user_id)
            tj.load_journal(str(journal_file))
        except Exception:
            continue
        for t in tj.trades:
            if getattr(t, 'trade_id', None) not in known_trade_ids:
                continue
            exit_time = getattr(t, 'exit_time', '')
            if since and exit_time:
                try:
                    since_dt = datetime.fromisoformat(since)
                    if isinstance(exit_time, str):
                        evt_dt = datetime.fromisoformat(exit_time)
                    else:
                        evt_dt = exit_time
                    if evt_dt <= since_dt:
                        continue
                except (ValueError, TypeError):
                    pass
            direction = "LONG" if t.side.upper() == "BUY" else "SHORT"
            events.append({
                "type": "trade_exit",
                "timestamp": str(exit_time) if exit_time else "",
                "symbol": t.symbol,
                "side": t.side,
                "direction": direction,
                "quantity": t.quantity,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "pnl": t.pnl,
                "pnl_pct": t.pnl_pct,
                "net_pnl": t.net_pnl,
                "exit_reason": t.exit_reason,
                "strategy_name": t.strategy_name or "",
                "hold_duration_minutes": getattr(t, "hold_duration_minutes", 0),
                "trade_id": getattr(t, "trade_id", ""),
            })

    mem_events = _in_memory_events.get(user_id, [])
    for e in mem_events:
        events.append(e)

    events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return {
        "events": events[:limit],
        "total": len(events),
    }
