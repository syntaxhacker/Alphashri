#!/usr/bin/env python3
"""Server-side streaming hub for the Unusual Whales dashboard.

The UW *WebSocket* feeds are Advanced-gated (HTTP 401 on this account), so the
dashboard streams over SSE instead: one background poller in this process hits
the UW REST API on a fast loop and every connected browser subscribes to the
deltas. A single upstream poller serves all clients — N browser tabs never
multiply the UW call rate.

    HUB.start()                       # lazy, daemon thread, idempotent
    ver, seen = HUB.subscribe_cursor()  # seed the "already seen" set on connect
    new, ver, phase = HUB.poll(seen)    # caller owns `seen`; adds new ids to it

`build_live_alerts(max_age=0)` is invoked every tick, so the fast loop really is
fresh. The once-a-day OI build (`alerts_data.build_alerts`) is refreshed only
every `OI_EVERY_TICKS` ticks — it does not move during the session.

Nothing here writes to any DB beyond what `build_live_alerts`/`build_alerts`
already do (their own `data/alerts.db` upserts).
"""
from __future__ import annotations

import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import live_alerts  # noqa: E402
import market_status  # noqa: E402

# Upstream poll cadence (seconds) per market phase. Kept as a small dict so the
# policy is readable at a glance instead of buried in if/else branches.
INTERVALS: dict = {"open": 4, "premarket": 8, "afterhours": 15, "closed": 90}

# OI (open interest) only updates once a day (~06:45 ET), so refresh it on a
# slow multiplier rather than on every fast tick.
OI_EVERY_TICKS = 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Hub:
    """One upstream live-alert poller shared by every SSE subscriber."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._started = False
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        # --- live alert state (newest-first list + id set) ---
        self.items: list = []
        self.ids: set = set()
        self.ts: str = _now_iso()
        self.version: int = 0
        self.phase: str = market_status.phase()
        self.counts: dict = {}
        self.total: int = 0
        # --- once-daily OI state ---
        self.oi: list = []
        self.oi_ids: set = set()
        self.oi_version: int = 0
        self._ticks: int = 0

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        """Start the daemon poller. Idempotent — safe to call on every connect."""
        with self._lock:
            if self._started:
                return
            self._started = True
            self._thread = threading.Thread(target=self._run, name="uw-stream-hub", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """Signal the poller to exit (used by tests / graceful shutdown)."""
        self._stop.set()

    def _run(self) -> None:
        # Poll IMMEDIATELY on start (the first iteration ticks before it waits),
        # so a server boot during market hours captures the tape without needing
        # a browser to connect. Then keep polling per phase.
        while not self._stop.is_set():
            # read the cadence first so a phase change takes effect next tick
            interval = INTERVALS.get(market_status.phase(), 60)
            try:
                self._tick()
            except Exception:  # noqa: BLE001 - the poller must never die
                pass
            self._stop.wait(interval)

    def _tick(self) -> None:
        payload = live_alerts.build_live_alerts(max_age=0)
        items = list(payload.get("alerts") or [])
        ids = {a.get("id") for a in items if a.get("id")}
        with self._lock:
            self.items = items
            self.ids = ids
            self.ts = _now_iso()
            self.phase = payload.get("phase") or market_status.phase()
            self.counts = dict(payload.get("counts") or {})
            self.total = int(payload.get("total") or len(items))
            self.version += 1
            self._ticks += 1
            due_oi = self._ticks % OI_EVERY_TICKS == 0
        if due_oi:
            self._refresh_oi()

    def _refresh_oi(self) -> None:
        try:
            import alerts_data  # noqa: PLC0415 - keep module import light

            payload = alerts_data.build_alerts()
            items = list(payload.get("alerts") or [])
            ids = {a.get("id") for a in items if a.get("id")}
            with self._lock:
                changed = ids != self.oi_ids
                self.oi = items
                self.oi_ids = ids
                if changed:
                    self.oi_version += 1
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------------- readers
    def snapshot(self) -> dict:
        """Consistent point-in-time copy used to prime a new SSE connection."""
        with self._lock:
            return {
                "ts": self.ts,
                "phase": self.phase,
                "version": self.version,
                "ids": sorted(self.ids),
                "items": list(self.items),
                "counts": dict(self.counts),
                "total": self.total,
                "oi": list(self.oi),
                "oi_ids": sorted(self.oi_ids),
                "oi_version": self.oi_version,
            }

    def subscribe_cursor(self):
        """Return `(version_now, set(ids_now))` so a client can seed its seen set."""
        with self._lock:
            return self.version, set(self.ids)

    def subscribe_oi_cursor(self):
        """Return `(oi_version_now, set(oi_ids_now))` for the OI feed."""
        with self._lock:
            return self.oi_version, set(self.oi_ids)

    def poll(self, cursor_seen: set):
        """Return `(new_items, version, phase)`.

        `cursor_seen` is owned by the caller: every id returned is added to it,
        so the next call only yields genuinely new rows. The snapshot primes the
        set on connect so the backlog is never replayed as "new".
        """
        with self._lock:
            items = self.items
            version = self.version
            phase = self.phase
        new: list = []
        for a in items:
            aid = a.get("id")
            if aid and aid not in cursor_seen:
                cursor_seen.add(aid)
                new.append(a)
        return new, version, phase

    def poll_oi(self, cursor_seen: set):
        """Return `(new_oi_items, oi_version)`; same ownership rules as `poll`."""
        with self._lock:
            items = self.oi
            version = self.oi_version
        new: list = []
        for a in items:
            aid = a.get("id")
            if aid and aid not in cursor_seen:
                cursor_seen.add(aid)
                new.append(a)
        return new, version


# Module singleton — imported by the dashboard server.
HUB = Hub()


if __name__ == "__main__":
    import json

    HUB.start()
    print("hub started; sampling for ~5s ...")
    _v, _seen = HUB.subscribe_cursor()
    last_phase = None
    for _ in range(5):
        time.sleep(1)
        new, ver, phase = HUB.poll(_seen)
        print(json.dumps({"version": ver, "phase": phase, "new": len(new)}))
        if phase != last_phase:
            last_phase = phase
    print("done")
