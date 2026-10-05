"""Timeframe registry (CONTRACT.md §1).

A *timeframe* is a named aggregation of OHLCV candles. Some timeframes are
natively served by the Upstox V3 transport, others are produced by resampling a
native *source_tf* (e.g. ``3m`` from ``1m``).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TFSpec:
    """Specification of a single timeframe.

    Attributes:
        id: stable identifier used across the API/DB/UI (e.g. ``"15m"``).
        label: human readable label (e.g. ``"15m"``).
        minutes: length of one bar in minutes.
        native: True when Upstox V3 serves this timeframe directly.
        source_tf: timeframe id to resample from when ``native`` is False.
        max_lookback_days: furthest history the scan may request.
        min_bars: minimum post-warmup bars required before detection is
            attempted. Below this the symbol is counted ``skipped``.
    """

    id: str
    label: str
    minutes: int
    native: bool
    source_tf: str | None
    max_lookback_days: int
    min_bars: int

    def to_dict(self) -> dict:
        return asdict(self)


# Order matters: it is the ladder shown in the UI (fast -> slow).
TIMEFRAMES: list[TFSpec] = [
    TFSpec("1m", "1m", 1, True, None, 30, 60),
    TFSpec("3m", "3m", 3, False, "1m", 30, 60),
    TFSpec("5m", "5m", 5, True, None, 90, 60),
    TFSpec("10m", "10m", 10, True, None, 90, 60),
    TFSpec("15m", "15m", 15, True, None, 90, 60),
    TFSpec("30m", "30m", 30, True, None, 180, 60),
    TFSpec("1h", "1h", 60, True, None, 365, 60),
    TFSpec("2h", "2h", 120, False, "1h", 365, 60),
    TFSpec("3h", "3h", 180, False, "1h", 365, 60),
    TFSpec("4h", "4h", 240, False, "1h", 365, 60),
    TFSpec("1D", "1D", 1440, True, None, 730, 60),
    TFSpec("1W", "1W", 10080, True, None, 1825, 52),
    TFSpec("1M", "1M", 43200, True, None, 3650, 24),
]

TIMEFRAME_IDS: list[str] = [tf.id for tf in TIMEFRAMES]

_BY_ID = {tf.id: tf for tf in TIMEFRAMES}


def get_timeframe(tf_id: str) -> TFSpec:
    """Return the :class:`TFSpec` for ``tf_id``.

    Raises:
        ValueError: when ``tf_id`` is not a registered timeframe id.
    """
    try:
        return _BY_ID[tf_id]
    except (KeyError, TypeError):
        raise ValueError(
            f"Unknown timeframe {tf_id!r}. Known: {TIMEFRAME_IDS}"
        ) from None
