#!/usr/bin/env python3
"""Automatic local fetch of newly published 52W/agri GitHub Release assets.

Follows the repo's self-gating background-task pattern (see ``db_backup_task``
in ``api_server_fastapi``): a cancellable loop that checks for a newer asset and
applies it through the same seam the admin refresh uses, without blocking
startup. The enable flag is read inside the loop, so disabling with
``RELEASE_SYNC_ENABLED=0`` takes effect without a restart.
"""
from __future__ import annotations

import asyncio
import math
import os

from scripts.sync_refresh_assets import (
    SyncBusy,
    last_applied_pointers,
    latest_refresh_pointers,
    run_sync,
)


def _enabled() -> bool:
    return os.getenv("RELEASE_SYNC_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _delay_seconds(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = float("nan")
    if not math.isfinite(value) or value < 0:
        print(f"[Release Sync] invalid {name}={raw!r}; using {default:g}")
        return default
    return value


def sync_once() -> str:
    """Check both kinds once: ``current``, ``applied``, ``busy`` or ``error``."""
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN") or None
    try:
        pointers = latest_refresh_pointers(token=token)
        applied = last_applied_pointers()
        due = False
        for kind in ("agri", "52w"):
            pointer = pointers.get(kind)
            if pointer is None:
                continue
            if kind == "52w":
                last_date, last_fingerprint = applied.week52_as_of, applied.week52_fingerprint
            else:
                last_date, last_fingerprint = applied.agri_as_of, applied.agri_fingerprint
            if last_date is not None and pointer.as_of < last_date:
                # A stale re-publish must never roll data back. Skip the whole
                # batch: run_sync(mode="latest") applies both kinds together.
                return "current"
            if last_date is None or pointer.as_of > last_date:
                due = True
            elif last_fingerprint is None or pointer.fingerprint != last_fingerprint:
                due = True
        if not due:
            return "current"
        run_sync(mode="latest", allow_empty=True, token=token)
        return "applied"
    except SyncBusy as exc:
        print(f"[Release Sync] busy: {exc}")
        return "busy"
    except Exception as exc:
        detail = str(exc)
        if token:
            detail = detail.replace(token, "[REDACTED]")
        print(f"[Release Sync] error: {type(exc).__name__}: {detail}")
        return "error"


async def release_sync_task():
    """Poll for newer release assets off the event loop (cancellable)."""
    startup_delay = _delay_seconds("RELEASE_SYNC_STARTUP_DELAY_SEC", 30.0)
    poll_delay = _delay_seconds("RELEASE_SYNC_POLL_SEC", 900.0)
    first = True
    while True:
        try:
            delay = startup_delay if first else poll_delay
            first = False
            await asyncio.sleep(delay)
            if not _enabled():
                continue
            result = await asyncio.to_thread(sync_once)
            if result == "applied":
                print("[Release Sync] applied newer release assets")
            elif result == "busy":
                print("[Release Sync] sync busy; retrying next poll")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[Release Sync] task error: {type(exc).__name__}: {exc}")
