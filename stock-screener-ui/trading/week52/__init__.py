"""Canonical 52W-high screener helpers: config, keys, math, ranges and job status.

Import the public API from here:
    from trading.week52 import get_52w_range, load_all_52w_ranges, classify_approach
"""
from .config import (
    PRICE_CAP,
    PROFILES_WITH_52W_BUCKETS,
    STALE_52W_BREAKOUT_PCT,
    TV_BATCH_SIZE,
    batch_delay_sec,
    batch_interval_sec,
    batch_max_wait_sec,
    batch_workers,
    cache_ttl_sec,
    enrich_top_n,
    exclude_etfs_from_screener,
    job_stale_sec,
    min_52w_turnover_cr,
    min_52w_volume_m,
    retest_window_days,
    touch_band_gap_pct,
    touch_eps_pct,
    touch_lookback_top,
    touched_52w_gap_threshold_pct,
)
from .job import (
    JOB_STATUS_KEY,
    JOB_STATUS_TTL,
    STALE_DEFAULT_SEC,
    complete_job,
    fail_job,
    finish_job,
    get_job_status,
    is_job_stale,
    job_age_sec,
    set_job_status,
    start_job,
    update_job_progress,
)
from .keys import (
    BULK,
    JOB_STATUS,
    JOB_TTL,
    PAPER_52W_CACHE_DIR,
    PREFIX,
    RANGE_TTL,
    per_symbol,
)
from .math import (
    classify_approach,
    gap_pct_to_52w_high,
    has_live_data,
    is_likely_etf,
    is_plausible_52w_gap,
    is_within_52w_touch_gap,
)
from .ranges import get_52w_range, load_all_52w_ranges, sanitize_bulk, sanitize_entry

__all__ = [
    # config
    "STALE_52W_BREAKOUT_PCT",
    "PRICE_CAP",
    "TV_BATCH_SIZE",
    "PROFILES_WITH_52W_BUCKETS",
    "touched_52w_gap_threshold_pct",
    "touch_eps_pct",
    "retest_window_days",
    "min_52w_volume_m",
    "min_52w_turnover_cr",
    "exclude_etfs_from_screener",
    "enrich_top_n",
    "touch_band_gap_pct",
    "touch_lookback_top",
    "batch_interval_sec",
    "batch_max_wait_sec",
    "job_stale_sec",
    "cache_ttl_sec",
    "batch_workers",
    "batch_delay_sec",
    # keys
    "PREFIX",
    "BULK",
    "JOB_STATUS",
    "JOB_TTL",
    "RANGE_TTL",
    "PAPER_52W_CACHE_DIR",
    "per_symbol",
    # math
    "is_likely_etf",
    "classify_approach",
    "has_live_data",
    "gap_pct_to_52w_high",
    "is_within_52w_touch_gap",
    "is_plausible_52w_gap",
    # ranges
    "sanitize_entry",
    "sanitize_bulk",
    "get_52w_range",
    "load_all_52w_ranges",
    # job
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
    "is_job_stale",
    "job_age_sec",
]
