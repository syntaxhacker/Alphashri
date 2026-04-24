"""
Portfolio endpoints for Paper Trading API.
"""

from datetime import timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends

from trading.paper_trader import get_paper_trader
from trading.journal import TradeJournal
from api.auth import get_current_user
from db.models import User
import config

from .paper_api import router, _get_user_id, _load_fresh_bot_snapshot


@router.get("/portfolio")
async def get_portfolio(user: "User" = Depends(get_current_user)):
    """Get current paper trading portfolio status."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
    status = trader.get_portfolio_status()

    today_str = datetime.now(config.IST).strftime('%Y-%m-%d')
    today_str_compact = datetime.now(config.IST).strftime('%Y%m%d')

    realized_pnl_today = 0.0
    daily_trades = 0

    if user_id:
        journal_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)
    else:
        journal_dir = Path(__file__).parent.parent.parent / "journals"
    journal_file = journal_dir / f"journal_{today_str_compact}.json"
    if journal_file.exists():
        try:
            temp_journal = TradeJournal(user_id=user_id)
            temp_journal.load_journal(str(journal_file))
            for t in temp_journal.trades:
                realized_pnl_today += float(t.net_pnl or 0)
                daily_trades += 1
        except Exception:
            pass

    snap = _load_fresh_bot_snapshot(user_id=user_id)
    if snap:
        snap_positions = snap.get("positions") or snap.get("open_positions_data") or []
        if isinstance(snap_positions, list):
            margin_used = sum(float(p.get("entry_price", 0)) * int(p.get("quantity", 0)) for p in snap_positions)
            position_value = sum(float(p.get("current_price", 0)) * int(p.get("quantity", 0)) for p in snap_positions)
            unrealized_pnl = sum(float(p.get("pnl", 0)) for p in snap_positions)

            cash = status.get("initial_capital", 0) - margin_used
            total_value = cash + position_value
            total_pnl = total_value - status.get("initial_capital", 0)
            total_pnl_pct = (total_pnl / status.get("initial_capital", 1) * 100) if status.get("initial_capital", 0) else 0

            daily_pnl = unrealized_pnl + realized_pnl_today
            daily_pnl_pct = (daily_pnl / status.get("initial_capital", 1) * 100) if status.get("initial_capital", 0) else 0

            status.update({
                "cash": round(cash, 2),
                "margin_used": round(margin_used, 2),
                "position_value": round(position_value, 2),
                "unrealized_pnl": round(unrealized_pnl, 2),
                "realized_pnl_today": round(realized_pnl_today, 2),
                "total_value": round(total_value, 2),
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round(total_pnl_pct, 2),
                "daily_pnl": round(daily_pnl, 2),
                "daily_pnl_pct": round(daily_pnl_pct, 2),
                "daily_trades": daily_trades,
                "positions": len(snap_positions),
                "open_positions": len(snap_positions),
            })
    if "daily_pnl_pct" not in status:
        base = status.get("initial_capital", 0) or 0
        daily_pnl = status.get("daily_pnl", 0) or 0
        status["daily_pnl_pct"] = (daily_pnl / base * 100) if base else 0.0

    from db.database import SessionLocal
    db_session = SessionLocal()
    try:
        from db.models import BotConfig
        bot_cfg = db_session.query(BotConfig).filter(BotConfig.user_id == user_id).first()
        max_daily_loss_pct = bot_cfg.max_daily_loss_pct if bot_cfg else 0.03
    except Exception:
        max_daily_loss_pct = 0.03
    finally:
        db_session.close()

    status["max_daily_loss_pct"] = max_daily_loss_pct
    status["daily_loss_limit_exceeded"] = (
        abs(status.get("daily_pnl", 0)) >= status.get("initial_capital", 0) * max_daily_loss_pct
        and status.get("daily_pnl", 0) < 0
    )

    if "realized_pnl_today" not in status:
        status["realized_pnl_today"] = round(realized_pnl_today, 2)
    if "daily_trades" not in status:
        status["daily_trades"] = daily_trades

    return status


from datetime import datetime


@router.post("/reset")
async def reset_portfolio(request, user: "User" = Depends(get_current_user)):
    """Reset paper trading with new capital."""
    from trading.paper_trader import reset_paper_trader
    from .requests import ResetRequest
    
    user_id = _get_user_id(user)
    trader = reset_paper_trader(user_id, request.capital)
    return {
        "status": "success",
        "message": f"Reset with capital ₹{request.capital:,.0f}",
        "portfolio": trader.get_portfolio_status()
    }


@router.get("/positions")
async def get_positions(user: "User" = Depends(get_current_user)):
    """Get all open positions."""
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)
    positions = trader.get_positions()

    snap = _load_fresh_bot_snapshot(user_id=user_id)
    if snap:
        snap_positions = snap.get("positions") or snap.get("open_positions_data") or []
        if isinstance(snap_positions, list) and len(snap_positions) > 0:
            positions = snap_positions

    return {
        "count": len(positions),
        "positions": positions
    }


@router.post("/update-prices")
async def update_prices(request, user: "User" = Depends(get_current_user)):
    """Update prices and check for SL/TP triggers."""
    from .requests import UpdatePricesRequest
    
    user_id = _get_user_id(user)
    trader = get_paper_trader(user_id)

    trades_before = len(trader.trades)

    trader.update_prices(request.prices)

    trades_after = len(trader.trades)
    new_trades_count = trades_after - trades_before

    if new_trades_count > 0:
        journal = get_journal(user_id)
        new_trades = trader.trades[-new_trades_count:]
        for trade in new_trades:
            journal.log_trade({
                'trade_id': trade.trade_id,
                'symbol': trade.symbol,
                'side': trade.side.value,
                'quantity': trade.quantity,
                'entry_price': trade.entry_price,
                'exit_price': trade.exit_price,
                'entry_time': trade.entry_time.isoformat(),
                'exit_time': trade.exit_time.isoformat(),
                'pnl': trade.pnl,
                'pnl_pct': trade.pnl_pct,
                'exit_reason': trade.exit_reason.value,
                'costs': trade.costs,
                'net_pnl': trade.net_pnl,
                'peak_price': trade.peak_price,
                'low_price': trade.low_price,
            })
        journal.save_journal()

    return {
        "status": "success",
        "portfolio": trader.get_portfolio_status(),
        "positions": trader.get_positions(),
        "trades_closed": new_trades_count
    }
