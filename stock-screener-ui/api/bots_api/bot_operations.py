import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict

from fastapi import HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .bots_router import (
    router,
    get_user_id,
    get_bot_by_uuid,
    get_strategy_by_uuid,
    is_bot_running,
    start_bot_process,
    stop_bot_process,
    _bot_logs,
    _db_available,
    get_db,
    SessionLocal,
)

from api.auth import get_current_user
from api.utils import _BUY_SIDES, _get_market_price
from api.bot_state import get_bot_state
from config import IST


def _calc_costs(entry_price: float, exit_price: float, quantity: int, side: str) -> float:
    from backtest.costs import calculate_trading_costs
    return calculate_trading_costs(entry_price, exit_price, quantity, side)['total_costs']


class CloseAllRequest(BaseModel):
    prices: Dict[str, float] = {}


_sync_get_bot_logs_endpoint = None
_sync_get_bot_portfolio = None
_sync_get_bot_trades = None


def _get_sync_functions():
    global _sync_get_bot_logs_endpoint, _sync_get_bot_portfolio, _sync_get_bot_trades

    if _sync_get_bot_logs_endpoint is None:
        def _sync_get_bot_logs(bot_uuid: str, user_id: int, lines: int, db: Session) -> dict:
            bot = get_bot_by_uuid(bot_uuid, user_id, db)
            log_path = _bot_logs.get(bot.id)
            if not log_path or not log_path.exists():
                return {"logs": "", "message": "No logs available"}
            try:
                with open(log_path, 'r') as f:
                    all_lines = f.readlines()
                    recent_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
                return {
                    "logs": "".join(recent_lines),
                    "total_lines": len(all_lines),
                    "showing": len(recent_lines),
                }
            except Exception as e:
                return {"logs": "", "error": str(e)}

        _sync_get_bot_logs_endpoint = _sync_get_bot_logs

        def _sync_get_bot_portfolio(bot_uuid: str, user_id: int, db: Session) -> dict:
            bot = get_bot_by_uuid(bot_uuid, user_id, db)
            state = get_bot_state(bot.id, user_id, db)
            if not state:
                return {
                    "bot_id": bot.uuid,
                    "portfolio": {
                        "initial_capital": 1000000,
                        "cash": 1000000,
                        "margin_used": 0,
                        "available_margin": 1000000,
                        "position_value": 0,
                        "unrealized_pnl": 0,
                        "realized_pnl": 0,
                        "total_value": 1000000,
                        "total_pnl": 0,
                        "total_pnl_pct": 0,
                        "daily_pnl": 0,
                        "daily_pnl_pct": 0,
                        "total_positions": 0,
                        "trades_count": 0,
                    },
                    "watchlist": [],
                    "positions": [],
                    "strategies": {},
                    "timestamp": datetime.now().isoformat(),
                }
            portfolio = dict(state["portfolio"])
            cash = portfolio.get("cash", 0)
            margin_used = portfolio.get("margin_used", 0)
            if "available_margin" not in portfolio:
                portfolio["available_margin"] = cash - margin_used
            return {
                "bot_id": bot.uuid,
                "portfolio": portfolio,
                "watchlist": state.get("watchlist", []),
                "positions": state["positions"],
                "strategies": state["strategies"],
                "timestamp": state["timestamp"],
            }

        _sync_get_bot_portfolio = _sync_get_bot_portfolio

        def _sync_get_bot_trades(bot_uuid: str, user_id: int, strategy_id: Optional[str],
                             limit: int, include_test: bool, db: Session) -> dict:
            from db.models import Trade as TradeModel, bot_strategies

            bot = get_bot_by_uuid(bot_uuid, user_id, db)

            result = db.execute(
                bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
            ).fetchall()
            bot_strategy_ids = [row.strategy_id for row in result]

            if not bot_strategy_ids:
                return {"bot_id": bot.uuid, "trades": [], "count": 0, "strategy_filter": strategy_id}

            strategy_internal_id = None
            if strategy_id is not None:
                strat = get_strategy_by_uuid(strategy_id, db)
                strategy_internal_id = strat.id

            query = db.query(TradeModel).filter(TradeModel.user_id == user_id)
            if bot_strategy_ids:
                query = query.filter(TradeModel.strategy_id.in_(bot_strategy_ids))
            if strategy_internal_id is not None:
                query = query.filter(TradeModel.strategy_id == strategy_internal_id)
            if not include_test:
                query = query.filter(TradeModel.is_test == False)
            query = query.order_by(TradeModel.exit_time.desc()).limit(limit)

            trades = [t.to_dict() for t in query.all()]
            from api.paper.history import _resolve_trade_bot_ids
            trades = _resolve_trade_bot_ids(trades)

            return {
                "bot_id": bot.uuid,
                "trades": trades,
                "count": len(trades),
                "strategy_filter": strategy_id,
            }

        _sync_get_bot_trades = _sync_get_bot_trades

    return _sync_get_bot_logs_endpoint, _sync_get_bot_portfolio, _sync_get_bot_trades


@router.get("/{bot_id}/logs")
async def get_bot_logs(
    bot_id: str,
    lines: int = 100,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        sync_fn, _, _ = _get_sync_functions()
        return await asyncio.to_thread(sync_fn, bot_id, user_id, lines, db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/portfolio")
async def get_bot_portfolio(
    bot_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        _, sync_fn, _ = _get_sync_functions()
        return await asyncio.to_thread(sync_fn, bot_id, user_id, db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/positions")
async def get_bot_positions(
    bot_id: str,
    strategy_id: Optional[str] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        state = get_bot_state(bot.id, user_id, db)
        positions = state['positions'] if state else []

        if not positions:
            from db.models import Position as PositionModel
            db_positions = db.query(PositionModel).filter(
                PositionModel.bot_id == bot.id,
            ).all()
            positions = [p.to_dict() for p in db_positions]

        if strategy_id is not None:
            strat = get_strategy_by_uuid(strategy_id, db)
            positions = [p for p in positions if p.get('strategy_id') == strat.id]

        return {
            "bot_id": bot.uuid,
            "positions": positions,
            "count": len(positions),
        }
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/trades")
async def get_bot_trades(
    bot_id: str,
    strategy_id: Optional[str] = None,
    limit: int = 100,
    include_test: bool = True,
    user_id_query: Optional[int] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = user_id_query if user_id_query is not None else get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        _, _, sync_fn = _get_sync_functions()
        return await asyncio.to_thread(sync_fn, bot_id, user_id, strategy_id, limit, include_test, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get trades: {str(e)}")
    finally:
        if close_db:
            db.close()


@router.post("/{bot_id}/start")
async def start_bot(
    bot_id: str,
    test_mode: bool = False,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        if not bot.is_active:
            bot.is_active = True
            db.commit()

        running, pid = is_bot_running(user_id, bot.id)
        if running:
            return {"message": f"Bot {bot_id} already running", "pid": pid}

        process = start_bot_process(user_id, bot.id, test_mode, bot.live_trading if hasattr(bot, 'live_trading') else False)

        return {
            "message": f"Bot {bot_id} started",
            "pid": process.pid,
            "log_file": str(_bot_logs.get(bot.id)),
        }
    finally:
        if close_db:
            db.close()


@router.post("/stop-all")
async def stop_all_bots(
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    """Stop all running bots for the current user."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        import concurrent.futures
        from db.models import BotConfig
        bots = db.query(BotConfig).filter(
            BotConfig.user_id == user_id,
            BotConfig.is_active == True,
        ).all()

        running_bots = []
        for bot in bots:
            running, pid = is_bot_running(user_id, bot.id)
            if running:
                running_bots.append(bot)

        stopped = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            fut_to_bot = {
                pool.submit(stop_bot_process, user_id, bot.id): bot
                for bot in running_bots
            }
            for fut in concurrent.futures.as_completed(fut_to_bot):
                bot = fut_to_bot[fut]
                stopped.append({"id": bot.uuid, "name": bot.name})

        return {
            "message": f"Stopped {len(stopped)} bot(s)",
            "stopped": stopped,
        }
    finally:
        if close_db:
            db.close()


@router.post("/{bot_id}/stop")
async def stop_bot(
    bot_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        running, pid = is_bot_running(user_id, bot.id)
        if not running:
            return {"message": f"Bot {bot_id} is not running"}

        stop_bot_process(user_id, bot.id)

        return {"message": f"Bot {bot_id} stopped"}
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/scan")
async def get_bot_scan(
    bot_id: str,
    strategy_id: Optional[str] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        state = get_bot_state(bot.id, user_id, db)
        scan_items = state['scan_items'] if state else []
        running = state is not None

        # Filter out scan items that already have open positions
        positions = state['positions'] if state and state.get('positions') else []
        if not positions:
            from db.models import Position as PositionModel
            db_positions = db.query(PositionModel).filter(
                PositionModel.bot_id == bot.id,
            ).all()
            positions = [p.to_dict() for p in db_positions]
        position_keys = {(p.get('symbol', ''), p.get('strategy_id')) for p in positions}
        scan_items = [s for s in scan_items if (s.get('symbol', ''), s.get('strategy_id')) not in position_keys]

        if strategy_id is not None:
            strat = get_strategy_by_uuid(strategy_id, db)
            scan_items = [s for s in scan_items if s.get('strategy_id') == strat.id]

        return {
            "bot_id": bot.uuid,
            "scan_items": scan_items,
            "count": len(scan_items),
            "timestamp": state['timestamp'] if state else datetime.now().isoformat(),
            "bot_running": running,
        }
    finally:
        if close_db:
            db.close()


@router.post("/{bot_id}/close-all")
async def close_all_bot_positions(
    bot_id: str,
    request: CloseAllRequest = CloseAllRequest(),
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)
        running, pid = is_bot_running(user_id, bot.id)

        from db.models import Position as _Pos, Trade as _Trade
        from config import IST
        positions = db.query(_Pos).filter(_Pos.bot_id == bot.id).all()

        if running:
            import json
            cmd_path = Path(f"/tmp/bot-cmd-{bot.id}.json")
            cmd_path.write_text(json.dumps({
                "action": "close_all",
                "prices": request.prices,
            }))
            return {
                "status": "signal_sent",
                "message": f"Close signal sent to bot for {len(positions)} positions",
                "bot_running": True,
                "bot_pid": pid,
            }

        closed_count = 0
        cmd_path = Path(f"/tmp/bot-cmd-{bot.id}.json")
        cmd_path.unlink(missing_ok=True)
        if positions:
            for pos in positions:
                exit_price = request.prices.get(pos.symbol, pos.current_price or pos.entry_price)
                _mp = _get_market_price(pos.symbol)
                if _mp is not None:
                    exit_price = _mp
                side = pos.side.upper()
                if side in _BUY_SIDES:
                    pnl = (exit_price - pos.entry_price) * pos.quantity
                    pnl_pct = ((exit_price - pos.entry_price) / pos.entry_price) * 100
                else:
                    pnl = (pos.entry_price - exit_price) * pos.quantity
                    pnl_pct = ((pos.entry_price - exit_price) / pos.entry_price) * 100
                costs = _calc_costs(pos.entry_price, exit_price, pos.quantity, side)
                trade = _Trade(
                    user_id=user_id,
                    bot_id=bot.id,
                    strategy_id=pos.strategy_id,
                    strategy_name=pos.strategy_name or "",
                    symbol=pos.symbol,
                    side=side,
                    quantity=pos.quantity,
                    entry_price=pos.entry_price,
                    exit_price=exit_price,
                    entry_time=pos.entry_time,
                    exit_time=datetime.now(IST),
                    stop_loss=pos.stop_loss or 0.0,
                    take_profit=pos.take_profit or 0.0,
                    pnl=round(pnl, 2),
                    pnl_pct=round(pnl_pct, 2),
                    costs=round(costs, 2),
                    net_pnl=round(pnl - costs, 2),
                    exit_reason="MANUAL_CLOSE",
                    reason="Closed via Close All",
                    peak_price=pos.peak_price or pos.entry_price,
                    low_price=pos.low_price or pos.entry_price,
                    source="live",
                )
                db.add(trade)
                db.delete(pos)
                closed_count += 1
            db.commit()

        return {"status": "success", "message": f"Closed {closed_count} positions", "bot_running": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to close positions: {str(e)}")
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/performance")
async def get_bot_performance(
    bot_id: str,
    days: int = 30,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        state = get_bot_state(bot.id, user_id, db)

        if not state:
            return {
                "bot_id": bot.uuid,
                "summary": {
                    "total_pnl": 0,
                    "total_pnl_pct": 0,
                    "daily_pnl": 0,
                    "total_trades": 0,
                    "total_positions": 0,
                },
                "by_strategy": {},
                "period_days": days,
                "timestamp": datetime.now().isoformat(),
            }

        portfolio = state['portfolio']
        strategies = state['strategies']

        total_trades = sum(
            s.get('portfolio_status', {}).get('trades_count', 0)
            for s in strategies.values()
        )

        return {
            "bot_id": bot.uuid,
            "summary": {
                "total_pnl": portfolio.get('total_pnl', 0),
                "total_pnl_pct": portfolio.get('total_pnl_pct', 0),
                "daily_pnl": portfolio.get('daily_pnl', 0),
                "total_trades": total_trades,
                "total_positions": portfolio.get('total_positions', 0),
            },
            "by_strategy": {
                strat_id: {
                    "name": strat_data.get('name'),
                    "pnl": strat_data.get('portfolio_status', {}).get('total_pnl', 0),
                    "trades": strat_data.get('portfolio_status', {}).get('trades_count', 0),
                    "positions": strat_data.get('portfolio_status', {}).get('positions_count', 0),
                }
                for strat_id, strat_data in strategies.items()
            },
            "period_days": days,
            "timestamp": state['timestamp'],
        }
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/performance/compare")
async def compare_strategy_performance(
    bot_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        state = get_bot_state(bot.id, user_id, db)

        if not state:
            return {
                "bot_id": bot.uuid,
                "comparison": [],
                "timestamp": datetime.now().isoformat(),
            }

        strategies = state['strategies']

        comparison = []
        for strat_id, strat_data in strategies.items():
            status = strat_data.get('portfolio_status', {})
            comparison.append({
                "strategy_id": int(strat_id),
                "strategy_name": strat_data.get('name'),
                "status": strat_data.get('status'),
                "trades": status.get('trades_count', 0),
                "positions": status.get('positions_count', 0),
                "realized_pnl": status.get('realized_pnl', 0),
                "unrealized_pnl": status.get('unrealized_pnl', 0),
                "total_pnl": status.get('total_pnl', 0),
                "capital_used": status.get('capital_used', 0),
                "capital_used_pct": status.get('capital_used_pct', 0),
            })

        comparison.sort(key=lambda x: x['total_pnl'], reverse=True)

        return {
            "bot_id": bot.uuid,
            "comparison": comparison,
            "timestamp": state['timestamp'],
        }
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/trade-count")
async def get_bot_trade_count(
    bot_id: str,
    user_id_query: Optional[int] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = user_id_query if user_id_query is not None else get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        try:
            from db.models import Trade as TradeModel
            with SessionLocal() as session:
                result = session.execute(
                    bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
                ).fetchall()
                strategy_ids = [row.strategy_id for row in result]

                count = session.query(TradeModel).filter(
                    TradeModel.user_id == user_id,
                    TradeModel.is_test == False,
                    TradeModel.strategy_id.in_(strategy_ids),
                ).count()

            return {"count": count}

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get trade count: {str(e)}")
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/strategy-performance")
async def get_strategy_performance(
    bot_id: str,
    days: int = 30,
    include_test: bool = True,
    user_id_query: Optional[int] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = user_id_query if user_id_query is not None else get_user_id(user)

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = get_bot_by_uuid(bot_id, user_id, db)

        try:
            from db.models import Trade as TradeModel
            from db.models import bot_strategies
            from sqlalchemy import func
            from collections import defaultdict

            cutoff = datetime.now(IST) - timedelta(days=days)
            result = db.execute(
                bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
            ).fetchall()
            bot_strategy_ids = [row.strategy_id for row in result]

            all_trades = db.query(TradeModel).filter(
                TradeModel.user_id == user_id,
                TradeModel.exit_time.isnot(None),
                TradeModel.exit_time >= cutoff,
            )
            if not include_test:
                all_trades = all_trades.filter(TradeModel.is_test == False)
            all_trades = all_trades.all()

            all_strategy_perf = {}
            strat_trades = defaultdict(list)
            for t in all_trades:
                strat_trades[t.strategy_id].append(t)
            for sid, sts in strat_trades.items():
                wins = [t for t in sts if (t.net_pnl or 0) >= 0]
                losses = [t for t in sts if (t.net_pnl or 0) < 0]
                all_strategy_perf[sid] = {
                    'strategy_id': sid,
                    'strategy_name': sts[0].strategy_name,
                    'trades': len(sts),
                    'winners': len(wins),
                    'losers': len(losses),
                    'win_rate': round(len(wins) / len(sts) * 100, 2) if sts else 0,
                    'total_pnl': round(sum(t.pnl or 0 for t in sts), 2),
                    'net_pnl': round(sum(t.net_pnl or 0 for t in sts), 2),
                    'total_costs': round(sum(t.costs or 0 for t in sts), 2),
                    'avg_win': round(sum(t.net_pnl or 0 for t in wins) / len(wins), 2) if wins else 0,
                    'avg_loss': round(sum(t.net_pnl or 0 for t in losses) / len(losses), 2) if losses else 0,
                }

            bot_performance = {
                str(sid): perf
                for sid, perf in all_strategy_perf.items()
                if sid in bot_strategy_ids
            }

            combined = {
                'total_trades': 0,
                'total_winners': 0,
                'total_losers': 0,
                'total_pnl': 0,
                'total_net_pnl': 0,
                'total_costs': 0,
                'test_trades': 0,
            }

            for perf in bot_performance.values():
                combined['total_trades'] += perf['trades']
                combined['total_winners'] += perf['winners']
                combined['total_losers'] += perf['losers']
                combined['total_pnl'] += perf.get('total_pnl', 0)
                combined['total_net_pnl'] += perf['net_pnl']
                combined['total_costs'] += perf['total_costs']
                combined['test_trades'] += perf.get('test_trades', 0)

            if combined['total_trades'] > 0:
                combined['win_rate'] = round(
                    combined['total_winners'] / combined['total_trades'] * 100, 1
                )
            else:
                combined['win_rate'] = 0

            combined['has_test_data'] = combined['test_trades'] > 0

            return {
                "bot_id": bot.uuid,
                "by_strategy": bot_performance,
                "combined": combined,
            }

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get strategy performance: {str(e)}")
    finally:
        if close_db:
            db.close()


async def bot_auto_recovery_task():
    """Periodically check and restart crashed bots."""
    from .bots_router import is_bot_running, start_bot_process
    from db.database import SessionLocal
    from db.models.bot import BotConfig

    await asyncio.sleep(30)
    while True:
        try:
            user_bots: dict[int, list[int]] = {}
            with SessionLocal() as db:
                bots = db.query(BotConfig).filter(
                    BotConfig.is_active == True,
                    BotConfig.user_id.isnot(None),
                ).all()
                for b in bots:
                    if b.user_id not in user_bots:
                        user_bots[b.user_id] = []
                    user_bots[b.user_id].append(b.id)

            for user_id, bot_ids in user_bots.items():
                for bot_id in bot_ids:
                    running, pid = is_bot_running(user_id, bot_id)
                    if running is False:
                        print(f"[Auto-Recovery] Bot {bot_id} (user {user_id}) crashed — restarting...")
                        try:
                            start_bot_process(user_id, bot_id)
                            print(f"[Auto-Recovery] Bot {bot_id} restarted")
                        except Exception as e:
                            print(f"[Auto-Recovery] Restart failed for bot {bot_id}: {e}")
        except asyncio.CancelledError:
            print("[Auto-Recovery] Task cancelled")
            break
        except Exception as e:
            print(f"[Auto-Recovery] Error: {e}")

        await asyncio.sleep(60)
