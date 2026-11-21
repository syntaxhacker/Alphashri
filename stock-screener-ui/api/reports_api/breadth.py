"""Index breadth for the Nifty desk — 5 indices, one cached quote call.

The desk check has always printed breadth; the report tab did not, so a narrow
rally (index up, smallcaps down) looked the same as a broad one. This endpoint
reuses the same Upstox quote path and caches for 60s so a 20px strip can poll it
without touching the rate budget.

Breadth was also *lost*: ``last.json`` held a single overwritten observation,
so a restart (or a day nobody watched) erased the session's advance/decline
path. Each refresh now appends one line to
``experiments/data/nifty_breadth/history/YYYY-MM-DD.jsonl`` — the full block
plus ``t`` — and keeps ``last.json`` in its existing ``{at, block}`` shape for
the cold-start reader in :mod:`api.reports_api.nifty`.

History is written from the refresh itself, so there is still exactly **one**
five-index quote call per 60s cache window: no second fetch loop, and no
rotation frame fetch (the advance/decline counts are read from the rotation
overview cache, which never fetches).

Never raises: a missing token or a failed call returns ``available: false`` and
the strip renders nothing.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter

import config
from api.reports_api.report_io import read_jsonl

router = APIRouter(prefix="/api/reports", tags=["reports"])

# (label, Upstox instrument key) — same set the desk check uses.
KEYS: tuple[tuple[str, str], ...] = (
    ("NIFTY", "NSE_INDEX|Nifty 50"),
    ("BANK", "NSE_INDEX|Nifty Bank"),
    ("MID", "NSE_INDEX|NIFTY MIDCAP 150"),
    ("SMALL", "NSE_INDEX|Nifty Smallcap 500"),
    ("BROAD", "NSE_INDEX|Nifty 500"),
)

_TTL_SECONDS = 60.0
_cache: dict[str, Any] = {"at": 0.0, "payload": None}

#: ``last.json`` is the cold-start fallback read by ``GET /nifty`` — keep the
#: ``{"at", "block"}`` shape byte-compatible with what ``nifty.py`` writes.
BREADTH_DIR = Path(config.BASE_DIR) / "experiments" / "data" / "nifty_breadth"
LAST_PATH = BREADTH_DIR / "last.json"
HISTORY_DIR = BREADTH_DIR / "history"

#: Minute key (``YYYY-MM-DDTHH:MM``) of the last history line written by this
#: process. Two refreshes inside one minute are the same observation; padding
#: the file with duplicates buys nothing and hides real gaps.
_last_history_minute: Optional[str] = None


def _now_ist() -> datetime:
    return datetime.now(config.IST)


def _fetch() -> dict[str, Any]:
    from scripts import upstox_common

    joined = ",".join(key for _, key in KEYS)
    data: dict[str, Any] = {}
    try:
        payload = upstox_common.get(
            "/market-quote/quotes",
            {"instrument_key": joined},
            timeout=8.0,
        )
        data = payload.get("data") or {}
    except Exception:
        data = {}

    rows: list[dict[str, Any]] = []
    for label, key in KEYS:
        # Upstox echoes the quote map with ':' separators even when the request
        # used '|' (NSE_INDEX:Nifty 50) — accept both spellings.
        row = data.get(key) or data.get(key.replace("|", ":")) or {}
        last = row.get("last_price")
        ohlc = row.get("ohlc") or {}
        close = ohlc.get("close")
        net = row.get("net_change")
        try:
            last = float(last) if last is not None else None
            close = float(close) if close is not None else None
            net = float(net) if net is not None else None
        except (TypeError, ValueError):
            last = close = net = None
        # After the session the quote's `ohlc.close` IS the close, so the only
        # usable day change is `net_change` (last − prev close).
        if last is not None and net is not None:
            prev = last - net
            pct = (net / prev * 100.0) if prev else None
        else:
            pct = ((last - close) / close * 100.0) if last and close else None
        rows.append(
            {
                "label": label,
                "last": round(last, 2) if last is not None else None,
                "close": round(last - net, 2) if last is not None and net is not None else (
                    round(close, 2) if close is not None else None
                ),
                "change_pct": round(pct, 2) if pct is not None else None,
            }
        )

    priced = [r for r in rows if r["change_pct"] is not None]
    up = sum(1 for r in priced if (r["change_pct"] or 0) > 0)
    return {
        "available": len(priced) > 0,
        "rows": rows,
        "up": up,
        "count": len(priced),
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def _rotation_state() -> Optional[dict[str, Any]]:
    """Advance/decline state from the rotation overview cache (never fetches)."""
    try:
        from api.rotation import cached_breadth

        state = cached_breadth("india")
    except Exception:
        return None
    return state if isinstance(state, dict) else None


def _compose_block(strip: dict[str, Any], state: Optional[dict[str, Any]]) -> dict[str, Any]:
    """The full breadth block: rotation advance/decline + the index strip.

    Mirrors ``nifty._breadth_block`` (same fields, same stale rule) so a history
    line is the object the report serves, not a private variant. Every field is
    optional: a cold rotation cache still yields a useful strip-only
    observation instead of dropping the refresh.
    """
    state = state or {}
    advances_pct = state.get("advances_pct")
    return {
        "advances_pct": advances_pct,
        "advances": state.get("advances"),
        "declines": state.get("declines"),
        "total": state.get("total"),
        "up": strip.get("up"),
        "count": strip.get("count"),
        "rows": strip.get("rows") or [],
        "available": bool(strip.get("available")),
        "fetched_at": strip.get("fetched_at"),
        # When the advance/decline figure was computed; the strip carries its
        # own ``fetched_at`` so each source stays auditable.
        "as_of": state.get("as_of") if advances_pct is not None else strip.get("fetched_at"),
        "stale": bool(state.get("stale")) if advances_pct is not None else False,
    }


def _last_minute_in_file(path: Path) -> Optional[str]:
    """``YYYY-MM-DDTHH:MM`` of the file's last line (tail read, never raises)."""
    try:
        with open(path, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 4096))
            tail = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    for line in reversed(tail.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            stamp = json.loads(line).get("t")
        except (json.JSONDecodeError, AttributeError):
            continue
        if isinstance(stamp, str):
            return stamp[:16]
    return None


def _append_history(block: dict[str, Any], now: Optional[datetime] = None) -> bool:
    """Append one line (block + ``t``) to today's history.

    Returns ``True`` when a line was written and ``False`` when this minute is
    already recorded (in this process or by one that wrote before a restart).
    Never raises.
    """
    global _last_history_minute
    ts = now or _now_ist()
    minute = ts.strftime("%Y-%m-%dT%H:%M")
    path = HISTORY_DIR / f"{ts.strftime('%Y-%m-%d')}.jsonl"
    if _last_history_minute is None:
        # A restart must not duplicate the minute the previous process wrote.
        _last_history_minute = _last_minute_in_file(path)
    if minute == _last_history_minute:
        return False
    try:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        line = json.dumps({"t": ts.isoformat(), **block}, separators=(",", ":"))
        with open(path, "a") as fh:
            fh.write(line + "\n")
    except (OSError, TypeError, ValueError):
        return False
    _last_history_minute = minute
    return True


def _write_last(block: dict[str, Any], at: float) -> None:
    """Keep ``last.json`` current for the cold-start reader in ``nifty.py``.

    Only a fresh advance/decline reading is persisted: overwriting the file
    with a strip-only block would erase the last real A/D number that the
    cold-start path exists to preserve. Never raises.
    """
    if block.get("advances_pct") is None or block.get("stale"):
        return
    try:
        LAST_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = LAST_PATH.with_suffix(".json.tmp")
        with open(tmp, "w") as fh:
            json.dump({"at": at, "block": block}, fh, separators=(",", ":"))
        os.replace(tmp, LAST_PATH)
    except (OSError, TypeError, ValueError):
        pass


def read_history(date_str: str) -> list[dict[str, Any]]:
    """Parse one day's history file (oldest first); ``[]`` when absent."""
    return read_jsonl(
        HISTORY_DIR / f"{date_str}.jsonl", predicate=lambda row: bool(row.get("t"))
    )


def refresh(force: bool = False) -> dict[str, Any]:
    """Refresh the strip, persist history + ``last.json``, return the strip.

    One five-index quote call per 60s window (``force`` bypasses it). The
    history append and the ``last.json`` write reuse that same observation —
    they add file I/O, never a provider call.
    """
    now = time.time()
    cached = _cache["payload"]
    if not force and isinstance(cached, dict) and now - float(_cache["at"]) <= _TTL_SECONDS:
        return cached
    payload = _fetch()
    _cache["payload"] = payload
    _cache["at"] = now
    block = _compose_block(payload, _rotation_state())
    _write_last(block, now)
    _append_history(block)
    return payload


@router.get("/breadth")
def get_breadth() -> dict[str, Any]:
    """Cached index breadth (60s). Shape: rows[label,last,close,change_pct]."""
    return refresh()
