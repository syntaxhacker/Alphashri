"""
Bot Management API - Endpoints for multi-strategy bot operations.

This module provides REST API endpoints for:
- Bot CRUD operations
- Bot control (start/stop)
- Strategy management within bots
- Portfolio and performance views
"""

import sys
import subprocess
import json
import os
import signal
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Generator
from dataclasses import asdict

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from rich.console import Console
from sqlalchemy.orm import Session

console = Console()

# Database imports
try:
    from db.database import SessionLocal, get_db
    from db.models import BotConfig, StrategyConfig, bot_strategies, User
    _db_available = True
except ImportError:
    _db_available = False
    get_db = None

# Auth imports
try:
    from api.auth import get_current_user_optional
    _auth_available = True
except ImportError:
    _auth_available = False
    async def get_current_user_optional():
        return None

# Create router
router = APIRouter(prefix="/api/bots", tags=["Bots"])

# Bot process tracking (per user)
_bot_processes: Dict[int, Dict[int, subprocess.Popen]] = {}  # {user_id: {bot_id: process}}
_bot_logs: Dict[int, Path] = {}  # {bot_id: log_path}


# ==================== Pydantic Models ====================

class StrategyAllocation(BaseModel):
    """Strategy allocation within a bot."""
    strategy_id: int
    max_positions: int = Field(default=3, ge=1, le=10)
    capital_allocation_pct: float = Field(default=0.20, ge=0.05, le=1.0)


class BotCreate(BaseModel):
    """Request to create a new bot."""
    name: str = Field(..., min_length=1, max_length=100)
    is_active: bool = True
    max_total_positions: int = Field(default=10, ge=1, le=20)
    max_total_capital_pct: float = Field(default=0.80, ge=0.1, le=1.0)
    strategies: List[StrategyAllocation] = Field(default_factory=list)


class BotUpdate(BaseModel):
    """Request to update a bot."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None
    max_total_positions: Optional[int] = Field(None, ge=1, le=20)
    max_total_capital_pct: Optional[float] = Field(None, ge=0.1, le=1.0)
    strategies: Optional[List[StrategyAllocation]] = None


class BotResponse(BaseModel):
    """Bot configuration response."""
    id: int
    name: str
    is_active: bool
    max_total_positions: int
    max_total_capital_pct: float
    strategies: List[dict]
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    running: bool = False
    pid: Optional[int] = None


class BotStatusResponse(BaseModel):
    """Detailed bot status response."""
    bot_id: int
    bot_name: str
    running: bool
    pid: Optional[int] = None
    portfolio: Optional[dict] = None
    strategies: Optional[Dict[str, dict]] = None
    positions: Optional[List[dict]] = None
    last_update: Optional[str] = None


class StrategyStatusResponse(BaseModel):
    """Strategy status within a bot."""
    strategy_id: int
    strategy_name: str
    status: str
    positions_count: int
    max_positions: int
    capital_used: float
    allocated_capital: float
    pnl: float
    trades_count: int


# ==================== Helper Functions ====================

def get_user_id(user) -> int:
    """Get user ID from user object, default to 0 for single-user mode."""
    if user is None:
        return 0
    return user.id


def get_bot_snapshot_path(bot_id: int) -> Path:
    """Get the snapshot file path for a bot."""
    return Path(f"/tmp/multi-strategy-bot-{bot_id}.json")


def load_bot_snapshot(bot_id: int) -> Optional[dict]:
    """Load the latest snapshot for a bot."""
    snapshot_path = get_bot_snapshot_path(bot_id)
    if snapshot_path.exists():
        try:
            return json.loads(snapshot_path.read_text())
        except Exception:
            pass
    return None


def is_bot_running(user_id: int, bot_id: int) -> tuple:
    """Check if a bot is currently running."""
    if user_id in _bot_processes and bot_id in _bot_processes[user_id]:
        process = _bot_processes[user_id][bot_id]
        if process.poll() is None:
            return True, process.pid
        else:
            # Process has ended, clean up
            del _bot_processes[user_id][bot_id]
    return False, None


def bot_to_response(bot: BotConfig, user_id: int = 0, db: Optional[Session] = None) -> BotResponse:
    """Convert BotConfig to response model."""
    running, pid = is_bot_running(user_id, bot.id)

    strategies = []
    # Use provided db session or create a new one
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
                    'id': strategy.id,
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
        name=bot.name,
        is_active=bot.is_active,
        max_total_positions=bot.max_total_positions,
        max_total_capital_pct=bot.max_total_capital_pct,
        strategies=strategies,
        created_at=bot.created_at.isoformat() if bot.created_at else None,
        updated_at=bot.updated_at.isoformat() if bot.updated_at else None,
        running=running,
        pid=pid,
    )


# ==================== Available Strategies Endpoint ====================
# NOTE: This must come BEFORE /{bot_id} routes to avoid route conflicts

@router.get("/available-strategies")
async def list_available_strategies(
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """List all available strategies that can be added to bots."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    # Fallback to SessionLocal if dependency injection not available
    if db is None:
        with SessionLocal() as db:
            strategies = db.query(StrategyConfig).filter(
                StrategyConfig.is_active == True
            ).all()

            return [
                {
                    "id": s.id,
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

    strategies = db.query(StrategyConfig).filter(
        StrategyConfig.is_active == True
    ).all()

    return [
        {
            "id": s.id,
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


# ==================== Bot CRUD Endpoints ====================

@router.get("", response_model=List[BotResponse])
async def list_bots(
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """List all bot configurations."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    if db is None:
        with SessionLocal() as session:
            bots = session.query(BotConfig).all()
            return [bot_to_response(bot, user_id, db=session) for bot in bots]

    bots = db.query(BotConfig).all()
    return [bot_to_response(bot, user_id, db=db) for bot in bots]


@router.post("", response_model=BotResponse)
async def create_bot(
    request: BotCreate,
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """Create a new bot configuration."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        # Check if name already exists
        existing = db.query(BotConfig).filter(BotConfig.name == request.name).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Bot with name '{request.name}' already exists")

        # Validate total allocation doesn't exceed 100%
        total_allocation = sum(s.capital_allocation_pct for s in request.strategies)
        if total_allocation > 1.0:
            raise HTTPException(
                status_code=400,
                detail=f"Total capital allocation ({total_allocation:.0%}) exceeds 100%"
            )

        # Create bot
        bot = BotConfig(
            name=request.name,
            is_active=request.is_active,
            max_total_positions=request.max_total_positions,
            max_total_capital_pct=request.max_total_capital_pct,
        )
        db.add(bot)
        db.flush()

        # Add strategies
        for alloc in request.strategies:
            strategy = db.query(StrategyConfig).filter(StrategyConfig.id == alloc.strategy_id).first()
            if not strategy:
                raise HTTPException(status_code=400, detail=f"Strategy {alloc.strategy_id} not found")

            db.execute(
                bot_strategies.insert().values(
                    bot_id=bot.id,
                    strategy_id=alloc.strategy_id,
                    max_positions=alloc.max_positions,
                    capital_allocation_pct=alloc.capital_allocation_pct,
                )
            )

        db.commit()
        db.refresh(bot)

        console.print(f"[green]Created bot: {bot.name} (ID: {bot.id})[/green]")
        return bot_to_response(bot, user_id, db=db)
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(
    bot_id: int,
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """Get a specific bot configuration."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    if db is None:
        with SessionLocal() as session:
            bot = session.query(BotConfig).filter(BotConfig.id == bot_id).first()
            if not bot:
                raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")

            return bot_to_response(bot, user_id, db=session)

    bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")

    return bot_to_response(bot, user_id, db=db)


@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(
    bot_id: int,
    request: BotUpdate,
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """Update a bot configuration."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
        if not bot:
            raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")

        # Update fields
        if request.name is not None:
            existing = db.query(BotConfig).filter(
                BotConfig.name == request.name,
                BotConfig.id != bot_id
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"Bot with name '{request.name}' already exists")
            bot.name = request.name

        if request.is_active is not None:
            bot.is_active = request.is_active

        if request.max_total_positions is not None:
            bot.max_total_positions = request.max_total_positions

        if request.max_total_capital_pct is not None:
            bot.max_total_capital_pct = request.max_total_capital_pct

        # Update strategies if provided
        if request.strategies is not None:
            # Validate total allocation
            total_allocation = sum(s.capital_allocation_pct for s in request.strategies)
            if total_allocation > 1.0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Total capital allocation ({total_allocation:.0%}) exceeds 100%"
                )

            # Remove existing strategies
            db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot_id))

            # Add new strategies
            for alloc in request.strategies:
                strategy = db.query(StrategyConfig).filter(StrategyConfig.id == alloc.strategy_id).first()
                if not strategy:
                    raise HTTPException(status_code=400, detail=f"Strategy {alloc.strategy_id} not found")

                db.execute(
                    bot_strategies.insert().values(
                        bot_id=bot_id,
                        strategy_id=alloc.strategy_id,
                        max_positions=alloc.max_positions,
                        capital_allocation_pct=alloc.capital_allocation_pct,
                    )
                )

        db.commit()
        db.refresh(bot)

        console.print(f"[green]Updated bot: {bot.name} (ID: {bot.id})[/green]")
        return bot_to_response(bot, user_id, db=db)
    finally:
        if close_db:
            db.close()


@router.delete("/{bot_id}")
async def delete_bot(
    bot_id: int,
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """Delete a bot configuration."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
        if not bot:
            raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")

        # Stop bot if running
        running, pid = is_bot_running(user_id, bot_id)
        if running:
            stop_bot_process(user_id, bot_id)

        # Remove strategy associations
        db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot_id))

        # Delete bot
        db.delete(bot)
        db.commit()

        console.print(f"[yellow]Deleted bot: {bot.name} (ID: {bot_id})[/yellow]")
        return {"message": f"Bot {bot_id} deleted successfully"}
    finally:
        if close_db:
            db.close()


# ==================== Bot Control Endpoints ====================

def start_bot_process(user_id: int, bot_id: int, test_mode: bool = False) -> subprocess.Popen:
    """Start a bot as a background process."""
    # Stop existing if running
    running, _ = is_bot_running(user_id, bot_id)
    if running:
        stop_bot_process(user_id, bot_id)

    # Create log file
    log_path = Path(f"/tmp/bot-{bot_id}.log")
    log_file = open(log_path, 'w')

    # Build command
    cmd = [
        sys.executable,
        str(Path(__file__).parent.parent / "trading" / "multi_strategy_runner.py"),
        f"--bot-id={bot_id}",
    ]
    if test_mode:
        cmd.append("--test")

    # Start process
    process = subprocess.Popen(
        cmd,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    # Track process
    if user_id not in _bot_processes:
        _bot_processes[user_id] = {}
    _bot_processes[user_id][bot_id] = process
    _bot_logs[bot_id] = log_path

    console.print(f"[green]Started bot {bot_id} (PID: {process.pid})[/green]")
    return process


def stop_bot_process(user_id: int, bot_id: int):
    """Stop a running bot process."""
    if user_id in _bot_processes and bot_id in _bot_processes[user_id]:
        process = _bot_processes[user_id][bot_id]
        if process.poll() is None:
            # Send SIGTERM for graceful shutdown
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if doesn't terminate
                process.kill()
                process.wait()

        del _bot_processes[user_id][bot_id]
        console.print(f"[yellow]Stopped bot {bot_id}[/yellow]")


@router.post("/{bot_id}/start")
async def start_bot(
    bot_id: int,
    test_mode: bool = False,
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """Start a multi-strategy bot."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
        if not bot:
            raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")

        if not bot.is_active:
            raise HTTPException(status_code=400, detail="Bot is not active")

        # Check if already running
        running, pid = is_bot_running(user_id, bot_id)
        if running:
            return {"message": f"Bot {bot_id} already running", "pid": pid}

        # Start bot
        process = start_bot_process(user_id, bot_id, test_mode)

        return {
            "message": f"Bot {bot_id} started",
            "pid": process.pid,
            "log_file": str(_bot_logs.get(bot_id)),
        }
    finally:
        if close_db:
            db.close()


@router.post("/{bot_id}/stop")
async def stop_bot(
    bot_id: int,
    user=Depends(get_current_user_optional)
):
    """Stop a running bot."""
    user_id = get_user_id(user)

    running, pid = is_bot_running(user_id, bot_id)
    if not running:
        return {"message": f"Bot {bot_id} is not running"}

    stop_bot_process(user_id, bot_id)

    return {"message": f"Bot {bot_id} stopped"}


@router.get("/{bot_id}/status", response_model=BotStatusResponse)
async def get_bot_status(
    bot_id: int,
    user=Depends(get_current_user_optional),
    db: Session = Depends(get_db) if get_db else None
):
    """Get detailed bot status with live data."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    user_id = get_user_id(user)

    # Fallback to SessionLocal if dependency injection not available
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
        if not bot:
            raise HTTPException(status_code=404, detail=f"Bot {bot_id} not found")

        running, pid = is_bot_running(user_id, bot_id)

        # Load snapshot for live data
        snapshot = load_bot_snapshot(bot_id)

        return BotStatusResponse(
            bot_id=bot_id,
            bot_name=bot.name,
            running=running,
            pid=pid,
            portfolio=snapshot.get('portfolio') if snapshot else None,
            strategies=snapshot.get('strategies') if snapshot else None,
            positions=snapshot.get('positions') if snapshot else None,
            last_update=snapshot.get('timestamp') if snapshot else None,
        )
    finally:
        if close_db:
            db.close()


@router.get("/{bot_id}/logs")
async def get_bot_logs(
    bot_id: int,
    lines: int = 100,
    user=Depends(get_current_user_optional)
):
    """Get recent bot logs."""
    user_id = get_user_id(user)

    log_path = _bot_logs.get(bot_id)
    if not log_path or not log_path.exists():
        return {"logs": "", "message": "No logs available"}

    try:
        # Read last N lines
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


# ==================== Strategy Control Endpoints ====================

@router.post("/{bot_id}/strategies/{strategy_id}/start")
async def start_strategy(
    bot_id: int,
    strategy_id: int,
    user=Depends(get_current_user_optional)
):
    """Start a specific strategy within a running bot."""
    # This would require IPC with the running bot process
    # For now, return a message that this requires bot restart
    return {
        "message": "Strategy control requires bot restart. Stop the bot, update config, and restart.",
        "bot_id": bot_id,
        "strategy_id": strategy_id,
    }


@router.post("/{bot_id}/strategies/{strategy_id}/stop")
async def stop_strategy(
    bot_id: int,
    strategy_id: int,
    user=Depends(get_current_user_optional)
):
    """Stop a specific strategy within a running bot."""
    return {
        "message": "Strategy control requires bot restart. Stop the bot, update config, and restart.",
        "bot_id": bot_id,
        "strategy_id": strategy_id,
    }


# ==================== Portfolio Endpoints ====================

@router.get("/{bot_id}/portfolio")
async def get_bot_portfolio(
    bot_id: int,
    user=Depends(get_current_user_optional)
):
    """Get combined portfolio for a bot."""
    snapshot = load_bot_snapshot(bot_id)

    if not snapshot:
        raise HTTPException(status_code=404, detail="Bot snapshot not found. Is the bot running?")

    return {
        "bot_id": bot_id,
        "portfolio": snapshot.get('portfolio'),
        "positions": snapshot.get('positions', []),
        "strategies": snapshot.get('strategies', {}),
        "timestamp": snapshot.get('timestamp'),
    }


@router.get("/{bot_id}/positions")
async def get_bot_positions(
    bot_id: int,
    strategy_id: Optional[int] = None,
    user=Depends(get_current_user_optional)
):
    """Get all positions for a bot, optionally filtered by strategy."""
    snapshot = load_bot_snapshot(bot_id)

    if not snapshot:
        raise HTTPException(status_code=404, detail="Bot snapshot not found. Is the bot running?")

    positions = snapshot.get('positions', [])

    if strategy_id is not None:
        positions = [p for p in positions if p.get('strategy_id') == strategy_id]

    return {
        "bot_id": bot_id,
        "positions": positions,
        "count": len(positions),
    }


@router.get("/{bot_id}/scan")
async def get_bot_scan(
    bot_id: int,
    strategy_id: Optional[int] = None,
    user=Depends(get_current_user_optional)
):
    """Get scan items for a bot, optionally filtered by strategy."""
    snapshot = load_bot_snapshot(bot_id)

    if not snapshot:
        raise HTTPException(status_code=404, detail="Bot snapshot not found. Is the bot running?")

    # Get combined scan items
    scan_items = snapshot.get('scan_items', [])

    # Or get from strategies
    if not scan_items:
        strategies = snapshot.get('strategies', {})
        for strat_id, strat_data in strategies.items():
            strat_scan = strat_data.get('scan_items', [])
            for item in strat_scan:
                item['strategy_id'] = int(strat_id)
                item['strategy_name'] = strat_data.get('name', f'Strategy {strat_id}')
            scan_items.extend(strat_scan)

    # Filter by strategy if specified
    if strategy_id is not None:
        scan_items = [s for s in scan_items if s.get('strategy_id') == strategy_id]

    return {
        "bot_id": bot_id,
        "scan_items": scan_items,
        "count": len(scan_items),
        "timestamp": snapshot.get('timestamp'),
    }


# ==================== Performance Endpoints ====================

@router.get("/{bot_id}/performance")
async def get_bot_performance(
    bot_id: int,
    days: int = 30,
    user=Depends(get_current_user_optional)
):
    """Get combined performance for a bot."""
    snapshot = load_bot_snapshot(bot_id)

    if not snapshot:
        raise HTTPException(status_code=404, detail="Bot snapshot not found. Is the bot running?")

    portfolio = snapshot.get('portfolio', {})
    strategies = snapshot.get('strategies', {})

    # Calculate combined stats
    total_trades = sum(
        s.get('portfolio_status', {}).get('trades_count', 0)
        for s in strategies.values()
    )

    return {
        "bot_id": bot_id,
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


@router.get("/{bot_id}/performance/compare")
async def compare_strategy_performance(
    bot_id: int,
    user=Depends(get_current_user_optional)
):
    """Compare performance across strategies in a bot."""
    snapshot = load_bot_snapshot(bot_id)

    if not snapshot:
        raise HTTPException(status_code=404, detail="Bot snapshot not found. Is the bot running?")

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

    # Sort by total P&L
    comparison.sort(key=lambda x: x['total_pnl'], reverse=True)

    return {
        "bot_id": bot_id,
        "comparison": comparison,
        "timestamp": snapshot.get('timestamp'),
    }


# ==================== Journal & Trade History Endpoints ====================

@router.get("/{bot_id}/trades")
async def get_bot_trades(
    bot_id: int,
    strategy_id: Optional[int] = None,
    limit: int = 100,
    include_test: bool = True,  # Include test/seeded data by default
    user_id_query: Optional[int] = None,  # For testing without auth
    user=Depends(get_current_user_optional)
):
    """Get trade history for a bot, optionally filtered by strategy."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    # Allow query param override for testing
    user_id = user_id_query if user_id_query is not None else get_user_id(user)

    # Get the journal for this user
    try:
        from trading.journal import get_journal
        journal = get_journal(user_id)

        # Filter trades by bot's strategies
        with SessionLocal() as db:
            result = db.execute(
                bot_strategies.select().where(bot_strategies.c.bot_id == bot_id)
            ).fetchall()

            strategy_ids = [row.strategy_id for row in result]

        # Filter trades
        trades = []
        for trade in journal.trades:
            # Only include trades from this bot's strategies
            if trade.strategy_id in strategy_ids:
                if strategy_id is None or trade.strategy_id == strategy_id:
                    # Filter out test trades if requested
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

        # Sort by exit time (most recent first) and limit
        trades.sort(key=lambda x: x['exit_time'], reverse=True)
        trades = trades[:limit]

        return {
            "bot_id": bot_id,
            "trades": trades,
            "count": len(trades),
            "strategy_filter": strategy_id,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get trades: {str(e)}")


@router.get("/{bot_id}/strategy-performance")
async def get_strategy_performance(
    bot_id: int,
    days: int = 30,
    include_test: bool = True,  # Include test/seeded data by default
    user_id_query: Optional[int] = None,  # For testing without auth
    user=Depends(get_current_user_optional)
):
    """Get performance breakdown by strategy from the trade journal."""
    if not _db_available:
        raise HTTPException(status_code=500, detail="Database not available")

    # Allow query param override for testing
    user_id = user_id_query if user_id_query is not None else get_user_id(user)

    try:
        from trading.journal import get_journal
        journal = get_journal(user_id)

        # Load historical journals for comprehensive analysis
        journal.load_all_journals(days=days)

        # Get all strategy performance (with optional test filtering)
        all_strategy_perf = journal.get_strategy_performance(include_test=include_test)

        # Filter to only this bot's strategies
        with SessionLocal() as db:
            result = db.execute(
                bot_strategies.select().where(bot_strategies.c.bot_id == bot_id)
            ).fetchall()

            bot_strategy_ids = [row.strategy_id for row in result]

        # Filter performance to this bot's strategies
        bot_performance = {
            str(sid): perf
            for sid, perf in all_strategy_perf.items()
            if sid in bot_strategy_ids
        }

        # Calculate combined stats
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
            "bot_id": bot_id,
            "by_strategy": bot_performance,
            "combined": combined,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get strategy performance: {str(e)}")
