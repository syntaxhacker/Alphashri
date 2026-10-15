"""Live push of Nifty OI alerts (SSE), so the UI is told instead of polling.

Why: the UI polls `/bursts` every 30s, so an alert detected at minute-boundary
N could reach the screen up to ~30s later. A watcher re-runs detection every
`WATCH_INTERVAL_SEC` and pushes genuinely new events to subscribed clients, so
the browser learns within a couple of seconds of the tape row landing.

Scope note: this removes the UI tail only. The tape itself is written once per
minute, so detection cannot beat ~60s without streaming OI over the Upstox
WebSocket (`MarketDataStreamerV3(..., mode="option_greeks")` carries OI;
`ltpc` does NOT). That upgrade is deliberately NOT here — it needs live-market
validation rather than another untested background task.

Everything is best-effort: the watcher is market-hours gated and every step is
wrapped, so it can never break the API.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Any, Optional

import config

logger = logging.getLogger(__name__)

#: How often the tape is re-scanned for new alerts.
WATCH_INTERVAL_SEC = 10
#: Bounded memory: how many published events to retain for late subscribers.
MAX_EVENTS = 300

_events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)
_seen_ids: set[str] = set()
_subscribers: set[asyncio.Queue] = set()


def recent_events(limit: int = 50) -> list[dict[str, Any]]:
    """Most recent events, newest last (initial snapshot for a new client)."""
    if limit <= 0:
        return []
    return list(_events)[-limit:]


def subscribe() -> asyncio.Queue:
    """Register a subscriber; caller must call `unsubscribe`."""
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def publish(events: list[dict[str, Any]]) -> int:
    """Publish unseen events. Returns how many were newly pushed."""
    fresh = []
    for e in events or []:
        eid = str(e.get("id") or "")
        if not eid or eid in _seen_ids:
            continue
        _seen_ids.add(eid)
        _events.append(e)
        fresh.append(e)

    if not fresh:
        return 0

    # Keep the dedupe set from growing without bound over a long session.
    if len(_seen_ids) > MAX_EVENTS * 4:
        keep = {str(e.get("id")) for e in _events}
        _seen_ids.intersection_update(keep)

    for q in list(_subscribers):
        for e in fresh:
            try:
                q.put_nowait(e)
            except asyncio.QueueFull:
                # A stalled client must never block the watcher.
                logger.debug("nifty stream: subscriber queue full, dropping event")
    return len(fresh)


def _collect(rows: list[dict]) -> list[dict[str, Any]]:
    """Every detector, in one place. Imported lazily to keep this module light."""
    from api.reports_api.nifty_bursts import (
        detect_coiling,
        detect_oi_bursts,
        detect_premium_moves,
        detect_squeezes,
        detect_strike_bursts,
    )

    out: list[dict[str, Any]] = []
    for fn in (detect_oi_bursts, detect_squeezes, detect_strike_bursts,
               detect_premium_moves, detect_coiling):
        try:
            out.extend(fn(rows))
        except Exception as exc:  # one bad detector must not kill the others
            logger.debug("nifty stream: %s failed: %s", getattr(fn, "__name__", fn), exc)
    return out


def _reset_state() -> None:
    """New session: forget published ids so a fresh day starts clean."""
    _events.clear()
    _seen_ids.clear()


async def nifty_burst_watch_task(interval_sec: int = WATCH_INTERVAL_SEC) -> None:
    """Re-scan the stored tape and push new alerts. Market-hours gated."""
    from api.reports_api.nifty import derive_tape_rows, read_tape

    await asyncio.sleep(15)
    current_day = ""
    while True:
        try:
            try:
                from trading.utils import is_market_open

                open_now = bool(is_market_open())
            except Exception:
                open_now = False

            if not open_now:
                # Out of hours nothing new is recorded; don't spin or fetch.
                await asyncio.sleep(60)
                continue

            from datetime import datetime

            day = datetime.now(config.IST).strftime("%Y-%m-%d")
            if day != current_day:
                current_day = day
                _reset_state()

            rows = derive_tape_rows(read_tape(day))
            if rows:
                publish(_collect(rows))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("nifty burst watcher error: %s", exc)

        await asyncio.sleep(interval_sec)


def sse_payload(event: dict[str, Any]) -> str:
    """Format one event as an SSE `data:` frame."""
    return f"data: {json.dumps(event, default=str)}\n\n"
