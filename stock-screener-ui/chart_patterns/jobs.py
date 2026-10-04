"""Bounded in-process compute queue for chart-pattern scans (CONTRACT.md §3).

- Env: ``PATTERN_SCAN_MAX_QUEUE`` (default 8), ``PATTERN_SCAN_MAX_WORKERS`` (default 3).
- Job id: ``cpj_<uuid4hex>``.
- States: queued | running | completed | failed | cancelled.
- Every transition is persisted to ``pattern_compute_jobs`` and mirrored to
  Redis ``pattern_job:{id}`` (TTL 24h); DB is the source of truth.
- Active jobs are rehydrated from the DB on startup.
"""
from __future__ import annotations

import os
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from chart_patterns import store

PATTERN_SCAN_MAX_QUEUE = int(os.environ.get("PATTERN_SCAN_MAX_QUEUE", "8"))
PATTERN_SCAN_MAX_WORKERS = int(os.environ.get("PATTERN_SCAN_MAX_WORKERS", "3"))

REDIS_TTL_SECONDS = 24 * 3600

_UNSET = object()


class QueueFullError(Exception):
    """Raised when the bounded queue has no free slot."""


_lock = threading.RLock()
_jobs: dict[str, dict] = {}
_pending: deque[str] = deque()
_running: set[str] = set()
_runner: Optional[Callable[[str], None]] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def configure(max_queue=None, max_workers=None, runner=_UNSET) -> None:
    """Test/ops hook to adjust queue limits or inject a runner."""
    global PATTERN_SCAN_MAX_QUEUE, PATTERN_SCAN_MAX_WORKERS, _runner
    if max_queue is not None:
        PATTERN_SCAN_MAX_QUEUE = int(max_queue)
    if max_workers is not None:
        PATTERN_SCAN_MAX_WORKERS = int(max_workers)
    if runner is not _UNSET:
        _runner = runner


def reset() -> None:
    """Clear all in-memory queue state (tests)."""
    global _runner
    with _lock:
        _jobs.clear()
        _pending.clear()
        _running.clear()
        _runner = None


def _max_queue() -> int:
    return max(1, int(PATTERN_SCAN_MAX_QUEUE))


def _max_workers() -> int:
    return max(1, int(PATTERN_SCAN_MAX_WORKERS))


def queue_size() -> int:
    with _lock:
        return len(_pending) + len(_running)


def _mirror(job: dict) -> None:
    try:
        from cache.redis_client import cache_set

        cache_set(f"pattern_job:{job['job_id']}", job, ttl=REDIS_TTL_SECONDS)
    except Exception:
        pass


def _persist(job: dict) -> None:
    try:
        store.save_job(job)
    except Exception:
        pass


def _refresh_positions_locked() -> None:
    for idx, jid in enumerate(_pending):
        job = _jobs.get(jid)
        if job is None:
            continue
        job["queue_position"] = idx
        _persist(job)
        _mirror(job)


def _runner_fn() -> Callable[[str], None]:
    if _runner is not None:
        return _runner

    def _default(job_id: str) -> None:
        from chart_patterns import scan

        scan.run_job(job_id)

    return _default


def _scope_signature(params: Optional[dict] = None) -> tuple:
    """Coalescing scope of a job: ``(sorted symbols, lookback_bars)``.

    Two jobs for the same ``(universe, timeframe)`` coalesce only when their
    scopes match; a scope change (Lookback or custom symbol set) supersedes
    the in-flight job instead of being silently dropped.
    """
    p = params if isinstance(params, dict) else {}
    symbols = p.get("symbols") or []
    return (tuple(sorted(symbols)), p.get("lookback_bars"))


def submit(universe: str, timeframe: str, requested_by=None, params: Optional[dict] = None) -> dict:
    """Enqueue a job. Raises :class:`QueueFullError` when the queue is full.

    A ``queued``/``running`` job for the same ``(universe, timeframe)`` combo
    with the same scope signature (symbols + lookback_bars) is coalesced:
    the existing job is returned instead of enqueuing a second scan
    (concurrent same-combo scans race in scan.py's delete/save_hits). A
    same-combo job with a *different* scope is cancelled and superseded by
    the new job, so a Lookback/symbol change is never silently dropped (the
    cancelled job stops at its next per-symbol check).
    """
    with _lock:
        new_scope = _scope_signature(params)
        supersede_id: Optional[str] = None
        for job_id, job in _jobs.items():
            if (
                job.get("status") in ("queued", "running")
                and job.get("universe") == universe
                and job.get("timeframe") == timeframe
            ):
                if _scope_signature(job.get("params")) == new_scope:
                    return dict(job)
                supersede_id = job_id
                break
        if supersede_id is not None:
            cancel(supersede_id)
        if len(_pending) + len(_running) >= _max_queue():
            raise QueueFullError(
                f"queue full ({len(_pending) + len(_running)}/{_max_queue()})"
            )
        job_id = f"cpj_{uuid.uuid4().hex}"
        job = {
            "job_id": job_id,
            "universe": universe,
            "timeframe": timeframe,
            "status": "queued",
            "total": 0,
            "done": 0,
            "failed": 0,
            "skipped": 0,
            "queue_position": None,
            "started_at": None,
            "finished_at": None,
            "data_through": None,
            "error": None,
            "requested_by": requested_by,
            "params": params or {},
        }
        _jobs[job_id] = job
        _pending.append(job_id)
        _refresh_positions_locked()
        _persist(job)
        _mirror(job)
        _maybe_start_locked()
        return dict(job)


def _maybe_start_locked() -> None:
    while _pending and len(_running) < _max_workers():
        job_id = _pending.popleft()
        job = _jobs.get(job_id)
        if job is None or job.get("status") != "queued":
            continue
        job["status"] = "running"
        job["started_at"] = job.get("started_at") or _now_iso()
        job["queue_position"] = None
        _running.add(job_id)
        _refresh_positions_locked()
        _persist(job)
        _mirror(job)
        thread = threading.Thread(target=_run_worker, args=(job_id,), daemon=True)
        thread.start()


def _run_worker(job_id: str) -> None:
    try:
        _runner_fn()(job_id)
    except Exception as exc:  # pragma: no cover - defensive
        with _lock:
            job = _jobs.get(job_id)
            if job is not None and job.get("status") not in ("cancelled", "completed"):
                job["status"] = "failed"
                job["error"] = str(exc)[:500]
                job["finished_at"] = _now_iso()
                _persist(job)
                _mirror(job)
    finally:
        with _lock:
            _running.discard(job_id)
            _maybe_start_locked()


def update_state(job_id: str, persist: bool = True, **fields: Any) -> Optional[dict]:
    """Update a job's in-memory DTO, Redis mirror, and (optionally) DB row."""
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            row = store.get_job(job_id)
            if row is None:
                return None
            row.pop("created_at", None)
            job = row
            _jobs[job_id] = job
        job.update(fields)
        _mirror(job)
        if persist:
            _persist(job)
        return dict(job)


def get_job(job_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            return dict(job)
    row = store.get_job(job_id)
    if row is not None:
        return row
    try:
        from cache.redis_client import cache_get

        cached = cache_get(f"pattern_job:{job_id}")
        if isinstance(cached, dict):
            return cached
    except Exception:
        pass
    return None


def list_active() -> list[dict]:
    """Return queued + running jobs, overlaying live in-memory state."""
    with _lock:
        memory = {jid: dict(job) for jid, job in _jobs.items() if job.get("status") in ("queued", "running")}
    rows = {row["job_id"]: row for row in store.list_jobs(active_only=True, limit=200)}
    rows.update(memory)
    # running first, then by created/start order
    def _key(job: dict):
        return (0 if job.get("status") == "running" else 1, job.get("queue_position") if job.get("queue_position") is not None else 0)

    return sorted(rows.values(), key=_key)


def is_cancelled(job_id: str) -> bool:
    with _lock:
        job = _jobs.get(job_id)
        return bool(job and job.get("status") == "cancelled")


def cancel(job_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            job = store.get_job(job_id)
            if job is None:
                return None
            job.pop("created_at", None)
            _jobs[job_id] = job
        status = job.get("status")
        if status not in ("queued", "running"):
            return dict(job)
        if status == "queued":
            try:
                _pending.remove(job_id)
            except ValueError:
                pass
            job["status"] = "cancelled"
            job["queue_position"] = None
            job["finished_at"] = _now_iso()
            _refresh_positions_locked()
            _persist(job)
            _mirror(job)
        else:
            # Signal the running worker; it flips the status when it notices.
            job["status"] = "cancelled"
            job["queue_position"] = None
            job["finished_at"] = _now_iso()
            _persist(job)
            _mirror(job)
        return dict(job)


def rehydrate(limit: int = 200) -> int:
    """Reload queued/running jobs from the DB after a process restart."""
    count = 0
    with _lock:
        for row in store.list_jobs(active_only=True, limit=limit):
            job_id = row["job_id"]
            if job_id in _jobs and _jobs[job_id].get("status") in ("queued", "running"):
                continue
            row = dict(row)
            row.pop("created_at", None)
            # A "running" row means the previous process died mid-job -> requeue.
            row["status"] = "queued"
            row["queue_position"] = None
            row["started_at"] = None
            _jobs[job_id] = row
            if job_id not in _pending:
                _pending.append(job_id)
            count += 1
        _refresh_positions_locked()
        _maybe_start_locked()
    return count
