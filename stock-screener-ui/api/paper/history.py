"""
History endpoints for Paper Trading API.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field

from api.auth import get_current_user
from db.models import User
from db.database import SessionLocal
import config

from .paper_api import router, _get_user_id


def _resolve_trade_bot_ids(trades: list) -> list:
    """Batch-resolve integer bot_ids to UUIDs and populate bot_name in trade dicts.

    Opens its own DB session for a single batch query, so it can be
    safely called from anywhere without requiring an existing session.
    """
    bot_ids = {t.get('bot_id') for t in trades if isinstance(t.get('bot_id'), int)}
    if not bot_ids:
        return trades
    from db.models.bot import BotConfig
    from db.database import SessionLocal
    with SessionLocal() as db:
        bots = db.query(BotConfig).filter(BotConfig.id.in_(bot_ids)).all()
        id_to_uuid = {b.id: b.uuid for b in bots}
        id_to_name = {b.id: b.name for b in bots}
        for t in trades:
            bid = t.get('bot_id')
            if isinstance(bid, int) and bid in id_to_uuid:
                t['bot_id'] = id_to_uuid[bid]
            if isinstance(bid, int) and bid in id_to_name and not t.get('bot_name'):
                t['bot_name'] = id_to_name[bid]
    return trades


@router.get("/trades")
async def get_trades(
    limit: int = 50,
    date: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    days_back: int = 7,
    symbol: Optional[str] = None,
    strategy_id: Optional[int] = None,
    bot_id: Optional[str] = None,
    user: "User" = Depends(get_current_user),
):
    """Get trade history from DB first, then journal fallback."""
    user_id = _get_user_id(user)
    all_trades = _get_trades_from_db(user_id, bot_id, symbol, strategy_id, from_date, to_date, days_back, limit)

    if not all_trades:
        all_trades = _get_trades_from_journals(user_id, limit, symbol, from_date, to_date)

    all_trades = _resolve_trade_bot_ids(all_trades)

    return {
        "total_trades": len(all_trades),
        "filtered_trades": len(all_trades),
        "trades": all_trades
    }


def _get_trades_from_db(
    user_id: int,
    bot_id: Optional[str],
    symbol: Optional[str],
    strategy_id: Optional[int],
    from_date: Optional[str],
    to_date: Optional[str],
    days_back: int,
    limit: int,
) -> list:
    from db.database import SessionLocal
    from db.models import Trade as TradeModel

    try:
        db = SessionLocal()
        query = db.query(TradeModel).filter(TradeModel.user_id == user_id, TradeModel.is_test == False)

        if bot_id and bot_id != "default":
            from api.bots_api.bots_router import resolve_bot_id
            numeric_bot_id = resolve_bot_id(bot_id, db)
            if numeric_bot_id is not None:
                query = query.filter(TradeModel.bot_id == numeric_bot_id)

        if symbol:
            query = query.filter(TradeModel.symbol == symbol.upper())

        if strategy_id:
            query = query.filter(TradeModel.strategy_id == strategy_id)

        if from_date:
            query = query.filter(TradeModel.exit_time >= datetime.strptime(from_date, '%Y-%m-%d').replace(tzinfo=config.IST))

        if to_date:
            query = query.filter(TradeModel.exit_time <= datetime.strptime(to_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=config.IST))

        if not from_date and not to_date:
            cutoff = datetime.now(config.IST) - timedelta(days=days_back)
            query = query.filter(TradeModel.exit_time >= cutoff)

        query = query.order_by(TradeModel.exit_time.desc()).limit(limit)
        return [t.to_dict() for t in query.all()]
    except Exception:
        return []
    finally:
        try:
            db.close()
        except Exception:
            pass


def _get_trades_from_journals(
    user_id: int,
    limit: int = 50,
    symbol: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list:
    """Fallback: load trades from JSON journal files when DB returns empty."""
    try:
        from trading.journal import Journal
        journal = Journal(user_id=user_id)
        journal.load_all_journals()
        trades = journal.trades or []
        if symbol:
            trades = [t for t in trades if t.get('symbol', '').upper() == symbol.upper()]
        if from_date:
            trades = [t for t in trades if t.get('exit_time', '') >= from_date]
        if to_date:
            trades = [t for t in trades if t.get('exit_time', '') <= to_date + ' 23:59:59']
        return trades[:limit]
    except Exception:
        return []




@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: str,
    user: "User" = Depends(get_current_user)
):
    """Delete a single trade from the database."""
    user_id = _get_user_id(user)
    from db.models.trade import Trade as TradeModel
    from db.database import SessionLocal
    with SessionLocal() as db:
        trade = db.query(TradeModel).filter(
            TradeModel.uuid == trade_id.replace("TRADE-", ""),
            TradeModel.user_id == user_id,
        ).first()
        if not trade:
            try:
                trade = db.query(TradeModel).filter(
                    TradeModel.id == int(trade_id.replace("TRADE-", "")),
                    TradeModel.user_id == user_id,
                ).first()
            except (ValueError, OverflowError):
                pass
        if not trade:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
        db.delete(trade)
        db.commit()
    return {"success": True, "message": f"Trade {trade_id} deleted"}


class TradeNotesUpdate(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)
    reason: Optional[str] = Field(default=None, max_length=500)


@router.patch("/trades/{trade_id}")
async def update_trade_notes(
    trade_id: str,
    body: TradeNotesUpdate,
    user: "User" = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    with SessionLocal() as db:
        from db.models.trade import Trade
        trade = db.query(Trade).filter(
            Trade.uuid == trade_id.replace("TRADE-", ""),
            Trade.user_id == user_id,
        ).first()
        if not trade:
            try:
                trade = db.query(Trade).filter(
                    Trade.id == int(trade_id.replace("TRADE-", "")),
                    Trade.user_id == user_id,
                ).first()
            except (ValueError, OverflowError):
                pass
        if not trade:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
        if body.notes is not None:
            trade.notes = body.notes
        if body.reason is not None:
            trade.reason = body.reason
        db.commit()
        return trade.to_dict()



