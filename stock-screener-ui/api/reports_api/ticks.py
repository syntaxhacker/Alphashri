"""1-second Nifty spot tick tape — additive, zero extra REST calls.

The spot ticker already polls every second (``nifty_ws.SPOT_POLL_INTERVAL_SEC``)
and publishes to ``_last_spot``. This task only *persists* that value when it
changes, so the chart can offer a 1 s timeframe without touching the Upstox
budget or the 1-minute tape.

Off-switch: ``TICK_TAPE_ENABLED=0``. Market-hours gated; never raises.
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

from api.reports_api._time import now_iso as _now_iso

router = APIRouter(prefix="/api/reports", tags=["reports"])

ENABLED = os.getenv("TICK_TAPE_ENABLED", "1") != "0"
SAMPLE_SEC = float(os.getenv("TICK_TAPE_INTERVAL_SEC", "1"))
_task: Optional[asyncio.Task] = None


def _dir() -> Path:
    import config

    path = Path(getattr(config, "BASE_DIR", Path(__file__).resolve().parents[2])) / "experiments" / "data" / "nifty_ticks"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _today_ist() -> str:
    import config

    return datetime.now(config.IST).strftime("%Y-%m-%d")


async def tick_tape_task() -> None:
    """Append one line per changed spot value (no REST, no polling)."""
    last_spot: Optional[float] = None
    while True:
        try:
            try:
                from trading.utils import is_derivatives_open

                open_now = bool(is_derivatives_open())
            except asyncio.CancelledError:
                raise
            except Exception:
                open_now = True
            if not open_now:
                await asyncio.sleep(60)
                continue
            from api.reports_api.nifty_ws import latest_spot

            snap = latest_spot()
            spot = snap.get("spot")
            if spot:
                value = round(float(spot), 2)
                if value != last_spot:
                    last_spot = value
                    with open(_dir() / f"{_today_ist()}.jsonl", "a") as fh:
                        fh.write(json.dumps({"t": _now_iso(), "spot": value}, separators=(",", ":")) + "\n")
            await asyncio.sleep(max(0.5, SAMPLE_SEC))
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(max(1.0, SAMPLE_SEC))


def start_tick_tape_task() -> Optional[asyncio.Task]:
    global _task
    if not ENABLED:
        return None
    if _task is not None and not _task.done():
        return _task
    _task = asyncio.create_task(tick_tape_task())
    return _task


def _read_day(date_str: str) -> list[dict]:
    path = _dir() / f"{date_str}.jsonl"
    if not path.exists():
        return []
    out: list[dict] = []
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict) and row.get("spot"):
                    out.append(row)
    except OSError:
        return []
    return out


def _epoch(t: str) -> float:
    try:
        return datetime.fromisoformat(t).timestamp()
    except (TypeError, ValueError):
        return 0.0


@router.get("/nifty/spot-blasts")
def get_spot_blasts(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    window: int = Query(default=10, ge=3, le=120, description="Move window in seconds"),
    min_pts: float = Query(default=8.0, gt=0, description="Minimum |move| in index points"),
    lookback_min: int = Query(default=6, ge=1, le=60, description="Scan the last N minutes"),
    limit: int = Query(default=20, ge=1, le=200),
) -> dict[str, Any]:
    """Spot-velocity blasts from the 1-second tick tape.

    A blast is the spot moving >= ``min_pts`` inside ``window`` seconds. This is
    the move the 1-minute OI tape cannot see: on 2026-10-26 the spot ran
    +20 pts in 30 s at 12:28 while every OI column looked ordinary.

    Pure read of the tick tape (no provider calls). Deduped into 30 s buckets,
    keeping the largest displacement, so a single run is one alert.
    """
    date_str = date if isinstance(date, str) and date else _today_ist()
    window = window if isinstance(window, int) else 10
    min_pts = float(min_pts) if isinstance(min_pts, (int, float)) else 8.0
    lookback_min = lookback_min if isinstance(lookback_min, int) else 6
    limit = limit if isinstance(limit, int) else 20

    rows = _read_day(date_str)
    pts = [(_epoch(str(r.get("t") or "")), float(r.get("spot") or 0)) for r in rows if r.get("spot")]
    if not pts:
        return {"date": date_str, "window_sec": window, "min_pts": min_pts, "count": 0, "blasts": []}

    end = pts[-1][0]
    pts = [p for p in pts if p[0] >= end - lookback_min * 60]

    blasts: list[dict[str, Any]] = []
    j = 0
    for i, (t, price) in enumerate(pts):
        while j < i and t - pts[j][0] > window:
            j += 1
        if j >= i:
            continue
        delta = price - pts[j][1]
        if abs(delta) < min_pts:
            continue
        blasts.append({
            "t": pts[i][0],
            "from_spot": round(pts[j][1], 2),
            "to_spot": round(price, 2),
            "delta": round(delta, 2),
            "direction": "up" if delta > 0 else "down",
            "window_sec": window,
            "rate_pts_per_sec": round(abs(delta) / max(1e-6, t - pts[j][0]), 2),
        })

    # One alert per 30 s bucket (largest displacement wins).
    best: dict[int, dict[str, Any]] = {}
    for b in blasts:
        key = int(b["t"] // 30)
        if key not in best or abs(b["delta"]) > abs(best[key]["delta"]):
            best[key] = b
    out = sorted(best.values(), key=lambda b: b["t"])[-limit:]
    for b in out:
        b["t"] = datetime.fromtimestamp(b["t"]).astimezone().isoformat()
    return {
        "date": date_str,
        "window_sec": window,
        "min_pts": min_pts,
        "count": len(out),
        "blasts": out,
    }


#: Blast thresholds. Tuned on 2026-10-26: smoothed OI p90 ≈ 1.2M/10 s, volume
#: p90 ≈ 45M/10 s, so these fire on the tail, not the noise.
#: 8-10 pt spot moves are noise — they fire dozens of times a session. Only a
#: real sprint (15 pts / 10 s, 25 pts / 30 s) is worth a sound.
BLAST_OI_M = float(os.getenv("BLAST_OI_M", "2.0"))
BLAST_OI_MULT = float(os.getenv("BLAST_OI_MULT", "6"))
BLAST_VOL_M = float(os.getenv("BLAST_VOL_M", "15.0"))
BLAST_VOL_MULT = float(os.getenv("BLAST_VOL_MULT", "8"))

from api.reports_api._blasts import chain_blasts as _shared_chain_blasts


def _spot_blasts(rows: list[dict], lookback_min: int) -> list[dict]:
    pts = [(_epoch(str(r.get("t") or "")), float(r.get("spot") or 0)) for r in rows if r.get("spot")]
    if not pts:
        return []
    end = pts[-1][0]
    pts = [p for p in pts if p[0] >= end - lookback_min * 60]
    out: list[dict] = []
    for window, min_pts in ((10, 15.0), (30, 25.0)):
        j = 0
        for i, (t, price) in enumerate(pts):
            while j < i and t - pts[j][0] > window:
                j += 1
            if j >= i:
                continue
            delta = price - pts[j][1]
            if abs(delta) < min_pts:
                continue
            out.append({
                "kind": "spot",
                "t": datetime.fromtimestamp(t).astimezone().isoformat(),
                "side": None,
                "delta": round(delta, 2),
                "label": f"SPOT {'↑' if delta > 0 else '↓'} {delta:+.1f} pts / {window}s",
                "detail": f"{pts[j][1]:,.1f} → {price:,.1f}",
                "severity": "critical",
                "bias": "bull" if delta > 0 else "bear",
            })
    return out


def _chain_blasts(date_str: str, lookback_min: int) -> list[dict]:
    """OI + volume blasts from the 10-second chain, with ADAPTIVE thresholds.

    Delegates to the shared implementation in :mod:`api.reports_api._blasts`.
    """
    from api.reports_api import chain10s

    def _get_snaps(d: str) -> list[dict]:
        if chain10s._today_ist() == d:
            return list(chain10s.RECENT)
        return chain10s._read_day(d)[-240:]

    return _shared_chain_blasts(
        date_str=date_str,
        lookback_min=lookback_min,
        oi_floor_m=BLAST_OI_M,
        oi_mult=BLAST_OI_MULT,
        vol_floor_m=BLAST_VOL_M,
        vol_mult=BLAST_VOL_MULT,
        get_snaps=_get_snaps,
        is_today=(chain10s._today_ist() == date_str),
        strike_step=50.0,
    )


@router.get("/nifty/blasts")
def get_nifty_blasts(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    lookback_min: int = Query(default=5, ge=1, le=30),
    limit: int = Query(default=40, ge=1, le=200),
) -> dict[str, Any]:
    """One feed for every fast move: spot velocity, OI blast, volume blast.

    All three read tapes we already write (1 s ticks + 10 s chain); no provider
    calls. Each kind is deduped into 30 s buckets so one run is one alert.
    """
    date_str = date if isinstance(date, str) and date else _today_ist()
    lookback_min = lookback_min if isinstance(lookback_min, int) else 5
    limit = limit if isinstance(limit, int) else 40

    raw = _spot_blasts(_read_recent(date_str), lookback_min) + _chain_blasts(date_str, lookback_min)
    best: dict[tuple[str, str, int], dict] = {}
    for b in raw:
        key = (b["kind"], str(b.get("side") or ""), int(_epoch(str(b["t"])) // 30))
        if key not in best or abs(float(b["delta"])) > abs(float(best[key]["delta"])):
            best[key] = b
    out = sorted(best.values(), key=lambda b: str(b["t"]))[-limit:]
    return {
        "date": date_str,
        "count": len(out),
        "thresholds": {"oi_m": BLAST_OI_M, "oi_mult": BLAST_OI_MULT, "vol_m": BLAST_VOL_M, "vol_mult": BLAST_VOL_MULT},
        "blasts": out,
    }


_TAIL: dict[str, dict] = {}


def _read_recent(date_str: str, max_rows: int = 4000) -> list[dict]:
    """Incremental tail of the tick file — parse only the new lines.

    The blast poller runs every 3 s; re-parsing the whole day (1.5 MB by the
    close) each time is pure waste. The offset/ring state is per file, so a
    restart simply re-reads the tail once.
    """
    path = _dir() / f"{date_str}.jsonl"
    if not path.exists():
        return []
    key = str(path)
    state = _TAIL.get(key)
    if state is None:
        state = {"offset": 0, "rows": deque(maxlen=max_rows)}
        _TAIL[key] = state
    try:
        with open(path) as fh:
            fh.seek(state["offset"])
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict) and row.get("spot"):
                    state["rows"].append(row)
            state["offset"] = fh.tell()
    except OSError:
        pass
    return list(state["rows"])


@router.get("/nifty/ticks")
def get_nifty_ticks(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    start: Optional[str] = Query(default=None, description="HH:MM inclusive"),
    end: Optional[str] = Query(default=None, description="HH:MM inclusive"),
    limit: int = Query(default=2000, ge=1, le=50000, description="Newest N ticks"),
) -> dict[str, Any]:
    """1-second spot ticks (newest ``limit``), optionally windowed by HH:MM."""
    # Direct (non-HTTP) callers pass the FastAPI Query sentinel for omitted
    # params; normalise before comparing.
    date_str = date if isinstance(date, str) and date else _today_ist()
    start = start if isinstance(start, str) else None
    end = end if isinstance(end, str) else None
    limit = limit if isinstance(limit, int) else 2000
    rows = _read_day(date_str)
    if start or end:
        def _hm(s: str) -> str:
            return s[11:16] if "T" in s else s[:5]
        rows = [
            r for r in rows
            if (not start or _hm(str(r.get("t") or "")) >= start)
            and (not end or _hm(str(r.get("t") or "")) <= end)
        ]
    return {"date": date_str, "count": len(rows), "rows": rows[-limit:]}
