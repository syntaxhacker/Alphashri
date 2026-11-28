"""Single home for all 52W-high screener env knobs and numeric constants.

Every SCREENER_52W_* / SCREENER_TOUCH_* / SCREENER_RETEST_* env read and every
shared constant lives here. No other module may read these env vars directly.
Bad or negative env values fall back to the documented default; integer readers
accept whole-number strings only (fractional values such as "120.5" fall back
rather than being truncated).
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
    """Read an integer env value: only whole-number strings are accepted.

    A fractional string like "120.5" is malformed for an integer knob, so it
    falls back to ``default`` instead of being silently truncated to 120.
    Negative values also fall back.
    """
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

# Fixed legacy touch bands. These callers predate the configurable 0.5%
# ``touch_eps_pct()`` knob and pin their own distance below the 52W high; their
# screener/debug output depends on the historical values, so the 0.5% default
# must NOT be imposed on them. ``*_PCT`` is the distance in percent, ``*_MULTIPLIER``
# is the 1 - pct/100 form used by the older callers (bit-exact with the old floats).
LEGACY_TOUCH_BAND_PCT = 2.0
LEGACY_TOUCH_BAND_MULTIPLIER = 1 - LEGACY_TOUCH_BAND_PCT / 100

LEGACY_RECENT_TOUCH_BAND_PCT = 1.0
LEGACY_RECENT_TOUCH_BAND_MULTIPLIER = 1 - LEGACY_RECENT_TOUCH_BAND_PCT / 100

LEGACY_NEAR_HIGH_BAND_PCT = 0.1
LEGACY_NEAR_HIGH_BAND_MULTIPLIER = 1 - LEGACY_NEAR_HIGH_BAND_PCT / 100


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
    """Interval (seconds) shown by the admin panel; the batch itself is on-demand."""
    return _env_int('SCREENER_52W_INTERVAL_SEC', 3600)


#: One canonical staleness default: job.STALE_DEFAULT_SEC aliases this value for
#: legacy callers instead of restating a second 1800 literal.
JOB_STALE_DEFAULT_SEC = 1800


def job_stale_sec() -> int:
    """Staleness threshold for a 'running' job (env SCREENER_52W_STALE_SEC, default 1800)."""
    return _env_int('SCREENER_52W_STALE_SEC', JOB_STALE_DEFAULT_SEC)


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
    "LEGACY_TOUCH_BAND_PCT",
    "LEGACY_TOUCH_BAND_MULTIPLIER",
    "LEGACY_RECENT_TOUCH_BAND_PCT",
    "LEGACY_RECENT_TOUCH_BAND_MULTIPLIER",
    "LEGACY_NEAR_HIGH_BAND_PCT",
    "LEGACY_NEAR_HIGH_BAND_MULTIPLIER",
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
    "JOB_STALE_DEFAULT_SEC",
    "job_stale_sec",
    "cache_ttl_sec",
    "batch_workers",
    "batch_delay_sec",
]
