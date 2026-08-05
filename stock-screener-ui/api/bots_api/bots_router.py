import asyncio
import json
import signal
import sys
import os
import uuid as uuid_module
import threading
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
_bot_processes_lock = threading.Lock()


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
    with _bot_processes_lock:
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
        pid = get_bot_pid(user_id, bot_id)
        status_key = f"bot:{user_id}:{bot_id}:status"
        status_val = client.get(status_key)

        if pid and _is_pid_alive(pid):
            if not status_val:
                _set_bot_status_redis(user_id, bot_id, pid)
            return True, pid

        if pid or status_val:
            _clear_bot_process_state(user_id, bot_id)
        return False, None
    except Exception:
        pass

    return False, None


def _is_pid_alive(pid: int) -> bool:
    """Check if a PID is a live, running process (not just existing).

    os.kill(pid, 0) alone returns True for zombie/defunct processes, which
    would make auto-recovery believe a crashed bot is still running. Read
    /proc/<pid>/stat instead so zombies are treated as dead.
    """
    try:
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().split()
        # state is field 3 of /proc/<pid>/stat
        state = parts[2] if len(parts) > 2 else "?"
        # 'Z' = zombie/defunct
        return state != "Z"
    except (OSError, ProcessLookupError, FileNotFoundError, IndexError):
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


def _clear_bot_process_state(user_id: int, bot_id: int):
    try:
        from cache.redis_client import get_redis_client
        client = get_redis_client()
        if client is not None:
            client.delete(
                f"bot:{user_id}:{bot_id}:status",
                f"bot:{user_id}:{bot_id}:pid",
                f"bot:{user_id}:{bot_id}:start_lock",
            )
    except Exception:
        pass


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

        strategy_ids = [row.strategy_id for row in result]
        strategies_map = {
            s.id: s for s in db.query(StrategyConfig)
            .filter(StrategyConfig.id.in_(strategy_ids)).all()
        } if strategy_ids else {}

        for row in result:
            strategy = strategies_map.get(row.strategy_id)
            if strategy:
                strategies.append({
                    'id': strategy.uuid,
                    'strategy_id': strategy.uuid,
                    'name': strategy.name,
                    'strategy_type': strategy.strategy_type,
                    'max_positions': row.max_positions,
                    'capital_allocation_pct': row.capital_allocation_pct,
                    'enable_shorts': strategy.enable_shorts,
                })

        watchlist = []
        strategy_watchlists = {}
        bot_runtime = db.query(BotRuntimeState).filter(BotRuntimeState.bot_id == bot.id).first()
        if bot_runtime and getattr(bot_runtime, "watchlist", None):
            try:
                parsed = json.loads(bot_runtime.watchlist)
                if isinstance(parsed, dict):
                    watchlist = parsed.get("shared", [])
                    strategy_watchlists = parsed.get("per_strategy", {})
                elif isinstance(parsed, list):
                    watchlist = parsed
            except Exception:
                pass
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
        max_daily_loss_pct=bot.max_daily_loss_pct if hasattr(bot, 'max_daily_loss_pct') and bot.max_daily_loss_pct is not None else 0.03,
        live_trading=bot.live_trading if hasattr(bot, 'live_trading') else False,
        strategies=strategies,
        created_at=bot.created_at.isoformat() if bot.created_at else None,
        updated_at=bot.updated_at.isoformat() if bot.updated_at else None,
        status="UNKNOWN" if status_unknown else ("RUNNING" if running else "STOPPED"),
        process_id=pid if pid else None,
        running=running,
        pid=pid if pid else None,
        error="Redis unavailable — status may be inaccurate" if status_unknown else None,
        watchlist=watchlist,
        strategy_watchlists=strategy_watchlists,
    )


def start_bot_process(user_id: int, bot_id: int, test_mode: bool = False, live_trading: bool = False):
    import subprocess

    lock_key = f"bot:{user_id}:{bot_id}:start_lock"
    lock_token = str(uuid_module.uuid4())
    lock_acquired = False

    try:
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client is not None:
                lock_acquired = bool(client.set(lock_key, lock_token, nx=True, ex=30))
                if not lock_acquired:
                    running, pid = is_bot_running(user_id, bot_id)
                    if running:
                        raise HTTPException(
                            status_code=409,
                            detail=f"Bot {bot_id} is already running (PID: {pid})",
                        )
        except HTTPException:
            raise
        except Exception:
            pass

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
        if live_trading:
            cmd.append("--live")

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

        with _bot_processes_lock:
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
    finally:
        if lock_acquired:
            try:
                from cache.redis_client import _release_lock
                _release_lock(lock_key, lock_token)
            except Exception:
                pass


@router.get("/internal/status", include_in_schema=False)
async def bots_internal_status():
    """Return running bot count. No auth required — for start.sh status."""
    with _bot_processes_lock:
        snapshot = {
            uid: {bid: proc for bid, proc in bots.items()}
            for uid, bots in _bot_processes.items()
        }
    count = 0
    details = []
    for user_id, bots in snapshot.items():
        for bot_id, proc in bots.items():
            if proc.poll() is None:
                count += 1
                details.append({"user_id": user_id, "bot_id": bot_id, "pid": proc.pid})
    return {"running": count, "bots": details}


@router.post("/internal/stop-all", include_in_schema=False)
async def stop_all_bots_internal():
    """Stop all running bot processes. No auth required — for shutdown use only."""
    with _bot_processes_lock:
        entries = [(uid, bid) for uid, bots in _bot_processes.items() for bid in list(bots.keys())]
    stopped = []
    for user_id, bot_id in entries:
        try:
            stop_bot_process(user_id, bot_id)
            stopped.append({"user_id": user_id, "bot_id": bot_id})
        except Exception as e:
            console.print(f"[red]Error stopping bot {user_id}/{bot_id}: {e}[/red]")
    console.print(f"[yellow]Stopped {len(stopped)} bot(s) via internal shutdown[/yellow]")
    return {"stopped": len(stopped), "bots": stopped}



def stop_bot_process(user_id: int, bot_id: int):
    import subprocess
    
    with _bot_processes_lock:
        process = _bot_processes.get(user_id, {}).pop(bot_id, None) if user_id in _bot_processes else None
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
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
