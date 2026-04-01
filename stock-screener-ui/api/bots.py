"""
Bot Management API - Endpoints for multi-strategy bot operations.

This module provides REST API endpoints for:
- Bot CRUD operations
- Bot control (start/stop)
- Strategy management within bots
- Portfolio and performance views
"""

import asyncio
import sys
import subprocess
import json
import os
import signal
import uuid as uuid_module
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Generator
from dataclasses import asdict

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from rich.console import Console
from sqlalchemy.orm import Session

console = Console()

try:
    from db.database import SessionLocal, get_db
    from db.models import BotConfig, StrategyConfig, bot_strategies, User
    _db_available = True
except ImportError:
    _db_available = False
    get_db = None

from api.auth import get_current_user
from db.models import User

router = APIRouter(prefix="/api/bots", tags=["Bots"])

_bot_processes: Dict[int, Dict[int, subprocess.Popen]] = {}
_bot_logs: Dict[int, Path] = {}


class StrategyAllocation(BaseModel):
    strategy_id: str  # UUID string
    max_positions: int = Field(default=3, ge=1, le=10)
    capital_allocation_pct: float = Field(default=0.20, ge=0.05, le=1.0)


class BotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    is_active: bool = True
    max_total_positions: int = Field(default=10, ge=1, le=20)
    max_total_capital_pct: float = Field(default=0.80, ge=0.1, le=1.0)
    strategies: List[StrategyAllocation] = Field(default_factory=list)


class BotUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None
    max_total_positions: Optional[int] = Field(None, ge=1, le=20)
    max_total_capital_pct: Optional[float] = Field(None, ge=0.1, le=1.0)
    strategies: Optional[List[StrategyAllocation]] = None


class BotResponse(BaseModel):
    id: int  # integer primary key
    uuid: str  # bot UUID
    name: str
    is_active: bool
    max_total_positions: int
    max_total_capital_pct: float
    strategies: List[dict]
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    status: Optional[str] = None
    process_id: Optional[int] = None
    error: Optional[str] = None


class BotStatusResponse(BaseModel):
    bot_id: str  # UUID string
    bot_name: str
    running: bool
    pid: Optional[int] = None
    portfolio: Optional[dict] = None
    strategies: Optional[Dict[str, dict]] = None
    positions: Optional[List[dict]] = None
    last_update: Optional[str] = None


class StrategyStatusResponse(BaseModel):
    strategy_id: str  # UUID string
    strategy_name: str
    status: str
    positions_count: int
    max_positions: int
    capital_used: float
    allocated_capital: float
    pnl: float
    trades_count: int


def get_user_id(user) -> int:
    if user is None:
        return 0
    return user.id


def validate_uuid(uuid_str: str) -> bool:
    """Validate that a string is a valid UUID."""
    try:
        uuid_module.UUID(uuid_str)
        return True
    except (ValueError, TypeError):
        return False


def get_bot_by_uuid(bot_uuid: str, user_id: int, db: Session) -> BotConfig:
    """Get bot by UUID or ID, validating ownership."""
    # Use different filters depending on whether bot_uuid looks like a UUID or an integer
    is_numeric = str(bot_uuid).isdigit()
    
    if is_numeric:
        bot = db.query(BotConfig).filter(
            BotConfig.id == int(bot_uuid),
            BotConfig.user_id == user_id
        ).first()
    else:
        if not validate_uuid(bot_uuid):
            raise HTTPException(status_code=400, detail=f"Invalid bot UUID: {bot_uuid}")
        bot = db.query(BotConfig).filter(
            BotConfig.uuid == bot_uuid,
            BotConfig.user_id == user_id
        ).first()

    if not bot:
        raise HTTPException(status_code=404, detail=f"Bot {bot_uuid} not found")
    return bot


def get_strategy_by_uuid(strategy_uuid: str, db: Session) -> StrategyConfig:
    """Get strategy by UUID or integer ID."""
    # Use different filters depending on whether strategy_uuid looks like a UUID or an integer
    is_numeric = str(strategy_uuid).isdigit()
    
    if is_numeric:
        strategy = db.query(StrategyConfig).filter(
            StrategyConfig.id == int(strategy_uuid)
        ).first()
    else:
        if not validate_uuid(strategy_uuid):
            raise HTTPException(status_code=400, detail=f"Invalid strategy UUID: {strategy_uuid}")
        strategy = db.query(StrategyConfig).filter(
            StrategyConfig.uuid == strategy_uuid
        ).first()
    
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_uuid} not found")
    return strategy


def validate_bot_ownership(bot_id: int, user_id: int, db: Session) -> BotConfig:
    bot = db.query(BotConfig).filter(
        BotConfig.id == bot_id,
        BotConfig.user_id == user_id
    ).first()
    if not bot:
        raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")
    return bot


def get_bot_snapshot_path(bot_id: int, user_id: int) -> Path:
    return Path(f"/tmp/multi-strategy-bot-{user_id}-{bot_id}.json")


def load_bot_snapshot(bot_id: int, user_id: int) -> Optional[dict]:
    snapshot_path = get_bot_snapshot_path(bot_id, user_id)
    if snapshot_path.exists():
        try:
            return json.loads(snapshot_path.read_text())
        except Exception:
            pass
    return None


def is_bot_running(user_id: int, bot_id: int) -> tuple:
    if user_id in _bot_processes and bot_id in _bot_processes[user_id]:
        process = _bot_processes[user_id][bot_id]
        if process.poll() is None:
            return True, process.pid
        else:
            del _bot_processes[user_id][bot_id]
    return False, None


def _sync_list_available_strategies(db: Session) -> list:
    strategies = db.query(StrategyConfig).filter(
        StrategyConfig.is_active == True
    ).all()
    return [
        {
            "id": s.uuid,
            "name": s.name,
            "strategy_type": s.strategy_type,
            "is_template": s.is_template,
            "is_default": s.is_default,
            "sl_pct": s.sl_pct,
            "tp_pct": s.tp_pct,
            "max_positions": s.max_positions,
        }
        for s in strategies
    ]


def _sync_list_bots(user_id: int, db: Session) -> list:
    bots = db.query(BotConfig).filter(BotConfig.user_id == user_id).order_by(BotConfig.name).all()
    return [bot_to_response(bot, user_id, db=db) for bot in bots]


def _sync_create_bot(request_dict: dict, user_id: int, db: Session) -> BotResponse:
    existing = db.query(BotConfig).filter(
        BotConfig.name == request_dict['name'],
        BotConfig.user_id == user_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Bot with name '{request_dict['name']}' already exists")

    total_allocation = sum(s['capital_allocation_pct'] for s in request_dict['strategies'])
    if round(total_allocation, 4) > 1.0:
        raise HTTPException(
            status_code=400,
            detail=f"Total capital allocation ({total_allocation:.0%}) exceeds 100%"
        )

    bot = BotConfig(
        uuid=str(uuid_module.uuid4()),
        name=request_dict['name'],
        user_id=user_id,
        is_active=request_dict['is_active'],
        max_total_positions=request_dict['max_total_positions'],
        max_total_capital_pct=request_dict['max_total_capital_pct'],
    )
    db.add(bot)
    db.flush()

    for alloc in request_dict['strategies']:
        strategy = get_strategy_by_uuid(alloc['strategy_id'], db)
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy.id,
                max_positions=alloc['max_positions'],
                capital_allocation_pct=alloc['capital_allocation_pct'],
            )
        )

    db.commit()
    db.refresh(bot)
    console.print(f"[green]Created bot: {bot.name} (ID: {bot.id})[/green]")
    return bot_to_response(bot, user_id, db=db)


def _sync_update_bot(bot_id: str, request_dict: dict, user_id: int, db: Session) -> BotResponse:
    bot = get_bot_by_uuid(bot_id, user_id, db)

    if request_dict.get('name') is not None:
        existing = db.query(BotConfig).filter(
            BotConfig.name == request_dict['name'],
            BotConfig.user_id == user_id,
            BotConfig.id != bot.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Bot with name '{request_dict['name']}' already exists")
        bot.name = request_dict['name']

    if request_dict.get('is_active') is not None:
        bot.is_active = request_dict['is_active']

    if request_dict.get('max_total_positions') is not None:
        bot.max_total_positions = request_dict['max_total_positions']

    if request_dict.get('max_total_capital_pct') is not None:
        bot.max_total_capital_pct = request_dict['max_total_capital_pct']

    if request_dict.get('strategies') is not None:
        total_allocation = sum(s['capital_allocation_pct'] for s in request_dict['strategies'])
        if round(total_allocation, 4) > 1.0:
            raise HTTPException(
                status_code=400,
                detail=f"Total capital allocation ({total_allocation:.0%}) exceeds 100%"
            )

        db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot.id))

        for alloc in request_dict['strategies']:
            strategy = get_strategy_by_uuid(alloc['strategy_id'], db)
            if not strategy:
                raise HTTPException(status_code=400, detail=f"Strategy {alloc['strategy_id']} not found")

            db.execute(
                bot_strategies.insert().values(
                    bot_id=bot.id,
                    strategy_id=strategy.id,
                    max_positions=alloc['max_positions'],
                    capital_allocation_pct=alloc['capital_allocation_pct'],
                )
            )

    db.commit()
    db.refresh(bot)
    console.print(f"[green]Updated bot: {bot.name} (UUID: {bot.uuid})[/green]")
    return bot_to_response(bot, user_id, db=db)


def _sync_delete_bot(bot_id: str, user_id: int, db: Session) -> dict:
    bot = get_bot_by_uuid(bot_id, user_id, db)
    running, pid = is_bot_running(user_id, bot.id)
    if running:
        stop_bot_process(user_id, bot.id)
    db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot.id))
    db.delete(bot)
    db.commit()
    console.print(f"[yellow]Deleted bot: {bot.name} (UUID: {bot_id})[/yellow]")
    return {"message": f"Bot {bot_id} deleted successfully"}


def _sync_get_bot_status(bot_uuid: str, user_id: int, db: Session) -> BotStatusResponse:
    bot = get_bot_by_uuid(bot_uuid, user_id, db)
    running, pid = is_bot_running(user_id, bot.id)
    snapshot = load_bot_snapshot(bot.id, user_id)
    if not snapshot:
        return BotStatusResponse(
            bot_id=bot.uuid,
            bot_name=bot.name,
            running=running,
            pid=pid,
            portfolio={
                "initial_capital": 1000000,
                "cash": 1000000,
                "total_value": 1000000,
                "total_pnl": 0,
                "total_pnl_pct": 0,
            },
            strategies={},
            positions=[],
            last_update=datetime.now().isoformat(),
        )
    return BotStatusResponse(
        bot_id=bot.uuid,
        bot_name=bot.name,
        running=running,
        pid=pid,
        portfolio=snapshot.get('portfolio') if snapshot else None,
        strategies=snapshot.get('strategies') if snapshot else None,
        positions=snapshot.get('positions') if snapshot else None,
        last_update=snapshot.get('timestamp') if snapshot else None,
    )


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


def _sync_get_bot_portfolio(bot_uuid: str, user_id: int, db: Session) -> dict:
    bot = get_bot_by_uuid(bot_uuid, user_id, db)
    snapshot = load_bot_snapshot(bot.id, user_id)
    if not snapshot:
        return {
            "bot_id": bot.uuid,
            "portfolio": {
                "initial_capital": 1000000,
                "cash": 1000000,
                "margin_used": 0,
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
            "positions": [],
            "strategies": {},
            "timestamp": datetime.now().isoformat(),
        }
    return {
        "bot_id": bot.uuid,
        "portfolio": snapshot.get('portfolio'),
        "positions": snapshot.get('positions', []),
        "strategies": snapshot.get('strategies', {}),
        "timestamp": snapshot.get('timestamp'),
    }


def _sync_get_bot_trades(bot_uuid: str, user_id: int, strategy_id: Optional[str],
                         limit: int, include_test: bool, db: Session) -> dict:
    bot = get_bot_by_uuid(bot_uuid, user_id, db)
    from trading.journal import get_journal
    journal = get_journal(user_id)
    journal.load_all_journals(days=30)
    result = db.execute(
        bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
    ).fetchall()
    strategy_ids = [row.strategy_id for row in result]
    strategy_internal_id = None
    if strategy_id is not None:
        strat = get_strategy_by_uuid(strategy_id, db)
        strategy_internal_id = strat.id
    trades = []
    for trade in journal.trades:
        if trade.strategy_id in strategy_ids:
            if strategy_internal_id is None or trade.strategy_id == strategy_internal_id:
                if not include_test and getattr(trade, 'is_test', False):
                    continue
                trades.append({
                    'trade_id': trade.trade_id,
                    'symbol': trade.symbol,
                    'side': trade.side,
                    'quantity': trade.quantity,
                    'entry_price': trade.entry_price,
                    'exit_price': trade.exit_price,
                    'entry_time': trade.entry_time,
                    'exit_time': trade.exit_time,
                    'pnl': trade.pnl,
                    'pnl_pct': trade.pnl_pct,
                    'exit_reason': trade.exit_reason,
                    'costs': trade.costs,
                    'net_pnl': trade.net_pnl,
                    'strategy_id': trade.strategy_id,
                    'strategy_name': trade.strategy_name,
                    'is_test': getattr(trade, 'is_test', False),
                    'source': getattr(trade, 'source', 'live'),
                })
    trades.sort(key=lambda x: x['exit_time'], reverse=True)
    trades = trades[:limit]
    return {
        "bot_id": bot.uuid,
        "trades": trades,
        "count": len(trades),
        "strategy_filter": strategy_id,
    }


def bot_to_response(bot: BotConfig, user_id: int = 0, db: Optional[Session] = None) -> BotResponse:
    running, pid = is_bot_running(user_id, bot.id)

    strategies = []
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True

    try:
        result = db.execute(
            bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
        ).fetchall()

        for row in result:
            strategy = db.query(StrategyConfig).filter(StrategyConfig.id == row.strategy_id).first()
            if strategy:
                strategies.append({
                    'id': strategy.uuid,  # Return UUID for strategy identifier
                    'strategy_id': strategy.uuid,
                    'name': strategy.name,
                    'strategy_type': strategy.strategy_type,
                    'max_positions': row.max_positions,
                    'capital_allocation_pct': row.capital_allocation_pct,
                })
    finally:
        if should_close:
            db.close()

    return BotResponse(
        id=bot.id,
        uuid=str(bot.uuid) if bot.uuid else None,
        name=bot.name,
        is_active=bot.is_active,
        max_total_positions=bot.max_total_positions,
        max_total_capital_pct=bot.max_total_capital_pct,
        strategies=strategies,
        created_at=bot.created_at.isoformat() if bot.created_at else None,
        updated_at=bot.updated_at.isoformat() if bot.updated_at else None,
        status="RUNNING" if running else "STOPPED",
        process_id=pid if pid else None,
    )


@router.get("/available-strategies")
async def list_available_strategies(
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    if db is None:
        with SessionLocal() as db:
            return await asyncio.to_thread(_sync_list_available_strategies, db)

    return await asyncio.to_thread(_sync_list_available_strategies, db)


@router.get("", response_model=List[BotResponse])
async def list_bots(
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    if db is None:
        with SessionLocal() as session:
            return await asyncio.to_thread(_sync_list_bots, user_id, session)

    return await asyncio.to_thread(_sync_list_bots, user_id, db)


@router.post("", response_model=BotResponse)
async def create_bot(
    request: BotCreate,
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
        request_dict = request.model_dump()
        return await asyncio.to_thread(_sync_create_bot, request_dict, user_id, db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(
    bot_id: str,  # UUID string
    user=Depends(get_current_user),
    db: Session = Depends(get_db) if get_db else None
):
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    if db is None:
        with SessionLocal() as session:
            bot = get_bot_by_uuid(bot_id, user_id, session)
            return bot_to_response(bot, user_id, db=session)

    bot = get_bot_by_uuid(bot_id, user_id, db)
    return bot_to_response(bot, user_id, db=db)


@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(
    bot_id: str,  # UUID string
    request: BotUpdate,
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
        request_dict = request.model_dump(exclude_none=True)
        return await asyncio.to_thread(_sync_update_bot, bot_id, request_dict, user_id, db)
    finally:
        if close_db:
            db.close()


@router.delete("/{bot_id}")
async def delete_bot(
    bot_id: str,  # UUID string
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
        return await asyncio.to_thread(_sync_delete_bot, bot_id, user_id, db)
    finally:
        if close_db:
            db.close()


def start_bot_process(user_id: int, bot_id: int, test_mode: bool = False) -> subprocess.Popen:
    running, _ = is_bot_running(user_id, bot_id)
    if running:
        stop_bot_process(user_id, bot_id)

    log_path = Path(f"/tmp/bot-{user_id}-{bot_id}.log")

    cmd = [
        sys.executable,
        str(Path(__file__).parent.parent / "trading" / "multi_strategy_runner.py"),
        f"--bot-id={bot_id}",
        f"--user-id={user_id}",
    ]
    if test_mode:
        cmd.append("--test")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    _stream_output = os.getenv("STREAM_BOT_OUTPUT", "false").lower() == "true"

    def _stream_bot_output(p: subprocess.Popen, lp: Path):
        import threading
        def _reader():
            with open(lp, 'w') as f:
                if p.stdout:
                    for line in iter(p.stdout.readline, b''):
                        text = line.decode('utf-8', errors='replace')
                        f.write(text)
                        f.flush()
                        if _stream_output:
                            sys.__stdout__.write(text)
                            sys.__stdout__.flush()
                    p.stdout.close()
        t = threading.Thread(target=_reader, daemon=True)
        t.start()

    _stream_bot_output(process, log_path)

    if user_id not in _bot_processes:
        _bot_processes[user_id] = {}
    _bot_processes[user_id][bot_id] = process
    _bot_logs[bot_id] = log_path

    console.print(f"[green]Started bot {bot_id} (PID: {process.pid})[/green]")
    return process


def stop_bot_process(user_id: int, bot_id: int):
    if user_id in _bot_processes and bot_id in _bot_processes[user_id]:
        process = _bot_processes[user_id][bot_id]
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

        del _bot_processes[user_id][bot_id]
        console.print(f"[yellow]Stopped bot {bot_id}[/yellow]")


@router.post("/{bot_id}/start")
async def start_bot(
    bot_id: str,  # UUID string
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
            raise HTTPException(status_code=400, detail="Bot is not active")

        running, pid = is_bot_running(user_id, bot.id)
        if running:
            return {"message": f"Bot {bot_id} already running", "pid": pid}

        process = start_bot_process(user_id, bot.id, test_mode)

        return {
            "message": f"Bot {bot_id} started",
            "pid": process.pid,
            "log_file": str(_bot_logs.get(bot.id)),
        }
    finally:
        if close_db:
            db.close()


@router.post("/{bot_id}/stop")
async def stop_bot(
    bot_id: str,  # UUID string
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


@router.get("/{bot_id}/status", response_model=BotStatusResponse)
async def get_bot_status(
    bot_id: str,  # UUID string
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
        return await asyncio.to_thread(_sync_get_bot_status, bot_id, user_id, db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/logs")
async def get_bot_logs(
    bot_id: str,  # UUID string
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
        return await asyncio.to_thread(_sync_get_bot_logs, bot_id, user_id, lines, db)
    finally:
        if close_db:
            db.close()


@router.post("/{bot_id}/strategies/{strategy_id}/start")
async def start_strategy(
    bot_id: str,  # UUID string
    strategy_id: str,  # UUID string
    user=Depends(get_current_user)
):
    return {
        "message": "Strategy control requires bot restart. Stop the bot, update config, and restart.",
        "bot_id": bot_id,
        "strategy_id": strategy_id,
    }


@router.post("/{bot_id}/strategies/{strategy_id}/stop")
async def stop_strategy(
    bot_id: str,  # UUID string
    strategy_id: str,  # UUID string
    user=Depends(get_current_user)
):
    return {
        "message": "Strategy control requires bot restart. Stop the bot, update config, and restart.",
        "bot_id": bot_id,
        "strategy_id": strategy_id,
    }


@router.get("/{bot_id}/portfolio")
async def get_bot_portfolio(
    bot_id: str,  # UUID string
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
        return await asyncio.to_thread(_sync_get_bot_portfolio, bot_id, user_id, db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/positions")
async def get_bot_positions(
    bot_id: str,  # UUID string
    strategy_id: Optional[str] = None,  # UUID string
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

        snapshot = load_bot_snapshot(bot.id, user_id)

        if not snapshot:
            return {
                "bot_id": bot.uuid,
                "positions": [],
                "count": 0,
            }

        positions = snapshot.get('positions', [])

        # Filter by strategy UUID if provided
        if strategy_id is not None:
            # Need to convert strategy UUID to internal ID for comparison
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


@router.get("/{bot_id}/scan")
async def get_bot_scan(
    bot_id: str,  # UUID string
    strategy_id: Optional[str] = None,  # UUID string
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

        snapshot = load_bot_snapshot(bot.id, user_id)

        if not snapshot:
            return {
                "bot_id": bot.uuid,
                "scan_items": [],
                "count": 0,
                "timestamp": datetime.now().isoformat(),
            }

        scan_items = snapshot.get('scan_items', [])

        if not scan_items:
            strategies = snapshot.get('strategies', {})
            for strat_id, strat_data in strategies.items():
                strat_scan = strat_data.get('scan_items', [])
                for item in strat_scan:
                    item['strategy_id'] = int(strat_id)
                    item['strategy_name'] = strat_data.get('name', f'Strategy {strat_id}')
                scan_items.extend(strat_scan)

        # Filter by strategy UUID if provided
        if strategy_id is not None:
            strat = get_strategy_by_uuid(strategy_id, db)
            scan_items = [s for s in scan_items if s.get('strategy_id') == strat.id]

        return {
            "bot_id": bot.uuid,
            "scan_items": scan_items,
            "count": len(scan_items),
            "timestamp": snapshot.get('timestamp'),
        }
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/performance")
async def get_bot_performance(
    bot_id: str,  # UUID string
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

        snapshot = load_bot_snapshot(bot.id, user_id)

        if not snapshot:
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

        portfolio = snapshot.get('portfolio', {})
        strategies = snapshot.get('strategies', {})

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
            "timestamp": snapshot.get('timestamp'),
        }
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/performance/compare")
async def compare_strategy_performance(
    bot_id: str,  # UUID string
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

        snapshot = load_bot_snapshot(bot.id, user_id)

        if not snapshot:
            return {
                "bot_id": bot.uuid,
                "comparison": [],
                "timestamp": datetime.now().isoformat(),
            }

        strategies = snapshot.get('strategies', {})

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
            "timestamp": snapshot.get('timestamp'),
        }
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/trades")
async def get_bot_trades(
    bot_id: str,  # UUID string
    strategy_id: Optional[str] = None,  # UUID string
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
        return await asyncio.to_thread(_sync_get_bot_trades, bot_id, user_id, strategy_id, limit, include_test, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get trades: {str(e)}")
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/trade-count")
async def get_bot_trade_count(
    bot_id: str,  # UUID string
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
            from trading.journal import get_journal
            journal = get_journal(user_id)

            with SessionLocal() as session:
                result = session.execute(
                    bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
                ).fetchall()
                strategy_ids = [row.strategy_id for row in result]

            count = sum(1 for t in journal.trades if t.strategy_id in strategy_ids)

            return {"count": count}

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get trade count: {str(e)}")
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/strategy-performance")
async def get_strategy_performance(
    bot_id: str,  # UUID string
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
            from trading.journal import get_journal
            journal = get_journal(user_id)

            journal.load_all_journals(days=days)

            all_strategy_perf = journal.get_strategy_performance(include_test=include_test)

            # Use the injected db session if available, otherwise create a new one
            if db is not None:
                result = db.execute(
                    bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
                ).fetchall()
                bot_strategy_ids = [row.strategy_id for row in result]
            else:
                with SessionLocal() as session:
                    result = session.execute(
                        bot_strategies.select().where(bot_strategies.c.bot_id == bot.id)
                    ).fetchall()
                    bot_strategy_ids = [row.strategy_id for row in result]

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
