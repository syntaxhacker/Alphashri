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


def _sanitize(symbol: str) -> str:
    # instrument keys contain '|' and index names contain spaces, both awkward
    # on the filesystem
    return (
        (symbol or "")
        .strip()
        .upper()
        .replace("|", "_")
        .replace("/", "_")
        .replace("\\", "_")
    )


def _safe_symbol(symbol: str) -> str:
    return _sanitize(symbol).replace(" ", "_")


#: Broker prefixes recognised in a journal file name. Longest first so a file
#: named ``fyers_tbt_...`` is not mistaken for a ``fyers`` one.
_KNOWN_BROKER_PREFIXES = ("fyers_tbt", "fyers", "upstox")


def journal_name(symbol: str, day: str, broker: Optional[str] = None) -> str:
    """``<broker>_<SYMBOL>_<day>.jsonl`` when a broker is given, else the legacy name."""
    if broker:
        return f"{broker.strip().lower()}_{_safe_symbol(symbol)}_{day}.jsonl"
    return f"{_safe_symbol(symbol)}_{day}.jsonl"


def journal_path(
    symbol: str, day: Optional[str] = None, broker: Optional[str] = None
) -> Path:
    """Resolve a journal file.

    New days are written as ``<broker>_<SYMBOL>_<day>.jsonl`` so a file can only
    ever hold one feed. A day that is already being written under the legacy
    ``<SYMBOL>_<day>.jsonl`` name keeps using it, so enabling the prefix never
    splits an in-progress session across two files.
    """
    day = day or _today()
    if broker:
        path = journal_dir() / journal_name(symbol, day, broker)
        if path.exists():
            return path
        # Keep an already-started day on its original file.
        if legacy_path(symbol, day).exists():
            return legacy_path(symbol, day)
        return path
    return legacy_path(symbol, day)


def legacy_path(symbol: str, day: str) -> Path:
    return journal_dir() / journal_name(symbol, day, broker=None)


def split_journal_name(path: Path) -> tuple[Optional[str], str, str]:
    """``(broker|None, symbol, day)`` parsed from a journal file name."""
    stem = path.stem
    parts = stem.rsplit("_", 1)
    day = parts[-1] if len(parts) == 2 else ""
    head = parts[0] if len(parts) == 2 else stem
    for candidate in _KNOWN_BROKER_PREFIXES:
        prefix = f"{candidate}_"
        if head.startswith(prefix):
            return candidate, head[len(prefix) :], day
    return None, head, day


def journal_files(symbol: str, day: Optional[str] = None) -> list[Path]:
    """Every file for a symbol/day, broker-specific first (newest scheme first)."""
    day = day or _today()
    specific = sorted(journal_dir().glob(f"*_{_safe_symbol(symbol)}_{day}.jsonl"))
    legacy = legacy_path(symbol, day)
    out = [p for p in specific if p.name != legacy.name]
    if legacy.exists():
        out.append(legacy)
    return out


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


def append(symbol: str, kind: str, payload: dict, broker: Optional[str] = None) -> None:
    if not is_enabled():
        return
    symbol = (symbol or "").strip()
    if not symbol or not isinstance(payload, dict):
        return
    try:
        path = journal_path(symbol, broker=broker)
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
    full_session_close: Optional[tuple] = None,
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
        named_broker, symbol, _ = split_journal_name(path)
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
                    # Half-open [start, end): exactly session_minutes slots, so
                    # covered + uncovered always adds up to the session length.
                    if start_minutes <= minutes_in_day < end_minutes:
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
        # A broker-named file that contains another feed means the prefix is
        # lying — surface it rather than trusting the name.
        broker_mismatch = bool(
            named_broker and known and named_broker not in known
        )
        rows.append(
            {
                "symbol": symbol,
                "file": path.name,
                "broker": broker_label,
                "named_broker": named_broker,
                "broker_mismatch": broker_mismatch,
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
        # The measured window ends at the continuous close; the full session
        # (incl. the closing auction) is reported separately so nothing is hidden.
        "full_session_close": (
            f"{full_session_close[0]:02d}:{full_session_close[1]:02d}"
            if full_session_close
            else f"{session_close[0]:02d}:{session_close[1]:02d}"
        ),
        "full_session_minutes": (
            max(
                1,
                (full_session_close[0] * 60 + full_session_close[1]) - start_minutes,
            )
            if full_session_close
            else session_minutes
        ),
        "auction_minutes": (
            max(
                0,
                (full_session_close[0] * 60 + full_session_close[1]) - end_minutes,
            )
            if full_session_close
            else 0
        ),
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
    while cursor < end:
        key = cursor.strftime("%Y-%m-%dT%H:%M")
        if key not in minutes:
            if run_start is None:
                run_start = cursor
        elif run_start is not None:
            gaps.append({"from": run_start.strftime("%H:%M"), "to": cursor.strftime("%H:%M"),
                         "minutes": int((cursor - run_start).total_seconds() // 60)})
            run_start = None
        cursor += timedelta(minutes=1)
    if run_start is not None:
        gaps.append({"from": run_start.strftime("%H:%M"), "to": end.strftime("%H:%M"),
                     "minutes": int((end - run_start).total_seconds() // 60)})
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


def read(
    symbol: str,
    day: Optional[str] = None,
    kind: Optional[str] = None,
    broker: Optional[str] = None,
) -> list[dict]:
    # Reading is a cold path; flush first so a caller in this process always
    # sees records it just appended (warm-start relies on that).
    flush()
    if broker:
        # Prefer this broker's file, but include a legacy one for the same day
        # so a session that started before the prefix was introduced still
        # replays in full.
        paths = journal_files(symbol, day)
    else:
        legacy = legacy_path(symbol, day or _today())
        paths = [legacy] if legacy.exists() else []
    out: list[dict] = []
    for path in paths:
        for record in _read_file(path, kind):
            out.append(record)
    return out


def read_all(symbol: str, day: Optional[str] = None, kind: Optional[str] = None) -> list[dict]:
    """Every record for a symbol/day across all files, newest broker first.

    Tools that analyse a day rather than replay one feed want this. Files are
    single-broker by construction, so the only mixing here is a day that
    changed feeds — call :func:`sources` to see which.
    """
    flush()
    out: list[dict] = []
    for path in journal_files(symbol, day):
        out.extend(_read_file(path, kind))
    return out


def sources(symbol: str, day: Optional[str] = None) -> list[str]:
    """Brokers that wrote a symbol's data for a day (from file names)."""
    found = []
    for path in journal_files(symbol, day):
        broker, _, _ = split_journal_name(path)
        found.append(broker or "legacy")
    return found


def _read_file(path: Path, kind: Optional[str]) -> list[dict]:
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
