#!/usr/bin/env python3
"""Append-only JSONL signal archive for the India board (roadmap F12 / W1d).

Every emitted playbook signal (P1-P8) is written as one JSON object per line::

    india_board/data/signals/{YYYY-MM-DD}.jsonl

Record schema (one record per emitted signal)::

    {
      "signal_id": "<uuid4>",
      "ts": "<ISO-8601 with IST offset>",
      "playbook": "P1".."P8",
      "ticker": "RELIANCE",
      "side": "CE|PE|LONG|SHORT|NA",
      "strike": 1500.0 | null,
      "expiry": "29-09-2026" | null,
      "features": {<arbitrary JSON-safe map>},
      "entry_ref": 1207.3 | null,
      "stop_ref": 1195.0 | null,
      "target_ref": 1230.0 | null,
      "spread_bp": 14.2 | null,
      "source": "scan|oi_flow|manual",
      "notes": "..."
    }

Design rules (mirrors ``oi_tracker``):

* ``log_signal`` **never raises** — on any failure it returns ``""`` and prints a
  short warning. A logging failure must never break a live scan / signal path.
* Numbers are forced JSON-safe: ``NaN`` / ``Infinity`` become ``null``.
* Reads skip malformed lines and never raise.
* Files older than ``KEEP_DAYS`` (400) are pruned best-effort.

This module touches no credentials, no network, and no other module's state.
"""
from __future__ import annotations

import json
import math
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

IST = ZoneInfo("Asia/Kolkata")

ROOT = Path(__file__).resolve().parent.parent
#: JSONL tree written by ``log_signal`` and read by ``read_signals``.
DATA_DIR = ROOT / "data" / "signals"

#: Valid playbook identifiers (see EDGE_ROADMAP.md section 5).
#: ``P8`` is the NSE bulk/block-deal institutional-buy detector (P8).
PLAYBOOKS = ("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8")
#: Valid ``side`` values. ``NA`` is for signals that are not directional legs.
SIDES = ("CE", "PE", "LONG", "SHORT", "NA")
#: Valid ``source`` values.
SOURCES = ("scan", "oi_flow", "manual")
#: Records on disk older than this are pruned on write (best-effort).
KEEP_DAYS = 400
#: Fields a caller must supply (``signal_id`` / ``ts`` are auto-filled).
REQUIRED_FIELDS = ("playbook", "ticker", "side", "features")

__all__ = [
    "DATA_DIR",
    "PLAYBOOKS",
    "SIDES",
    "SOURCES",
    "KEEP_DAYS",
    "make_signal",
    "log_signal",
    "read_signals",
    "read_range",
    "prune_signals",
]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def _json_safe(value):
    """Recursively make ``value`` JSON-safe (NaN/Inf -> None)."""
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _sanitize(record: dict) -> dict:
    return {str(k): _json_safe(v) for k, v in record.items()}


def _signal_file(date_str: str, root: Path | str | None = None) -> Path:
    """``{root}/{YYYY-MM-DD}.jsonl`` — dirs created by callers."""
    base = Path(root) if root is not None else DATA_DIR
    return base / f"{date_str}.jsonl"


def _date_obj(value) -> date | None:
    """Coerce a ``date`` / ``datetime`` / ``"YYYY-MM-DD"`` into a ``date``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _record_date(record: dict) -> str | None:
    """IST calendar date a record belongs to, derived from its ``ts``."""
    try:
        dt = datetime.fromisoformat(str(record.get("ts") or ""))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    else:
        dt = dt.astimezone(IST)
    return dt.date().isoformat()


def _is_record(rec) -> bool:
    """True when a decoded JSONL line looks like a signal record."""
    if not isinstance(rec, dict):
        return False
    for key in ("signal_id", "ts", "playbook", "ticker"):
        if not rec.get(key):
            return False
    return isinstance(rec.get("features"), dict)


def _validate(record: dict) -> str:
    """Return an error message, or ``""`` when the record is valid."""
    playbook = str(record.get("playbook") or "").upper()
    if playbook not in PLAYBOOKS:
        return f"playbook must be one of {PLAYBOOKS}, got {record.get('playbook')!r}"
    if not str(record.get("ticker") or "").strip():
        return "ticker is required"
    side = str(record.get("side") or "").upper()
    if side not in SIDES:
        return f"side must be one of {SIDES}, got {record.get('side')!r}"
    if not isinstance(record.get("features"), dict):
        return "features must be a dict"
    if _record_date(record) is None:
        return f"ts is not a valid ISO timestamp: {record.get('ts')!r}"
    return ""


# ---------------------------------------------------------------------------
# writer
# ---------------------------------------------------------------------------


def make_signal(
    playbook: str,
    ticker: str,
    side: str = "NA",
    *,
    features: dict | None = None,
    entry_ref: float | None = None,
    stop_ref: float | None = None,
    target_ref: float | None = None,
    strike: float | None = None,
    expiry: str | None = None,
    spread_bp: float | None = None,
    source: str = "scan",
    notes: str = "",
) -> dict:
    """Build a validated signal record so callers never hand-build dicts.

    Fills ``signal_id`` (uuid4) and ``ts`` (now, IST) and raises ``ValueError``
    when the result is not a valid record. ``log_signal`` is the never-raising
    counterpart that persists the record.
    """
    record = {
        "signal_id": str(uuid.uuid4()),
        "ts": datetime.now(IST).isoformat(),
        "playbook": str(playbook or "").upper().strip(),
        "ticker": str(ticker or "").upper().strip(),
        "side": str(side or "NA").upper().strip(),
        "strike": strike,
        "expiry": expiry,
        "features": dict(features or {}),
        "entry_ref": entry_ref,
        "stop_ref": stop_ref,
        "target_ref": target_ref,
        "spread_bp": spread_bp,
        "source": str(source or "scan").lower().strip(),
        "notes": str(notes or ""),
    }
    record = _sanitize(record)
    err = _validate(record)
    if err:
        raise ValueError(err)
    return record


def log_signal(record: dict, root: Path | str | None = None) -> str:
    """Append one signal record; return its ``signal_id``.

    Fills ``signal_id`` / ``ts`` when absent. **Never raises** — any failure
    (bad schema, unreadable disk, …) returns ``""`` after a short warning.
    Best-effort prunes signal files older than ``KEEP_DAYS`` afterwards.
    """
    try:
        if not isinstance(record, dict):
            raise ValueError("record must be a dict")
        rec = dict(record)
        if not rec.get("signal_id"):
            rec["signal_id"] = str(uuid.uuid4())
        if not rec.get("ts"):
            rec["ts"] = datetime.now(IST).isoformat()
        rec = _sanitize(rec)

        err = _validate(rec)
        if err:
            raise ValueError(err)

        day = _record_date(rec)
        dest = _signal_file(day, root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(rec, separators=(",", ":"))
        with open(dest, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
        prune_signals(root=root)
        return str(rec["signal_id"])
    except Exception as exc:  # noqa: BLE001 - logging must never break callers
        print(
            f"[signal-log] write failed: {type(exc).__name__}: {exc}"[:160],
            flush=True,
        )
        return ""


# ---------------------------------------------------------------------------
# readers
# ---------------------------------------------------------------------------


def read_signals(date: str | date | None = None, root: Path | str | None = None) -> list[dict]:
    """Records stored for one IST day, sorted by ``ts`` (oldest first).

    ``date`` defaults to today in IST. Missing files yield ``[]``; malformed/
    foreign lines are skipped; never raises.
    """
    day = _date_obj(date) or datetime.now(IST).date()
    path = _signal_file(day.isoformat(), root)
    try:
        if not path.is_file():
            return []
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception as exc:  # noqa: BLE001
        print(f"[signal-log] read failed: {type(exc).__name__}", flush=True)
        return []

    out: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except (ValueError, TypeError):
            continue
        if _is_record(rec):
            out.append(rec)
    out.sort(key=lambda r: str(r.get("ts") or ""))
    return out


def read_range(
    start_date: str | date,
    end_date: str | date,
    root: Path | str | None = None,
) -> list[dict]:
    """All records in ``[start_date, end_date]`` (inclusive), sorted by ``ts``."""
    start = _date_obj(start_date)
    end = _date_obj(end_date)
    if start is None or end is None or start > end:
        return []
    out: list[dict] = []
    day = start
    while day <= end:
        out.extend(read_signals(day.isoformat(), root=root))
        day += timedelta(days=1)
    out.sort(key=lambda r: str(r.get("ts") or ""))
    return out


# ---------------------------------------------------------------------------
# retention
# ---------------------------------------------------------------------------


def prune_signals(
    root: Path | str | None = None,
    keep_days: int = KEEP_DAYS,
    today: str | date | None = None,
) -> int:
    """Delete ``*.jsonl`` older than ``keep_days``; return the count removed.

    The boundary day and everything newer are kept. Missing roots are a no-op,
    so this is always safe to call.
    """
    base = Path(root) if root is not None else DATA_DIR
    ref = _date_obj(today) or datetime.now(IST).date()
    try:
        cutoff = ref - timedelta(days=int(keep_days))
    except (TypeError, ValueError):
        cutoff = ref - timedelta(days=KEEP_DAYS)

    removed = 0
    try:
        if not base.is_dir():
            return 0
        for path in base.glob("*.jsonl"):
            file_day = _date_obj(path.stem)
            if file_day is None or file_day >= cutoff:
                continue
            try:
                path.unlink()
                removed += 1
            except OSError:
                continue
    except Exception as exc:  # noqa: BLE001
        print(f"[signal-log] prune failed: {type(exc).__name__}", flush=True)
    return removed
