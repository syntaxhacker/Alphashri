"""Telegram delivery for Event Radar.

Two very different messages:

* the **daily digest** — the calendar, once per morning. It is a message the
  user reads over coffee, so it is capped at 20 lines and always ends with a
  counter instead of a truncated list.
* the **anomaly alert** — "this symbol is moving and nobody told us why". It is
  time-critical and must never fire for an explained move.

Alerts must never break the poller: a dead Telegram token, a blocked network or
a rate-limit blow-up is logged and swallowed. The tripwire's job is detection;
delivery is best-effort by design, because an exception here would kill the loop
and the feature would go dark silently.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Sequence
from typing import Optional

from .contract import Anomaly, Event, days_until

logger = logging.getLogger("event_radar.alerts")

#: Hard cap: a 20-line message fits one phone screen and Telegram's preview.
MAX_DIGEST_LINES = 20

DIGEST_COOLDOWN_KEY = "event-radar-digest"

_US_TZ = dt.timezone(dt.timedelta(hours=-4))


def _today_iso(today: Optional[dt.date]) -> Optional[str]:
    return today.isoformat() if isinstance(today, dt.date) else None


def _relative(days: int) -> str:
    if days == 0:
        return "today"
    if days > 0:
        return f"in {days}d"
    return f"{-days}d ago"


def format_event_line(ev: Event, today: Optional[dt.date] = None) -> str:
    """One digest line, e.g. ``📅 ORCL Investor Day in 3d (2026-10-31) · edgar · announced 2026-10-23``.

    ``days_until`` comes from the contract so the digest and the UI can never
    disagree about what "in 3d" means.
    """
    offset = days_until(ev.event_date, _today_iso(today))
    line = f"📅 {ev.title} {_relative(offset)} ({ev.event_date}) · {ev.source}"
    if ev.announced_at:
        line = f"{line} · announced {ev.announced_at}"
    return line


def _et_today() -> dt.date:
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # pragma: no cover - tzdata missing
        return dt.datetime.now(_US_TZ).date()


def send_daily_digest(events: Sequence[Event], today: Optional[dt.date] = None) -> int:
    """Send one digest message; returns the number of events actually included.

    Returns ``0`` for an empty calendar (nothing to say is not a message) and
    ``0`` when delivery fails — a caller that logs the return value must not
    claim it informed the user when Telegram refused the message.
    """
    items = list(events)  # copy: never mutate the caller's sequence
    if not items:
        return 0

    clock = today if isinstance(today, dt.date) else _et_today()
    header = f"📅 Event Radar — {clock.isoformat()}"

    capacity = MAX_DIGEST_LINES - 1  # header occupies one line
    included = items[:capacity]
    tail_needed = len(items) > len(included)
    if tail_needed:
        # The "+N more" line itself needs a slot, so one fewer event is shown.
        included = items[: max(0, capacity - 1)]

    lines = [header] + [format_event_line(ev, clock) for ev in included]
    if tail_needed:
        lines.append(f"+{len(items) - len(included)} more")
    text = "\n".join(lines[:MAX_DIGEST_LINES])

    try:
        from trading.telegram_notifier import send_alert

        send_alert(text, cooldown_key=DIGEST_COOLDOWN_KEY)
    except Exception as exc:  # noqa: BLE001 - delivery is best-effort by design
        logger.warning("event radar digest delivery failed: %s", exc)
        return 0
    return len(included)


def format_anomaly(an: Anomaly) -> str:
    """One compact alert: what moved, how far, how abnormal, and when."""
    lines = [
        f"⚡ {an.symbol} {an.ret_pct:+.2f}% in 1m "
        f"({an.ret_sigma:+.1f}σ, {an.vol_ratio:.1f}x vol)",
        f"{an.ts} @ {an.price:.2f}",
    ]
    if an.suspected:
        lines.append(an.suspected)
    return "\n".join(lines)


def send_anomaly(an: Anomaly) -> bool:
    """Alert on an unexplained move; ``False`` when suppressed or undelivered.

    Suppression is the interesting case: ``has_known_event`` means the calendar
    already explains this symbol-day (an investor day, an earnings print), and
    paging the user about a move we predicted is exactly the noise this feature
    is meant to remove.
    """
    if an.has_known_event:
        return False

    try:
        from trading.telegram_notifier import send_alert

        send_alert(
            format_anomaly(an),
            cooldown_key=f"event-radar-anomaly-{an.symbol}",
        )
    except Exception as exc:  # noqa: BLE001 - never kill the poller
        logger.warning("event radar anomaly alert failed for %s: %s", an.symbol, exc)
        return False
    return True


__all__ = [
    "DIGEST_COOLDOWN_KEY",
    "MAX_DIGEST_LINES",
    "format_anomaly",
    "format_event_line",
    "send_anomaly",
    "send_daily_digest",
]
