"""Deprecated compatibility shim; canonical code lives in ``trading.week52.job``."""
from trading.week52.job import (
    JOB_STATUS_KEY,
    JOB_STATUS_TTL,
    STALE_DEFAULT_SEC,
    complete_job,
    fail_job,
    finish_job,
    get_job_status,
    get_stale_threshold_sec,
    is_job_stale,
    job_age_sec,
    set_job_status,
    start_job,
    update_job_progress,
)

__all__ = [
    "JOB_STATUS_KEY",
    "JOB_STATUS_TTL",
    "STALE_DEFAULT_SEC",
    "get_job_status",
    "set_job_status",
    "start_job",
    "update_job_progress",
    "finish_job",
    "complete_job",
    "fail_job",
    "get_stale_threshold_sec",
    "is_job_stale",
    "job_age_sec",
]
