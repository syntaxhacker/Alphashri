"""Killzone session definitions and masks ported from ``ict.pine``.

Labels and per-zone enabled flags are at ict.pine:13-16,99-111; the actual
``input.session`` strings and their IANA timezones are at ict.pine:538-541.
The global ``showKZ`` input defaults to false (ict.pine:99) as a *display*
switch; the per-zone inputs below all default to true.
"""

from __future__ import annotations

from dataclasses import dataclass
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Killzone:
    """One Pine killzone: session string in ``tz``, plus Pine's ET comment."""

    name: str
    session: str
    tz: str
    enabled: bool
    et_equiv: str


# ict.pine:538-541 — the four windows are data; no zone-name branches below.
KILLZONES: tuple[Killzone, ...] = (
    Killzone("New York", "0700-0900", "America/New_York", True, ""),
    Killzone("London Open", "0700-1000", "Europe/London", True, "0200-0500 UTC-5"),
    Killzone("London Close", "1500-1700", "Europe/London", True, "1000-1200 UTC-5"),
    Killzone("Asian", "1000-1400", "Asia/Tokyo", True, "2000-0000 UTC-5"),
)


def _minutes(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[2:])


def _window(zone: Killzone) -> tuple[int, int]:
    start, end = zone.session.split("-")
    return _minutes(start), _minutes(end)


def _zone_mask(index: pd.DatetimeIndex, zone: Killzone, tz: str) -> np.ndarray:
    """Evaluate one session in its own zone; zoneinfo provides Pine's DST."""
    start, end = _window(zone)
    local = index.tz_convert(ZoneInfo(tz)).tz_convert(ZoneInfo(zone.tz))
    minutes = local.hour * 60 + local.minute
    if end < start:  # session crossing local midnight
        inside = (minutes >= start) | (minutes < end)
    else:
        inside = (minutes >= start) & (minutes < end)
    return np.asarray(inside, dtype=bool)


def _check_index(index: pd.DatetimeIndex) -> None:
    if not isinstance(index, pd.DatetimeIndex) or index.tz is None:
        raise ValueError("killzone helpers require a tz-aware DatetimeIndex")


def session_mask(
    index: pd.DatetimeIndex, tz: str = "America/New_York"
) -> pd.Series:
    """Union of the enabled killzones (ict.pine:538-541), half-open ``[start, end)``.

    ``tz`` is the chart/output timezone: the returned Series is indexed in it.
    Each session is still evaluated in its own IANA zone, matching Pine's third
    ``time()`` argument. DST is handled by zoneinfo, not a fixed UTC offset.
    """
    _check_index(index)
    mask = np.zeros(len(index), dtype=bool)
    for zone in KILLZONES:
        if zone.enabled:
            mask |= _zone_mask(index, zone, tz)
    return pd.Series(mask, index=index.tz_convert(ZoneInfo(tz)), name="in_killzone")


def killzone_windows(
    df: pd.DataFrame,
) -> dict[str, list[tuple[pd.Timestamp, pd.Timestamp]]]:
    """First and last bar of every contiguous in-session run, per zone.

    Runs break on a bar outside the session or on a change of local session
    date, so daily bars from different days are never merged.
    """
    index = df.index
    _check_index(index)
    windows: dict[str, list[tuple[pd.Timestamp, pd.Timestamp]]] = {}
    positions = np.arange(len(index))
    for zone in KILLZONES:
        if not zone.enabled:
            windows[zone.name] = []
            continue
        active = pd.Series(_zone_mask(index, zone, tz="America/New_York"), index=positions)
        dates = pd.Series(index.tz_convert(ZoneInfo(zone.tz)).date, index=positions)
        run_id = (active.ne(active.shift()) | dates.ne(dates.shift())).cumsum()
        runs: list[tuple[pd.Timestamp, pd.Timestamp]] = []
        for _, group in active[active].groupby(run_id[active], sort=False):
            hit = group.index.to_numpy()
            runs.append((index[hit[0]], index[hit[-1]]))
        windows[zone.name] = runs
    return windows
