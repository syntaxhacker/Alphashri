"""Redis-backed status for the Upstox 52W range batch job."""
from __future__ import annotations

from datetime import datetime
from typing import Any

import config

JOB_STATUS_KEY = "52w_range:job_status"
JOB_STATUS_TTL = 86400 * 7  # 7 days


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