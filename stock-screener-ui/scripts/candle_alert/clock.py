from datetime import datetime, timezone

from . import config


def _as_utc(now: datetime) -> datetime:
    # A naive value is interpreted as UTC so epoch math never mixes local offsets in.
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def next_close(tf_minutes: int, now: datetime) -> datetime:
    step = tf_minutes * 60
    # floor + 1 keeps the boundary strictly after now, so a just-passed close is not re-alerted.
    boundary = (_as_utc(now).timestamp() // step + 1) * step
    return datetime.fromtimestamp(boundary, tz=timezone.utc)


def seconds_until(tf_minutes: int, now: datetime) -> float:
    return next_close(tf_minutes, now).timestamp() - _as_utc(now).timestamp()


def close_epoch(tf_minutes: int, now: datetime) -> int:
    return int(next_close(tf_minutes, now).timestamp())


def in_alert_window(tf_minutes: int, now: datetime) -> bool:
    remaining = seconds_until(tf_minutes, now)
    return 0 < remaining <= config.ALERT_LEAD_SECONDS


def format_hms(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"
