"""Aggregated strategy performance across all bots."""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from api.auth import get_current_user
from db.database import SessionLocal
from db.models import User
from db.models.trade import Trade
import config

router = APIRouter(prefix="/api/strategy-performance", tags=["strategy-performance"])


@router.get("")
async def get_strategy_performance(
    days: int = 30,
    user: User = Depends(get_current_user),
):
    user_id = user.id if hasattr(user, 'id') else 1
    cutoff = datetime.now(config.IST) - timedelta(days=days)

    with SessionLocal() as db:
        trades = db.query(Trade).filter(
            Trade.user_id == user_id,
            Trade.is_test == False,
            Trade.exit_time.isnot(None),
            Trade.exit_time >= cutoff,
        ).all()

    from collections import defaultdict
    perf = defaultdict(lambda: {"trades": 0, "wins": 0, "losses": 0, "net_pnl": 0.0, "total_pnl": 0.0, "costs": 0.0})

    for t in trades:
        key = (t.strategy_id, t.strategy_name or "Unknown")
        p = perf[key]
        p["trades"] += 1
        net = (t.net_pnl or 0)
        p["net_pnl"] += net
        p["total_pnl"] += (t.pnl or 0)
        p["costs"] += (t.costs or 0)
        if net >= 0:
            p["wins"] += 1
        else:
            p["losses"] += 1

    result = []
    for (sid, sname), data in sorted(perf.items(), key=lambda x: x[1]["net_pnl"], reverse=True):
        result.append({
            "strategy_id": sid,
            "strategy_name": sname,
            "trades": data["trades"],
            "wins": data["wins"],
            "losses": data["losses"],
            "win_rate": round(data["wins"] / data["trades"] * 100, 1) if data["trades"] else 0,
            "total_pnl": round(data["total_pnl"], 2),
            "net_pnl": round(data["net_pnl"], 2),
            "costs": round(data["costs"], 2),
        })

    return {
        "strategies": result,
        "total_trades": sum(r["trades"] for r in result),
        "total_net_pnl": round(sum(r["net_pnl"] for r in result), 2),
        "days": days,
    }
