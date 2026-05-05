import asyncio
import json
import signal
import sys
import os
import uuid as uuid_module
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from rich.console import Console

console = Console()

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from db.database import SessionLocal, get_db
    from db.models import BotConfig, BotRuntimeState, StrategyConfig, bot_strategies, User
    _db_available = True
except ImportError:
    _db_available = False
    get_db = None

from api.auth import get_current_user

router = APIRouter(prefix="/api/bots", tags=["Bots"])

_bot_processes: Dict[int, Dict[int, any]] = {}
_bot_logs: Dict[int, Path] = {}


def get_user_id(user) -> int:
    if user is None:
        return 0
    return user.id


def validate_uuid(uuid_str: str) -> bool:
    try:
        uuid_module.UUID(uuid_str)
        return True
    except (ValueError, TypeError):
        return False


def resolve_bot_id(bot_id_str: str, db: Session) -> Optional[int]:
    """Convert a UUID or numeric string bot_id to the integer PK.

    Tries int() first (fast path for numeric IDs). Falls back to
    BotConfig.uuid lookup if that fails. Returns None if not found.
    """
    try:
        return int(bot_id_str)
    except ValueError:
        from db.models.bot import BotConfig
        bot = db.query(BotConfig).filter(BotConfig.uuid == bot_id_str).first()
        return bot.id if bot else None


def get_bot_by_uuid(bot_uuid: str, user_id: int, db: Session) -> BotConfig:
    bot_id = resolve_bot_id(bot_uuid, db)
    if bot_id is None:
        raise HTTPException(status_code=404, detail=f"Bot {bot_uuid} not found")
    bot = db.query(BotConfig).filter(
        BotConfig.id == bot_id,
        BotConfig.user_id == user_id
    ).first()
    if not bot:
        raise HTTPException(status_code=404, detail=f"Bot {bot_uuid} not found")
    return bot


def get_strategy_by_uuid(strategy_uuid: str, db: Session) -> StrategyConfig:
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
    import json
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

    try:
        from cache.redis_client import get_redis_client
        client = get_redis_client()
        if client is None:
            return None, None
        val = client.get(f"bot:{user_id}:{bot_id}:status")
        if val:
            pid = get_bot_pid(user_id, bot_id)
            if pid and _is_pid_alive(pid):
                return True, pid
            else:
                client.delete(f"bot:{user_id}:{bot_id}:status")
        return False, None
    except Exception:
        pass

    return False, None


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def get_bot_pid(user_id: int, bot_id: int) -> Optional[int]:
    try:
        from cache.redis_client import get_redis_client
        client = get_redis_client()
        if client:
            pid_str = client.get(f"bot:{user_id}:{bot_id}:pid")
            if pid_str:
                return int(pid_str)
    except Exception:
        pass
    return None


def _set_bot_status_redis(user_id: int, bot_id: int, pid: int, ttl: int = 90):
    try:
        from cache.redis_client import get_redis_client
        client = get_redis_client()
        if client is not None:
            client.setex(f"bot:{user_id}:{bot_id}:status", ttl, f"running:{pid}")
    except Exception:
        pass


def _clear_bot_status_redis(user_id: int, bot_id: int):
    try:
        from cache.redis_client import get_redis_client
        client = get_redis_client()
        if client is not None:
            client.delete(f"bot:{user_id}:{bot_id}:status")
    except Exception:
        pass


def bot_to_response(bot: BotConfig, user_id: int = 0, db: Optional[Session] = None) -> "BotResponse":
    from api.bots_api.requests import BotResponse

    running, pid = is_bot_running(user_id, bot.id)
    status_unknown = running is None
    running = bool(running)

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
                    'id': strategy.uuid,
                    'strategy_id': strategy.uuid,
                    'name': strategy.name,
                    'strategy_type': strategy.strategy_type,
                    'max_positions': row.max_positions,
                    'capital_allocation_pct': row.capital_allocation_pct,
                })

        watchlist = []
        bot_runtime = db.query(BotRuntimeState).filter(BotRuntimeState.bot_id == bot.id).first()
        if bot_runtime and getattr(bot_runtime, "watchlist", None):
            try:
                watchlist = json.loads(bot_runtime.watchlist)
            except Exception:
                watchlist = []
    finally:
        if should_close:
            db.close()

    return BotResponse(
        id=str(bot.uuid) if bot.uuid else str(bot.id),
        uuid=str(bot.uuid) if bot.uuid else "",
        name=bot.name,
        is_active=bot.is_active,
        max_total_positions=bot.max_total_positions,
        max_total_capital_pct=bot.max_total_capital_pct,
        max_daily_loss_pct=bot.max_daily_loss_pct if hasattr(bot, 'max_daily_loss_pct') else 0.03,
        strategies=strategies,
        created_at=bot.created_at.isoformat() if bot.created_at else None,
        updated_at=bot.updated_at.isoformat() if bot.updated_at else None,
        status="UNKNOWN" if status_unknown else ("RUNNING" if running else "STOPPED"),
        process_id=pid if pid else None,
        running=running,
        pid=pid if pid else None,
        error="Redis unavailable — status may be inaccurate" if status_unknown else None,
        watchlist=watchlist,
    )


def start_bot_process(user_id: int, bot_id: int, test_mode: bool = False):
    import subprocess
    
    running, _ = is_bot_running(user_id, bot_id)
    if running:
        stop_bot_process(user_id, bot_id)

    log_path = Path(f"/tmp/bot-{user_id}-{bot_id}.log")
    runner_script = PROJECT_ROOT / "trading" / "runner_cli.py"

    if not runner_script.exists():
        console.print(f"[red]Bot runner script not found: {runner_script}[/red]")
        raise HTTPException(
            status_code=500,
            detail=f"Bot runner script not found at {runner_script}. "
                   f"PROJECT_ROOT={PROJECT_ROOT} — check file structure.",
        )

    cmd = [
        sys.executable,
        str(runner_script),
        f"--bot-id={bot_id}",
        f"--user-id={user_id}",
    ]
    if test_mode:
        cmd.append("--test")

    env = {**os.environ, "PYTHONPATH": f"{PROJECT_ROOT}:{PROJECT_ROOT.parent}"}

    log_file = open(log_path, 'a')
    process = subprocess.Popen(
        cmd,
        stdout=log_file,
        stderr=log_file,
        cwd=str(PROJECT_ROOT),
        start_new_session=True,
        env=env,
    )

    if user_id not in _bot_processes:
        _bot_processes[user_id] = {}
    _bot_processes[user_id][bot_id] = process
    _bot_logs[bot_id] = log_path
    _set_bot_status_redis(user_id, bot_id, process.pid)

    try:
        from cache.redis_client import get_redis_client
        client = get_redis_client()
        if client:
            client.setex(f"bot:{user_id}:{bot_id}:pid", 86400, str(process.pid))
    except Exception:
        pass

    console.print(f"[green]Started bot {bot_id} (PID: {process.pid})[/green]")
    return process


def stop_bot_process(user_id: int, bot_id: int):
    import subprocess
    
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
        _clear_bot_status_redis(user_id, bot_id)
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client:
                client.delete(f"bot:{user_id}:{bot_id}:pid")
        except Exception:
            pass
        console.print(f"[yellow]Stopped bot {bot_id}[/yellow]")
    else:
        pid = get_bot_pid(user_id, bot_id)
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass
        _clear_bot_status_redis(user_id, bot_id)
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client:
                client.delete(f"bot:{user_id}:{bot_id}:pid")
        except Exception:
            pass
