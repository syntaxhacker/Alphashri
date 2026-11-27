#!/usr/bin/env python3
"""Automatic local fetch of newly published 52W GitHub Release assets.

Follows the repo's self-gating background-task pattern (see ``db_backup_task``
in ``api_server_fastapi``): a cancellable loop that checks for a newer 52W
asset and applies it through the same seam the admin refresh uses, without
blocking startup. The enable flag is read inside the loop, so disabling with
``RELEASE_SYNC_ENABLED=0`` takes effect without a restart.
"""
from __future__ import annotations

import asyncio
import os

from scripts.sync_refresh_assets import (
    last_applied_52w_as_of,
    latest_52w_as_of,
    run_sync,
)


def _enabled() -> bool:
    return os.getenv("RELEASE_SYNC_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def sync_once() -> str:
    """Check once for a newer 52W asset: ``current``, ``applied`` or ``error``."""
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN") or None
    try:
        latest = latest_52w_as_of()
        applied = last_applied_52w_as_of()
        if latest is None or (applied is not None and latest <= applied):
            return "current"
        run_sync(mode="latest", allow_empty=True, token=token)
        return "applied"
    except Exception as exc:
        detail = str(exc)
        if token:
            detail = detail.replace(token, "[REDACTED]")
        print(f"[Release Sync] error: {type(exc).__name__}: {detail}")
        return "error"


async def release_sync_task():
    """Poll for newer 52W release assets off the event loop (cancellable)."""
    first = True
    while True:
        try:
            if first:
                delay = float(os.getenv("RELEASE_SYNC_STARTUP_DELAY_SEC", "30"))
                first = False
            else:
                delay = float(os.getenv("RELEASE_SYNC_POLL_SEC", "900"))
            await asyncio.sleep(delay)
            if not _enabled():
                continue
            result = await asyncio.to_thread(sync_once)
            if result == "applied":
                print("[Release Sync] applied newer 52W assets")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[Release Sync] task error: {type(exc).__name__}: {exc}")
