"""Event Radar — corporate event calendar + intraday anomaly tripwire.

Public surface:

    from api.event_radar.contract import Event, Anomaly, EVENT_TYPES
    from api.event_radar.router import router

The JSON shape in ``Event.to_dict()`` is mirrored 1:1 by
``src/types/events.ts``. Change one, change the other.
"""

from .contract import (  # noqa: F401
    ANOMALY_COOLDOWN_MIN,
    ANOMALY_MIN_ABS_RET,
    ANOMALY_RET_SIGMA,
    ANOMALY_VOL_MULT,
    EVENT_TYPES,
    SOURCE_PRECEDENCE,
    Anomaly,
    Event,
    days_until,
)

__all__ = [
    "ANOMALY_COOLDOWN_MIN",
    "ANOMALY_MIN_ABS_RET",
    "ANOMALY_RET_SIGMA",
    "ANOMALY_VOL_MULT",
    "EVENT_TYPES",
    "SOURCE_PRECEDENCE",
    "Anomaly",
    "Event",
    "days_until",
]
