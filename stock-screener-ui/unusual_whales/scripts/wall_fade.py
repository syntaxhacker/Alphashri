#!/usr/bin/env python3
"""MNQ failed-breakout-at-the-call-wall watcher.

The rule (derived from the 2026-09-29 session, n=1 — treat as a hypothesis):

    1. LEVEL   : UW NDX call wall, translated into MNQ futures points
    2. ARM     : MNQ trades at/above the wall
    3. TRIGGER : MNQ prints back below the wall (failed breakout)
    4. CONFIRM : cumulative delta over the trigger window is negative
    5. STOP    : just beyond the high of the failed breakout (NOT a tight stop)
    6. TARGET  : overnight POC

On 2026-09-29 this fired 8 seconds after the RTH open: entry 30690.75, failure
high 30725.25, MAE 15.5 pts, target the overnight POC at +55.75 pts. A 15-pt
stop was stopped out; a 20-pt stop made +55.75. The stop rule in step 5 is the
whole edge — see the stop-sensitivity note in the README.

The mirror case (price ACCEPTS above the wall for N minutes on positive delta)
is recorded as informational only: on 2026-09-29 fading an accepted wall was
the losing trade, so it is deliberately NOT shorted.

Read-only with respect to market data. Alerting only — it never places orders.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

from mw_session import cme_futures_open, et_now  # noqa: E402
from mw_tickstore import TickCache, cumulative_delta, volume_profile  # noqa: E402
from nq_basis import mnq_levels  # noqa: E402
from uw_client import UWClient  # noqa: E402

ET = ZoneInfo("America/New_York")
DB_PATH = ROOT / "data" / "gex_levels.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ms     INTEGER NOT NULL,
  created_at     TEXT    NOT NULL,
  session        TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  symbol         TEXT,
  wall           REAL,
  flip           REAL,
  magnet         REAL,
  put_wall       REAL,
  price          REAL,
  basis          REAL,
  entry          REAL,
  entry_confirm  REAL,
  stop           REAL,
  target         REAL,
  rr             REAL,
  failure_high   REAL,
  cvd            REAL,
  armed_at_ms    INTEGER,
  trigger_at_ms  INTEGER,
  detail         TEXT,
  UNIQUE(session, kind, trigger_at_ms)
);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    con.commit()
    return con


def session_bounds(now: datetime | None = None) -> tuple[int, int]:
    """(RTH start ms, RTH end ms) in ET for the current/next session."""
    n = et_now(now)
    day = n.date()
    if n.hour < 9 or (n.hour == 9 and n.minute < 30):
        pass  # before today's open -> use today
    start = datetime.combine(day, datetime.min.time(), tzinfo=ET).replace(hour=9, minute=30)
    end = start.replace(hour=16, minute=0)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def overnight_bounds(now: datetime | None = None) -> tuple[int, int]:
    """CME session start (17:00 ET prior) -> today's RTH start."""
    rth_start, _ = session_bounds(now)
    on_start = int((datetime.fromtimestamp(rth_start / 1000, ET) - timedelta(hours=16, minutes=30)).timestamp() * 1000)
    return on_start, rth_start


def detect(levels: dict, ticks: list, *, wall: float, target: float, now_ms: int,
           buffer_pts: float = 2.5, confirm_s: int = 60, min_vol: float = 200.0,
           accept_min: int = 20, freshness_s: int | None = 300) -> dict | None:
    """Run the state machine over today's RTH ticks. Returns a signal or None.

    Confirmation must be measured on the FOLLOW-THROUGH after the cross, not
    before it: on 2026-09-29 the cross happened ~1 s after the open, so a
    "delta before the trigger" window contains almost no data and can never
    confirm. Requiring ``confirm_s`` of post-trigger data (with volume) is both
    testable and tradeable, and ``entry_confirm`` is the price you could
    actually have got.

    ``freshness_s`` bounds how old the cross may be. Gamma walls drift intraday,
    so without it a live watcher would re-discover ancient patterns every time
    the wall moves. Pass ``None`` when replaying a finished session.
    """
    if not ticks or wall is None:
        return None
    armed_ts = failure_high = None
    trigger = None
    for ts, px, _v, _a in ticks:
        if px >= wall:
            if armed_ts is None:
                armed_ts = ts
            failure_high = px if failure_high is None else max(failure_high, px)
        elif armed_ts is not None:
            trigger = (ts, px)
            break
    if armed_ts is None:
        return None

    base = {
        "wall": wall,
        "symbol": levels.get("symbol"),
        "flip": next((l["mnq"] for l in levels.get("levels", []) if l["key"] == "gamma_flip"), None),
        "magnet": next((l["mnq"] for l in levels.get("levels", []) if l["key"] == "gamma_magnet"), None),
        "put_wall": next((l["mnq"] for l in levels.get("levels", []) if l["key"] == "put_wall"), None),
        "price": levels.get("price"),
        "basis": levels.get("basis"),
        "armed_at_ms": armed_ts,
        "failure_high": failure_high,
    }

    if trigger is None:
        held_min = (ticks[-1][0] - armed_ts) / 60000.0
        if held_min >= accept_min:
            cvd = cumulative_delta([t for t in ticks if t[0] >= armed_ts])
            if cvd > 0:
                return {**base, "kind": "accept", "entry": None, "entry_confirm": None,
                        "stop": None, "target": None, "rr": None, "cvd": cvd,
                        "trigger_at_ms": armed_ts,  # non-null so UNIQUE dedupes
                        "detail": f"price held above the wall {held_min:.0f} min with positive delta "
                                  f"({cvd:+,.0f}) — wall being accepted, do NOT fade"}
        return None

    trig_ts, trig_px = trigger
    if now_ms - trig_ts < confirm_s * 1000:
        return None  # not enough follow-through data to confirm yet
    if freshness_s is not None and now_ms - trig_ts > freshness_s * 1000:
        return None  # cross is stale — the wall has probably moved since
    window = [t for t in ticks if trig_ts <= t[0] <= trig_ts + confirm_s * 1000]
    vol = sum(max(t[2] or 0, 0) for t in window)
    if vol < min_vol:
        return None
    cvd = cumulative_delta(window)
    # A retest of the wall inside the window is normal and does NOT invalidate
    # the failure (2026-09-29 peaked 3.5 pts back above it). Require only that
    # the window ends below the wall and spends most of its time below it.
    below = [t for t in window if t[1] < wall]
    pct_below = len(below) / len(window) if window else 0.0
    if cvd >= 0 or window[-1][1] >= wall or pct_below < 0.60:
        return None  # no follow-through: not a failed breakout

    entry = window[-1][1]  # realistic fill at confirmation
    stop = failure_high + buffer_pts
    risk = stop - entry
    reward = entry - target
    if risk <= 0 or reward <= 0:
        return None
    return {**base, "kind": "fade", "entry": round(trig_px, 2), "entry_confirm": round(entry, 2),
            "stop": round(stop, 2), "target": round(target, 2), "rr": round(reward / risk, 2),
            "cvd": cvd, "trigger_at_ms": trig_ts, "confirm_vol": vol,
            "detail": f"failed breakout at the call wall; cross at {trig_px:.2f}, confirmed after "
                      f"{confirm_s}s at {entry:.2f} on delta {cvd:+,.0f}; stop above the failure high "
                      f"{failure_high:.2f} + {buffer_pts} buffer, target overnight POC {target:.2f}"}


def _notify(text: str, key: str) -> bool:
    try:
        root = SCRIPTS.parents[1]  # stock-screener-ui
        try:
            from dotenv import load_dotenv  # noqa: PLC0415

            for name in (".env.local", ".env.dev", ".env"):
                path = root / name
                if path.exists():
                    load_dotenv(path, override=False)
        except Exception:  # noqa: BLE001  — env may already be set by the caller
            pass
        sys.path.insert(0, str(root))
        from trading.telegram_notifier import send_alert  # noqa: PLC0415

        send_alert(text, cooldown_key=key)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  (telegram unavailable: {exc})", file=sys.stderr)
        return False


def store(con, sig: dict) -> bool:
    """Insert if new for (session, kind). Returns True when it is a new signal."""
    sess = et_now().date().isoformat()
    cur = con.execute(
        """INSERT OR IGNORE INTO signals
           (created_ms,created_at,session,kind,symbol,wall,flip,magnet,put_wall,price,basis,
            entry,entry_confirm,stop,target,rr,failure_high,cvd,armed_at_ms,trigger_at_ms,detail)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (int(datetime.now(timezone.utc).timestamp() * 1000),
         datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
         sess, sig["kind"], sig.get("symbol"), sig.get("wall"), sig.get("flip"),
         sig.get("magnet"), sig.get("put_wall"), sig.get("price"), sig.get("basis"),
         sig.get("entry"), sig.get("entry_confirm"), sig.get("stop"), sig.get("target"),
         sig.get("rr"), sig.get("failure_high"), sig.get("cvd"), sig.get("armed_at_ms"),
         sig.get("trigger_at_ms"), sig.get("detail")),
    )
    con.commit()
    return cur.rowcount == 1


def format_alert(sig: dict, target=None) -> str:
    if sig["kind"] == "accept":
        return (f"MNQ · WALL ACCEPTED (info only, do not fade)\n"
                f"wall {sig['wall']:.2f} · price {sig.get('price')}\n{sig.get('detail')}")
    return (
        f"MNQ · FAILED BREAKOUT AT CALL WALL → FADE\n"
        f"entry {sig['entry_confirm']:.2f} (cross {sig['entry']:.2f})   "
        f"stop {sig['stop']:.2f}   target {sig['target']:.2f}   R:R {sig['rr']}\n"
        f"wall {sig['wall']:.2f} · failure high {sig['failure_high']:.2f} · "
        f"flip {sig['flip']} · magnet {sig['magnet']} · put wall {sig['put_wall']}\n"
        f"confirm delta {sig['cvd']:+,.0f} · basis {sig['basis']} · price {sig.get('price')}\n"
        f"Not advice. Stop placement is the edge — a tight fixed stop lost on 2026-09-29."
    )


def cycle(con, client, cache: TickCache, levels: dict, target: float, *, alert: bool, quiet: bool,
          freshness_s: int | None = 300) -> dict | None:
    rth_start, _ = session_bounds()
    ticks = cache.load(rth_start)
    sig = detect(levels, ticks, wall=next(
        (l["mnq"] for l in levels.get("levels", []) if l["key"] == "call_wall"), None),
        target=target, now_ms=int(time.time() * 1000), freshness_s=freshness_s)
    if not sig:
        if not quiet:
            print(f"[{et_now():%H:%M:%S} ET] no signal · rth ticks {len(ticks):,} · "
                  f"wall {next((l['mnq'] for l in levels.get('levels', []) if l['key'] == 'call_wall'), None)}")
        return None
    is_new = store(con, sig)
    if not quiet:
        print(f"[{et_now():%H:%M:%S} ET] SIGNAL {sig['kind']} new={is_new}: {sig.get('detail')}")
    if is_new and alert:
        _notify(format_alert(sig), key=f"wall_fade:{et_now().date()}:{sig['kind']}")
    return sig


def main() -> None:
    ap = argparse.ArgumentParser(description="MNQ failed-breakout-at-the-call-wall watcher")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--prefix", default="MNQ")
    ap.add_argument("--buffer", type=float, default=2.5, help="pts beyond the failure high for the stop")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--no-alert", action="store_true", help="log signals but send no Telegram")
    ap.add_argument("--all-hours", action="store_true", help="run outside RTH (not recommended)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    con = connect(Path(args.db))
    client = UWClient()
    cache = TickCache(args.prefix)
    print(f"wall-fade watcher: {args.prefix}, every {args.interval}s, stop = failure_high + {args.buffer}")
    print(f"alerts: {'OFF' if args.no_alert else 'Telegram (trading.telegram_notifier)'}")

    _poc_cache: dict[str, float] = {}

    def overnight_poc() -> float | None:
        key = et_now().date().isoformat()
        if key in _poc_cache:
            return _poc_cache[key]
        on_start, rth_start = overnight_bounds()
        prof = volume_profile([t for t in cache.load(on_start) if on_start <= t[0] < rth_start])
        if prof:
            _poc_cache[key] = prof["poc"]
        return _poc_cache.get(key)

    try:
        while True:
            if args.all_hours or cme_futures_open():
                try:
                    levels = mnq_levels(client, prefix=args.prefix)
                    target = overnight_poc()
                    if target is None:
                        if not args.quiet:
                            print("  (no overnight profile yet — waiting)")
                    else:
                        cycle(con, client, cache, levels, target,
                              alert=not args.no_alert, quiet=args.quiet)
                except Exception as exc:  # noqa: BLE001
                    print(f"  cycle failed: {exc}", file=sys.stderr)
                if args.once:
                    return
            elif not args.quiet:
                print(f"[{et_now():%H:%M:%S} ET] market closed - idle")
                if args.once:
                    return
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
