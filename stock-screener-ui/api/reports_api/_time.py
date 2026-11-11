"""Shared IST clock helpers for the reports API.

Every report module used to carry its own byte-identical copy of ``_now_iso``
(and usually ``_today_str``). One copy here keeps the fallback behaviour
identical everywhere: ``config.IST`` when available, a tz-aware local stamp
when ``config`` (or tzinfo) blows up.

Callers keep their private module-level names via ``import ... as _now_iso``
so tests can still ``monkeypatch.setattr(module, "_today_str", ...)``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

import config

def now_ist() -> datetime:
    """Current time in IST, falling back to a tz-aware local datetime."""
    try:
        return datetime.now(config.IST)
    except Exception:
        return datetime.now().astimezone()


def now_iso() -> str:
    """Current IST time as an ISO string (tz-aware on both paths)."""
    try:
        return datetime.now(config.IST).isoformat()
    except Exception:
        return datetime.now().astimezone().isoformat()


def today_str() -> str:
    """Current IST session date as ``YYYY-MM-DD``."""
    try:
        return datetime.now(config.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().astimezone().strftime("%Y-%m-%d")


def minutes_between(a: dict, b: dict) -> Optional[int]:
    """Whole minutes from timestamp ``a`` to ``b`` (ISO ``...HH:MM[:SS]`` strings).

    Returns ``None`` when either timestamp is missing or unparseable. One shared
    copy so every reader treats recorder gaps identically instead of re-implementing
    the same subtraction (and its ``(ValueError, TypeError)`` guard) per module.
    """
    try:
        return int((datetime.fromisoformat(str(b.get("t"))) -
                    datetime.fromisoformat(str(a.get("t")))).total_seconds() // 60)
    except (ValueError, TypeError):
        return None
