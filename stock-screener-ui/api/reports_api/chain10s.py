"""10-second slim option-chain snapshots — additive, never on the hot path.

Why: the 1-minute tape is the canonical record, but a 100-pt squeeze can start
and finish inside one tape minute (2026-10-23 13:37). The chain itself cannot be
polled at 1 Hz (190 KB/call, and a shared 2000 req/30 min Upstox budget), so this
poller stores a **slim** chain every 10 s (±750 strikes × ltp/oi/volume) and
speeds up to 3 s for 90 s after a large OI change.

Design rules:
- additive: the 1-min tape/replay/live paths are untouched;
- off-switch: ``CHAIN10S_ENABLED=0`` stops the task and the endpoint returns [];
- market-hours gated; failures never raise (the next tick retries).
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/reports", tags=["reports"])

WINDOW_PTS = float(os.getenv("CHAIN10S_WINDOW_PTS", "750"))
INTERVAL_SEC = float(os.getenv("CHAIN10S_INTERVAL_SEC", "10"))
BURST_INTERVAL_SEC = float(os.getenv("CHAIN10S_BURST_SEC", "3"))
BURST_WINDOW_SEC = float(os.getenv("CHAIN10S_BURST_WINDOW_SEC", "90"))
BURST_DELTA = float(os.getenv("CHAIN10S_BURST_DELTA", "1000000"))
ENABLED = os.getenv("CHAIN10S_ENABLED", "1") != "0"

LAST: dict[str, Any] = {"t": None, "spot": None, "rows": None, "expiry": None}
#: Newest FULL parsed chain (greeks + prev_oi included), memory only. The disk
#: frame stays slim; this lets the snapshot/tape builders reuse a chain that was
#: ALREADY fetched instead of paying a second ~50 s REST call against the shared
#: Upstox budget. Written by :func:`poll_once`, read by :func:`fresh_frame`.
LAST_FULL: dict[str, Any] = {"t": None, "ts": None, "spot": None,
                             "expiry": None, "rows": None}
#: In-memory ring of recent snapshots — the blast detector must not re-parse a
#: 5 MB day file every 3 seconds.
RECENT: deque = deque(maxlen=240)
_task: Optional[asyncio.Task] = None
_burst_until = 0.0
_prev_oi: Optional[float] = None


def _dir() -> Path:
    import config

    path = Path(getattr(config, "BASE_DIR", Path(__file__).resolve().parents[2])) / "experiments" / "data" / "nifty_chain10s"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _today_ist() -> str:
    import config

    return datetime.now(config.IST).strftime("%Y-%m-%d")


def slim_rows(rows: list[dict], spot: float, window: float = WINDOW_PTS) -> list[list[float]]:
    """±``window`` strikes as [strike, ceLtp, ceOi, ceVol, peLtp, peOi, peVol].

    Pure and tolerant: a missing leg stores 0, a missing strike is skipped.
    """
    out: list[list[float]] = []
    for row in rows or []:
        try:
            strike = float(row.get("strike") or 0)
        except (TypeError, ValueError):
            continue
        if strike <= 0 or (spot and abs(strike - spot) > window):
            continue
        ce = row.get("ce") or {}
        pe = row.get("pe") or {}
        out.append([
            strike,
            float(ce.get("ltp") or 0),
            float(ce.get("oi") or 0),
            float(ce.get("volume") or 0),
            float(pe.get("ltp") or 0),
            float(pe.get("oi") or 0),
            float(pe.get("volume") or 0),
        ])
    out.sort(key=lambda r: r[0])
    return out


async def poll_once() -> Optional[dict]:
    """Fetch one chain, append the slim snapshot, update LAST. Never raises."""
    global _prev_oi, _burst_until
    try:
        # Lazy import: keeps this module import-light and cycle-free.
        from api.reports_api.nifty import _fetch_chain_payload, parse_chain_payload

        expiry, payload = await _fetch_chain_payload(None)
        chain_expiry, spot, rows = parse_chain_payload(payload)
        slim = slim_rows(rows, spot)
        if not slim:
            return None
        now = datetime.now()
        ts_epoch = time.time()
        snap = {
            "t": now.astimezone().isoformat(),
            "spot": round(float(spot), 2),
            "expiry": chain_expiry or expiry or "",
            "rows": slim,
        }
        with open(_dir() / f"{_today_ist()}.jsonl", "a") as fh:
            fh.write(json.dumps(snap, separators=(",", ":")) + "\n")
        total_oi = sum(r[2] + r[5] for r in slim)
        if _prev_oi is not None and abs(total_oi - _prev_oi) >= BURST_DELTA:
            _burst_until = time.time() + BURST_WINDOW_SEC
        _prev_oi = total_oi
        LAST.update(snap)
        # The FULL rows (not the slim projection) so a consumer that needs
        # greeks / prev_oi (the snapshot's positioning + control blocks) can
        # reuse this fetch instead of issuing its own.
        LAST_FULL.update({"t": snap["t"], "ts": ts_epoch, "spot": snap["spot"],
                          "expiry": snap["expiry"], "rows": rows})
        RECENT.append(snap)
        return snap
    except asyncio.CancelledError:
        raise
    except Exception:
        return None


def fresh_frame(max_age_sec: float = 30.0) -> Optional[dict]:
    """Newest full parsed chain when younger than ``max_age_sec``, else ``None``.

    Returns ``{t, ts, age_sec, spot, expiry, rows}`` with the rows list copied
    (shallow per row) so a caller can never mutate the shared cache. ``None``
    when the poller is disabled, has not run, or the frame is stale — market
    closed, poller dead, or a long-failing upstream. Callers then fall back to
    their own REST fetch.
    """
    if not ENABLED:
        return None
    frame = LAST_FULL
    ts = frame.get("ts")
    rows = frame.get("rows")
    if not ts or not isinstance(rows, list) or not rows:
        return None
    try:
        age = time.time() - float(ts)
    except (TypeError, ValueError):
        return None
    if age < 0 or age > float(max_age_sec):
        return None
    return {
        "t": frame.get("t"),
        "ts": float(ts),
        "age_sec": age,
        "spot": frame.get("spot"),
        "expiry": frame.get("expiry"),
        "rows": [dict(r) for r in rows],
    }


async def chain10s_task() -> None:
    """Poll every INTERVAL_SEC (3 s inside a burst window) while the market is open.

    Uses derivatives-open (09:15‑15:40) so that F&O chain10s stays live through
    the closing auction and the five‑minute extensions that follow.
    """
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
            await poll_once()
            interval = BURST_INTERVAL_SEC if time.time() < _burst_until else INTERVAL_SEC
            await asyncio.sleep(max(1.0, interval))
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(INTERVAL_SEC)


def start_chain10s_task() -> Optional[asyncio.Task]:
    """Idempotent task starter (mirrors the other report tasks)."""
    global _task
    if not ENABLED:
        return None
    if _task is not None and not _task.done():
        return _task
    _task = asyncio.create_task(chain10s_task())
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
                if isinstance(row, dict):
                    out.append(row)
    except OSError:
        return []
    return out


def summarise_snapshots(newest: list[dict],
                        strike_step: Optional[float] = 50.0) -> list[dict]:
    """Aggregate slim snapshots for the strip / blast detector.

    Two data-quality guards live here, and both are load-bearing:
    - common strike set: the poller stores ±30 strikes, so a 50-pt spot move
      drops/adds a strike carrying millions of OI (a fake blast);
    - per-strike median of 3: Upstox serves two slightly different OI values
      for the same contract on alternating requests.

    ``strike_step`` picks the fixed ATM reference: the default 50 is the
    NIFTY grid. Pass ``None`` for a symbol whose strikes are not on a 50-pt
    ladder (RELIANCE trades 2.5/5/10-pt strikes) — the newest snapshot's
    nearest ACTUAL strike is then used, so the premium series is the ATM
    leg instead of a 20-pt-away ITM/OTM pair.
    """
    # The 10 s strip only needs totals; shipping ±30 strikes × N snapshots
    # costs ~177 KB every 10 s. Aggregating here drops it to ~5 KB.
    # ONE reference strike for the whole window: the ATM premium rolls to a
    # new strike as spot moves, and a roll looks like a 50-rupee premium
    # jump (a fake buy/sell). Nearest 50 to the newest spot, or the nearest
    # actual strike when ``strike_step`` is None.
    newest_spot = float((newest[-1].get("spot") if newest else 0) or 0)
    ref_strike = None
    if newest_spot > 0:
        if strike_step:
            ref_strike = round(newest_spot / strike_step) * strike_step
        else:
            newest_cells = (newest[-1].get("rows") or []) if newest else []
            candidates = [float(cell[0]) for cell in newest_cells
                          if len(cell) >= 7]
            if candidates:
                ref_strike = min(candidates, key=lambda k: abs(k - newest_spot))
    # Common strike set across the window. The poller stores ±30 strikes
    # around spot, so crossing a 50-pt boundary drops one strike and adds
    # another — each carrying millions of OI. Summing per-snapshot sets
    # turned that shift into a fake "±3.2M call blast" every few seconds.
    strike_sets = [
        {float(cell[0]) for cell in (snap.get("rows") or []) if len(cell) >= 7}
        for snap in newest
    ]
    common: set[float] = set.intersection(*strike_sets) if strike_sets else set()

    # Per-strike median of 3. Upstox serves two slightly different OI
    # values for the same contract on alternating requests (two backend
    # nodes), so a raw diff flips ±1M on 30 strikes with no real trade.
    # The median kills a single-sample flip while still following a move
    # that persists for two samples.
    per_strike: dict[float, dict[int, tuple[float, float]]] = {}
    for i, snap in enumerate(newest):
        for cell in snap.get("rows") or []:
            if len(cell) < 7:
                continue
            k = float(cell[0])
            if common and k not in common:
                continue
            per_strike.setdefault(k, {})[i] = (float(cell[2] or 0), float(cell[5] or 0))

    def _median3(values: list[float]) -> float:
        values = sorted(values)
        return values[len(values) // 2]

    smoothed: list[tuple[float, float]] = []
    for i in range(len(newest)):
        ce_total = 0.0
        pe_total = 0.0
        for points in per_strike.values():
            window = [points[j] for j in (i - 1, i, i + 1) if j in points]
            if not window:
                continue
            ce_total += _median3([w[0] for w in window])
            pe_total += _median3([w[1] for w in window])
        smoothed.append((ce_total, pe_total))

    out = []
    for i, snap in enumerate(newest):
        cells = snap.get("rows") or []
        ce_oi, pe_oi = smoothed[i]
        # ATM premium: OI direction alone cannot tell put buying (bearish)
        # from put writing (bullish) — the premium move is the tiebreaker.
        spot = float(snap.get("spot") or 0)
        atm = None
        if ref_strike is not None:
            for cell in cells:
                if len(cell) >= 7 and float(cell[0] or 0) == ref_strike:
                    atm = cell
                    break
            if atm is None and common:
                # The reference strike fell outside this snapshot's window
                # (or the common set): use the nearest common strike.
                nearest = min(common, key=lambda k: abs(k - ref_strike))
                for cell in cells:
                    if len(cell) >= 7 and float(cell[0] or 0) == nearest:
                        atm = cell
                        break
        if atm is None:
            best = float("inf")
            for cell in cells:
                if len(cell) < 7:
                    continue
                dist = abs(float(cell[0] or 0) - spot)
                if dist < best:
                    best = dist
                    atm = cell
        def _sum(idx: int) -> float:
            return sum(
                float(cell[idx] or 0)
                for cell in cells
                if len(cell) > idx and (not common or float(cell[0]) in common)
            )
        out.append({
            "t": snap.get("t"),
            "spot": snap.get("spot"),
            "ce_oi": ce_oi,
            "pe_oi": pe_oi,
            "ce_vol": _sum(3),
            "pe_vol": _sum(6),
            "atm_strike": float(atm[0]) if atm else None,
            "ce_prem": float(atm[1] or 0) if atm else None,
            "pe_prem": float(atm[4] or 0) if atm else None,
        })
    return out


@router.get("/nifty/chain10s")
def get_chain10s(
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    start: Optional[str] = Query(default=None, description="HH:MM inclusive"),
    end: Optional[str] = Query(default=None, description="HH:MM inclusive"),
    limit: int = Query(default=240, ge=1, le=2000, description="Newest N snapshots"),
    summary: bool = Query(default=False, description="Per-snapshot OI/volume totals only"),
) -> dict[str, Any]:
    """Slim 10-second chain snapshots for a session (newest ``limit``)."""
    # Direct (non-HTTP) callers pass the FastAPI Query sentinel for omitted
    # params; normalise before comparing.
    date_str = date if isinstance(date, str) and date else _today_ist()
    start = start if isinstance(start, str) else None
    end = end if isinstance(end, str) else None
    limit = limit if isinstance(limit, int) else 240
    # Direct (non-HTTP) callers get the Query sentinel, which is truthy.
    summary = summary if isinstance(summary, bool) else False
    rows = _read_day(date_str)
    if start or end:
        def _hm(s: str) -> str:
            return s[11:16] if "T" in s else s[:5]
        rows = [
            r for r in rows
            if (not start or _hm(str(r.get("t") or "")) >= start)
            and (not end or _hm(str(r.get("t") or "")) <= end)
        ]
    newest = rows[-limit:]
    if summary:
        out = summarise_snapshots(newest)
        return {"date": date_str, "count": len(rows), "summary": out}
    return {"date": date_str, "count": len(rows), "rows": newest}
