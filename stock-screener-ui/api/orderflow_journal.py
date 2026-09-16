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
import threading
import time
from datetime import datetime
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
