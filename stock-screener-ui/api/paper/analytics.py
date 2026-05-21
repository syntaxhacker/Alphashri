"""
Analytics endpoints for Paper Trading — equity curve, P&L analytics.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends

from api.auth import get_current_user
from db.models import User
from trading.journal import TradeJournal
import config

from .paper_api import router, _get_user_id


@router.get("/analytics")
async def get_analytics(
    days_back: int = 90,
    user: "User" = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    journal_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)

    all_trades = []
    today = datetime.now(config.IST)
    for i in range(days_back + 1):
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
            d = {
                "symbol": t.symbol,
                "side": t.side,
                "quantity": t.quantity,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "entry_time": str(t.entry_time),
                "exit_time": str(t.exit_time),
                "pnl": t.pnl,
                "pnl_pct": t.pnl_pct,
                "net_pnl": t.net_pnl,
                "costs": t.costs,
                "exit_reason": t.exit_reason,
                "strategy_name": t.strategy_name,
                "hold_duration_minutes": getattr(t, "hold_duration_minutes", 0),
            }
            all_trades.append(d)

    all_trades.sort(key=lambda x: x.get("exit_time", ""))

    daily_pnl: dict[str, dict] = {}
    cumulative = 0.0
    equity_curve: list[dict] = []
    monthly_pnl: dict[str, float] = {}
    symbol_stats: dict[str, dict] = {}

    for t in all_trades:
        exit_time = t.get("exit_time", "")
        day_key = exit_time[:10] if exit_time else "unknown"
        net = t.get("net_pnl", 0)

        if day_key not in daily_pnl:
            daily_pnl[day_key] = {"date": day_key, "pnl": 0.0, "net_pnl": 0.0, "trades": 0, "winners": 0, "losers": 0}
        daily_pnl[day_key]["pnl"] += t.get("pnl", 0)
        daily_pnl[day_key]["net_pnl"] += net
        daily_pnl[day_key]["trades"] += 1
        if net >= 0:
            daily_pnl[day_key]["winners"] += 1
        else:
            daily_pnl[day_key]["losers"] += 1

        cumulative += net
        equity_curve.append({"date": day_key, "cumulative_pnl": round(cumulative, 2)})

        month_key = exit_time[:7] if exit_time else "unknown"
        if month_key not in monthly_pnl:
            monthly_pnl[month_key] = 0.0
        monthly_pnl[month_key] += net

        sym = t.get("symbol", "UNKNOWN")
        if sym not in symbol_stats:
            symbol_stats[sym] = {"symbol": sym, "trades": 0, "winners": 0, "net_pnl": 0.0}
        symbol_stats[sym]["trades"] += 1
        symbol_stats[sym]["net_pnl"] += net
        if net >= 0:
            symbol_stats[sym]["winners"] += 1

    daily_series = sorted(daily_pnl.values(), key=lambda x: x["date"])

    peak = float("-inf")
    drawdown_series: list[dict] = []
    max_drawdown = 0.0
    max_drawdown_pct = 0.0
    for point in equity_curve:
        val = point["cumulative_pnl"]
        if val > peak:
            peak = val
        dd = peak - val
        dd_pct = (dd / peak * 100) if peak > 0 else 0
        drawdown_series.append({"date": point["date"], "drawdown": round(dd, 2), "drawdown_pct": round(dd_pct, 2)})
        if dd > max_drawdown:
            max_drawdown = dd
            max_drawdown_pct = dd_pct

    sorted_sym = sorted(symbol_stats.values(), key=lambda x: x["net_pnl"], reverse=True)

    wins = [t for t in all_trades if t.get("net_pnl", 0) >= 0]
    losses = [t for t in all_trades if t.get("net_pnl", 0) < 0]
    total_net = sum(t.get("net_pnl", 0) for t in all_trades)
    total_gross = sum(t.get("pnl", 0) for t in all_trades)
    total_costs = sum(t.get("costs", 0) for t in all_trades)

    return {
        "summary": {
            "total_trades": len(all_trades),
            "winners": len(wins),
            "losers": len(losses),
            "win_rate": round(len(wins) / len(all_trades) * 100, 2) if all_trades else 0,
            "total_gross_pnl": round(total_gross, 2),
            "total_net_pnl": round(total_net, 2),
            "total_costs": round(total_costs, 2),
            "avg_win": round(sum(t.get("net_pnl", 0) for t in wins) / len(wins), 2) if wins else 0,
            "avg_loss": round(sum(t.get("net_pnl", 0) for t in losses) / len(losses), 2) if losses else 0,
            "profit_factor": round(abs(sum(t.get("net_pnl", 0) for t in wins) / sum(t.get("net_pnl", 0) for t in losses)), 2) if losses and sum(t.get("net_pnl", 0) for t in losses) != 0 else float("inf"),
            "max_drawdown": round(max_drawdown, 2),
            "max_drawdown_pct": round(max_drawdown_pct, 2),
            "final_pnl": round(cumulative, 2),
        },
        "daily_pnl": daily_series,
        "equity_curve": equity_curve,
        "drawdown": drawdown_series,
        "monthly_pnl": [{"month": k, "pnl": round(v, 2)} for k, v in sorted(monthly_pnl.items())],
        "symbol_performance": sorted_sym[:20],
    }
