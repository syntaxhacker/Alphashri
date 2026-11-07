"""HISTORY read endpoints for ANY F&O underlying (options desk).

The NIFTY recorder writes ``nifty_*`` directories and NIFTY's readers are
hard-wired to them. This module serves the SAME history shapes for a generic
symbol (``SENSEX``, ``RELIANCE``, ...) from the generic recorder's frozen
on-disk contract::

  experiments/data/options_tape/{SYM}/{YYYY-MM-DD}.jsonl
      raw NIFTY-style tape rows (t, spot, ce_oi, pe_oi, ce_vol, pe_vol,
      pcr_oi, pcr_vol, max_pain, ... walls, expiry, chain, ...)
  experiments/data/options_chain10s/{SYM}/{YYYY-MM-DD}.jsonl
      {"t", "spot", "expiry", "rows": [[strike, ceLtp, ceOi, ceVol,
      peLtp, peOi, peVol], ...]}
  experiments/data/options_snapshots/{SYM}/{YYYY-MM-DD}.jsonl
      {"t", "fetched_at", "report": <NiftyReport>, "sensex": null}
  experiments/data/options_snapshots/{SYM}/{YYYY-MM-DD}.json
      the day's last snapshot report

Every route lives under the ``/api/reports/options`` prefix (tape, chain10s,
bursts, blasts, replay/dates, replay, snapshot, tape/status).

Design rules:
- **Read-only.** No writes, no network, no background task, no Upstox call.
- **NIFTY directories are never touched.** Only *pure* NIFTY logic is reused
  (``derive_tape_rows``, ``summarise_snapshots``, the burst detectors); every
  file read goes through :data:`DATA_ROOT` + a generic directory name.
- **Never 500 on a missing file.** Missing days are the 404
  ``{is_trading_day: False}`` envelope where NIFTY uses one (tape / replay /
  snapshot), and an empty ``count: 0`` 200 where NIFTY degrades (bursts).
- **Symbol is validated**, not interpolated: upper-cased, then checked against
  ``[A-Z0-9&_-]`` so a path can never escape the data directory.
"""

from __future__ import annotations

import json
import os
import re
import statistics
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

import config
from api.reports_api._dates import validate_date
from api.reports_api._numeric import safe_float as _safe_float
from api.reports_api.nifty_bursts import (
    NIFTY_LOT_SIZE,
    OI_BURST_MIN_ABS,
    OI_BURST_WINDOW,
    OI_SIGNAL_RISK_BUDGET,
    coalesce_bursts,
    derive_oi_signal,
    detect_coiling,
    detect_oi_bursts,
    detect_premium_moves,
    detect_squeezes,
    detect_strike_bursts,
    session_trend,
)
from api.reports_api.nifty_fuel import basis_text, fuel_state, structure_evidence

router = APIRouter(prefix="/api/reports/options", tags=["options-history"])

# stock-screener-ui/api/reports_api/options_history.py -> parents[2] == stock-screener-ui
DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "experiments" / "data"

#: Generic recorder directories (one sub-directory per underlying).
CHAIN10S_DIR = "options_chain10s"
TAPE_DIR = "options_tape"
SNAPSHOTS_DIR = "options_snapshots"

#: The generic tape/chain10s are recorded per minute / per 10 seconds.
TAPE_INTERVAL_SEC = 60

#: Underlying names seen in F&O: RELIANCE, BAJAJ-AUTO, M&M, NIFTYNXT50.
_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9&_-]{0,23}$")

# --- blasts (10-second chain) — adaptive thresholds ----------------------------
#: A blast must be unusual *for this session*: ``max(floor, k × median)``.
#: Unlike NIFTY (where the 10 s OI delta runs 0.7M-2.8M), a stock's chain OI is
#: orders of magnitude smaller, so the absolute floors here are deliberately
#: low and the multiplier does the work. Env-overridable for index-scale names.
BLAST_OI_M = float(os.getenv("OPTIONS_BLAST_OI_M", "0.25"))
BLAST_OI_MULT = float(os.getenv("OPTIONS_BLAST_OI_MULT", "6"))
BLAST_VOL_M = float(os.getenv("OPTIONS_BLAST_VOL_M", "0.5"))
BLAST_VOL_MULT = float(os.getenv("OPTIONS_BLAST_VOL_MULT", "8"))

from api.reports_api._blasts import chain_blasts as _shared_chain_blasts

#: Parsed+projected replay days, keyed by (symbol, date, path, mtime, size) so
#: scrubbing one frame per move does not re-parse the whole day log.
_SLIM_CACHE: dict[tuple, list[dict]] = {}


# --- validation / paths --------------------------------------------------------
def _today() -> str:
    """Today's session date in IST (never the host's local date)."""
    return datetime.now(config.IST).strftime("%Y-%m-%d")


#: Re-exported under the private name: ``options_walls`` imports it from here.
_validate_date = validate_date


def _symbol(underlying: str) -> str:
    """Upper-cased, validated underlying symbol or a 400.

    The value lands in a filesystem path, so the charset is enforced rather
    than trusted: ``..`` / ``/`` / whitespace can never leave ``DATA_ROOT``.
    """
    symbol = str(underlying or "").strip().upper()
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(
            status_code=400,
            detail=f"bad underlying: {underlying!r}, want a symbol like NIFTY/RELIANCE",
        )
    return symbol


def _path(kind: str, symbol: str, date_str: str, suffix: str = ".jsonl") -> Path:
    return DATA_ROOT / kind / symbol / f"{date_str}{suffix}"


def _read_jsonl(path: Path) -> list[dict]:
    """Parsed JSON-object lines; ``[]`` when missing, blank lines skipped."""
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
                except (json.JSONDecodeError, ValueError):
                    continue
                if isinstance(row, dict):
                    out.append(row)
    except OSError:
        return []
    return out


def _read_jsonl_tail(path: Path, max_bytes: int = 1_500_000) -> list[dict]:
    """Last ``max_bytes`` of a growing JSONL file, parsed.

    The chain log reaches several MB per symbol per day and the blast strip
    polls every few seconds; re-reading the whole day for the newest 240
    snapshots was pure waste. The first line of a tail read is almost always
    partial, so it is dropped unless the read started at 0. Never raises.
    """
    if not path.exists():
        return []
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            start = max(0, size - max_bytes)
            fh.seek(start)
            data = fh.read()
    except OSError:
        return []
    lines = data.split(b"\n")
    if start > 0:
        lines = lines[1:]
    out: list[dict] = []
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            row = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def _read_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        with open(path) as fh:
            value = json.load(fh)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _last_snapshot(symbol: str, date_str: str) -> Optional[dict]:
    """The day's last saved report (``{SYM}/{date}.json``).

    Accepts both the raw report and the ``{"report": {...}}`` envelope so the
    reader never depends on which shape the recorder chose to persist.
    """
    data = _read_json(_path(SNAPSHOTS_DIR, symbol, date_str, ".json"))
    if not isinstance(data, dict):
        return None
    inner = data.get("report")
    if isinstance(inner, dict):
        return inner
    return data


def _missing(date_str: str, message: str) -> HTTPException:
    """The NIFTY-shaped "nothing recorded" envelope (404, not 500)."""
    return HTTPException(status_code=404, detail={
        "is_trading_day": False,
        "date": date_str,
        "message": message,
    })


def _epoch(value: Any) -> float:
    """Epoch seconds from an ISO string (0.0 when unparseable)."""
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


# --- 1. tape -------------------------------------------------------------------
@router.get("/{underlying}/tape")
def get_options_tape(
    underlying: str,
    date: Optional[str] = Query(default=None, description="Tape date YYYY-MM-DD (default: today IST)"),
) -> dict[str, Any]:
    """Per-minute OI tape with the same derived deltas as ``/nifty/tape``.

    ``derive_tape_rows`` is pure and comes straight from the NIFTY reader, so
    the formulas (``call_doi``/``put_doi``/``net``/``call_tick``/``pcr_doi``/
    ``spot_flip``) are identical. A missing/empty tape is a 404 envelope — the
    recorder only writes rows for minutes it was alive.
    """
    symbol = _symbol(underlying)
    date_str = validate_date(date if isinstance(date, str) and date else _today())
    raw = _read_jsonl(_path(TAPE_DIR, symbol, date_str))
    if not raw:
        raise _missing(date_str, f"no {symbol} tape for {date_str}")
    # Lazy: nifty is a heavy module (auth, intel routers) and this reader must
    # stay import-light for the API's startup path.
    from api.reports_api.nifty import derive_tape_rows

    rows = derive_tape_rows(raw)
    return {
        "date": date_str,
        "interval_sec": TAPE_INTERVAL_SEC,
        "baseline_t": rows[0].get("t") if rows else None,
        "rows": rows,
    }


# --- 2. 10-second chain --------------------------------------------------------
@router.get("/{underlying}/chain10s")
def get_options_chain10s(
    underlying: str,
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    start: Optional[str] = Query(default=None, description="HH:MM inclusive"),
    end: Optional[str] = Query(default=None, description="HH:MM inclusive"),
    limit: int = Query(default=240, ge=1, le=2000, description="Newest N snapshots"),
    summary: bool = Query(default=False, description="Per-snapshot OI/volume totals only"),
) -> dict[str, Any]:
    """Slim 10-second chain snapshots for a session (newest ``limit``).

    Read/filter logic is copied from ``chain10s.get_chain10s`` — including the
    direct-call guards (FastAPI ``Query`` sentinels leak into non-HTTP calls).
    """
    symbol = _symbol(underlying)
    # Direct (non-HTTP) callers pass the Query sentinel for omitted params.
    date_str = validate_date(date if isinstance(date, str) and date else _today())
    start = start if isinstance(start, str) else None
    end = end if isinstance(end, str) else None
    limit = limit if isinstance(limit, int) and not isinstance(limit, bool) else 240
    summary = summary if isinstance(summary, bool) else False

    rows = _read_jsonl(_path(CHAIN10S_DIR, symbol, date_str))
    if start or end:
        def _hm(value: str) -> str:
            return value[11:16] if "T" in value else value[:5]

        rows = [
            r for r in rows
            if (not start or _hm(str(r.get("t") or "")) >= start)
            and (not end or _hm(str(r.get("t") or "")) <= end)
        ]
    newest = rows[-limit:]
    if summary:
        # Lazy import: only this branch needs the chain aggregator.
        from api.reports_api import chain10s

        # `strike_step=None` = nearest ACTUAL strike: stock chains are not on
        # a 50-pt ladder (RELIANCE 2.5/5/10), so the 50-grid reference would
        # report a 20-pt-away ITM call / OTM put as the "ATM" premium.
        return {"date": date_str, "count": len(rows),
                "summary": chain10s.summarise_snapshots(
                    newest, strike_step=None)}
    return {"date": date_str, "count": len(rows), "snapshots": newest}


# --- 3. OI bursts --------------------------------------------------------------
def _snapshot_context(symbol: str, date_str: str) -> tuple[Optional[dict], Optional[list], float]:
    """``(report, strikes, spot)`` from the day's last snapshot.

    Never raises: a missing snapshot only costs the burst its plan
    (``signal: null``) and structure levels, never the whole feed.
    """
    try:
        report = _last_snapshot(symbol, date_str)
        if not isinstance(report, dict):
            return None, None, 0.0
        strikes = report.get("strikes")
        spot = _safe_float(report.get("spot"))
        return report, (strikes if isinstance(strikes, list) and strikes else None), spot
    except Exception:
        return None, None, 0.0


def _levels_from_report(report: Optional[dict]) -> dict[str, float]:
    """Named levels the desk trades against (max pain + heavy wall strikes)."""
    levels: dict[str, float] = {}
    if not isinstance(report, dict):
        return levels
    max_pain = _safe_float(report.get("max_pain"))
    if max_pain:
        levels["max_pain"] = max_pain
    walls = report.get("walls_near") or report.get("walls") or {}
    if isinstance(walls, dict):
        for side_key, kind in (("calls", "wall"), ("puts", "wall")):
            entries = walls.get(side_key) or []
            if entries and isinstance(entries[0], dict):
                strike = _safe_float(entries[0].get("strike"))
                if strike:
                    levels[f"{kind}_{side_key}"] = strike
    return levels


def _resolve_lot_size(symbol: str, report: Optional[dict], strikes: Optional[list]) -> tuple[int, bool]:
    """``(lot_size, verified)`` for this symbol's contract.

    Order: the snapshot's own ``lot_size`` → the recorder's resolver (index
    table + ``NSE_FO`` instrument file, e.g. RELIANCE 500) → NIFTY's 65 as a
    documented **unverified** fallback (``verified=False``). A plan sized on
    the wrong lot is worse than one that says "verify the lot".
    """
    try:
        lot = int((report or {}).get("lot_size") or 0)
        if lot > 0:
            return lot, True
    except (TypeError, ValueError):
        pass
    try:
        from api.reports_api.options_recorder import lot_size as recorder_lot_size

        lot = int(recorder_lot_size(symbol, strikes))
        if lot > 1:  # 1 means "unresolved" in that resolver
            return lot, True
    except Exception:
        pass
    return NIFTY_LOT_SIZE, False


def _size_signal(signal: dict, lot: int, verified: bool) -> None:
    """Re-size a plan onto the real contract lot, in place.

    ``derive_oi_signal`` sizes on ``NIFTY_LOT_SIZE``; the units are derived
    back from the same risk budget so ``qty`` stays an exact multiple of the
    symbol's own lot (a 65-share order is not tradeable on a 500-lot stock).
    """
    entry = _safe_float(signal.get("entry"))
    sl = _safe_float(signal.get("sl"))
    units = int(OI_SIGNAL_RISK_BUDGET // max(0.05, entry - sl)) if entry > 0 else 0
    lots = units // lot if lot > 0 else 0
    signal["lots"] = lots
    signal["qty"] = lots * lot
    signal["lot_size"] = lot
    signal["lot_size_verified"] = verified


@router.get("/{underlying}/bursts")
def get_options_bursts(
    underlying: str,
    date: Optional[str] = Query(default=None, description="Burst date YYYY-MM-DD (default: today IST)"),
    window: int = Query(default=OI_BURST_WINDOW, ge=3, le=60, description="Trailing minutes for the baseline"),
    min_abs: float = Query(default=OI_BURST_MIN_ABS, ge=0, description="Absolute ΔOI floor (contracts)"),
) -> dict[str, Any]:
    """Per-minute OI bursts recomputed from the stored tape — never errors.

    Same detectors, coalescing and plan logic as ``/nifty/bursts`` (all pure
    imports). NIFTY-specific news tagging is not applied — a stock burst has no
    index headline feed, so every burst carries ``news: []``.

    Lot sizing: ``derive_oi_signal`` sizes on NIFTY's 65, so the plan is
    re-sized here onto the symbol's own contract lot (snapshot ``lot_size`` →
    recorder resolver → NIFTY 65). When the lot could not be resolved the
    signal says ``lot_size_verified: False`` — verify it before ordering.
    """
    symbol = _symbol(underlying)
    date_str = validate_date(date if isinstance(date, str) and date else _today())
    window = window if isinstance(window, int) and not isinstance(window, bool) else OI_BURST_WINDOW
    min_abs = min_abs if isinstance(min_abs, (int, float)) and not isinstance(min_abs, bool) else OI_BURST_MIN_ABS

    raw = _read_jsonl(_path(TAPE_DIR, symbol, date_str))
    if not raw:
        return {"date": date_str, "count": 0, "interval_sec": TAPE_INTERVAL_SEC,
                "bursts": [], "reason": "no tape"}

    from api.reports_api.nifty import derive_tape_rows

    rows = derive_tape_rows(raw)
    bursts = detect_oi_bursts(rows, window=window, min_abs=min_abs)
    for detector in (detect_squeezes, detect_strike_bursts,
                     detect_premium_moves, detect_coiling):
        try:
            bursts += detector(rows)
        except Exception:
            pass
    bursts.sort(key=lambda b: str(b.get("t") or ""))
    # One alert per (minute, side): a directional minute trips several
    # strikes/detectors and they describe the same event.
    bursts = coalesce_bursts(bursts)

    report, strikes, spot = _snapshot_context(symbol, date_str)
    levels = _levels_from_report(report)
    lot, lot_verified = _resolve_lot_size(symbol, report, strikes)
    try:
        trend = session_trend(rows)
    except Exception:
        trend = None

    for b in bursts:
        try:
            # Trend at the burst's own minute, not at the close.
            b_trend = session_trend(rows, at_time=b.get("t")) or trend
            prem = b.get("premChg")
            building = _safe_float(b.get("delta")) > 0
            b["fuel_state"] = fuel_state(building, None if prem is None else float(prem))
            b["structure"] = structure_evidence(rows, str(b.get("t") or ""), levels)
            if b["structure"]:
                b["invalidation"] = b["structure"].get("level")
            b["signal"] = derive_oi_signal(b, strikes, spot, trend=b_trend)
            if b["signal"] is not None:
                _size_signal(b["signal"], lot, lot_verified)
            elif (strikes and spot
                  and b.get("type") not in ("coil", "squeeze", "premium")):
                b["plan_suppressed"] = True
                b["signal"] = {
                    "leg": None, "strike": None, "entry": None, "sl": None,
                    "target": None, "qty": 0, "lots": 0,
                    "basis": basis_text(b.get("fuel_state"), b.get("side") or "call",
                                        b.get("structure"), _safe_float(b.get("spot"))),
                }
        except Exception:
            b["signal"] = None
        # No NIFTY headline feed for a stock/index-generic symbol.
        b.setdefault("news", [])
        if trend:
            b["trend"] = trend

    return {"date": date_str, "count": len(bursts),
            "interval_sec": TAPE_INTERVAL_SEC, "bursts": bursts}


# --- 4. OI / volume blasts (10-second chain only) ------------------------------
def _chain_blasts(symbol: str, date_str: str, lookback_min: int) -> list[dict]:
    """OI + volume blasts from the generic 10-second chain.

    Documented detector (no spot tape is recorded per-symbol, so no spot
    blasts are ever emitted — a fabricated spot move is worse than a missing
    one):

    1. newest 240 snapshots, then keep those inside ``lookback_min``;
    2. aggregate with ``chain10s.summarise_snapshots`` (common-strike set +
       per-strike median of 3) — removes the ±strike window roll and the
       dual-backend OI flicker;
    3. difference totals against the previous snapshot at least 10 s older;
    4. gate with ``max(floor, k × window median)`` — adaptive per session;
    5. keep the strongest event per ``(kind, side, 30 s bucket)``.

    Blast shape matches NIFTY's ``NiftyBlast`` (``kind`` is only ``"oi"`` or
    ``"volume"``).

    Delegates to the shared implementation in :mod:`api.reports_api._blasts`.
    """
    def _get_snaps(d: str) -> list[dict]:
        return _read_jsonl_tail(_path(CHAIN10S_DIR, symbol, d))[-240:]

    return _shared_chain_blasts(
        date_str=date_str,
        lookback_min=lookback_min,
        oi_floor_m=BLAST_OI_M,
        oi_mult=BLAST_OI_MULT,
        vol_floor_m=BLAST_VOL_M,
        vol_mult=BLAST_VOL_MULT,
        get_snaps=_get_snaps,
        is_today=(date_str == _today()),
        strike_step=None,
    )


@router.get("/{underlying}/blasts")
def get_options_blasts(
    underlying: str,
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD (default: today IST)"),
    lookback_min: int = Query(default=5, ge=1, le=30),
    limit: int = Query(default=40, ge=1, le=200),
) -> dict[str, Any]:
    """OI/volume blasts from the generic 10-second chain (no spot blasts).

    Index spot velocity needs the 1-second tick tape, which is recorded for
    NIFTY only. Rather than invent spot moves from 10-second snapshots, this
    feed serves the chain-based kinds and never emits ``kind: "spot"``.
    """
    symbol = _symbol(underlying)
    date_str = validate_date(date if isinstance(date, str) and date else _today())
    lookback_min = lookback_min if isinstance(lookback_min, int) and not isinstance(lookback_min, bool) else 5
    limit = limit if isinstance(limit, int) and not isinstance(limit, bool) else 40

    raw = _chain_blasts(symbol, date_str, lookback_min)
    # One alert per 30 s bucket: a run trips several samples.
    best: dict[tuple[str, str, int], dict] = {}
    for b in raw:
        key = (b["kind"], str(b.get("side") or ""), int(_epoch(str(b.get("t"))) // 30))
        if key not in best or abs(float(b["delta"])) > abs(float(best[key]["delta"])):
            best[key] = b
    blasts = sorted(best.values(), key=lambda b: str(b.get("t")))[-limit:]
    return {"date": date_str, "count": len(blasts),
            "lookback_min": lookback_min, "blasts": blasts}


# --- 5. replay dates -----------------------------------------------------------
@router.get("/{underlying}/replay/dates")
def get_options_replay_dates(
    underlying: str,
    limit: int = Query(default=15, ge=1, le=120),
) -> dict[str, Any]:
    """Dates that have a per-minute replay log for ``underlying``, newest first.

    Mirrors ``get_nifty_replay_dates``: empty files and non-date filenames are
    skipped, so a holiday resolves to the last session that actually recorded.
    """
    symbol = _symbol(underlying)
    limit = limit if isinstance(limit, int) and not isinstance(limit, bool) else 15
    directory = DATA_ROOT / SNAPSHOTS_DIR / symbol
    dates: list[str] = []
    try:
        paths = sorted(directory.glob("*.jsonl"), reverse=True)
    except OSError:
        paths = []
    for path in paths:
        try:
            datetime.strptime(path.stem, "%Y-%m-%d")
        except ValueError:
            continue
        try:
            if path.stat().st_size == 0:
                continue
        except OSError:
            continue
        dates.append(path.stem)
        if len(dates) >= limit:
            break
    return {"dates": dates, "latest": dates[0] if dates else None}


# --- 6. replay frames ----------------------------------------------------------
def _needs_analytics(report: Optional[dict]) -> bool:
    """True when a stored frame predates the analytics-carrying recorder.

    Frames written before the recorder called ``_attach_analytics`` carry only
    ``strikes/gex/positioning/intraday/emas/ohlc`` — the EOD report then shows
    ``—`` for VIX/control/regime/strength. A stored report that already has
    those blocks is returned as-is (no recompute, no extra I/O).
    """
    if not isinstance(report, dict):
        return True
    for key in ("vix", "control", "regime", "strength"):
        value = report.get(key)
        if not isinstance(value, dict) or not value:
            return True
    return False


async def _enrich_legacy_report(symbol: str, report: dict) -> dict:
    """Attach analytics to a legacy stored frame, never raising.

    Calls ``options_report._attach_analytics`` on a shallow copy with the
    frame's own ``intraday`` bars. Reads only this symbol's tape/daily/VIX —
    never any ``nifty_*`` directory.
    """
    try:
        from api.reports_api.options_report import (
            _attach_analytics as _enrich_report,
        )

        enriched = dict(report)
        intraday = enriched.get("intraday")
        await _enrich_report(
            symbol, enriched,
            intraday if isinstance(intraday, list) else [],
        )
        return enriched
    except Exception:
        return report
def _slim_report(report: Optional[dict]) -> Optional[dict]:
    """Project one stored frame the way NIFTY's ``_slim_replay_report`` does.

    NIFTY trims strikes to ±750 pts around spot because an index chain is
    ±30 strikes × 3. A stock's spot can be ~₹1,400, where a fixed 750-pt band
    is meaningless, so this projection drops only the derived ``emas`` block
    (recomputed from the frame, never read by the replay UI) and keeps the
    listed chain intact. Never mutates the stored payload; never raises.
    """
    if not isinstance(report, dict):
        return report
    try:
        out = dict(report)
        out.pop("emas", None)
        return out
    except Exception:
        return report


def _read_snapshots(symbol: str, date_str: str) -> list[dict]:
    """Replay frames for a day, ascending and de-duplicated by MINUTE."""
    rows = _read_jsonl(_path(SNAPSHOTS_DIR, symbol, date_str))
    rows = sorted(rows, key=lambda r: str(r.get("t") or ""))
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        minute = str(row.get("t") or "")[:16]
        if minute and minute in seen:
            continue
        if minute:
            seen.add(minute)
        out.append(row)
    return out


def _slimmed_snapshots(symbol: str, date_str: str) -> list[dict]:
    """Replay frames with the projection applied, cached per file mtime/size."""
    path = _path(SNAPSHOTS_DIR, symbol, date_str)
    try:
        st = path.stat() if path.exists() else None
        mtime = st.st_mtime if st else 0.0
        size = st.st_size if st else 0
    except OSError:
        mtime, size = 0.0, 0
    key = (symbol, date_str, str(path), mtime, size)
    cached = _SLIM_CACHE.get(key)
    if cached is not None:
        return cached
    rows = [
        {**s, "report": _slim_report(s.get("report"))}
        if isinstance(s.get("report"), dict) else s
        for s in _read_snapshots(symbol, date_str)
    ]
    # Bounded: a scrub across 15 symbols must not grow without limit.
    if len(_SLIM_CACHE) > 64:
        _SLIM_CACHE.clear()
    _SLIM_CACHE[key] = rows
    return rows


@router.get("/{underlying}/replay")
async def get_options_replay(
    underlying: str,
    date: str = Query(..., description="Replay date YYYY-MM-DD"),
    t: Optional[str] = Query(default=None, description=(
        "ISO minute; when given, returns the snapshot recorded at the last "
        "minute at or before ``t`` instead of the whole day")),
    meta: bool = Query(default=False, description=(
        "Return only the frame list (t + spot, no report bodies)")),
) -> dict[str, Any]:
    """Serve the day's per-minute FULL report snapshots (replay source).

    ``meta=1`` → ``{date, count, interval_sec, frames: [{t, spot}]}``;
    ``t`` → ``{date, snapshot}`` (``null`` when every frame is later);
    otherwise → ``{date, count, interval_sec, snapshots}``.
    A missing/empty log yields the 404 ``{is_trading_day: False}`` envelope.

    The ``t`` single frame is enriched on read when it predates the
    analytics-carrying recorder (legacy frames lack
    ``vix/control/regime/strength``); meta and the full-day list are served
    as stored.
    """
    symbol = _symbol(underlying)
    date_str = validate_date(date)
    snaps = _slimmed_snapshots(symbol, date_str)
    if not snaps:
        raise _missing(date_str, f"no {symbol} snapshots for {date_str}")

    want_meta = meta is True or (isinstance(meta, int) and not isinstance(meta, bool) and meta == 1)
    if want_meta:
        frames = [
            {"t": s.get("t"),
             "spot": _safe_float((s.get("report") or {}).get("spot"))}
            for s in snaps if isinstance(s, dict)
        ]
        return {"date": date_str, "count": len(frames),
                "interval_sec": TAPE_INTERVAL_SEC, "frames": frames}

    if t and isinstance(t, str):
        # FULL timestamps are compared: truncating to the minute made
        # "10:01:30" also select the 10:01:59 frame. Same-tz ISO strings sort
        # correctly as text; a space separator is normalised to "T".
        target = t.strip().replace(" ", "T")
        chosen: Optional[dict] = None
        for snap in snaps:
            snap_t = str(snap.get("t") or "")
            if snap_t and snap_t <= target:
                chosen = snap
        if (chosen is not None and isinstance(chosen.get("report"), dict)
                and _needs_analytics(chosen.get("report"))):
            enriched = await _enrich_legacy_report(symbol, chosen["report"])
            chosen = {**chosen, "report": enriched}
        return {"date": date_str, "snapshot": chosen}
    return {"date": date_str, "count": len(snaps),
            "interval_sec": TAPE_INTERVAL_SEC, "snapshots": snaps}


# --- 7. last snapshot ----------------------------------------------------------
@router.get("/{underlying}/snapshot")
async def get_options_snapshot(
    underlying: str,
    date: Optional[str] = Query(default=None, description="Snapshot date YYYY-MM-DD (default: today IST)"),
) -> dict[str, Any]:
    """The day's last saved snapshot report; 404 envelope when missing.

    A legacy stored report (no ``vix/control/regime/strength``) is enriched
    on read via ``options_report._attach_analytics``.
    """
    symbol = _symbol(underlying)
    date_str = validate_date(date if isinstance(date, str) and date else _today())
    data = _last_snapshot(symbol, date_str)
    if data is None:
        raise _missing(date_str, f"no {symbol} snapshot for {date_str}")
    if _needs_analytics(data):
        data = await _enrich_legacy_report(symbol, data)
    return data


# --- 8. recorder status --------------------------------------------------------
def _recorder_status() -> Optional[dict]:
    """The recorder's own status dict, or ``None`` when it is not available.

    Kept behind a seam so the endpoint still answers (tape fallback) when the
    recorder module is missing, broken or has not been imported yet.
    """
    try:
        from api.reports_api.options_recorder import status

        out = status()
        return out if isinstance(out, dict) else None
    except Exception:
        return None


@router.get("/{underlying}/tape/status")
def get_options_tape_status(underlying: str) -> dict[str, Any]:
    """Recorder heartbeat, or an honest read-only fallback from the tape.

    The recorder exposes ``status()``; when it cannot be imported the endpoint
    reports the newest tape row instead of a fabricated heartbeat (``None``
    when today has no rows). No task is started here — this module never owns
    a recorder.
    """
    symbol = _symbol(underlying)
    delegated = _recorder_status()
    if delegated is not None:
        return delegated

    date_str = _today()
    rows = _read_jsonl(_path(TAPE_DIR, symbol, date_str))
    last = rows[-1] if rows else None
    return {
        "date": date_str,
        "source": "tape-fallback",
        "rows": len(rows),
        "last_tick": (last or {}).get("t"),
    }
