#!/usr/bin/env python3
"""Read-only Upstox market clock.

Pulls ``GET /market/status/:exchange``, ``GET /market/timings/:date`` and
``GET /market/holidays`` and prints a one-block session summary. ``--check``
exits 0 when the market is OPEN (handy as a pre-flight gate for live jobs).

The exchange status endpoint is **live-only**: it always describes *now*.
Asking for a past session therefore never reuses today's status — the clock
marks the status as not applicable for that date and refuses to report OPEN.

Read-only by construction: only HTTP GETs, no orders, no DB writes. Requests
go through the shared Upstox rate limiter (``scripts/upstox_rate``).

Usage:
    .venv/bin/python scripts/market_clock.py --check
    .venv/bin/python scripts/market_clock.py --check --exchange NSE --json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import desk_common  # noqa: E402
from scripts import upstox_common  # noqa: E402
from scripts.upstox_common import data as _data  # noqa: E402

# Raw Upstox market-status values → coarse bucket. Anything unrecognised
# (e.g. future status strings) defaults to CLOSED (safe for live gates).
# "OPEN" and "SPECIAL_OPEN" are the short/special-session variants Upstox
# returns for a shortened or special trading day — both are tradable.
_OPEN = {"NORMAL_OPEN", "OPEN", "SPECIAL_OPEN"}
_PRE_OPEN = {"PRE_OPEN_START", "PRE_OPEN_END"}


# ---------------------------------------------------------------------------
# pure helpers (unit-tested, no network)
# ---------------------------------------------------------------------------
def classify_status(status: str | None) -> str:
    """Map a raw Upstox status string → OPEN / PRE_OPEN / CLOSED."""
    text = str(status or "").strip().upper()
    if text in _OPEN:
        return "OPEN"
    if text in _PRE_OPEN:
        return "PRE_OPEN"
    return "CLOSED"


def parse_status_payload(payload) -> dict:
    """Normalise ``GET /market/status/:exchange`` → ``{exchange, raw, state, ...}``."""
    data = _data(payload)
    if not isinstance(data, dict):
        return {"exchange": None, "raw": None, "state": "CLOSED", "last_updated": None}
    raw = data.get("status")
    out = {
        "exchange": data.get("exchange"),
        "raw": raw,
        "state": classify_status(raw),
        "last_updated": data.get("last_updated"),
    }
    cas = data.get("cas_eligible_status")
    if isinstance(cas, dict):
        out["cas_status"] = cas.get("status")
    return out


def _fmt_epoch_ms(value, tz: dt.tzinfo = dt.timezone.utc) -> str:
    """Epoch-millis → ``HH:MM`` in ``tz`` (``"—"`` when unparseable)."""
    try:
        moment = dt.datetime.fromtimestamp(float(value) / 1000, tz=dt.timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return "—"
    return moment.astimezone(tz).strftime("%H:%M")


def parse_timings_payload(payload, exchange: str = "NSE") -> dict:
    """Normalise ``GET /market/timings/:date`` → ``{exchange, start, end}``.

    Times are ``HH:MM`` IST strings (Upstox returns epoch millis); missing
    exchange rows become None fields.
    """
    import config

    data = _data(payload)
    rows = data if isinstance(data, list) else []
    match = next(
        (r for r in rows if isinstance(r, dict) and str(r.get("exchange", "")).upper() == exchange.upper()),
        None,
    )
    if match is None:
        return {"exchange": exchange, "start": None, "end": None}
    return {
        "exchange": exchange,
        "start": _fmt_epoch_ms(match.get("start_time"), config.IST),
        "end": _fmt_epoch_ms(match.get("end_time"), config.IST),
    }


def _exchange_names(values) -> list[str]:
    """Exchange names from a ``closed/open_exchanges`` list (strings or ``{"exchange": ...}`` dicts)."""
    names: list[str] = []
    for entry in values or []:
        if isinstance(entry, dict):
            entry = entry.get("exchange")
        if entry:
            names.append(str(entry).upper())
    return names


def parse_holidays_payload(payload, exchange: str = "NSE") -> list[dict]:
    """Normalise ``GET /market/holidays`` → ``[{date, description}]``.

    Keeps entries where ``exchange`` is closed (listed in ``closed_exchanges``
    or absent from ``open_exchanges``), sorted by date. Settlement-only
    holidays still count as non-trading days for the desk block.
    """
    data = _data(payload)
    if isinstance(data, dict):  # single-date shape: {"date": ..., ...}
        data = [data]
    if not isinstance(data, list):
        return []
    want = exchange.upper()
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        date = row.get("date")
        if not date:
            continue
        closed = _exchange_names(row.get("closed_exchanges"))
        opened = _exchange_names(row.get("open_exchanges"))
        is_closed = want in closed or (want not in opened)
        if not is_closed:
            continue
        out.append({"date": str(date), "description": str(row.get("description", ""))})
    out.sort(key=lambda r: r["date"])
    return out


def next_holiday(holidays: list[dict], today: str) -> dict | None:
    """First holiday on/after ``today`` (both ``YYYY-MM-DD``), else None."""
    for row in holidays or []:
        if isinstance(row, dict) and str(row.get("date", "")) >= today:
            return row
    return None


def status_applies_to_date(date: str, today: str) -> bool:
    """True when the live exchange status is meaningful for ``date``.

    ``GET /market/status/:exchange`` describes *now*. It says nothing about a
    past session, so a past (or future) date must not borrow today's status.
    """
    return str(date or "") == str(today or "")


def status_for_date(exchange: str, date: str, today: str,
                    raw: str | None = None) -> dict:
    """Status block for ``date``; today's live status, or a closed/no-op block.

    For a non-today date the state is CLOSED with ``live: False`` and an
    explanatory note — the ``--check`` gate must not pass on a stale status.
    """
    if status_applies_to_date(date, today):
        return {
            "exchange": exchange,
            "raw": raw,
            "state": classify_status(raw),
            "last_updated": None,
            "live": True,
        }
    return {
        "exchange": exchange,
        "raw": None,
        "state": "CLOSED",
        "last_updated": None,
        "live": False,
        "note": (f"market status is live-only — {date} is not today ({today}), "
                 f"so today's status was not applied"),
    }


# ---------------------------------------------------------------------------
# live sources (network, read-only)
# ---------------------------------------------------------------------------
def _get(path: str, timeout: float):
    return upstox_common.get(path, None, timeout)


def build_clock(exchange: str, date: str, timeout: float, today: str | None = None) -> dict:
    """Fetch status + timings + holidays; degrades per-source, never raises.

    ``today`` defaults to the current IST date. The live exchange status is
    only applied when ``date`` IS today (see :func:`status_for_date`).
    """
    today = today or desk_common.today_ist()
    clock: dict = {"exchange": exchange, "date": date, "today": today, "errors": []}
    if status_applies_to_date(date, today):
        try:
            raw = _get(f"/market/status/{exchange}", timeout)
            parsed = parse_status_payload(raw)
            clock["status"] = {**parsed, "live": True}
        except Exception as exc:  # noqa: BLE001
            clock["status"] = {"exchange": exchange, "raw": None, "state": "CLOSED",
                               "last_updated": None, "live": True}
            clock["errors"].append(f"unavailable: status ({type(exc).__name__})")
    else:
        clock["status"] = status_for_date(exchange, date, today)
        clock["errors"].append(
            f"status not applied: {date} is not today ({today}) — the exchange "
            f"status endpoint is live-only")
    try:
        clock["session"] = parse_timings_payload(_get(f"/market/timings/{date}", timeout), exchange)
    except Exception as exc:  # noqa: BLE001
        clock["session"] = {"exchange": exchange, "start": None, "end": None}
        clock["errors"].append(f"unavailable: timings ({type(exc).__name__})")
    try:
        holidays = parse_holidays_payload(_get("/market/holidays", timeout), exchange)
        clock["holidays"] = holidays
        clock["next_holiday"] = next_holiday(holidays, date)
    except Exception as exc:  # noqa: BLE001
        clock["holidays"] = []
        clock["next_holiday"] = None
        clock["errors"].append(f"unavailable: holidays ({type(exc).__name__})")
    return clock


def render(clock: dict) -> str:
    status = clock.get("status") or {}
    session = clock.get("session") or {}
    nxt = clock.get("next_holiday") or {}
    lines = [
        f"MARKET {clock.get('exchange')} {clock.get('date')}  state {status.get('state', 'CLOSED')}"
        + (f"  (raw {status['raw']})" if status.get("raw") else "")
    ]
    if status.get("note"):
        lines.append(f"NOTE {status['note']}")
    start, end = session.get("start"), session.get("end")
    lines.append(f"SESSION {start or '—'}–{end or '—'} IST")
    if nxt.get("date"):
        lines.append(f"NEXT HOLIDAY {nxt['date']}  {nxt.get('description', '')}".rstrip())
    else:
        lines.append("NEXT HOLIDAY —")
    for err in clock.get("errors") or []:
        lines.append(err)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="market_clock",
        description="Read-only Upstox market clock (no orders, no DB writes).",
    )
    ap.add_argument("--check", action="store_true", help="print the clock block; exit 0 iff market is OPEN")
    ap.add_argument("--exchange", default="NSE")
    ap.add_argument("--date", default=None, help="session date YYYY-MM-DD (default today IST)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--timeout", type=float, default=10.0)
    args = ap.parse_args(argv)

    date = args.date or desk_common.today_ist()
    try:
        dt.date.fromisoformat(date)
    except ValueError:
        ap.error("--date must be YYYY-MM-DD")

    try:
        clock = build_clock(args.exchange, date, args.timeout)
    except Exception as exc:  # noqa: BLE001
        print(f"error: {type(exc).__name__}: {exc}")
        return 2
    if args.json:
        print(json.dumps(clock, indent=2, default=str))
    else:
        print(render(clock))
    if args.check:
        return 0 if (clock.get("status") or {}).get("state") == "OPEN" else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
