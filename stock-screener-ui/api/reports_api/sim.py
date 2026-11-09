"""HTTP surface for the Index Report strategy simulator.

No-lookahead: a strategy is signalled on the first recorded minute at/after its
entry time but fills on the next one, over the recorded 1-minute option tape.
Nothing is interpolated or fetched live.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date as _date
from datetime import datetime, time
from pathlib import Path
from typing import Any, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import config
from api.reports_api._dates import validate_date
from options_paper import structures, tape
from options_paper.spec import get_lot
from options_paper.structure_engine import ExecSpec, run_specs
from options_paper.tape import Tick, _to_tick

router = APIRouter(prefix="/api/reports/sim", tags=["report-sim"])

# stock-screener-ui/api/reports_api/sim.py -> parents[2] == stock-screener-ui
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "experiments" / "data"

#: Underlying names seen in F&O: RELIANCE, BAJAJ-AUTO, M&M, NIFTYNXT50.
_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9&_-]{0,23}$")

FILL_MODEL = (
    "entries fill on the next recorded minute; exits fill at the bar close; "
    "targets are capped at the target"
)

#: Parsed ticks keyed by (path, mtime_ns, size). Bounded because a session of
#: runs across several underlyings must not grow without limit.
_TICKS_CACHE: dict[tuple[str, int, int], list[Tick]] = {}
_TICKS_CACHE_MAX = 8

_DEFAULT_EXEC = {
    "entryTime": "09:35",
    "slPct": 30.0,
    "tpPct": 60.0,
    "maxHoldMin": 60,
    "trailPct": 0.0,
    "eodExit": "15:10",
}


# --------------------------------------------------------------------------
# Templates (mirrors src/pages/report/sim/simSpec.ts)
# --------------------------------------------------------------------------
def _leg(action: str, opt: str, strike: str, lots: int = 1) -> dict[str, Any]:
    return {"action": action, "opt": opt, "strike": strike, "lots": lots}


def _template(tid: str, name: str, blurb: str, legs: list[dict]) -> dict[str, Any]:
    return {"id": tid, "name": name, "blurb": blurb, "legs": legs,
            "exec": dict(_DEFAULT_EXEC)}


TEMPLATES: list[dict[str, Any]] = [
    _template("long-call", "Long call",
              "Buy an ATM call. Unlimited upside, premium at risk.",
              [_leg("BUY", "CE", "ATM")]),
    _template("long-put", "Long put",
              "Buy an ATM put. Profits on a downside move.",
              [_leg("BUY", "PE", "ATM")]),
    _template("long-straddle", "Long straddle",
              "Buy ATM call + put. Profits from a large move either way.",
              [_leg("BUY", "CE", "ATM"), _leg("BUY", "PE", "ATM")]),
    _template("bull-call-spread", "Bull call spread",
              "Buy ATM call, sell a higher call. Capped bullish debit spread.",
              [_leg("BUY", "CE", "ATM"), _leg("SELL", "CE", "ATM+2")]),
    _template("bear-put-spread", "Bear put spread",
              "Buy ATM put, sell a lower put. Capped bearish debit spread.",
              [_leg("BUY", "PE", "ATM"), _leg("SELL", "PE", "ATM-2")]),
    _template("bull-put-spread", "Bull put spread",
              "Sell ATM put, buy a lower put. Bullish credit spread.",
              [_leg("SELL", "PE", "ATM"), _leg("BUY", "PE", "ATM-2")]),
    _template("bear-call-spread", "Bear call spread",
              "Sell ATM call, buy a higher call. Bearish credit spread.",
              [_leg("SELL", "CE", "ATM"), _leg("BUY", "CE", "ATM+2")]),
    _template("short-strangle", "Short strangle",
              "Sell an OTM call + put. Collects premium in a range; the tails are open.",
              [_leg("SELL", "CE", "ATM+2"), _leg("SELL", "PE", "ATM-2")]),
    _template("iron-condor", "Iron condor",
              "Sell ATM±1, buy ATM±2 wings. Range-bound credit spread.",
              [_leg("BUY", "PE", "ATM-2"), _leg("SELL", "PE", "ATM-1"),
               _leg("SELL", "CE", "ATM+1"), _leg("BUY", "CE", "ATM+2")]),
]


# --------------------------------------------------------------------------
# Request models (camelCase on the wire, snake_case in Python)
# --------------------------------------------------------------------------
class LegIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    action: str
    opt: str
    strike: Union[str, int, float]
    lots: int = Field(default=1, ge=1, le=50)


class ExecIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    entry_time: str = Field(default="09:35", alias="entryTime")
    sl_pct: float = Field(default=30.0, alias="slPct")
    tp_pct: float = Field(default=60.0, alias="tpPct")
    max_hold_min: int = Field(default=60, alias="maxHoldMin")
    trail_pct: float = Field(default=0.0, alias="trailPct")
    eod_exit: str = Field(default="15:10", alias="eodExit")


class StrategyIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    legs: list[LegIn] = Field(min_length=1, max_length=12)
    exec_spec: ExecIn = Field(alias="exec")


class RunIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    symbol: str = "NIFTY"
    date: Optional[str] = None
    as_of: Optional[str] = Field(default=None, alias="asOf")
    strategies: list[StrategyIn] = Field(min_length=1, max_length=8)
    costs: bool = True
    slippage_ticks: int = Field(default=0, ge=0, le=5, alias="slippageTicks")


# --------------------------------------------------------------------------
# Validation / paths
# --------------------------------------------------------------------------
def _today() -> str:
    """Today's session date in IST (never the host's local date)."""
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def _symbol(underlying: str) -> str:
    """Upper-cased, validated underlying symbol or a 400.

    The value lands in a filesystem path, so the charset is enforced rather
    than trusted: ``..`` / ``/`` / whitespace can never leave ``DATA_ROOT``.
    """
    symbol = str(underlying or "").strip().upper()
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(
            status_code=400,
            detail=f"bad symbol: {underlying!r}, want a symbol like NIFTY/RELIANCE",
        )
    return symbol


def _missing(date_str: str, message: str) -> HTTPException:
    """The NIFTY-shaped "nothing recorded" envelope (404, not 500)."""
    return HTTPException(status_code=404, detail={
        "is_trading_day": False,
        "date": date_str,
        "message": message,
    })


def _tape_path(symbol: str, date_str: str) -> Path:
    """Tape file for a session: NIFTY keeps its own recorder directory."""
    if symbol == "NIFTY":
        return tape.tape_path(date_str)
    return DATA_ROOT / "options_tape" / symbol / f"{date_str}.jsonl"


def _read_jsonl(path: Path) -> list[dict]:
    """Parsed JSON-object lines; ``[]`` when missing, blank lines skipped."""
    if not path.exists():
        return []
    out: list[dict] = []
    try:
        with path.open() as fh:
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


def _generic_ticks(path: Path) -> list[Tick]:
    """Typed ticks from a generic recorder tape (same row contract as NIFTY)."""
    ticks: list[Tick] = []
    for row in _read_jsonl(path):
        tick = _to_tick(row)
        if tick is not None and tick.spot > 0:
            ticks.append(tick)
    ticks.sort(key=lambda tick: tick.t)
    return ticks


def _load_ticks(symbol: str, date_str: str) -> list[Tick]:
    """Tape ticks for a session, cached on the source file's (mtime, size).

    The cache is a seam the tests replace wholesale, and it is what makes a
    re-run of the same replay instant instead of re-parsing the day log.
    """
    path = _tape_path(symbol, date_str)
    try:
        stat = path.stat()
    except OSError:
        stat = None
    key = (str(path),
           stat.st_mtime_ns if stat else 0,
           stat.st_size if stat else 0)
    cached = _TICKS_CACHE.get(key)
    if cached is not None:
        return cached
    if stat is None:
        ticks: list[Tick] = []
    elif symbol == "NIFTY":
        ticks = tape.load_tape(date_str)
    else:
        ticks = _generic_ticks(path)
    if len(_TICKS_CACHE) >= _TICKS_CACHE_MAX:
        _TICKS_CACHE.pop(next(iter(_TICKS_CACHE)), None)
    _TICKS_CACHE[key] = ticks
    return ticks


def _gap_count(symbol: str, date_str: str) -> int:
    """Missed minutes journalled next to the tape (0 when no journal)."""
    path = _tape_path(symbol, date_str).parent / f"{date_str}.gaps.jsonl"
    try:
        with path.open() as fh:
            return sum(1 for line in fh if line.strip())
    except OSError:
        return 0


def _as_of_time(value: Optional[str]) -> Optional[time]:
    """``HH:MM`` or ISO datetime -> time; a malformed value is a 400."""
    text = str(value or "").strip()
    if not text:
        return None
    candidate = text.replace(" ", "T")
    try:
        if "T" in candidate:
            return datetime.fromisoformat(candidate).time()
        return time.fromisoformat(candidate)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"bad asOf: {value!r}, want HH:MM or an ISO datetime",
        ) from None


def _lot_size(symbol: str) -> tuple[int, bool]:
    """``(lot, verified)``; an unknown symbol degrades, never 500s."""
    try:
        return get_lot(symbol), True
    except KeyError:
        return (65 if symbol == "NIFTY" else 1), False


def _r2(value: float) -> float:
    return round(float(value), 2)


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@router.get("/strategies")
def get_strategies() -> dict[str, Any]:
    """The built-in structures the report UI offers as starting points."""
    return {"templates": TEMPLATES}


@router.post("/run")
def run_simulation(body: RunIn) -> dict[str, Any]:
    """Replay one session's recorded tape through every requested structure.

    ``asOf`` truncates the tape at a minute (live mode); omitting it runs the
    whole recorded day. The payload is exactly what the report UI renders.
    """
    symbol = _symbol(body.symbol)
    date_str = validate_date(body.date if body.date else _today())
    session_day = datetime.strptime(date_str, "%Y-%m-%d").date()
    as_of = _as_of_time(body.as_of)

    ticks = sorted(_load_ticks(symbol, date_str), key=lambda tick: tick.t)
    if not ticks:
        raise _missing(date_str, f"no {symbol} tape for {date_str}")

    if as_of is not None:
        cutoff = as_of.strftime("%H:%M")
        ticks = [tick for tick in ticks if tick.t.strftime("%H:%M") <= cutoff]
        if not ticks:
            raise _missing(
                date_str,
                f"no {symbol} tape for {date_str} at {cutoff}",
            )

    tape_lag_sec = 0
    if as_of is not None:
        requested = datetime.combine(session_day, as_of, tzinfo=config.IST)
        last_t = ticks[-1].t
        if last_t.tzinfo is None:
            last_t = last_t.replace(tzinfo=config.IST)
        tape_lag_sec = max(0, int((requested - last_t).total_seconds()))

    expiry = ""
    expiries = [tick.expiry for tick in ticks if tick.expiry]
    if expiries:
        expiry = Counter(expiries).most_common(1)[0][0]
    dte = 0
    if expiry:
        try:
            dte = max(0, (_date.fromisoformat(expiry[:10]) - session_day).days)
        except ValueError:
            dte = 0

    lot_size, lot_verified = _lot_size(symbol)

    specs: list[ExecSpec] = []
    for strategy in body.strategies:
        try:
            legs = [
                structures.parse_leg_spec({
                    "action": leg.action,
                    "opt": leg.opt,
                    "strike": str(leg.strike),
                    "lots": leg.lots,
                })
                for leg in strategy.legs
            ]
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"strategy {strategy.name!r}: {exc}",
            ) from None
        specs.append(ExecSpec(
            id=strategy.id,
            name=strategy.name,
            legs=legs,
            entry_time=strategy.exec_spec.entry_time,
            sl_pct=strategy.exec_spec.sl_pct,
            tp_pct=strategy.exec_spec.tp_pct,
            max_hold_min=strategy.exec_spec.max_hold_min,
            trail_pct=strategy.exec_spec.trail_pct,
            eod_exit=strategy.exec_spec.eod_exit,
        ))

    try:
        results = run_specs(
            specs, ticks, lot_size,
            slippage_ticks=float(body.slippage_ticks),
            costs=body.costs,
        )
    except Exception as exc:  # never leak a traceback to the report UI
        raise HTTPException(
            status_code=500,
            detail=f"simulation failed: {type(exc).__name__}: {str(exc)[:180]}",
        ) from exc

    totals: dict[str, float] = {}
    for result in results:
        for point in result.equity:
            key = str(point["t"])
            totals[key] = totals.get(key, 0.0) + float(point["pnl"])
    combined_equity = [
        {"t": key, "pnl": _r2(value)} for key, value in sorted(totals.items())
    ]

    return {
        "symbol": symbol,
        "date": date_str,
        "expiry": expiry,
        "dte": dte,
        "asOf": ticks[-1].t.isoformat(),
        "spot": _r2(ticks[-1].spot),
        "lotSize": lot_size,
        "lotVerified": lot_verified,
        "coverage": {
            "frames": len(ticks),
            "first": ticks[0].t.isoformat(),
            "last": ticks[-1].t.isoformat(),
            "gaps": _gap_count(symbol, date_str),
        },
        "strategies": [result.as_dict() for result in results],
        "combined": {
            "realized": _r2(sum(result.realized for result in results)),
            "unrealized": _r2(sum(result.unrealized for result in results)),
            "total": _r2(sum(result.total for result in results)),
            "equity": combined_equity,
        },
        "tapeLagSec": tape_lag_sec,
        "fillModel": FILL_MODEL,
    }
