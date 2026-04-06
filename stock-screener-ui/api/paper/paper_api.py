"""
Paper API - Main router and shared logic.
"""

import sys
import subprocess
import json
import time
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Optional, List

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from fastapi import APIRouter, HTTPException, Depends
from rich.console import Console

from trading.paper_trader import get_paper_trader
from trading.journal import get_journal
from api.auth import get_current_user
from db.models import User
import config

console = Console()

router = APIRouter(prefix="/api/paper", tags=["Paper Trading"])

_paper_bot_process: Optional[subprocess.Popen] = None
_paper_bot_log_file = Path("/tmp/alphashri-runner.log")
_paper_bot_log_handle = None
_paper_bot_snapshot_file = Path("/tmp/alphashri-snapshot.json")
_paper_bot_pid_file = Path("/tmp/alphashri-runner.pid")

_user_snapshot_files: dict = {}
_user_pid_files: dict = {}

DEFAULT_USER_ID = 1


def _get_user_id(user: "User") -> int:
    return user.id


def _get_snapshot_file(user_id: Optional[int] = None) -> Path:
    if user_id is None:
        return _paper_bot_snapshot_file
    if user_id not in _user_snapshot_files:
        _user_snapshot_files[user_id] = Path(f"/tmp/alphashri-{user_id}-snapshot.json")
    return _user_snapshot_files[user_id]


def _get_pid_file(user_id: Optional[int] = None) -> Path:
    if user_id is None:
        return _paper_bot_pid_file
    if user_id not in _user_pid_files:
        _user_pid_files[user_id] = Path(f"/tmp/alphashri-{user_id}-runner.pid")
    return _user_pid_files[user_id]


def _load_fresh_bot_snapshot(max_age_seconds: int = 300, user_id: Optional[int] = None) -> Optional[dict]:
    snapshot_file = _get_snapshot_file(user_id)
    if not snapshot_file.exists():
        return None
    try:
        data = json.loads(snapshot_file.read_text())
        ts = data.get("timestamp")
        if ts:
            try:
                age = (datetime.now() - datetime.fromisoformat(ts)).total_seconds()
                if age > max_age_seconds:
                    return None
            except Exception:
                pass
        return data
    except Exception:
        return None


def _read_runner_pid_file(user_id: Optional[int] = None) -> Optional[int]:
    pid_file = _get_pid_file(user_id)
    try:
        if not pid_file.exists():
            return None
        return int(pid_file.read_text().strip())
    except Exception:
        return None


def _write_runner_pid_file(pid: int, user_id: Optional[int] = None) -> None:
    pid_file = _get_pid_file(user_id)
    try:
        pid_file.write_text(str(pid))
    except Exception:
        pass


def _clear_runner_pid_file(user_id: Optional[int] = None) -> None:
    pid_file = _get_pid_file(user_id)
    try:
        if pid_file.exists():
            pid_file.unlink()
    except Exception:
        pass


def _is_pid_alive(pid: int) -> bool:
    try:
        return subprocess.run(["kill", "-0", str(pid)], check=False).returncode == 0
    except Exception:
        return False


def _get_bot_status() -> dict:
    global _paper_bot_process

    def _runner_script_path() -> Path:
        return Path(__file__).parent.parent / "run_daily_trading.py"

    def _list_runner_pids() -> List[int]:
        script_name = _runner_script_path().name
        try:
            out = subprocess.check_output(["pgrep", "-f", script_name], text=True)
        except Exception:
            return []
        pids: List[int] = []
        for line in out.splitlines():
            try:
                pid = int(line.strip())
            except Exception:
                continue
            if pid != os.getpid():
                pids.append(pid)
        return sorted(set(pids))

    import os
    running = False
    pid = None
    return_code = None

    if _paper_bot_process is not None:
        return_code = _paper_bot_process.poll()
        if return_code is None:
            running = True
            pid = _paper_bot_process.pid
        else:
            _paper_bot_process = None

    runner_pids = _list_runner_pids()
    pid_from_file = _read_runner_pid_file()
    if pid_from_file is not None:
        if _is_pid_alive(pid_from_file):
            if pid_from_file not in runner_pids:
                runner_pids.append(pid_from_file)
                runner_pids = sorted(set(runner_pids))
        else:
            _clear_runner_pid_file()

    if not running and runner_pids:
        running = True
        if pid_from_file in runner_pids:
            pid = pid_from_file
        else:
            pid = runner_pids[0]
        return_code = None
        if pid is not None:
            _write_runner_pid_file(pid)

    return {
        "running": running,
        "pid": pid,
        "runner_pids": runner_pids,
        "return_code": return_code,
        "log_file": str(_paper_bot_log_file),
        "pid_file": str(_paper_bot_pid_file),
    }


def _get_symbol_trades_from_db(user_id: int, symbol: str, date: str) -> list:
    from db.database import SessionLocal
    from db.models import Trade as TradeModel

    try:
        db = SessionLocal()
        date_start = datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=config.IST)
        date_end = date_start.replace(hour=23, minute=59, second=59)
        query = db.query(TradeModel).filter(
            TradeModel.user_id == user_id,
            TradeModel.symbol == symbol.upper(),
            TradeModel.is_test == False,
        )
        if date:
            query = query.filter(TradeModel.exit_time >= date_start, TradeModel.exit_time <= date_end)
        trades = []
        for t in query.all():
            d = t.to_dict()
            if d.get("entry_time") and d["entry_time"] != "":
                try:
                    dt = datetime.fromisoformat(d["entry_time"])
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=config.IST)
                    ist_time = dt.astimezone(config.IST)
                    d["entry_time"] = ist_time.strftime("%Y-%m-%dT%H:%M:%S")
                except (ValueError, TypeError):
                    pass
            if d.get("exit_time") and d["exit_time"] != "":
                try:
                    dt = datetime.fromisoformat(d["exit_time"])
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=config.IST)
                    ist_time = dt.astimezone(config.IST)
                    d["exit_time"] = ist_time.strftime("%Y-%m-%dT%H:%M:%S")
                except (ValueError, TypeError):
                    pass
            trades.append(d)
        return trades
    except Exception:
        return []
    finally:
        try:
            db.close()
        except Exception:
            pass


__all__ = ["router", "_get_user_id", "_get_bot_status", "_get_symbol_trades_from_db"]
