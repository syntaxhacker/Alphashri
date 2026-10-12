#!/usr/bin/env python3
"""US market phase + adaptive freshness policy.

Single source of truth for "how fresh should data be right now" so the
dashboard never serves stalled data while the market is open, and never wastes
UW quota while it is closed.

Phases (ET): premarket 04:00-09:30, open 09:30-16:00, afterhours 16:00-20:00,
closed otherwise (weekends always closed). US market holidays are not
special-cased — on a holiday the API simply returns no new data, and the
adaptive TTLs still keep the UI responsive.
"""
from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

_OPEN = time(9, 30)
_CLOSE = time(16, 0)
_PRE = time(4, 0)
_POST = time(20, 0)

# Server cache TTL (seconds) per phase.
_TTL = {
    "open": 25,
    "premarket": 40,
    "afterhours": 75,
    "closed": 180,
}

# Browser poll interval (ms) per view per phase — fast while open, cheap when shut.
# NOTE: "alerts" is the once-daily OI build (updates ~06:45 ET) so it is slow by
# design; "live" is the real-time flow/unusual/dark-pool stream and is fast.
_POLL_MS = {
    "open": {"live": 20000, "alerts": 600000, "news": 30000, "pulse": 40000, "snapshot": 45000,
             "opps": 60000, "symbol": 90000, "tape": 30000, "default": 60000},
    "premarket": {"live": 45000, "alerts": 300000, "news": 30000, "pulse": 60000, "snapshot": 60000,
                  "opps": 90000, "symbol": 120000, "tape": 60000, "default": 60000},
    "afterhours": {"live": 60000, "alerts": 600000, "news": 45000, "pulse": 90000, "snapshot": 90000,
                   "opps": 120000, "symbol": 180000, "tape": 60000, "default": 90000},
    "closed": {"live": 300000, "alerts": 1800000, "news": 120000, "pulse": 300000, "snapshot": 180000,
               "opps": 300000, "symbol": 300000, "tape": 300000, "default": 180000},
}


# Hidden-tab cadence: the alert watcher keeps polling in the background so a
# closed-over tab can still ring the desktop notification + bell, just slower.
_POLL_MS_HIDDEN = {
    "open": {"live": 60000, "default": 300000},
    "premarket": {"live": 120000, "default": 600000},
    "afterhours": {"live": 120000, "default": 600000},
    "closed": {"live": 300000, "default": 900000},
}


def now_et(now: datetime | None = None) -> datetime:
    return now or datetime.now(ET)


def phase(now: datetime | None = None) -> str:
    """Return one of: premarket | open | afterhours | closed."""
    n = now_et(now)
    if n.weekday() >= 5:
        return "closed"
    t = n.time()
    if _OPEN <= t < _CLOSE:
        return "open"
    if _PRE <= t < _OPEN:
        return "premarket"
    if _CLOSE <= t < _POST:
        return "afterhours"
    return "closed"


def is_open(now: datetime | None = None) -> bool:
    return phase(now) == "open"


def ttl(now: datetime | None = None) -> int:
    """Adaptive cache TTL in seconds for the current phase."""
    return _TTL[phase(now)]


def poll_ms(now: datetime | None = None) -> dict:
    return dict(_POLL_MS[phase(now)])


def poll_ms_hidden(now: datetime | None = None) -> dict:
    return dict(_POLL_MS_HIDDEN[phase(now)])


def status_payload(now: datetime | None = None) -> dict:
    n = now_et(now)
    p = phase(n)
    return {
        "phase": p,
        "is_open": p == "open",
        "et": n.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "utc": n.astimezone(UTC).isoformat(timespec="seconds"),
        "ttl_s": dict(_TTL),
        "poll_ms": poll_ms(n),
        "poll_ms_hidden": poll_ms_hidden(n),
        "policy": {
            "open": "fast — 25s server cache; alerts 25s / news 30s / snapshot 45s browser",
            "premarket": "news + alerts fast, options data is prior session",
            "afterhours": "slower; options data settles after the close",
            "closed": "cheap — long TTLs, no point polling",
        },
    }


if __name__ == "__main__":
    import json

    print(json.dumps(status_payload(), indent=2))
