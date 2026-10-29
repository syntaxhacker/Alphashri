"""Desk trade markers for the Nifty report chart.

Read-only view over the paper desk's journal — closed trades plus the open
book — shaped for plotting on the Nifty spot chart:

    GET /api/reports/nifty/desk-trades?date=YYYY-MM-DD   (default: today)

Sources (read-only, never written):
  - ``options_paper/journal/{date}.jsonl`` — one closed trade per line.
  - ``options_paper/journal/agent_positions.json`` — the currently open book.

The journal is the primary/authoritative source: it carries the entry/exit
premiums, times and net P&L of every closed leg, so no database access is
needed here (``db/alphashri.db`` is never opened). Missing files, malformed
lines and bad timestamps degrade to an empty/partial payload rather than an
error — this endpoint feeds a chart panel and must never break the report.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional

from fastapi import APIRouter, Query

import config

router = APIRouter()

#: stock-screener-ui/api/reports_api/desk_trades.py -> parents[2] == stock-screener-ui
JOURNAL_DIR = (
    Path(__file__).resolve().parent.parent.parent / "options_paper" / "journal"
)

SIDE_LONG = "LONG"
SIDE_SHORT = "SHORT"

#: The discretionary (agent) book. Everything else in the journal is coded.
MANUAL_STRATEGY = "agent_discretionary"

#: Book labels used in the ``by_book`` split.
BOOK_MANUAL = "manual"
BOOK_CODED = "coded"

#: A straddle is two option legs (CE + PE) at one strike.
STRADDLE_LEGS = 2
SINGLE_LEG = 1


# ---------------------------------------------------------------------------
# Small coercion helpers (never raise)
# ---------------------------------------------------------------------------

def _opt_float(value: Any) -> Optional[float]:
    """``float(value)`` or ``None`` — blank/garbage becomes ``None``."""
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out


def _opt_int(value: Any) -> Optional[int]:
    out = _opt_float(value)
    return int(out) if out is not None else None


def _opt_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_ts(value: Any) -> Optional[datetime]:
    """ISO timestamp -> ``datetime``; ``None`` when blank/unparseable."""
    text = _opt_str(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _sort_key(value: Any) -> tuple[int, str]:
    """Orderable key for ISO strings, tolerant of mixed/aware/naive stamps.

    The journal stamps everything in IST, so dropping the offset is enough to
    keep a naive and an aware stamp comparable; unparseable stamps sort last.
    """
    dt = _parse_ts(value)
    if dt is None:
        return (1, str(value or ""))
    return (0, dt.replace(tzinfo=None).isoformat())


def _norm_side(raw: Any) -> str:
    text = (_opt_str(raw) or "").upper()
    if text in ("SHORT", "SELL", "SELL_SHORT"):
        return SIDE_SHORT
    return SIDE_LONG


def _norm_opt(opt: Any, symbol: Any = None) -> Optional[str]:
    """``CE`` / ``PE`` / ``STRADDLE`` from the explicit field, else the symbol.

    A STRADDLE is a real book position (CE + PE at one strike) — it must not
    be dropped for "not being CE or PE", or the open book silently loses half
    the positions on a pin day.
    """
    text = (_opt_str(opt) or "").upper()
    if "STRADDLE" in text:
        return "STRADDLE"
    if "CE" in text and "PE" not in text:
        return "CE"
    if "PE" in text and "CE" not in text:
        return "PE"
    sym = (_opt_str(symbol) or "").upper()
    if "STRADDLE" in sym:
        return "STRADDLE"
    if sym.endswith("CE"):
        return "CE"
    if sym.endswith("PE"):
        return "PE"
    return None


def _is_manual(record: Any) -> bool:
    """True when a record belongs to the discretionary (agent) book."""
    strategy = _opt_str(record.get("strategy")) if isinstance(record, dict) else None
    return (strategy or "").strip().lower() == MANUAL_STRATEGY


def _trade_key(record: dict) -> Optional[str]:
    key = _opt_str(record.get("_key"))
    if key:
        return key
    entry = _opt_str(record.get("entry_time"))
    if not entry:
        return None
    symbol = _opt_str(record.get("symbol")) or _opt_str(record.get("strike")) or ""
    strategy = _opt_str(record.get("strategy")) or "trade"
    return f"{strategy}|{symbol}|{entry}"


# ---------------------------------------------------------------------------
# Journal / position parsing (pure)
# ---------------------------------------------------------------------------

def parse_journal_lines(lines: Iterable[str]) -> list[dict]:
    """Parse JSONL journal lines, skipping blank/corrupt/non-object entries.

    A line is only usable as a marker source when it carries an ``entry_time``
    (there is nothing to plot otherwise), so records without one are dropped
    here rather than surfacing as ``t: None`` markers.
    """
    records: list[dict] = []
    for line in lines or []:
        if not isinstance(line, str):
            continue
        line = line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(value, dict):
            continue
        if not _opt_str(value.get("entry_time")):
            continue
        records.append(value)
    return records


def journal_path(date_str: str, journal_dir: Optional[Path] = None) -> Path:
    return Path(journal_dir or JOURNAL_DIR) / f"{date_str}.jsonl"


def positions_path(journal_dir: Optional[Path] = None) -> Path:
    return Path(journal_dir or JOURNAL_DIR) / "agent_positions.json"


def read_journal(date_str: str,
                 journal_dir: Optional[Path] = None) -> list[dict]:
    """Closed trades for ``date_str``; ``[]`` when the file is missing."""
    try:
        with open(journal_path(date_str, journal_dir), encoding="utf-8") as f:
            return parse_journal_lines(f)
    except OSError:
        return []


def read_open_positions(date_str: Optional[str] = None,
                        journal_dir: Optional[Path] = None,
                        today: Optional[str] = None) -> list[dict]:
    """Open positions from ``agent_positions.json``, scoped to the session.

    For TODAY the book is scoped by EXPIRY: a position belongs to today's
    book while its contract is still alive (``expiry >= today``). Scoping by
    ENTRY date instead silently dropped every position carried over from a
    previous session — the open book looked empty on exactly the days it
    mattered. A position with no expiry is kept (it cannot be ruled out).

    For a PAST date the file holds the CURRENT book, which cannot describe
    that day's book, so the entry-date scope is kept. A position with no
    parseable ``entry_time`` is kept — better to show it than to hide the
    book because one field is missing.
    """
    try:
        with open(positions_path(journal_dir), encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []
    raw_positions = payload.get("positions")
    if not isinstance(raw_positions, list):
        return []
    today = today or _today_str()
    is_today = date_str is None or date_str == today
    out: list[dict] = []
    for raw in raw_positions:
        position = normalise_position(raw)
        if position is None:
            continue
        if is_today:
            expiry = _opt_str(position.get("expiry"))
            if expiry and expiry < today:
                continue  # the contract has already expired
        elif date_str:
            entry = _parse_ts(position.get("entry_time"))
            if entry is not None and entry.strftime("%Y-%m-%d") != date_str:
                continue
        out.append(position)
    return out


def normalise_position(raw: Any) -> Optional[dict]:
    """Flatten one ``agent_positions.json`` entry into the response shape."""
    if not isinstance(raw, dict):
        return None
    strike = _opt_float(raw.get("strike"))
    opt = _norm_opt(raw.get("opt"), raw.get("symbol"))
    if strike is None and opt is None:
        return None
    entry_premium = _opt_float(raw.get("entry_premium"))
    if entry_premium is None:
        entry_premium = _opt_float(raw.get("premium"))
    return {
        "id": _opt_str(raw.get("id")),
        "strategy": _opt_str(raw.get("strategy")),
        "opt": opt,
        "legs": STRADDLE_LEGS if opt == "STRADDLE" else SINGLE_LEG,
        "strike": strike,
        "side": _norm_side(raw.get("direction") or raw.get("side")),
        "entry_premium": entry_premium,
        "entry_time": _opt_str(raw.get("entry_time")),
        "entry_spot": _opt_float(raw.get("entry_spot")),
        "stop": _opt_float(raw.get("stop")),
        "target": _opt_float(raw.get("target")),
        "lots": _opt_int(raw.get("lots")),
        "qty": _opt_int(raw.get("qty")),
        "expiry": _opt_str(raw.get("expiry")),
        "tag": _opt_str(raw.get("tag")),
        "reason": _opt_str(raw.get("reason")),
    }


# ---------------------------------------------------------------------------
# Marker / summary builders (pure)
# ---------------------------------------------------------------------------

def _entry_marker(record: dict) -> Optional[dict]:
    entry_time = _opt_str(record.get("entry_time"))
    if not entry_time:
        return None
    return {
        "kind": "entry",
        "t": entry_time,
        "spot": _opt_float(record.get("entry_spot")),
        "opt": _norm_opt(record.get("opt"), record.get("symbol")),
        "strike": _opt_float(record.get("strike")),
        "side": _norm_side(record.get("direction") or record.get("side")),
        "price": _opt_float(record.get("entry_premium")),
        "net_pnl": None,
        "reason": _opt_str(record.get("reason")),
        "trade_key": _trade_key(record),
    }


def _exit_marker(record: dict) -> Optional[dict]:
    exit_time = _opt_str(record.get("exit_time"))
    if not exit_time:
        return None
    return {
        "kind": "exit",
        "t": exit_time,
        "spot": _opt_float(record.get("exit_spot")),
        "opt": _norm_opt(record.get("opt"), record.get("symbol")),
        "strike": _opt_float(record.get("strike")),
        "side": _norm_side(record.get("direction") or record.get("side")),
        "price": _opt_float(record.get("exit_premium")),
        "net_pnl": _opt_float(record.get("net_pnl")),
        "reason": _opt_str(record.get("exit_reason")),
        "trade_key": _trade_key(record),
    }


def build_markers(records: Iterable[dict]) -> list[dict]:
    """Per-leg markers: one ``entry`` at entry_time + one ``exit`` at exit_time.

    The exit marker carries the realised ``net_pnl`` and ``exit_reason``; the
    entry marker leaves them ``null``. Sorted chronologically by ``t``.
    """
    markers: list[dict] = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        entry = _entry_marker(record)
        if entry is not None:
            markers.append(entry)
        exit_ = _exit_marker(record)
        if exit_ is not None:
            markers.append(exit_)
    markers.sort(key=lambda m: (_sort_key(m.get("t")), m.get("kind", "")))
    return markers


def build_summary(records: Iterable[dict]) -> dict:
    """Closed-trade counts and realised P&L across the journal records.

    ``by_book`` splits the day into the MANUAL book (``agent_discretionary``)
    and the CODED strategies — the two are read very differently (the agent
    picks its entries by hand, the coded ones by rule) and a single blended
    number hides which one lost money.
    """
    closed = 0
    net = 0.0
    wins = 0
    losses = 0
    books: dict[str, dict] = {
        BOOK_MANUAL: {"closed": 0, "net": 0.0, "wins": 0, "losses": 0},
        BOOK_CODED: {"closed": 0, "net": 0.0, "wins": 0, "losses": 0},
    }
    for record in records or []:
        if not isinstance(record, dict):
            continue
        if not _opt_str(record.get("exit_time")):
            continue
        closed += 1
        book = books[BOOK_MANUAL if _is_manual(record) else BOOK_CODED]
        book["closed"] += 1
        pnl = _opt_float(record.get("net_pnl"))
        if pnl is None:
            continue
        net += pnl
        book["net"] += pnl
        if pnl > 0:
            wins += 1
            book["wins"] += 1
        elif pnl < 0:
            losses += 1
            book["losses"] += 1
    for book in books.values():
        book["net"] = round(book["net"], 2)
    return {
        "closed": closed,
        "net": round(net, 2),
        "wins": wins,
        "losses": losses,
        "by_book": books,
    }


def collect_desk_trades(date_str: str,
                        journal_dir: Optional[Path] = None,
                        today: Optional[str] = None) -> dict:
    """Assemble the full response for ``date_str`` (never raises)."""
    records = read_journal(date_str, journal_dir)
    return {
        "date": date_str,
        "markers": build_markers(records),
        "open": read_open_positions(date_str, journal_dir, today=today),
        "summary": build_summary(records),
    }


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

def _today_str() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def _validate_date(date_str: str) -> str:
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400,
                            detail=f"bad date: {date_str!r}, want YYYY-MM-DD")
    return date_str


@router.get("/nifty/desk-trades")
def get_desk_trades(date: Optional[str] = Query(
        default=None, description="Journal date YYYY-MM-DD (default: today)")):
    """Entry/exit markers + open book + realised summary for ``date``."""
    return collect_desk_trades(_validate_date(date or _today_str()))
