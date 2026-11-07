"""Tape-based call/put wall test, rejection and break detection.

Pure detection over the 1-minute tape rows (same shape the recorder writes:
``t``, ``spot``, ``call_wall``, ``put_wall``, ``max_pain``). No network, no DB.

Validated on the 2026-11-03 tape (the 12:10 flush): the call wall 23,700 was
tested from 11:54, rejected at 12:10, and max pain 23,650 was hit. Historical
scan (10 sessions): a call-wall test rejects 40% of the time, and *every*
rejection reached max pain; put-wall tests held only 25% of the time.

Recall journal
--------------
Detection is only useful if the feed can be audited afterwards, so every
event the feed emits is appended to
``experiments/data/nifty_wall_events/{date}.jsonl`` (deduped on
``t+side+kind+level`` — the bursts feed is polled every few seconds and would
otherwise write the same event hundreds of times). :func:`recall_report`
replays a day's tape through :func:`detect_wall_events` and diffs it against
that journal: *detected* (replay), *alerted* (journal), *missing* (detected
but never alerted), *extra* (alerted but no longer reproducible). The CLI is
``scripts/nifty_event_recall.py``.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from api.reports_api._numeric import safe_opt_float

WALL_PROX_PTS = 15.0
TEST_MIN_FRAMES = 10
REJECT_MIN_PTS = 25.0
REJECT_WINDOW = 30
BREAK_BUFFER_PTS = 5.0
BREAK_MIN_FRAMES = 5
CONT_PTS = 50.0

# stock-screener-ui/api/reports_api/nifty_wall_events.py -> parents[2] == root
EVENTS_DIR = (Path(__file__).resolve().parent.parent.parent
              / "experiments" / "data" / "nifty_wall_events")

#: One writer per process is not enough: the bursts endpoint is a sync handler
#: and FastAPI runs it in a threadpool, so two polls can persist concurrently.
_WRITE_LOCK = threading.Lock()


def events_path(date_str: str, path: Optional[Path | str] = None) -> Path:
    """Journal path for ``date_str`` (``path`` overrides the directory/file)."""
    if path is not None:
        p = Path(path)
        return p if p.suffix == ".jsonl" else p / f"{date_str}.jsonl"
    return EVENTS_DIR / f"{date_str}.jsonl"


def event_key(event: dict[str, Any]) -> tuple[str, str, str, float]:
    """Dedupe key: ``(t, side, kind, level)``.

    ``t`` is the event's own tape timestamp (a minute's second-resolution
    stamp), so re-running detection on the same tape is idempotent while a
    genuine re-test at a later minute is a new event.
    """
    try:
        level = round(float(event.get("level")), 2)
    except (TypeError, ValueError):
        level = 0.0
    return (str(event.get("t") or ""), str(event.get("side") or ""),
            str(event.get("kind") or ""), level)


def read_events(date_str: str,
                path: Optional[Path | str] = None) -> list[dict[str, Any]]:
    """Persisted events for ``date_str`` (oldest first); never raises."""
    target = events_path(date_str, path)
    out: list[dict[str, Any]] = []
    try:
        with open(target) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if isinstance(row, dict):
                    out.append(row)
    except OSError:
        return []
    return out


def persist_events(events: Iterable[dict[str, Any]], date_str: str,
                   path: Optional[Path | str] = None) -> dict[str, int]:
    """Append new events to the day's journal; return ``{added, skipped}``.

    Append-only and idempotent: an event already in the file (same
    ``t+side+kind+level``) is skipped, so polling the bursts feed does not grow
    the journal. Never raises — the journal is an audit trail, not a
    dependency of the feed.
    """
    target = events_path(date_str, path)
    added = 0
    skipped = 0
    try:
        with _WRITE_LOCK:
            existing = {event_key(row) for row in read_events(date_str, path)}
            fresh: list[dict[str, Any]] = []
            for event in events or ():
                if not isinstance(event, dict):
                    continue
                key = event_key(event)
                if key in existing:
                    skipped += 1
                    continue
                existing.add(key)
                fresh.append(event)
            if not fresh:
                return {"added": 0, "skipped": skipped}
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = "".join(json.dumps({**ev, "date": date_str},
                                         separators=(",", ":")) + "\n"
                              for ev in fresh)
            # One write per poll: a partial line is still a valid prefix, and
            # O_APPEND keeps concurrent writers from interleaving.
            with open(target, "a") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            added = len(fresh)
    except Exception:
        return {"added": added, "skipped": skipped}
    return {"added": added, "skipped": skipped}


def recall_report(date_str: str,
                  rows: Optional[Iterable[dict[str, Any]]] = None,
                  path: Optional[Path | str] = None,
                  tape_loader: Optional[Callable[[str], list]] = None,
                  ) -> dict[str, Any]:
    """Diff a tape replay against the persisted alert journal for ``date_str``.

    ``rows`` is the tape (``t``/``spot``/``call_wall``/``put_wall`` rows). When
    omitted it is loaded with ``tape_loader`` (default:
    ``api.reports_api.nifty.read_tape``, imported lazily to avoid a cycle).

    Returns counts plus the two interesting lists:

    * ``missing`` — detected by replay but never alerted (a detector worked and
      the feed did not emit it: the recall bug this journal exists to find);
    * ``extra`` — alerted but no longer reproducible (tape rewritten, or the
      alert was mapped from a different frame set).
    """
    if rows is None:
        loader = tape_loader
        if loader is None:
            from api.reports_api.nifty import read_tape as loader  # type: ignore
        try:
            rows = loader(date_str)
        except Exception:
            rows = []
    detected = detect_wall_events(list(rows or ()))
    alerted = read_events(date_str, path)
    detected_keys = {event_key(ev) for ev in detected}
    alerted_keys = {event_key(ev) for ev in alerted}
    missing = [ev for ev in detected if event_key(ev) not in alerted_keys]
    extra = [ev for ev in alerted if event_key(ev) not in detected_keys]
    return {
        "date": date_str,
        "detected": len(detected),
        "alerted": len(alerted_keys),
        "matched": len(detected_keys & alerted_keys),
        "missing": missing,
        "extra": extra,
        "journal": str(events_path(date_str, path)),
    }


def _spot(row: dict[str, Any]) -> Optional[float]:
    """Row spot as a safe optional float (None / NaN / inf all pass through)."""
    return safe_opt_float(row.get("spot"))


def _level(row: dict[str, Any], side: str) -> Optional[float]:
    """Row's call/put wall level as a safe optional float."""
    key = "call_wall" if side == "call" else "put_wall"
    return safe_opt_float(row.get(key))


def detect_wall_events(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return wall test / rejection / break events in tape order.

    Event shapes::

        {"kind": "wall_test", "side": "call", "t": ..., "level": 23700.0}
        {"kind": "rejection", "side": "call", "t": ..., "level": 23700.0,
         "target": 23650.0, "spot": 23650.0, "moved_pts": 45.75}
        {"kind": "break", "side": "call", "t": ..., "level": 23700.0,
         "spot": 23755.0, "moved_pts": 55.0}
        {"kind": "wall_break", "side": "put", "t": ..., "level": 23500.0}
    """
    clean = [r for r in (rows or []) if isinstance(r, dict) and _spot(r) is not None]
    events: list[dict[str, Any]] = []
    n = len(clean)
    i = 0
    while i < n:
        row = clean[i]
        spot = _spot(row)
        cw = _level(row, "call")
        pw = _level(row, "put")

        # ---- call wall test -> rejection or break ----
        if cw is not None and abs(cw - spot) <= WALL_PROX_PTS:
            j = i
            while j < n:
                lvl = _level(clean[j], "call") or cw
                s = _spot(clean[j])
                if abs(lvl - s) > WALL_PROX_PTS:
                    break
                j += 1
            if j - i >= TEST_MIN_FRAMES:
                events.append({"kind": "wall_test", "side": "call", "t": row["t"], "level": cw})
                after = [(k, _spot(clean[k])) for k in range(j, min(n, j + REJECT_WINDOW))]
                if after:
                    hit = next(((k, s) for k, s in after if s <= spot - REJECT_MIN_PTS), None)
                    if hit:
                        hit_k, hit_spot = hit
                        events.append(
                            {
                                "kind": "rejection",
                                "side": "call",
                                "t": clean[hit_k]["t"],
                                "level": cw,
                                "target": row.get("max_pain"),
                                "spot": round(hit_spot, 2),
                                "moved_pts": round(spot - hit_spot, 2),
                            }
                        )
                    else:
                        hit = next(((k, s) for k, s in after if s >= cw + CONT_PTS), None)
                        if hit:
                            hit_k, hit_spot = hit
                            events.append(
                                {
                                    "kind": "break",
                                    "side": "call",
                                    "t": clean[hit_k]["t"],
                                    "level": cw,
                                    "spot": round(hit_spot, 2),
                                    "moved_pts": round(hit_spot - cw, 2),
                                }
                            )
            i = max(j, i + 1)
            continue

        # ---- put wall test -> hold or break ----
        if pw is not None and abs(pw - spot) <= WALL_PROX_PTS:
            j = i
            while j < n:
                lvl = _level(clean[j], "put") or pw
                s = _spot(clean[j])
                if abs(lvl - s) > WALL_PROX_PTS:
                    break
                j += 1
            if j - i >= TEST_MIN_FRAMES:
                events.append({"kind": "wall_test", "side": "put", "t": row["t"], "level": pw})
                after = [(k, _spot(clean[k])) for k in range(j, min(n, j + REJECT_WINDOW))]
                if after:
                    hit = next(((k, s) for k, s in after if s <= pw - REJECT_MIN_PTS), None)
                    if hit:
                        hit_k, hit_spot = hit
                        events.append(
                            {
                                "kind": "wall_break",
                                "side": "put",
                                "t": clean[hit_k]["t"],
                                "level": pw,
                                "spot": round(hit_spot, 2),
                                "moved_pts": round(pw - hit_spot, 2),
                            }
                        )
            i = max(j, i + 1)
            continue

        i += 1
    return events
