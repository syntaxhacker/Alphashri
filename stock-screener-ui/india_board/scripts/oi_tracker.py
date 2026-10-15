#!/usr/bin/env python3
"""Intraday OI flow tracker: poll the Fyers option chain every 2 minutes
during market hours, keep snapshots in memory, serve them to the dashboard.

Market hours: Mon–Fri 09:15–15:30 IST.

Each snapshot: ``{ts, ticker, strikes: [{strike, ce_oi, pe_oi, ce_oich,
pe_oich}]}``. Snapshots live in a module-level list capped at 200 entries
(oldest evicted first). A daemon thread polls the whole ``fyers_data``
universe sequentially with a small gap between tickers.

Persistence: every snapshot is also appended to::

    india_board/data/oi_flow/{TICKER}/{YYYY-MM-DD}.jsonl

(one JSON object per line, date derived from ``ts``). On start, today's
files are hydrated back into ``_SNAPSHOTS`` so a server restart does not
wipe the day, and files older than 30 days are pruned. All disk failures
are logged briefly and never crash the poller.

The Fyers token is handled entirely inside ``fyers_data`` — this module
never touches, prints, or logs credentials.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

IST = ZoneInfo("Asia/Kolkata")

ROOT = Path(__file__).resolve().parent.parent
#: JSONL tree written by ``_append`` / read by ``_load_day``.
DATA_DIR = ROOT / "data" / "oi_flow"

POLL_SEC = 120
MAX_SNAPS = 200
#: Snapshots on disk older than this many days are deleted at startup.
KEEP_DAYS = 30
_GAP_SEC = 1.0  # gap between tickers inside one poll sweep

_SNAPSHOTS: list[dict] = []
_lock = threading.Lock()
_started = False


def is_market_open(now: datetime | None = None) -> bool:
    """True during Mon–Fri 09:15–15:30 IST."""
    cur = now or datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)
    if cur.weekday() >= 5:  # Sat / Sun
        return False
    mins = cur.hour * 60 + cur.minute
    return 9 * 60 + 15 <= mins <= 15 * 60 + 30


def _num(v, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Disk persistence — small helpers with an overridable root (``root=``).
# Every helper is best-effort: they return quietly (or with a bool) instead
# of raising, so a full/read-only disk can never kill the poller.
# ---------------------------------------------------------------------------


def _snapshot_file(ticker: str, date_str: str, root: Path | str | None = None) -> Path:
    """``{root}/{TICKER}/{date}.jsonl`` — ticker upper-cased, dirs created by callers."""
    t = (ticker or "").upper().strip()
    base = Path(root) if root is not None else DATA_DIR
    return base / t / f"{date_str}.jsonl"


def _snap_date(snap: dict) -> str:
    """IST calendar date (``YYYY-MM-DD``) a snapshot belongs to, from its ``ts``."""
    dt = datetime.fromisoformat(str(snap.get("ts") or ""))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    else:
        dt = dt.astimezone(IST)
    return dt.date().isoformat()


def _append(ticker: str, snap: dict, root: Path | str | None = None) -> bool:
    """Append one snapshot as a JSONL line under ``root``. Returns success."""
    try:
        dest = _snapshot_file(ticker, _snap_date(snap), root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(snap, separators=(",", ":"))
        with open(dest, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[oi-flow] persist failed for {ticker}: {type(exc).__name__}: {exc}"[:160], flush=True)
        return False


def _load_day(ticker: str, date_str: str, root: Path | str | None = None) -> list[dict]:
    """Snapshots stored for one ticker/day, sorted by ``ts`` (oldest first).

    Missing files yield ``[]``; malformed lines are skipped, never raised.
    """
    path = _snapshot_file(ticker, date_str, root)
    snaps: list[dict] = []
    try:
        if not path.is_file():
            return snaps
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception as exc:  # noqa: BLE001
        print(f"[oi-flow] load failed for {ticker}: {type(exc).__name__}", flush=True)
        return snaps
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue  # malformed line — skip, don't crash
        if isinstance(obj, dict) and obj.get("ts") and obj.get("ticker"):
            snaps.append(obj)
    snaps.sort(key=lambda s: str(s.get("ts") or ""))
    return snaps


def _hydrate(
    date_str: str | None = None,
    root: Path | str | None = None,
    tickers: list[str] | None = None,
) -> list[dict]:
    """Load *today's* JSONL files into ``_SNAPSHOTS`` (sorted, capped).

    Older dates stay on disk untouched. Returns the snapshots now in memory.
    """
    day = date_str or datetime.now(IST).date().isoformat()
    base = Path(root) if root is not None else DATA_DIR
    if tickers is None:
        tickers = []
        try:
            if base.is_dir():
                tickers = sorted(p.name for p in base.iterdir() if p.is_dir())
        except OSError:
            tickers = []
    loaded: list[dict] = []
    for t in tickers:
        loaded.extend(_load_day(t, day, base))
    with _lock:
        # Dedupe on (ts, ticker) so a repeated hydrate never doubles memory.
        merged: dict[tuple, dict] = {}
        for s in list(_SNAPSHOTS) + loaded:
            merged[(str(s.get("ts")), str(s.get("ticker")))] = s
        combined = sorted(merged.values(), key=lambda s: str(s.get("ts") or ""))
        if len(combined) > MAX_SNAPS:
            combined = combined[len(combined) - MAX_SNAPS:]
        _SNAPSHOTS.clear()
        _SNAPSHOTS.extend(combined)
        if loaded:
            print(f"[oi-flow] hydrated {len(loaded)} snapshot(s) for {day} from disk", flush=True)
        result = list(_SNAPSHOTS)
    return result


def _prune(
    root: Path | str | None = None,
    keep_days: int = KEEP_DAYS,
    today: date | None = None,
) -> int:
    """Delete ``{root}/*/*.jsonl`` files older than ``keep_days`` days.

    Best-effort: returns the number of files removed and never raises.
    """
    base = Path(root) if root is not None else DATA_DIR
    removed = 0
    try:
        cutoff = (today or datetime.now(IST).date()) - timedelta(days=keep_days)
        for f in base.glob("*/*.jsonl"):
            try:
                fdate = date.fromisoformat(f.stem)
            except ValueError:
                continue  # unexpected filename — leave it alone
            if fdate < cutoff:
                try:
                    f.unlink()
                    removed += 1
                except OSError:
                    continue
    except Exception:  # noqa: BLE001
        return removed
    return removed


def take_snapshot(ticker: str) -> dict | None:
    """Fetch the live chain for one ticker and append a snapshot.

    Returns the snapshot, or None on any failure (token expired,
    rate-limited, unknown ticker). Never raises.
    """
    t = (ticker or "").upper().strip()
    if not t:
        return None
    try:
        import fyers_data  # noqa: PLC0415

        chain = fyers_data.get_chain(t)
    except Exception:  # noqa: BLE001
        return None
    strikes = []
    for r in chain.get("strikes") or []:
        strike = _num(r.get("strike"), default=float("nan"))
        if strike != strike or strike <= 0:
            continue
        strikes.append(
            {
                "strike": strike,
                "ce_oi": _num(r.get("ce_oi")),
                "pe_oi": _num(r.get("pe_oi")),
                "ce_oich": _num(r.get("ce_oich")),
                "pe_oich": _num(r.get("pe_oich")),
            }
        )
    strikes.sort(key=lambda r: r["strike"])
    # Underlying spot is required by the W3a playbook emitters (P1/P2/P4).
    # Record it verbatim from the chain — ``None`` when unavailable, never
    # fabricated. Old JSONL lines without the key still load and read as None.
    spot = chain.get("spot")
    try:
        spot = None if spot is None else float(spot)
        if spot != spot:  # NaN is not a usable price
            spot = None
    except (TypeError, ValueError):
        spot = None
    snap = {
        "ts": datetime.now(IST).isoformat(),
        "ticker": t,
        "spot": spot,
        "strikes": strikes,
    }
    with _lock:
        _SNAPSHOTS.append(snap)
        while len(_SNAPSHOTS) > MAX_SNAPS:
            _SNAPSHOTS.pop(0)
        # Persist inside the lock so concurrent on-demand + poller writes
        # serialize per file. _append never raises.
        _append(t, snap)
    return snap


def history(ticker: str | None = None) -> list[dict]:
    """All snapshots, oldest first; filtered by ticker when given."""
    with _lock:
        snaps = list(_SNAPSHOTS)
    if ticker:
        t = ticker.upper().strip()
        snaps = [s for s in snaps if s.get("ticker") == t]
    return snaps


def latest(ticker: str | None = None) -> dict | None:
    """Most recent snapshot (for ticker when given), or None."""
    snaps = history(ticker)
    return snaps[-1] if snaps else None


def _sweep() -> None:
    try:
        import fyers_data  # noqa: PLC0415

        tickers = list(fyers_data.UNIVERSE)
    except Exception:  # noqa: BLE001
        return
    for i, t in enumerate(tickers):
        # A dead token 401s every call — abort the sweep instead of grinding
        # through the universe (each failure also means no snapshots written).
        if i >= 2 and fyers_data.fyers_paused():
            print("[oi-flow] aborting sweep — Fyers auth failed (re-authenticate)", flush=True)
            return
        snap = take_snapshot(t)
        if snap is not None:
            print(f"[oi-flow] {t}: {len(snap['strikes'])} strikes @ {snap['ts']}", flush=True)
        time.sleep(_GAP_SEC)


def _loop() -> None:
    print(f"[oi-flow] poller started (every {POLL_SEC}s during 09:15-15:30 IST)", flush=True)
    while True:
        try:
            if is_market_open():
                print("[oi-flow] market open — sweeping universe", flush=True)
                _sweep()
            else:
                print("[oi-flow] market closed — skipping sweep", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[oi-flow] sweep failed: {exc}", flush=True)
        time.sleep(POLL_SEC)


def ensure_started() -> None:
    """Start the background poller exactly once (daemon thread).

    Before starting, hydrate today's persisted snapshots back into memory
    and prune files older than ``KEEP_DAYS`` — both best-effort.
    """
    global _started
    if _started:
        return
    _started = True
    try:
        _hydrate()
    except Exception as exc:  # noqa: BLE001
        print(f"[oi-flow] hydrate failed: {type(exc).__name__}: {exc}"[:160], flush=True)
    try:
        removed = _prune()
        if removed:
            print(f"[oi-flow] pruned {removed} oi-flow file(s) older than {KEEP_DAYS}d", flush=True)
    except Exception:  # noqa: BLE001
        pass  # retention is best-effort
    th = threading.Thread(target=_loop, name="oi-flow-poller", daemon=True)
    th.start()
