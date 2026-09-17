"""
Order-flow JSONL journal.

Appends normalized ticks and emitted signals to one file per symbol per IST
day (``{SYMBOL}_{YYYY-MM-DD}.jsonl``) so signals can be replayed/backtested and
session CVD can survive WebSocket reconnects.

Stdlib only. Every write path swallows errors so the live bridge never breaks
because of disk problems.
"""

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import config

_JOURNAL_ROOT = ("experiments", "data", "orderflow_journal")

#: Keep a small pool of append handles instead of open/close per record.
#: A 50-level feed writes many thousands of records a minute; the old
#: open+write+close cycle burned syscalls and dentry lookups for every tick.
_MAX_OPEN_HANDLES = 64
#: Seconds between forced flushes for high-frequency kinds. Signals flush
#: immediately (they are rare and load-bearing); ticks trade at most this much
#: buffered data against a hard crash.
_FLUSH_INTERVAL_SEC = float(os.getenv("ORDERFLOW_JOURNAL_FLUSH_SEC", "0.5"))

_handles: dict[str, "object"] = {}
_handle_order: list[str] = []
_pending: dict[str, float] = {}
_current_day = None
_lock = threading.Lock()

try:  # orjson serializes a 50-level tick ~9x faster than stdlib json
    import orjson as _fastjson

    def _encode(record: dict) -> str:
        return _fastjson.dumps(record, default=str).decode("utf-8")

except ImportError:  # pragma: no cover - fallback keeps the module importable
    def _encode(record: dict) -> str:
        return json.dumps(record, separators=(",", ":"), default=str)



def _flush_interval() -> float:
    return _FLUSH_INTERVAL_SEC


def _roll_day_locked(path: Path) -> None:
    """Close handles from a previous IST day (paths are day-stamped)."""
    global _current_day
    day = path.parent, path.name.rsplit("_", 1)[-1]
    if day == _current_day:
        return
    if _current_day is not None:
        for key in list(_handles):
            if not key.endswith(f"_{_current_day}"):
                _close_key(key)
        _handle_order[:] = [k for k in _handle_order if k in _handles]
    _current_day = day


def is_enabled() -> bool:
    value = os.getenv("ORDERFLOW_JOURNAL")
    if value is None:
        return True
    return value.strip().lower() not in ("0", "false", "no", "off")


def journal_dir() -> Path:
    return config.BASE_DIR.joinpath(*_JOURNAL_ROOT)


def _today() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def journal_path(symbol: str, day: Optional[str] = None) -> Path:
    symbol = (symbol or "").strip().upper()
    # instrument keys contain '|' which is illegal on some filesystems
    safe = symbol.replace("|", "_").replace("/", "_").replace("\\", "_")
    day = day or _today()
    return journal_dir() / f"{safe}_{day}.jsonl"


def _acquire(path: Path):
    """Append handle for ``path``, reusing the pooled one when present."""
    key = str(path)
    handle = _handles.get(key)
    if handle is not None:
        return handle

    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a", encoding="utf-8")
    _handles[key] = handle
    _handle_order.append(key)

    # Bound open descriptors on hosts that journal many symbols.
    while len(_handle_order) > _MAX_OPEN_HANDLES:
        stale = _handle_order.pop(0)
        if stale == key:
            continue
        _close_key(stale)
    return handle


def _close_key(key: str) -> None:
    handle = _handles.pop(key, None)
    _pending.pop(key, None)
    if handle is None:
        return
    try:
        handle.flush()
        handle.close()
    except Exception:  # noqa: BLE001 - best-effort close
        pass


def flush() -> None:
    """Flush every buffered handle (safe to call at any time)."""
    with _lock:
        for key in list(_handles):
            handle = _handles.get(key)
            if handle is None:
                continue
            try:
                handle.flush()
                _pending.pop(key, None)
            except Exception:  # noqa: BLE001
                pass


def close_all() -> None:
    """Flush and close every handle (shutdown / day rollover)."""
    with _lock:
        for key in list(_handles):
            _close_key(key)
        _handle_order.clear()


def append(symbol: str, kind: str, payload: dict) -> None:
    if not is_enabled():
        return
    symbol = (symbol or "").strip()
    if not symbol or not isinstance(payload, dict):
        return
    try:
        path = journal_path(symbol)
        record = {"ts": int(time.time() * 1000), "kind": kind, "data": payload}
        line = _encode(record) + "\n"
        with _lock:
            _roll_day_locked(path)
            handle = _acquire(path)
            handle.write(line)
            key = str(path)
            now = time.monotonic()
            if kind == "signal":
                # Rare and load-bearing: durable as soon as it is written.
                handle.flush()
                _pending.pop(key, None)
            elif now - _pending.get(key, 0.0) >= _flush_interval():
                handle.flush()
                _pending[key] = now
    except Exception:
        return


#: How each broker's data is recognised in a stored tick. The depth shape is
#: the reliable tell: TBT is 50 levels with a sequence number, the plain Fyers
#: socket adds per-level order counts, and Upstox has neither.
TBT_MIN_LEVELS = 20


def infer_broker(tick: dict) -> str:
    """Which broker produced a stored tick (``fyers_tbt`` / ``fyers`` / ``upstox``)."""
    if not isinstance(tick, dict):
        return "unknown"
    depth = tick.get("depth") or {}
    bids = depth.get("buy") or []
    if tick.get("seq") is not None or len(bids) >= TBT_MIN_LEVELS:
        return "fyers_tbt"
    if any(level.get("orders") for level in bids):
        return "fyers"
    if bids or (depth.get("sell") or []):
        return "upstox"
    return "unknown"


def _minute_key(ms: int, tz):
    moment = datetime.fromtimestamp(ms / 1000, tz=tz)
    return moment.strftime("%Y-%m-%dT%H:%M"), moment


#: Cheap, JSON-free shape probes used while streaming a journal file. Mirrors
#: :func:`infer_broker`; kept in sync by test_infer_broker_from_line_matches.
_TS_RE = re.compile(r'"ts"\s*:\s*(\d{10,16})')
_SEQ_RE = re.compile(r'"seq"\s*:\s*\d')
_ORDERS_RE = re.compile(r'"orders"\s*:\s*[1-9]')
_SIGNAL_RE = re.compile(r'"kind"\s*:\s*"signal"')


def infer_broker_from_line(line: str) -> str:
    """Same answer as :func:`infer_broker`, without parsing JSON.

    A full scan of a day is ~100 MB; parsing every 5 KB record would cost
    seconds on each admin refresh, and sampling misses a file whose feed
    changes partway through — which is the case worth catching.
    """
    if _SEQ_RE.search(line) or line.count('"price"') >= TBT_MIN_LEVELS:
        return "fyers_tbt"
    if _ORDERS_RE.search(line):
        return "fyers"
    if '"price"' in line:
        return "upstox"
    return "unknown"


def summarize_day(
    day: Optional[str] = None,
    session_start: tuple = (9, 15),
    session_close: tuple = (15, 30),
) -> dict:
    """Per-file summary of one day's journal: size, records, broker, coverage.

    Coverage answers "how much of the session did we capture?" — the share of
    session minutes that contain at least one stored record. A day that stops
    at 11:00, or a file that mixes two brokers, shows up here instead of
    looking like a normal file.

    Stdlib-only by design; the caller passes the session window.
    """
    day = day or _today()
    directory = journal_dir()
    start_minutes = session_start[0] * 60 + session_start[1]
    end_minutes = session_close[0] * 60 + session_close[1]
    session_minutes = max(1, end_minutes - start_minutes)

    rows: list[dict] = []
    for path in sorted(directory.glob(f"*_{day}.jsonl")):
        symbol = path.name[: -len(f"_{day}.jsonl")].replace("_", "|", 0)
        records = 0
        ticks = 0
        signals = 0
        minutes: set[str] = set()
        first_ms = last_ms = None
        brokers: set[str] = set()

        try:
            handle = path.open("r", encoding="utf-8")
        except OSError:
            continue
        with handle:
            for line in handle:
                if not line.strip():
                    continue
                records += 1
                match = _TS_RE.search(line)
                ms = int(match.group(1)) if match else None
                if ms is not None:
                    if first_ms is None or ms < first_ms:
                        first_ms = ms
                    if last_ms is None or ms > last_ms:
                        last_ms = ms
                    key, moment = _minute_key(ms, config.IST)
                    minutes_in_day = moment.hour * 60 + moment.minute
                    if start_minutes <= minutes_in_day <= end_minutes:
                        minutes.add(key)
                if _SIGNAL_RE.search(line):
                    signals += 1
                else:
                    ticks += 1
                brokers.add(infer_broker_from_line(line))

        covered = len(minutes)
        # "unknown" ticks (no depth payload) are not a second broker, so they
        # must not turn a clean file into "mixed".
        known = sorted(b for b in brokers if b != "unknown")
        broker_label = "mixed" if len(known) > 1 else (known[0] if known else "unknown")
        rows.append(
            {
                "symbol": symbol,
                "file": path.name,
                "broker": broker_label,
                "brokers_seen": sorted(brokers),
                "bytes": path.stat().st_size,
                "records": records,
                "ticks": ticks,
                "signals": signals,
                "first_ts": first_ms,
                "last_ts": last_ms,
                "covered_minutes": covered,
                "coverage_pct": round(covered / session_minutes * 100, 1),
                "gaps": _gaps(minutes, day, session_start, session_close),
            }
        )

    return {
        "day": day,
        "session_start": f"{session_start[0]:02d}:{session_start[1]:02d}",
        "session_close": f"{session_close[0]:02d}:{session_close[1]:02d}",
        "session_minutes": session_minutes,
        "rows": rows,
        "total_bytes": sum(r["bytes"] for r in rows),
        "total_records": sum(r["records"] for r in rows),
        "overall_coverage_pct": (
            round(sum(r["covered_minutes"] for r in rows) / (session_minutes * len(rows)) * 100, 1)
            if rows
            else 0.0
        ),
    }


def _gaps(minutes: set[str], day: str, session_start: tuple, session_close: tuple) -> list[dict]:
    """Runs of session minutes with no data (capped, largest first)."""
    start = datetime.strptime(f"{day} {session_start[0]:02d}:{session_start[1]:02d}", "%Y-%m-%d %H:%M")
    end = datetime.strptime(f"{day} {session_close[0]:02d}:{session_close[1]:02d}", "%Y-%m-%d %H:%M")
    gaps: list[dict] = []
    run_start = None
    cursor = start
    while cursor <= end:
        key = cursor.strftime("%Y-%m-%dT%H:%M")
        present = key in minutes
        if not present and run_start is None:
            run_start = cursor
        elif present and run_start is not None:
            gaps.append({"from": run_start.strftime("%H:%M"), "to": cursor.strftime("%H:%M"),
                         "minutes": int((cursor - run_start).total_seconds() // 60)})
            run_start = None
        cursor += timedelta(minutes=1)
    if run_start is not None:
        gaps.append({"from": run_start.strftime("%H:%M"), "to": end.strftime("%H:%M"),
                     "minutes": int((end - run_start).total_seconds() // 60) + 1})
    gaps.sort(key=lambda g: g["minutes"], reverse=True)
    return gaps[:5]


def available_days(limit: int = 30) -> list[str]:
    """Days that have at least one journal file, newest first."""
    days = set()
    for path in journal_dir().glob("*.jsonl"):
        stem = path.stem
        if "_" in stem:
            days.add(stem.rsplit("_", 1)[-1])
    return sorted(days, reverse=True)[:limit]


def read(symbol: str, day: Optional[str] = None, kind: Optional[str] = None) -> list[dict]:
    # Reading is a cold path; flush first so a caller in this process always
    # sees records it just appended (warm-start relies on that).
    flush()
    try:
        path = journal_path(symbol, day)
    except Exception:
        return []
    if not path.exists():
        return []

    out: list[dict] = []
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(record, dict):
                    continue
                if kind is not None and record.get("kind") != kind:
                    continue
                out.append(record)
    except Exception:
        return out
    return out
