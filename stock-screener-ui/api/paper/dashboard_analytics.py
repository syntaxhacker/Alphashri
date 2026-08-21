"""Bot-focused dashboard analytics for Paper Trading."""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd

from fastapi import Depends, HTTPException

import config
from api.auth import get_current_user
from api.bots_api.bots_router import resolve_bot_id
from db.database import SessionLocal
from db.models import Trade as TradeModel
from db.models import User
from db.models.bot import BotConfig

from .paper_api import _get_user_id, router


def _parse_date(value: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = pd.Timestamp(value, tz=config.IST).to_pydatetime()
        if end_of_day:
            return parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
        return parsed
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc


def _period_bounds(preset: str, from_date: Optional[str], to_date: Optional[str]) -> tuple[Optional[datetime], datetime]:
    now = datetime.now(config.IST)
    end = _parse_date(to_date, end_of_day=True) or now
    start = _parse_date(from_date)
    if start:
        return start, end

    preset_key = (preset or "30D").upper()
    if preset_key == "7D":
        return end - timedelta(days=7), end
    if preset_key == "90D":
        return end - timedelta(days=90), end
    if preset_key == "YTD":
        return end.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0), end
    if preset_key == "ALL":
        return None, end
    return end - timedelta(days=30), end


def _profit_factor(wins: list, losses: list) -> Optional[float]:
    win_sum = sum(float(t.net_pnl or 0) for t in wins)
    loss_sum = abs(sum(float(t.net_pnl or 0) for t in losses))
    if loss_sum == 0:
        return None if win_sum > 0 else 0.0
    return round(win_sum / loss_sum, 2)


def _max_drawdown(points: list[dict]) -> tuple[float, float, list[dict]]:
    peak = 0.0
    max_dd = 0.0
    max_dd_pct = 0.0
    series = []
    for point in points:
        value = float(point["cumulative_pnl"])
        peak = max(peak, value)
        drawdown = peak - value
        drawdown_pct = (drawdown / peak * 100) if peak > 0 else 0.0
        max_dd = max(max_dd, drawdown)
        max_dd_pct = max(max_dd_pct, drawdown_pct)
        series.append({
            "date": point["date"],
            "drawdown": round(drawdown, 2),
            "drawdown_pct": round(drawdown_pct, 2),
        })
    return round(max_dd, 2), round(max_dd_pct, 2), series


def _summary_for_trades(trades: list) -> dict:
    wins = [t for t in trades if float(t.net_pnl or 0) >= 0]
    losses = [t for t in trades if float(t.net_pnl or 0) < 0]
    total_net = sum(float(t.net_pnl or 0) for t in trades)
    total_gross = sum(float(t.pnl or 0) for t in trades)
    total_costs = sum(float(t.costs or 0) for t in trades)
    avg_hold_values = [
        (t.exit_time - t.entry_time).total_seconds() / 60
        for t in trades
        if t.entry_time and t.exit_time
    ]
    return {
        "total_trades": len(trades),
        "winners": len(wins),
        "losers": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100, 2) if trades else 0,
        "total_gross_pnl": round(total_gross, 2),
        "total_net_pnl": round(total_net, 2),
        "total_costs": round(total_costs, 2),
        "avg_win": round(sum(float(t.net_pnl or 0) for t in wins) / len(wins), 2) if wins else 0,
        "avg_loss": round(sum(float(t.net_pnl or 0) for t in losses) / len(losses), 2) if losses else 0,
        "profit_factor": _profit_factor(wins, losses),
        "avg_hold_minutes": round(sum(avg_hold_values) / len(avg_hold_values), 1) if avg_hold_values else 0,
    }


def _trade_item(t) -> dict:
    hold = None
    if t.entry_time and t.exit_time:
        hold = int((t.exit_time - t.entry_time).total_seconds() / 60)
    return {
        "trade_id": f"TRADE-{t.id:06d}",
        "symbol": t.symbol,
        "bot_id": str(t.bot.uuid) if t.bot else None,
        "bot_name": t.bot.name if t.bot else "Default",
        "strategy_id": t.strategy_id,
        "strategy_name": t.strategy_name or "",
        "side": t.side,
        "entry_time": t.entry_time.isoformat() if t.entry_time else None,
        "exit_time": t.exit_time.isoformat() if t.exit_time else None,
        "net_pnl": round(float(t.net_pnl or 0), 2),
        "pnl_pct": round(float(t.pnl_pct or 0), 2),
        "exit_reason": t.exit_reason or "",
        "hold_duration_minutes": hold,
    }


@router.get("/dashboard/analytics")
async def get_dashboard_analytics(
    preset: str = "30D",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    bot_id: Optional[str] = None,
    user: "User" = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    start, end = _period_bounds(preset, from_date, to_date)

    with SessionLocal() as db:
        query = db.query(TradeModel).filter(
            TradeModel.user_id == user_id,
            TradeModel.is_test == False,
            TradeModel.exit_time.isnot(None),
            TradeModel.exit_time <= end,
        )
        if start:
            query = query.filter(TradeModel.exit_time >= start)
        if bot_id and bot_id != "all":
            numeric_bot_id = resolve_bot_id(bot_id, db)
            if numeric_bot_id is None:
                raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")
            query = query.filter(TradeModel.bot_id == numeric_bot_id)

        trades = query.order_by(TradeModel.exit_time.asc()).all()
        bots = db.query(BotConfig).filter(BotConfig.user_id == user_id).all()
        bot_lookup = {bot.id: bot for bot in bots}

        daily: dict[str, dict] = {}
        cumulative = 0.0
        equity_curve = []
        for t in trades:
            day_key = t.exit_time.astimezone(config.IST).date().isoformat() if t.exit_time else "unknown"
            daily.setdefault(day_key, {"date": day_key, "net_pnl": 0.0, "trades": 0, "winners": 0, "losers": 0})
            net = float(t.net_pnl or 0)
            daily[day_key]["net_pnl"] += net
            daily[day_key]["trades"] += 1
            daily[day_key]["winners" if net >= 0 else "losers"] += 1

        for point in sorted(daily.values(), key=lambda p: p["date"]):
            point["net_pnl"] = round(point["net_pnl"], 2)
            cumulative += point["net_pnl"]
            equity_curve.append({"date": point["date"], "cumulative_pnl": round(cumulative, 2)})

        max_dd, max_dd_pct, drawdown = _max_drawdown(equity_curve)
        summary = _summary_for_trades(trades)
        summary.update({
            "max_drawdown": max_dd,
            "max_drawdown_pct": max_dd_pct,
            "best_day": max(daily.values(), key=lambda p: p["net_pnl"], default=None),
            "worst_day": min(daily.values(), key=lambda p: p["net_pnl"], default=None),
        })

        by_bot: dict[str, list] = defaultdict(list)
        by_strategy: dict[tuple, list] = defaultdict(list)
        by_symbol: dict[str, list] = defaultdict(list)
        exit_reasons: dict[str, int] = defaultdict(int)
        for t in trades:
            bot_key = str(t.bot.uuid) if t.bot else "default"
            by_bot[bot_key].append(t)
            by_strategy[(bot_key, t.strategy_id or 0, t.strategy_name or "Unknown")].append(t)
            by_symbol[t.symbol].append(t)
            exit_reasons[t.exit_reason or "UNKNOWN"] += 1

        bot_rankings = []
        for key, bot_trades in by_bot.items():
            first = bot_trades[0]
            bot = bot_lookup.get(first.bot_id)
            bot_summary = _summary_for_trades(bot_trades)
            bot_max_dd, bot_max_dd_pct, _ = _max_drawdown([
                {"date": str(i), "cumulative_pnl": sum(float(t.net_pnl or 0) for t in bot_trades[: i + 1])}
                for i in range(len(bot_trades))
            ])
            bot_rankings.append({
                "bot_id": key,
                "bot_name": bot.name if bot else "Default",
                "running": False,
                "total_net_pnl": bot_summary["total_net_pnl"],
                "total_trades": bot_summary["total_trades"],
                "win_rate": bot_summary["win_rate"],
                "profit_factor": bot_summary["profit_factor"],
                "max_drawdown": bot_max_dd,
                "max_drawdown_pct": bot_max_dd_pct,
                "avg_hold_minutes": bot_summary["avg_hold_minutes"],
            })
        bot_rankings.sort(key=lambda b: b["total_net_pnl"], reverse=True)

        strategy_rankings = []
        for (bot_key, strategy_id, strategy_name), strategy_trades in by_strategy.items():
            first = strategy_trades[0]
            bot = bot_lookup.get(first.bot_id)
            strategy_summary = _summary_for_trades(strategy_trades)
            strategy_rankings.append({
                "bot_id": bot_key,
                "bot_name": bot.name if bot else "Default",
                "strategy_id": strategy_id,
                "strategy_name": strategy_name,
                "total_net_pnl": strategy_summary["total_net_pnl"],
                "total_trades": strategy_summary["total_trades"],
                "win_rate": strategy_summary["win_rate"],
                "profit_factor": strategy_summary["profit_factor"],
                "avg_hold_minutes": strategy_summary["avg_hold_minutes"],
            })
        strategy_rankings.sort(key=lambda s: s["total_net_pnl"], reverse=True)

        symbol_performance = []
        for symbol, symbol_trades in by_symbol.items():
            symbol_summary = _summary_for_trades(symbol_trades)
            symbol_performance.append({
                "symbol": symbol,
                "total_net_pnl": symbol_summary["total_net_pnl"],
                "total_trades": symbol_summary["total_trades"],
                "win_rate": symbol_summary["win_rate"],
            })
        symbol_performance.sort(key=lambda s: s["total_net_pnl"], reverse=True)

        winners = sorted(trades, key=lambda t: float(t.net_pnl or 0), reverse=True)[:10]
        losers = sorted(trades, key=lambda t: float(t.net_pnl or 0))[:10]
        total_exits = sum(exit_reasons.values()) or 1

        return {
            "period": {
                "preset": preset,
                "from_date": start.date().isoformat() if start else None,
                "to_date": end.date().isoformat(),
                "bot_id": bot_id or "all",
                "trade_count": len(trades),
            },
            "summary": summary,
            "bot_rankings": bot_rankings,
            "strategy_rankings": strategy_rankings,
            "daily_pnl": sorted(daily.values(), key=lambda p: p["date"]),
            "equity_curve": equity_curve,
            "drawdown": drawdown,
            "biggest_winners": [_trade_item(t) for t in winners if float(t.net_pnl or 0) > 0],
            "biggest_losers": [_trade_item(t) for t in losers if float(t.net_pnl or 0) < 0],
            "symbol_performance": symbol_performance[:20],
            "exit_reasons": [
                {"reason": reason, "count": count, "pct": round(count / total_exits * 100, 2)}
                for reason, count in sorted(exit_reasons.items(), key=lambda item: item[1], reverse=True)
            ],
        }
