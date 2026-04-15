"""
History endpoints for Paper Trading API.
"""

from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, Depends

from trading.journal import TradeJournal, get_journal
from api.auth import get_current_user
from db.models import User
from db.database import SessionLocal
import config

from .paper_api import router, _get_user_id


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
        all_trades = _get_trades_from_journals(user_id, date, from_date, to_date, days_back, bot_id, symbol, strategy_id, limit)

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
            try:
                numeric_bot_id = int(bot_id)
                query = query.filter(TradeModel.bot_id == numeric_bot_id)
            except ValueError:
                pass

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
    date: Optional[str],
    from_date: Optional[str],
    to_date: Optional[str],
    days_back: int,
    bot_id: Optional[str],
    symbol: Optional[str],
    strategy_id: Optional[int],
    limit: int,
) -> list:
    from rich.console import Console
    console = Console()

    if user_id:
        journal_dir = Path(__file__).parent.parent.parent / "journals" / str(user_id)
    else:
        journal_dir = Path(__file__).parent.parent.parent / "journals"

    all_trades = []

    if date:
        date_str = date.replace('-', '')
        journal_file = journal_dir / f"journal_{date_str}.json"
        if journal_file.exists():
            temp_journal = TradeJournal(user_id=user_id)
            try:
                temp_journal.load_journal(str(journal_file))
                all_trades = [asdict(t) for t in temp_journal.trades]
            except Exception as e:
                console.print(f"[yellow]Could not load journal for {date}: {e}[/yellow]")
    elif from_date:
        start_dt = datetime.strptime(from_date, '%Y-%m-%d')
        if to_date:
            end_dt = datetime.strptime(to_date, '%Y-%m-%d')
        else:
            end_dt = min(datetime.now(config.IST), start_dt + timedelta(days=90))

        current_dt = start_dt
        while current_dt <= end_dt:
            date_str = current_dt.strftime('%Y%m%d')
            journal_file = journal_dir / f"journal_{date_str}.json"
            if journal_file.exists():
                temp_journal = TradeJournal(user_id=user_id)
                try:
                    temp_journal.load_journal(str(journal_file))
                    all_trades.extend([asdict(t) for t in temp_journal.trades])
                except Exception:
                    pass
            current_dt += timedelta(days=1)
    else:
        today = datetime.now(config.IST).strftime('%Y%m%d')
        journal = TradeJournal(user_id=user_id)
        journal_file = journal_dir / f"journal_{today}.json"
        if journal_file.exists():
            try:
                journal.load_journal(str(journal_file))
            except Exception as e:
                console.print(f"[yellow]Could not reload journal: {e}[/yellow]")
        all_trades = [asdict(t) for t in journal.trades]

        for i in range(0, days_back + 1):
            day_str = (datetime.now(config.IST) - timedelta(days=i)).strftime('%Y%m%d')
            journal_file = journal_dir / f"journal_{day_str}.json"
            if not journal_file.exists():
                continue
            try:
                temp_journal = TradeJournal(user_id=user_id)
                temp_journal.load_journal(str(journal_file))
                all_trades.extend([asdict(t) for t in temp_journal.trades])
            except Exception:
                pass

    deduped = {}
    for t in all_trades:
        key = (t.get('symbol'), t.get('side'), t.get('quantity'), t.get('entry_time'), t.get('exit_time'))
        deduped[key] = t
    all_trades = list(deduped.values())

    if symbol:
        all_trades = [t for t in all_trades if t.get('symbol', '').upper() == symbol.upper()]
    if strategy_id:
        from db.models.bot import StrategyConfig
        strategy_name = None
        with SessionLocal() as db:
            config = db.query(StrategyConfig).filter(StrategyConfig.id == strategy_id).first()
            if config:
                strategy_name = config.name
        if strategy_name:
            all_trades = [t for t in all_trades if t.get('strategy_name') == strategy_name]
    if bot_id:
        if bot_id == "default":
            all_trades = [t for t in all_trades if t.get('bot_id') in (0, None, "0")]
        else:
            try:
                numeric_bot_id = int(bot_id)
                all_trades = [t for t in all_trades if t.get('bot_id') == numeric_bot_id]
            except ValueError:
                all_trades = [t for t in all_trades if str(t.get('bot_id')) == str(bot_id)]

    all_trades.sort(key=lambda x: x.get('exit_time', ''), reverse=True)
    return all_trades[:limit]


@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: str,
    user: "User" = Depends(get_current_user)
):
    """Delete a single trade from the journal."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)

    original_count = len(journal.trades)
    journal.trades = [t for t in journal.trades if t.trade_id != trade_id]

    if len(journal.trades) == original_count:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

    journal.save_journal()

    return {"success": True, "message": f"Trade {trade_id} deleted"}


@router.get("/journal/summary")
async def get_journal_summary(user: "User" = Depends(get_current_user)):
    """Get trading performance summary."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    return journal.get_performance_summary()


@router.get("/journal/symbols")
async def get_symbol_performance(user: "User" = Depends(get_current_user)):
    """Get performance by symbol."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    return journal.get_symbol_performance()


@router.get("/journal/daily")
async def get_daily_report(date: Optional[str] = None, user: "User" = Depends(get_current_user)):
    """Get daily trading report."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    return journal.get_daily_report(date)


@router.get("/journal/export")
async def export_journal(user: "User" = Depends(get_current_user)):
    """Export journal to CSV."""
    user_id = _get_user_id(user)
    journal = get_journal(user_id)
    filepath = journal.export_to_csv()
    return {"status": "success", "filepath": filepath}
