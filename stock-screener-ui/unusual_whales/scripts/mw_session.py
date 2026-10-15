#!/usr/bin/env python3
"""CME Globex session calendar + tick-feed staleness guard.

Why this exists
---------------
MotiveWave rewrites the in-progress hour file in batches (~1-3 min), so a
"frozen" last tick is NORMAL. And every CME product halts daily from
17:00-18:00 ET. A naive staleness check therefore false-alarms twice a day for
an hour. This module knows the difference between "MotiveWave is behind on its
flush" and "there is genuinely no feed".

Scope: CME Globex daily schedule for equity-index / energy futures —
Sunday 17:00 ET open, Friday 17:00 ET close, daily maintenance halt
17:00-18:00 ET (Mon-Thu). Exchange HOLIDAYS are not modelled: on a holiday the
feed is legitimately quiet, so callers should treat stale=True as "worth a
look", not "broken".

Times are America/New_York and DST-aware via zoneinfo.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = timezone.utc

# observed MotiveWave flush cadence was 1-3 min; 5 min is a safe "too long"
DEFAULT_MAX_AGE_S = 300.0


def et_now(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(ET)
    if now.tzinfo is None:
        return now.replace(tzinfo=UTC).astimezone(ET)
    return now.astimezone(ET)


def cme_futures_open(now: datetime | None = None) -> bool:
    """True while CME Globex is trading (ignores exchange holidays)."""
    n = et_now(now)
    wd = n.weekday()  # Mon=0 .. Sun=6
    minutes = n.hour * 60 + n.minute
    if wd == 5:  # Saturday — closed all day
        return False
    if wd == 6:  # Sunday — opens 17:00 ET
        return minutes >= 17 * 60
    if wd == 4:  # Friday — closes 17:00 ET
        return minutes < 17 * 60
    return not (17 * 60 <= minutes < 18 * 60)  # Mon-Thu daily halt


def next_open(now: datetime | None = None) -> datetime:
    """Next moment the daily session resumes (ET)."""
    n = et_now(now)
    wd, minutes = n.weekday(), n.hour * 60 + n.minute
    if wd == 5:
        return (n + timedelta(days=1)).replace(hour=17, minute=0, second=0, microsecond=0)
    if wd == 6:
        if minutes < 17 * 60:
            return n.replace(hour=17, minute=0, second=0, microsecond=0)
        return (n + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    if minutes < 17 * 60:
        return n.replace(hour=17, minute=0, second=0, microsecond=0)
    return n.replace(hour=18, minute=0, second=0, microsecond=0)


def staleness(prefix: str = "MNQ", root: Path | None = None, *,
              max_age_s: float = DEFAULT_MAX_AGE_S, now: datetime | None = None) -> dict:
    """Is the MotiveWave tick feed for ``prefix`` behind?

    ``stale`` is only ever True while the exchange is open — during the daily
    halt (or the weekend) a growing age is expected and reported as ``open=False``.
    """
    from mw_tickstore import latest_tick  # local import keeps this module light

    now_utc = datetime.now(UTC) if now is None else et_now(now).astimezone(UTC)
    out = {
        "instrument": None,
        "age_s": None,
        "age_min": None,
        "open": cme_futures_open(now_utc),
        "max_age_s": float(max_age_s),
        "stale": False,
        "reason": None,
        "next_open_et": next_open(now_utc).strftime("%Y-%m-%d %H:%M %Z"),
    }
    tick = latest_tick(prefix, root)
    if not tick:
        out["reason"] = "no tick found in the MotiveWave store"
        out["stale"] = bool(out["open"])
        return out
    age = now_utc.timestamp() - tick["ts"] / 1000.0
    out.update(
        instrument=tick.get("instrument"),
        age_s=round(age, 1),
        age_min=round(age / 60.0, 1),
    )
    if not out["open"]:
        out["reason"] = "exchange closed (CME daily halt / weekend) — growing age is expected"
    elif age > max_age_s:
        out["stale"] = True
        out["reason"] = f"feed quiet {age / 60:.1f} min while the exchange is open"
    else:
        out["reason"] = "fresh"
    return out


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(staleness(sys.argv[1] if len(sys.argv) > 1 else "MNQ"), indent=2))
