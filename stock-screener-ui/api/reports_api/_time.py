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
    """Current time in IST, falling back to a tz-aware local datetime.

    Pinned to IST rather than ``datetime.now().astimezone()`` so a non-IST
    host (CI, UTC containers) cannot split a day file from its stamps.
    """
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

    Floors by design — legacy callers compare against a whole-minute budget.
    Callers that must know whether two rows are truly adjacent should use
    :func:`seconds_between` instead: flooring turns a 66-second recorder gap
    into "1 minute", which a one-minute-only detector must not credit.
    """
    try:
        return int((datetime.fromisoformat(str(b.get("t"))) -
                    datetime.fromisoformat(str(a.get("t")))).total_seconds() // 60)
    except (ValueError, TypeError):
        return None


def seconds_between(a: dict, b: dict) -> Optional[float]:
    """Exact elapsed seconds from timestamp ``a`` to ``b`` (ISO ``...HH:MM[:SS]``).

    ``None`` for missing/unparseable timestamps, same guard as
    :func:`minutes_between`. Unlike that helper nothing is floored, so a
    09:54:03 -> 09:55:09 gap reads 66.0 and can be rejected as out-of-cadence.
    """
    try:
        return (datetime.fromisoformat(str(b.get("t"))) -
                datetime.fromisoformat(str(a.get("t")))).total_seconds()
    except (ValueError, TypeError):
        return None
