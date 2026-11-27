"""Single home for all 52W-high screener env knobs and numeric constants.

Every SCREENER_52W_* / SCREENER_TOUCH_* / SCREENER_RETEST_* env read and every
shared constant lives here. No other module may read these env vars directly.
Bad or negative env values fall back to the documented default.
"""
import math
import os


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(value) or value < 0:
        return default
    return value


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


#: A row whose price sits more than this far ABOVE its recorded 52W high
#: (gap < -STALE) is treated as a stale-high data error, not a breakout.
#: Genuine breakouts sit at gap ≈ 0% to slightly negative; a −10%/−20% gap
#: means the stored high disagrees with the live price feed.
STALE_52W_BREAKOUT_PCT = 5.0

#: Hard price ceiling for 52W candidates (skip close >= this).
PRICE_CAP = 7000

#: TV scanner ticker batch size for enrichment.
TV_BATCH_SIZE = 80

#: Profiles whose rows carry the touched/retest/fresh bucket fields.
PROFILES_WITH_52W_BUCKETS = {'trending', 'near_52w_breakout', 'touched_52w_high', '52w_high'}


def touched_52w_gap_threshold_pct() -> float:
    """Within this % below 52W high (or above = breakout) => 'touched' bucket."""
    return _env_float('SCREENER_52W_TOUCHED_GAP_PCT', 1.0)


def touch_eps_pct() -> float:
    """A daily high within this % of the 52W high counts as a touch."""
    return _env_float('SCREENER_52W_TOUCH_EPS_PCT', 0.5)


def retest_window_days() -> int:
    """A touch within this many days + now below high => 'retest' (else 'fresh')."""
    return _env_int('SCREENER_RETEST_WINDOW_DAYS', 5)


def min_52w_volume_m() -> float:
    """Default minimum volume (M shares) for 52w_high candidates. 0.0 disables."""
    return _env_float('SCREENER_52W_MIN_VOLUME_M', 0.0)


def min_52w_turnover_cr() -> float:
    """Default minimum turnover (Rs Cr) for 52w_high candidates. See above."""
    return _env_float('SCREENER_52W_MIN_TURNOVER_CR', 0.5)


def exclude_etfs_from_screener() -> bool:
    """When True (default), ETF/liquid-fund symbols are dropped from screener output."""
    return os.environ.get('SCREENER_EXCLUDE_ETFS', '1').lower() not in ('0', 'false', 'no')


def enrich_top_n() -> int:
    """How many top-scored rows get an intraday LTP refresh."""
    return _env_int('SCREENER_52W_ENRICH_TOP', 80)


def touch_band_gap_pct() -> float:
    """Approaching rows within this % of the high get a 90d lookback for days_ago."""
    return _env_float('SCREENER_TOUCH_BAND_GAP_PCT', 5.0)


def touch_lookback_top() -> int:
    """Max approaching rows to 90d-lookback for days_ago."""
    return _env_int('SCREENER_TOUCH_LOOKBACK_TOP', 120)


def batch_interval_sec() -> int:
    """Batch scheduler interval (seconds)."""
    return _env_int('SCREENER_52W_INTERVAL_SEC', 3600)


def batch_max_wait_sec() -> int:
    """Max seconds the scheduler waits for a batch subprocess to finish."""
    return _env_int('SCREENER_52W_MAX_WAIT_SEC', 7200)


def job_stale_sec() -> int:
    """Staleness threshold for a 'running' job (env SCREENER_52W_STALE_SEC, default 1800)."""
    return _env_int('SCREENER_52W_STALE_SEC', 1800)


def cache_ttl_sec() -> int:
    """TTL for the bulk 52W range cache (env SCREENER_52W_CACHE_TTL, default 24h)."""
    return _env_int('SCREENER_52W_CACHE_TTL', 24 * 60 * 60)


def batch_workers() -> int:
    """Parallel workers for the 52W range batch (env SCREENER_52W_WORKERS, default 3)."""
    return _env_int('SCREENER_52W_WORKERS', 3)


def batch_delay_sec() -> float:
    """Delay between batch symbol fetches (env SCREENER_52W_DELAY_SEC, default 0.35s)."""
    return _env_float('SCREENER_52W_DELAY_SEC', 0.35)


__all__ = [
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
]
