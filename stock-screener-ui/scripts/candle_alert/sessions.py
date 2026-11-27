
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from .config import UTC
from .session import IST

_CLOSED = "MARKET CLOSED"


@dataclass(frozen=True)
class Session:
    name: str
    zone: str
    start: time
    end: time
    color: str


SESSIONS = (
    Session("ASIAN", "Asia/Tokyo", time(9, 0), time(15, 0), "#38BDF8"),
    Session("LONDON", "Europe/London", time(8, 0), time(17, 0), "#FBBF24"),
    Session("NY", "America/New_York", time(9, 30), time(16, 0), "#A78BFA"),
)
_COLORS = {item.name: item.color for item in SESSIONS}
_COLORS[_CLOSED] = "#6B7688"


def _window(session: Session, day):
    zone = ZoneInfo(session.zone)
    start = datetime.combine(day, session.start, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(day, session.end, tzinfo=zone).astimezone(UTC)
    return start, end


def current_sessions(now: datetime) -> list[str]:
    if now.astimezone(UTC).weekday() >= 5:
        return []
    active = []
    for session in SESSIONS:
        start, end = _window(session, now.astimezone(UTC).date())
        if start <= now < end:
            active.append(session.name)
    return active


def next_session(now: datetime):
    """Returns (name, UTC start) of the next session opening after now."""
    base = now.astimezone(UTC).date()
    upcoming = []
    for session in SESSIONS:
        for offset in range(4):
            day = base + timedelta(days=offset)
            start, _ = _window(session, day)
            if start > now:
                upcoming.append((start, session.name))
                break
    if not upcoming:
        return None, None
    start, name = min(upcoming)
    return name, start


def session_label(now: datetime) -> str:
    active = current_sessions(now)
    if not active:
        return _CLOSED
    return " + ".join(active)


def session_color(label: str) -> str:
    if label in _COLORS:
        return _COLORS[label]
    for name in SESSIONS:
        if name.name in label:
            return name.color
    return _COLORS[_CLOSED]


def session_detail(now: datetime) -> str:
    active = session_label(now)
    name, start = next_session(now)
    if name is None:
        return active
    local = start.astimezone(IST)
    minutes = max(0, int((start - now).total_seconds() // 60))
    if minutes >= 60:
        countdown = f"{minutes // 60}h{minutes % 60:02d}m"
    else:
        countdown = f"{minutes}m"
    return f"{active} · next {name} {local:%H:%M} IST (in {countdown})"
