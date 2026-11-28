"""Single cache-key namespace for the 52W-high screener.

Only this module defines 52w_range* key strings and TTLs.
"""

PREFIX = "52w_range"

#: Bulk key holding every symbol's {high, low, close[, days_ago]}.
BULK = "52w_range:all"

#: Redis key holding the batch job status dict.
JOB_STATUS = "52w_range:job_status"

#: TTL for cached 52W range data (seconds). Ranges arrive from the release-sync
#: watcher or an admin-triggered refresh, not an in-process scheduler. Env
#: override: config.cache_ttl_sec() (SCREENER_52W_CACHE_TTL).
RANGE_TTL = 24 * 60 * 60

#: TTL for the batch job status (seconds, 7 days).
JOB_TTL = 86400 * 7

#: Paper-trading 52W file cache directory (relative to project root).
PAPER_52W_CACHE_DIR = "experiments/data/52w_cache"

#: Paper endpoint's per-symbol JSON cache TTL, in minutes. This is a short-lived
#: Upstox-derived level cache, not the Redis range namespace governed by
#: RANGE_TTL; the two windows deliberately differ.
PAPER_52W_FILE_TTL_MINUTES = 5


def per_symbol(symbol: str) -> str:
    """Redis key for a single symbol's 52W range."""
    return f"52w_range:{symbol}"
