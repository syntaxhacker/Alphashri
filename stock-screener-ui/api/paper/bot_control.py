"""
Bot control endpoints for Paper Trading API.
"""

import sys
import asyncio
import subprocess
import time
from pathlib import Path
from datetime import datetime

from fastapi import HTTPException, Depends

from api.auth import get_current_user
from db.models import User

from .paper_api import (
    router,
    _get_user_id,
    _get_bot_status,
    _paper_bot_process,
    _paper_bot_log_file,
    _paper_bot_log_handle,
    _write_runner_pid_file,
    _clear_runner_pid_file,
)


@router.get("/bot/status")
async def get_paper_bot_status():
    """Get background paper trading runner status."""
    return _get_bot_status()


@router.post("/bot/start")
async def start_paper_bot(user: "User" = Depends(get_current_user)):
    """Start background paper trading runner process."""
    global _paper_bot_process, _paper_bot_log_handle

    status = _get_bot_status()
    if status["running"]:
        return {
            "status": "already_running",
            "message": f"Paper trading runner is already running (pids={status.get('runner_pids', [])})",
            **status,
        }

    script_path = Path(__file__).parent.parent.parent / "run_daily_trading.py"
    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"Runner script not found: {script_path}")

    _paper_bot_log_file.parent.mkdir(parents=True, exist_ok=True)
    _paper_bot_log_handle = open(_paper_bot_log_file, "a", buffering=1)

    cmd = [sys.executable, "-u", str(script_path)]

    def _launch_process():
        global _paper_bot_process
        _paper_bot_process = subprocess.Popen(
            cmd,
            cwd=str(Path(__file__).parent.parent.parent),
            stdout=_paper_bot_log_handle,
            stderr=_paper_bot_log_handle,
            start_new_session=True,
        )
        _write_runner_pid_file(_paper_bot_process.pid)

    await asyncio.to_thread(_launch_process)

    new_status = _get_bot_status()
    return {
        "status": "started",
        "message": "Paper trading runner started",
        **new_status,
    }


@router.post("/bot/stop")
async def stop_paper_bot(user: "User" = Depends(get_current_user)):
    """Stop background paper trading runner process."""
    global _paper_bot_process, _paper_bot_log_handle

    import subprocess as sub

    status = _get_bot_status()
    pids_to_stop = set(status.get("runner_pids") or [])
    if _paper_bot_process is not None and _paper_bot_process.poll() is None:
        pids_to_stop.add(_paper_bot_process.pid)

    if not pids_to_stop:
        return {
            "status": "not_running",
            "message": "Paper trading runner is not running",
            **status,
        }

    stopped = []
    still_running = []
    for pid in sorted(pids_to_stop):
        try:
            def _kill_and_wait(pid=pid):
                sub.run(["kill", str(pid)], check=False)
                for _ in range(10):
                    probe = sub.run(["kill", "-0", str(pid)], check=False)
                    if probe.returncode != 0:
                        return True
                    time.sleep(0.2)
                probe = sub.run(["kill", "-0", str(pid)], check=False)
                if probe.returncode == 0:
                    sub.run(["kill", "-9", str(pid)], check=False)
                    time.sleep(0.1)
                    probe = sub.run(["kill", "-0", str(pid)], check=False)
                return probe.returncode != 0

            killed = await asyncio.to_thread(_kill_and_wait)
            if killed:
                stopped.append(pid)
            else:
                still_running.append(pid)
        except Exception:
            still_running.append(pid)

    _paper_bot_process = None
    _clear_runner_pid_file()
    if _paper_bot_log_handle:
        try:
            _paper_bot_log_handle.close()
        except Exception:
            pass
        _paper_bot_log_handle = None
    new_status = _get_bot_status()
    return {
        "status": "stopped",
        "message": f"Stopped runner(s): {stopped}" + (f"; still running: {still_running}" if still_running else ""),
        "stopped_pids": stopped,
        "still_running_pids": still_running,
        **new_status,
    }
