"""Per-minute US options tape recorder (NQ first).

Layout mirrors the Nifty tape: one JSONL row per minute under
``experiments/data/us_tape/{ROOT}/{YYYY-MM-DD}.jsonl`` plus a gaps journal.
Dates are **America/New_York** — 00:00 IST is still the previous US session.

Rows are complete snapshots: spot, walls, max pain, PCR and every strike within
+/-8% (OI, volume, IV per leg). That makes the file replayable frame by frame
without any upstream calls.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from api.reports_api import us_chain

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
US_TAPE_DIR = Path(__file__).resolve().parents[2] / "experiments" / "data" / "us_tape"

INTERVAL_SEC = 60
TICK_TIMEOUT_SEC = 55
RTH_OPEN = dt.time(9, 30)
RTH_CLOSE = dt.time(16, 0)
ROOTS: tuple[str, ...] = ("NQ",)

_last_tick: str | None = None
_last_error: str | None = None
_iterations = 0
_task: asyncio.Task | None = None


def now_et() -> dt.datetime:
    return dt.datetime.now(ET)


def tape_dir(root: str) -> Path:
    return US_TAPE_DIR / root


def tape_path(root: str, date_str: str) -> Path:
    return tape_dir(root) / f"{date_str}.jsonl"


def gaps_path(root: str, date_str: str) -> Path:
    return tape_dir(root) / f"{date_str}.gaps.jsonl"


def is_rth(now: dt.datetime | None = None) -> bool:
    """Weekday regular session, 09:30-16:00 New York."""
    n = now or now_et()
    return n.weekday() < 5 and RTH_OPEN <= n.time() < RTH_CLOSE


def _append(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")


def read_tape(root: str, date_str: str) -> list[dict[str, Any]]:
    path = tape_path(root, date_str)
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    rows.sort(key=lambda r: r.get("t", ""))
    return rows


def _last_row(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            back = min(size, 16384)
            f.seek(size - back)
            lines = [ln for ln in f.read().decode("utf-8", "ignore").splitlines() if ln.strip()]
        return json.loads(lines[-1]) if lines else None
    except Exception:  # noqa: BLE001
        return None


def record_tick(root: str = "NQ", *, now: dt.datetime | None = None,
                force: bool = False) -> dict[str, Any] | None:
    """Fetch one snapshot and append it. Skips outside RTH unless ``force``."""
    global _last_tick, _last_error, _iterations

    stamp = now or now_et()
    if not force and not is_rth(stamp):
        return None

    date_str = stamp.date().isoformat()
    minute = stamp.strftime("%Y-%m-%dT%H:%M")
    path = tape_path(root, date_str)

    _iterations += 1
    try:
        row = us_chain.snapshot(root)
    except Exception as exc:  # noqa: BLE001
        _last_error = f"{type(exc).__name__}: {str(exc)[:160]}"
        logger.warning("us tape %s: %s", root, _last_error)
        return None

    last = _last_row(path)
    if last and str(last.get("t", ""))[:16] == minute:
        # Already recorded this minute (restart / double loop) — keep one row.
        _last_tick = last.get("t")
        return last

    _append(path, row)
    _last_tick = row["t"]
    _last_error = None
    return row


def tape_status() -> dict[str, Any]:
    return {
        "last_tick": _last_tick,
        "last_error": _last_error,
        "iterations": _iterations,
        "interval_sec": INTERVAL_SEC,
        "roots": list(ROOTS),
        "market_open": is_rth(),
        "now_et": now_et().isoformat(),
        "dir": str(US_TAPE_DIR),
    }


def replay_dates(root: str, limit: int = 30) -> list[str]:
    d = tape_dir(root)
    if not d.exists():
        return []
    dates = sorted((p.stem for p in d.glob("*.jsonl") if not p.name.endswith(".gaps.jsonl")),
                   reverse=True)
    return dates[:limit]


def eod_summary(root: str, date_str: str) -> dict[str, Any] | None:
    """Derived end-of-day card from the recorded rows (no upstream calls)."""
    rows = read_tape(root, date_str)
    if not rows:
        return None

    spots = [r["spot"] for r in rows if r.get("spot")]
    first, last = rows[0], rows[-1]
    walls = {"call": last.get("call_wall"), "put": last.get("put_wall")}
    migrations = 0
    touches = 0
    prev = None
    for r in rows:
        cur = (r.get("call_wall"), r.get("put_wall"))
        if prev is not None and cur != prev:
            migrations += 1
        prev = cur
        mp = r.get("max_pain")
        s = r.get("spot")
        if mp and s and abs(s - mp) / s <= 0.0025:
            touches += 1

    return {
        "root": root,
        "date": date_str,
        "contract": last.get("contract"),
        "series": last.get("series"),
        "expiry": last.get("expiry"),
        "minutes": len(rows),
        "first_t": first.get("t"),
        "last_t": last.get("t"),
        "open": first.get("spot"),
        "high": max(spots) if spots else None,
        "low": min(spots) if spots else None,
        "close": last.get("spot"),
        "change_pct": last.get("change_pct"),
        "call_oi": last.get("call_oi"),
        "put_oi": last.get("put_oi"),
        "pcr_oi": last.get("pcr_oi"),
        "pcr_vol": last.get("pcr_vol"),
        "max_pain": last.get("max_pain"),
        "call_wall": walls["call"],
        "put_wall": walls["put"],
        "exp_move_pct": last.get("exp_move_pct"),
        "atm_iv": last.get("atm_iv"),
        "wall_migrations": migrations,
        "max_pain_touches": touches,
        "total_call_vol": sum(r.get("call_vol") or 0 for r in rows),
        "total_put_vol": sum(r.get("put_vol") or 0 for r in rows),
    }


async def us_tape_loop(root: str = "NQ") -> None:
    """Record one row per minute while the US session is open."""
    logger.info("us tape: recorder started for %s", root)
    while True:
        started = now_et()
        try:
            await asyncio.wait_for(asyncio.to_thread(record_tick, root), timeout=TICK_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            logger.warning("us tape %s: tick timed out", root)
        except Exception:  # noqa: BLE001
            logger.exception("us tape %s: tick failed", root)

        elapsed = (now_et() - started).total_seconds()
        await asyncio.sleep(max(1.0, INTERVAL_SEC - elapsed))


def start_us_tape_task() -> asyncio.Task:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(us_tape_loop())
    return _task
