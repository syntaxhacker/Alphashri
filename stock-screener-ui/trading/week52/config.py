"""Single home for all 52W-high screener env knobs and numeric constants.

Every SCREENER_52W_* / SCREENER_TOUCH_* / SCREENER_RETEST_* env read and every
shared constant lives here. No other module may read these env vars directly.
"""
import os

#: A row whose price sits more than this far ABOVE its recorded 52W high
#: (gap < -STALE) is treated as a stale-high data error, not a breakout.
#: Genuine breakouts sit at gap ≈ 0% to slightly negative; a −10%/−20% gap
#: means the stored high disagrees with the live price feed.
STALE_52W_BREAKOUT_PCT = 5.0

#: Hard price ceiling for 52W candidates (skip close >= this).
PRICE_CAP = 7000

#: TV scanner ticker batch size for enrichment.
TV_BATCH_SIZE = 80


def touched_52w_gap_threshold_pct() -> float:
    """Within this % below 52W high (or above = breakout) => 'touched' bucket."""
    return float(os.environ.get('SCREENER_52W_TOUCHED_GAP_PCT', '1.0'))


def touch_eps_pct() -> float:
    """A daily high within this % of the 52W high counts as a touch."""
    return float(os.environ.get('SCREENER_52W_TOUCH_EPS_PCT', '0.5'))


def retest_window_days() -> int:
    """A touch within this many days + now below high => 'retest' (else 'fresh')."""
    return int(os.environ.get('SCREENER_RETEST_WINDOW_DAYS', '5'))


def min_52w_volume_m() -> float:
    """Default minimum volume (M shares) for 52w_high candidates. 0.0 disables."""
    return float(os.environ.get('SCREENER_52W_MIN_VOLUME_M', '0.0'))


def min_52w_turnover_cr() -> float:
    """Default minimum turnover (Rs Cr) for 52w_high candidates. See above."""
    return float(os.environ.get('SCREENER_52W_MIN_TURNOVER_CR', '0.5'))


def exclude_etfs_from_screener() -> bool:
    """When True (default), ETF/liquid-fund symbols are dropped from screener output."""
    return os.environ.get('SCREENER_EXCLUDE_ETFS', '1').lower() not in ('0', 'false', 'no')


def enrich_top_n() -> int:
    """How many top-scored rows get an intraday LTP refresh."""
    return int(os.environ.get('SCREENER_52W_ENRICH_TOP', '80'))


def touch_band_gap_pct() -> float:
    """Approaching rows within this % of the high get a 90d lookback for days_ago."""
    return float(os.environ.get('SCREENER_TOUCH_BAND_GAP_PCT', '5.0'))


def touch_lookback_top() -> int:
    """Max approaching rows to 90d-lookback for days_ago."""
    return int(os.environ.get('SCREENER_TOUCH_LOOKBACK_TOP', '120'))


def batch_interval_sec() -> int:
    """Batch scheduler interval (seconds)."""
    return int(os.environ.get('SCREENER_52W_INTERVAL_SEC', '3600'))


def batch_max_wait_sec() -> int:
    """Max seconds the scheduler waits for a batch subprocess to finish."""
    return int(os.environ.get('SCREENER_52W_MAX_WAIT_SEC', '7200'))


def job_stale_sec() -> int:
    """Staleness threshold for a 'running' job (env SCREENER_52W_STALE_SEC, default 1800)."""
    try:
        return max(0, int(os.environ.get('SCREENER_52W_STALE_SEC', '1800')))
    except (TypeError, ValueError):
        return 1800
