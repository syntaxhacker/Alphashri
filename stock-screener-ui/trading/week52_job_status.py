"""Redis-backed status for the Upstox 52W range batch job."""
from __future__ import annotations

from datetime import datetime
from typing import Any

import config

import os

JOB_STATUS_KEY = "52w_range:job_status"
JOB_STATUS_TTL = 86400 * 7  # 7 days

# A "running" job whose last update is older than this is considered stale
# (crashed/hung subprocess) and may be reset by the scheduler or admin endpoints.
# Override with env SCREENER_52W_STALE_SEC (default 1800s = 30min).
STALE_DEFAULT_SEC = 1800


def _now_iso() -> str:
    return datetime.now(config.IST).isoformat()


def get_job_status() -> dict[str, Any] | None:
    from cache.redis_client import cache_get

    data = cache_get(JOB_STATUS_KEY)
    return data if isinstance(data, dict) else None


def set_job_status(**fields: Any) -> None:
    from cache.redis_client import cache_get, cache_set

    current = cache_get(JOB_STATUS_KEY)
    if not isinstance(current, dict):
        current = {}
    current.update(fields)
    if "updated_at" not in fields:
        current["updated_at"] = _now_iso()
    cache_set(JOB_STATUS_KEY, current, ttl=JOB_STATUS_TTL)


def start_job(total: int, *, skip_existing: bool = False, skip_updated_today: bool = False) -> None:
    set_job_status(
        status="running",
        total=total,
        processed=0,
        ok=0,
        failed=0,
        skipped=0,
        skip_existing=skip_existing,
        skip_updated_today=skip_updated_today,
        started_at=_now_iso(),
        finished_at=None,
        message="Upstox 52W range batch started",
        error=None,
    )


def update_job_progress(
    processed: int,
    total: int,
    *,
    ok: int = 0,
    failed: int = 0,
    skipped: int = 0,
    last_symbol: str | None = None,
) -> None:
    pct = round(100.0 * processed / total, 1) if total > 0 else 0.0
    fields: dict[str, Any] = {
        "status": "running",
        "processed": processed,
        "total": total,
        "ok": ok,
        "failed": failed,
        "skipped": skipped,
        "progress_pct": pct,
        "message": f"Processing {processed}/{total} ({pct}%)",
    }
    if last_symbol:
        fields["last_symbol"] = last_symbol
    set_job_status(**fields)


def finish_job(
    *,
    ok: int,
    failed: int,
    skipped: int,
    total: int,
    elapsed_sec: float,
    error: str | None = None,
) -> None:
    status = "failed" if error else "completed"
    set_job_status(
        status=status,
        processed=total,
        total=total,
        ok=ok,
        failed=failed,
        skipped=skipped,
        progress_pct=100.0 if total else 0.0,
        finished_at=_now_iso(),
        elapsed_sec=round(elapsed_sec, 1),
        message=error or f"Done — ok={ok} skipped={skipped} failed={failed}",
        error=error,
    )


def fail_job(message: str) -> None:
    set_job_status(
        status="failed",
        finished_at=_now_iso(),
        message=message,
        error=message,
    )


def get_stale_threshold_sec() -> int:
    """Staleness threshold for a 'running' job (env SCREENER_52W_STALE_SEC, default 1800)."""
    try:
        return max(0, int(os.environ.get("SCREENER_52W_STALE_SEC", str(STALE_DEFAULT_SEC))))
    except (TypeError, ValueError):
        return STALE_DEFAULT_SEC


def _parse_ts(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        ts = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=config.IST)
    return ts


def job_age_sec(job: dict[str, Any] | None) -> float | None:
    """Age in seconds since the job's last update (updated_at, fallback started_at).

    Returns None when the job has no parseable timestamp.
    """
    if not isinstance(job, dict):
        return None
    ts = _parse_ts(job.get("updated_at")) or _parse_ts(job.get("started_at"))
    if ts is None:
        return None
    try:
        now = datetime.now(config.IST)
    except Exception:
        from datetime import timezone

        now = datetime.now(timezone.utc)
    return max(0.0, (now - ts).total_seconds())


def is_job_stale(job: dict[str, Any] | None, stale_sec: int | None = None) -> bool:
    """True when job is 'running' but its last update is older than the threshold.

    Pure function over the job dict — no Redis access, safe to unit-test.
    """
    if not isinstance(job, dict) or job.get("status") != "running":
        return False
    threshold = stale_sec if stale_sec is not None else get_stale_threshold_sec()
    age = job_age_sec(job)
    if age is None:
        return False
    return age > threshold