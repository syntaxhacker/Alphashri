"""Single cache-key namespace for the 52W-high screener.

Only this module defines 52w_range* key strings and TTLs.
"""

PREFIX = "52w_range"

#: Bulk key holding every symbol's {high, low, close[, days_ago]}.
BULK = "52w_range:all"

#: Redis key holding the batch job status dict.
JOB_STATUS = "52w_range:job_status"

#: TTL for cached 52W range data (seconds).
RANGE_TTL = 600

#: TTL for the batch job status (seconds, 7 days).
JOB_TTL = 86400 * 7

#: Paper-trading 52W file cache directory (relative to project root).
PAPER_52W_CACHE_DIR = "experiments/data/52w_cache"


def per_symbol(symbol: str) -> str:
    """Redis key for a single symbol's 52W range."""
    return f"52w_range:{symbol}"
