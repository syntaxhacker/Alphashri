"""
Portfolio endpoints for Paper Trading API.
"""

from datetime import timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends

from trading.paper_trader import get_paper_trader
from trading.journal import get_journal, TradeJournal
from api.auth import get_current_user
from db.models import User
import config

from .paper_api import router, _get_user_id
from .requests import ResetRequest, UpdatePricesRequest
from .helpers import build_trade_log_entry


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

    if "daily_pnl_pct" not in status:
        base = status.get("initial_capital", 0) or 0
        daily_pnl = status.get("daily_pnl", 0) or 0
        status["daily_pnl_pct"] = (daily_pnl / base * 100) if base else 0.0

    from db.database import SessionLocal
    db_session = SessionLocal()
    try:
        from db.models import BotConfig
        bot_cfg = db_session.query(BotConfig).filter(BotConfig.user_id == user_id).first()
        max_daily_loss_pct = bot_cfg.max_daily_loss_pct if bot_cfg and bot_cfg.max_daily_loss_pct is not None else 0.03
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
async def reset_portfolio(request: "ResetRequest", user: "User" = Depends(get_current_user)):
    """Reset paper trading with new capital."""
    from trading.paper_trader import reset_paper_trader
    
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

    return {
        "count": len(positions),
        "positions": positions
    }


@router.post("/update-prices")
async def update_prices(request: UpdatePricesRequest, user: "User" = Depends(get_current_user)):
    """Update prices and check for SL/TP triggers."""
    
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
            journal.log_trade(build_trade_log_entry(trade))
        journal.save_journal()

    return {
        "status": "success",
        "portfolio": trader.get_portfolio_status(),
        "positions": trader.get_positions(),
        "trades_closed": new_trades_count
    }
