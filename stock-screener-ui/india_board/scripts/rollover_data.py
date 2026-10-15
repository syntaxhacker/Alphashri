#!/usr/bin/env python3
"""Multi-expiry rollover + futures-basis tracker for the India board (W1c / F8).

Two related edges are measured here:

* **Rollover %** — how much open interest has migrated from the nearest expiry
  to the next one. ``rollover_pct = next_oi / (near_oi + next_oi)`` per side and
  per strike; a value above 0.5 means more OI already sits in the next series
  (``"rolling"``), otherwise the market is still ``"holding"`` the near series.
* **Futures basis** — the front-contract premium/discount to spot plus its
  annualised value, reused verbatim from :func:`fyers_data.build_futures` (the
  basis maths lives there; this module only maps its output).

Design notes
------------
* The pure helpers (:func:`rollover`, :func:`pcr_by_expiry`) take already-fetched
  chains so they are fully unit-testable without a network. Only
  :func:`rollover_series`, :func:`basis_snapshot`, :func:`scheduled_capture` and
  :func:`ensure_started` touch ``fyers_data`` (imported lazily so this module
  imports cleanly even while the data layer is being changed in parallel).
* Persistence is append-only JSONL, one file per IST calendar day::

      india_board/data/rollover/{YYYY-MM-DD}.jsonl

  one record per ticker per capture (see :func:`_capture_one` for the schema).
  Every disk helper is best-effort and never raises into a scheduler tick.
* Fyers pacing lives in ``fyers_data`` (its pacer); this module additionally
  estimates calls per ticker and stops a capture run well under the per-minute
  budget (:data:`MAX_CHAIN_CALLS`).
* The Fyers token is handled entirely inside ``fyers_data`` — this module never
  touches, prints, or logs credentials.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# Make sibling modules (``fyers_data`` / ``nse_universe``) importable both when
# this file is run directly and when imported as
# ``india_board.scripts.rollover_data``. Mirrors ``scan_data.py``.
sys.path.insert(0, str(Path(__file__).resolve().parent))

IST = ZoneInfo("Asia/Kolkata")

ROOT = Path(__file__).resolve().parent.parent
#: JSONL tree written by :func:`_append` / read by :func:`load`.
DATA_DIR = ROOT / "data" / "rollover"

#: Day files older than this are pruned at startup / on demand.
KEEP_DAYS = 180

#: Default scheduler interval (seconds). ``ROLLOVER_INTERVAL_SEC`` overrides.
_DEFAULT_INTERVAL = 1800
#: Scheduler tick — short sleeps keep the 15:20 post-close capture prompt.
_SCHED_TICK = 10
#: Small gap between tickers inside one capture run (the rest of the pacing is
#: handled by the ``fyers_data`` token bucket).
_GAP_SEC = 0.35
#: Hard ceiling on estimated Fyers calls per :func:`scheduled_capture` run.
MAX_CHAIN_CALLS = 40
#: Conservative estimate per ticker: list_expiries + near chain + next chain +
#: futures chain. The real count is often lower thanks to the data-layer cache.
_CALLS_PER_TICKER = 4

#: Scheduler state (guarded by the GIL; only mutated from the daemon loop and
#: :func:`_run_due_capture`).
_STARTED = False
_LAST_CAPTURE_TS = 0.0
_POST_1520_DATE: str | None = None
#: Rotating cursor so repeated budget-capped runs eventually cover the universe.
_CAPTURE_CURSOR = 0


def _num(v, default: float = 0.0) -> float:
    """Best-effort float (``None``/junk -> ``default``)."""
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _env_interval() -> float:
    """Capture interval in seconds, honouring ``ROLLOVER_INTERVAL_SEC``.

    Read on every call so a test/env override needs no re-import; malformed or
    missing values fall back to :data:`_DEFAULT_INTERVAL` instead of raising.
    """
    try:
        return float(os.environ.get("ROLLOVER_INTERVAL_SEC", _DEFAULT_INTERVAL))
    except (TypeError, ValueError):
        return float(_DEFAULT_INTERVAL)


#: Snapshot of the interval at import time (the loop re-reads it each cycle).
ROLLOVER_INTERVAL_SEC = _env_interval()


# ---------------------------------------------------------------------------
# Date / expiry helpers (pure)
# ---------------------------------------------------------------------------

_EXPIRY_FORMATS = ("%d-%m-%Y", "%Y-%m-%d", "%d-%b-%Y", "%Y%m%d")


def _parse_expiry(value) -> date | None:
    """Parse a Fyers expiry (``DD-MM-YYYY`` | ISO | epoch) to a date, else None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(int(value), tz=IST).date()
        except (ValueError, OSError, OverflowError):
            return None
    s = str(value).strip()
    if not s:
        return None
    for fmt in _EXPIRY_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    if s.isdigit():
        try:
            return datetime.fromtimestamp(int(s), tz=IST).date()
        except (ValueError, OSError, OverflowError):
            return None
    return None


def _reference_date(chain: dict) -> date:
    """The IST date an expiry's DTE is measured from (``as_of`` else today)."""
    ref = _parse_expiry((chain or {}).get("as_of"))
    return ref or datetime.now(IST).date()


def _dte(expiry, ref_date: date | None) -> int | None:
    """Whole days from ``ref_date`` to ``expiry`` (never negative), else None."""
    exp = _parse_expiry(expiry)
    if exp is None or ref_date is None:
        return None
    return max(0, (exp - ref_date).days)


def _side_totals(chain: dict) -> tuple[float, float]:
    """``(call_oi, put_oi)`` for a chain — top-level totals, else strike sum."""
    chain = chain if isinstance(chain, dict) else {}
    strikes = chain.get("strikes") or []
    call = _num(chain.get("call_oi")) or sum(
        _num(r.get("ce_oi")) for r in strikes if isinstance(r, dict)
    )
    put = _num(chain.get("put_oi")) or sum(
        _num(r.get("pe_oi")) for r in strikes if isinstance(r, dict)
    )
    return call, put


def _rollover_ratio(next_oi: float, near_oi: float) -> float | None:
    """``next / (near + next)``; ``None`` when there is no OI on either side."""
    denom = _num(near_oi) + _num(next_oi)
    if denom <= 0:
        return None
    return _num(next_oi) / denom


def _strike_map(chain: dict) -> dict[float, dict]:
    """``{strike: row}`` for a chain, ignoring malformed/non-positive strikes."""
    out: dict[float, dict] = {}
    for row in (chain or {}).get("strikes") or []:
        if not isinstance(row, dict):
            continue
        k = _num(row.get("strike"), default=float("nan"))
        if k != k or k <= 0:  # NaN or non-positive
            continue
        out[k] = row
    return out


def _per_strike(near_chain: dict, next_chain: dict) -> list[dict]:
    """Per-strike rollover over the union of both expiries' strikes."""
    near_map = _strike_map(near_chain)
    next_map = _strike_map(next_chain)
    rows: list[dict] = []
    for strike in sorted(set(near_map) | set(next_map)):
        n = near_map.get(strike) or {}
        x = next_map.get(strike) or {}
        n_ce, n_pe = _num(n.get("ce_oi")), _num(n.get("pe_oi"))
        x_ce, x_pe = _num(x.get("ce_oi")), _num(x.get("pe_oi"))
        n_oi, x_oi = n_ce + n_pe, x_ce + x_pe
        rows.append(
            {
                "strike": strike,
                "near_call_oi": n_ce,
                "near_put_oi": n_pe,
                "near_oi": n_oi,
                "next_call_oi": x_ce,
                "next_put_oi": x_pe,
                "next_oi": x_oi,
                "rollover_pct": _rollover_ratio(x_oi, n_oi),
                "rollover_pct_call": _rollover_ratio(x_ce, n_ce),
                "rollover_pct_put": _rollover_ratio(x_pe, n_pe),
                "oi_shift": x_oi - n_oi,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Core: rollover across the nearest two expiries (pure)
# ---------------------------------------------------------------------------

def rollover(ticker: str, near_chain: dict, next_chain: dict) -> dict:
    """Rollover between the nearest (``near_chain``) and next expiry.

    Both inputs are :func:`fyers_data.get_chain` payloads. Returns total and
    per-strike near/next OI, the rollover split by side, the OI shift
    (``next - near``, i.e. positioning moving out), and a classification of
    ``"rolling"`` when total ``rollover_pct > 0.5`` else ``"holding"``.
    ``rollover_pct`` is ``None`` when the denominator is zero.
    """
    t = str(ticker or "").upper().strip()
    near_chain = near_chain if isinstance(near_chain, dict) else {}
    next_chain = next_chain if isinstance(next_chain, dict) else {}

    near_call, near_put = _side_totals(near_chain)
    next_call, next_put = _side_totals(next_chain)
    near_oi, next_oi = near_call + near_put, next_call + next_put

    pct = _rollover_ratio(next_oi, near_oi)
    ref = _reference_date(near_chain)
    return {
        "ticker": t,
        "near_expiry": near_chain.get("expiry"),
        "next_expiry": next_chain.get("expiry"),
        "near_expiry_flag": near_chain.get("expiry_flag"),
        "next_expiry_flag": next_chain.get("expiry_flag"),
        "near_dte": _dte(near_chain.get("expiry"), ref),
        "next_dte": _dte(next_chain.get("expiry"), ref),
        "near_oi": near_oi,
        "next_oi": next_oi,
        "near_call_oi": near_call,
        "near_put_oi": near_put,
        "next_call_oi": next_call,
        "next_put_oi": next_put,
        "rollover_pct": pct,
        "rollover_pct_call": _rollover_ratio(next_call, near_call),
        "rollover_pct_put": _rollover_ratio(next_put, near_put),
        "oi_shift": next_oi - near_oi,
        "oi_shift_call": next_call - near_call,
        "oi_shift_put": next_put - near_put,
        "classification": "rolling" if (pct is not None and pct > 0.5) else "holding",
        "strikes": _per_strike(near_chain, next_chain),
    }


# ---------------------------------------------------------------------------
# PCR term structure (pure)
# ---------------------------------------------------------------------------

def pcr_by_expiry(chains_by_expiry) -> dict:
    """Total CE/PE OI and PCR per expiry (term structure of PCR).

    ``chains_by_expiry`` may be a ``{expiry: chain}`` mapping or an iterable of
    chain payloads (the expiry is then read off each chain). Malformed entries
    are skipped. Returns ``{expiry: {expiry, call_oi, put_oi, pcr, expiry_flag}}``
    with ``pcr = put_oi / call_oi`` (``None`` when call OI is zero).
    """
    if isinstance(chains_by_expiry, dict):
        items = list(chains_by_expiry.items())
    else:
        items = [
            ((c or {}).get("expiry") if isinstance(c, dict) else None, c)
            for c in (chains_by_expiry or [])
        ]

    out: dict[str, dict] = {}
    for expiry, chain in items:
        if not isinstance(chain, dict):
            continue
        key = expiry or chain.get("expiry")
        if not key:
            continue
        call_oi, put_oi = _side_totals(chain)
        out[str(key)] = {
            "expiry": str(key),
            "call_oi": call_oi,
            "put_oi": put_oi,
            "pcr": (put_oi / call_oi) if call_oi else None,
            "expiry_flag": chain.get("expiry_flag"),
        }
    return out


# ---------------------------------------------------------------------------
# Network wrappers (lazy ``fyers_data`` import; never raise outward)
# ---------------------------------------------------------------------------

def _meta_get(meta, key):
    """Safe lookup on a ``list_expiries`` entry (returns None for non-dicts)."""
    return meta.get(key) if isinstance(meta, dict) else None


def _ensure_expiry_meta(chain: dict, meta: dict) -> dict:
    """Backfill ``expiry`` / ``expiry_flag`` from a ``list_expiries`` entry."""
    if not isinstance(chain, dict):
        return chain
    if not chain.get("expiry"):
        chain["expiry"] = _meta_get(meta, "date") or _meta_get(meta, "expiry")
    if not chain.get("expiry_flag"):
        chain["expiry_flag"] = _meta_get(meta, "expiry_flag")
    return chain


def rollover_series(ticker: str) -> dict:
    """Fetch the nearest two expiries and compute their rollover.

    This is the only rollover function that touches the network. Any failure
    (missing expiries, token expiry, rate limit) is caught and returned as
    ``{"ticker": ..., "unavailable": True, "reason": ...}`` — never raised.
    """
    t = str(ticker or "").upper().strip()
    if not t:
        return {"ticker": t, "unavailable": True, "reason": "empty ticker"}
    try:
        import fyers_data  # noqa: PLC0415  (lazy: parallel-edited data layer)

        expiries = list(fyers_data.list_expiries(t) or [])
    except Exception as exc:  # noqa: BLE001
        return {"ticker": t, "unavailable": True,
                "reason": f"{type(exc).__name__}: {exc}"[:200]}
    if len(expiries) < 2:
        return {"ticker": t, "unavailable": True,
                "reason": f"need >=2 expiries, got {len(expiries)}"}

    near_meta, next_meta = expiries[0], expiries[1]
    try:
        near = fyers_data.get_chain(t, expiry_epoch=_meta_get(near_meta, "expiry"))
        nxt = fyers_data.get_chain(t, expiry_epoch=_meta_get(next_meta, "expiry"))
    except Exception as exc:  # noqa: BLE001
        return {"ticker": t, "unavailable": True,
                "reason": f"{type(exc).__name__}: {exc}"[:200]}

    near = _ensure_expiry_meta(near, near_meta)
    nxt = _ensure_expiry_meta(nxt, next_meta)
    out = rollover(t, near, nxt)
    out["spot"] = (near or {}).get("spot")
    out["as_of"] = (near or {}).get("as_of")
    out["expiries"] = [_meta_get(m, "date") or _meta_get(m, "expiry") for m in expiries]
    near_key = str(_meta_get(near_meta, "date") or (near or {}).get("expiry"))
    next_key = str(_meta_get(next_meta, "date") or (nxt or {}).get("expiry"))
    out["pcr_by_expiry"] = pcr_by_expiry({near_key: near, next_key: nxt})
    out["unavailable"] = False
    return out


def basis_snapshot(ticker: str) -> dict:
    """Front-contract basis for one ticker, mapped from ``build_futures``.

    Reuses :func:`fyers_data.build_futures` (which owns all basis maths) and
    surfaces only the nearest contract:

        {"ticker", "spot", "near": {"expiry", "price", "basis",
         "annualized_basis", "dte"}, "ts", "as_of"}

    Never raises; failures yield ``unavailable: True`` with ``near: None``.
    """
    t = str(ticker or "").upper().strip()
    ts = datetime.now(IST).isoformat()
    try:
        import fyers_data  # noqa: PLC0415  (lazy: parallel-edited data layer)

        payload = fyers_data.build_futures(t) or {}
    except Exception as exc:  # noqa: BLE001
        return {"ticker": t, "spot": None, "near": None, "ts": ts,
                "unavailable": True, "reason": f"{type(exc).__name__}: {exc}"[:200]}

    if not isinstance(payload, dict):
        payload = {}
    futures = payload.get("futures") or []
    front = next((f for f in futures if isinstance(f, dict)), None)
    near = None
    if front is not None:
        near = {
            "expiry": front.get("expiry"),
            "price": front.get("price"),
            "basis": front.get("basis"),
            "annualized_basis": front.get("annualized_basis"),
            "dte": front.get("dte"),
        }
    return {
        "ticker": t,
        "spot": payload.get("spot"),
        "near": near,
        "ts": ts,
        "as_of": payload.get("as_of"),
        "unavailable": False,
    }


# ---------------------------------------------------------------------------
# Persistence — append-only JSONL, one file per IST day. Best-effort only.
# ---------------------------------------------------------------------------


def _day_path(date_str: str, root: Path | str | None = None) -> Path:
    """``{root}/{date_str}.jsonl`` (root defaults to :data:`DATA_DIR`)."""
    base = Path(root) if root is not None else DATA_DIR
    return base / f"{date_str}.jsonl"


def _record_date(record: dict) -> str:
    """IST calendar date (``YYYY-MM-DD``) a record belongs to, from its ``ts``."""
    try:
        dt = datetime.fromisoformat(str((record or {}).get("ts") or ""))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        else:
            dt = dt.astimezone(IST)
        return dt.date().isoformat()
    except (TypeError, ValueError):
        return datetime.now(IST).date().isoformat()


def _append(record: dict, root: Path | str | None = None) -> bool:
    """Append one record as a JSONL line (single write, fsync best-effort).

    Returns success and never raises — a full/read-only disk logs briefly.
    """
    try:
        dest = _day_path(_record_date(record), root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, separators=(",", ":"), default=str)
        with open(dest, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[rollover] persist failed: {type(exc).__name__}: {exc}"[:160], flush=True)
        return False


#: Public alias — the documented persistence entry point.
def persist(record: dict, root: Path | str | None = None) -> bool:
    """Persist one capture record (see :func:`_append`)."""
    return _append(record, root=root)


def _read_day(path: Path) -> list[dict]:
    """Parse one JSONL file, skipping blank/malformed lines (never raises)."""
    records: list[dict] = []
    try:
        if not path.is_file():
            return records
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception as exc:  # noqa: BLE001
        print(f"[rollover] load failed: {type(exc).__name__}", flush=True)
        return records
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue  # malformed line — skip, don't crash
        if isinstance(obj, dict) and obj.get("ts"):
            records.append(obj)
    return records


def load(root: Path | str | None = None, date_str: str | None = None) -> list[dict]:
    """Records stored for one IST day (default: today), sorted by ``ts``."""
    day = date_str or datetime.now(IST).date().isoformat()
    records = _read_day(_day_path(day, root))
    records.sort(key=lambda r: str(r.get("ts") or ""))
    return records


def history(
    ticker: str | None = None,
    root: Path | str | None = None,
    date_str: str | None = None,
    days: int | None = None,
) -> list[dict]:
    """All persisted records (oldest first), optionally filtered by ticker.

    With ``date_str`` only that day is read; otherwise every ``*.jsonl`` file is
    scanned (``days`` caps it to the most recent N day files).
    """
    base = Path(root) if root is not None else DATA_DIR
    if date_str:
        files = [_day_path(date_str, root)]
    else:
        try:
            files = sorted(base.glob("*.jsonl"))
        except OSError:
            files = []
        if days is not None and days >= 0:
            files = files[-days:] if days else []
    records: list[dict] = []
    for path in files:
        records.extend(_read_day(path))
    if ticker:
        t = str(ticker).upper().strip()
        records = [r for r in records if str(r.get("ticker") or "").upper() == t]
    records.sort(key=lambda r: str(r.get("ts") or ""))
    return records


def prune(
    root: Path | str | None = None,
    keep_days: int = KEEP_DAYS,
    today: date | None = None,
) -> int:
    """Delete ``{root}/*.jsonl`` older than ``keep_days`` days.

    Best-effort: returns the number of files removed and never raises.
    """
    base = Path(root) if root is not None else DATA_DIR
    removed = 0
    try:
        cutoff = (today or datetime.now(IST).date()) - timedelta(days=keep_days)
        for f in base.glob("*.jsonl"):
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


# ---------------------------------------------------------------------------
# Scheduled capture
# ---------------------------------------------------------------------------


def _lot_size(under: str) -> int | None:
    """Contract lot size from an *already cached* NSE master, else None.

    Never downloads: if the local master cache is stale/missing this returns
    None rather than triggering an 85 MB fetch inside a scheduler tick.
    """
    try:
        import nse_universe  # noqa: PLC0415

        if getattr(nse_universe, "_master", None) is None:
            if not nse_universe._cache_fresh():  # type: ignore[attr-defined]
                return None
            nse_universe.load_master()  # parses the local cache only when fresh
        return nse_universe.lot_size(under)
    except Exception:  # noqa: BLE001
        return None


def _capture_one(ticker: str) -> dict:
    """Build one persisted record for a ticker (rollover + basis).

    Persisted schema (one JSON object per ticker per capture)::

        {
          "ts":               "<IST ISO timestamp>",     # record date key
          "ticker":           "NIFTY",
          "spot":             <float>|<null>,
          "lot_size":         <int>|<null>,
          "basis":    <basis_snapshot()> | null,          # see basis_snapshot
          "rollover": <rollover_series()> | null          # see rollover_series
        }

    ``basis`` / ``rollover`` carry their own ``unavailable``/``reason`` fields
    when a fetch failed, so a captured record always deserialises.
    """
    t = str(ticker or "").upper().strip()
    roll = rollover_series(t)
    basis = basis_snapshot(t)
    spot = None
    if isinstance(basis, dict) and basis.get("spot") is not None:
        spot = basis.get("spot")
    elif isinstance(roll, dict):
        spot = roll.get("spot")
    return {
        "ts": datetime.now(IST).isoformat(),
        "ticker": t,
        "spot": spot,
        "lot_size": _lot_size(t),
        "basis": basis,
        "rollover": roll,
    }


def _default_tickers() -> list[str]:
    """Indices + the 20 liquid names from the Fyers universe (indices first)."""
    try:
        import fyers_data  # noqa: PLC0415

        return [str(t) for t in fyers_data.UNIVERSE]
    except Exception:  # noqa: BLE001  (data layer unavailable -> indices only)
        return ["NIFTY", "BANKNIFTY"]


def scheduled_capture(
    tickers: list[str] | None = None,
    *,
    max_calls: int = MAX_CHAIN_CALLS,
) -> dict:
    """Capture basis + rollover for ``tickers`` and persist one record each.

    Defaults to indices + the 20 liquid names in ``fyers_data.UNIVERSE``.
    Sequential with a small sleep, and capped by ``max_calls`` estimated Fyers
    calls so a run stays well under the per-minute budget; when the default
    universe is used the cursor rotates so successive runs cover all names.

    Returns ``{ts, count, calls_estimated, universe, cursor, records}``.
    """
    explicit = tickers is not None
    global _CAPTURE_CURSOR
    work = [str(t).upper().strip() for t in (tickers if explicit else _default_tickers()) if t]
    now_iso = datetime.now(IST).isoformat()
    if not work:
        return {"ts": now_iso, "count": 0, "calls_estimated": 0,
                "universe": 0, "cursor": _CAPTURE_CURSOR, "records": []}

    start = 0
    if not explicit:
        start = _CAPTURE_CURSOR % len(work)
        work = work[start:] + work[:start]

    budget = max(1, int(max_calls))
    budget_tickers = max(1, budget // _CALLS_PER_TICKER)
    records: list[dict] = []
    calls = 0
    for i, t in enumerate(work):
        if i >= budget_tickers or calls + _CALLS_PER_TICKER > budget:
            break
        try:
            record = _capture_one(t)
        except Exception as exc:  # noqa: BLE001  (one bad ticker never aborts)
            print(f"[rollover] capture failed for {t}: {type(exc).__name__}"[:160],
                  flush=True)
            continue
        calls += _CALLS_PER_TICKER
        persist(record)
        records.append(record)
        _CAPTURE_CURSOR = (start + i + 1) % len(work)
        time.sleep(_GAP_SEC)

    print(f"[rollover] captured {len(records)}/{len(work)} ticker(s) "
          f"(~{calls} calls, budget {budget})", flush=True)
    return {"ts": now_iso, "count": len(records), "calls_estimated": calls,
            "universe": len(work), "cursor": _CAPTURE_CURSOR, "records": records}


# ---------------------------------------------------------------------------
# Scheduler — capture on an interval during market hours only, plus one
# post-15:20 capture so a late-starting process still records the day.
# ---------------------------------------------------------------------------


def _is_market_open(now: datetime | None = None) -> bool:
    """True during Mon-Fri 09:15-15:30 IST (local copy, no extra imports)."""
    cur = now or datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)
    if cur.weekday() >= 5:  # Sat / Sun
        return False
    mins = cur.hour * 60 + cur.minute
    return 9 * 60 + 15 <= mins <= 15 * 60 + 30


def _is_post_1520(cur: datetime) -> bool:
    """True at/after 15:20 IST (the guaranteed end-of-day capture point)."""
    return (cur.hour, cur.minute) >= (15, 20)


def _run_due_capture(now: datetime | None = None) -> bool:
    """Run one capture if due; returns True when a capture was attempted.

    Due when market is open and either the interval has elapsed since the last
    capture, or it is at/after 15:20 and no post-15:20 capture has happened
    today. Blocking, so ticks cannot overlap.
    """
    cur = now or datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)

    global _LAST_CAPTURE_TS, _POST_1520_DATE
    today = cur.date().isoformat()
    late = _is_post_1520(cur) and cur.weekday() < 5 and _POST_1520_DATE != today
    if not _is_market_open(cur):
        # Outside the session only the single post-15:20 archival capture may
        # still run for today — this is what records the day when the process
        # starts (or restarts) after the 15:30 close.
        if not late:
            return False

    interval = _env_interval()
    due_interval = _LAST_CAPTURE_TS <= 0 or (cur.timestamp() - _LAST_CAPTURE_TS) >= interval
    due_late = late
    if due_late:
        # A restart after 15:20 must not re-archive the day: if today's file
        # already holds a post-15:20 capture, mark it done and skip.
        try:
            from datetime import time as _time  # noqa: PLC0415

            cutoff = datetime.combine(cur.date(), _time(15, 20), tzinfo=IST)
            for rec in history(date_str=today):
                ts_raw = rec.get("ts") if isinstance(rec, dict) else None
                if not ts_raw:
                    continue
                seen = datetime.fromisoformat(str(ts_raw))
                if seen.tzinfo is None:
                    seen = seen.replace(tzinfo=IST)
                if seen >= cutoff:
                    _POST_1520_DATE = today
                    return False
        except Exception:  # noqa: BLE001  (never block the loop on a read issue)
            pass
    if not (due_interval or due_late):
        return False

    try:
        # Deliberate archival (EOD + the one post-15:20 capture). The pacer
        # blocks off-hours calls by default, so this path opts in explicitly.
        import fyers_pacer  # noqa: PLC0415

        with fyers_pacer.allow_offhours("rollover-post-1520"):
            result = scheduled_capture()
    except Exception as exc:  # noqa: BLE001  (never kill the loop)
        print(f"[rollover] capture error: {type(exc).__name__}: {exc}"[:160], flush=True)
        _LAST_CAPTURE_TS = cur.timestamp()
        return False

    _LAST_CAPTURE_TS = cur.timestamp()
    if _is_post_1520(cur):
        _POST_1520_DATE = today
    print(f"[rollover] cycle done: {result.get('count', 0)} record(s) @ "
          f"{cur.strftime('%H:%M')}", flush=True)
    return True


def _loop() -> None:
    print(f"[rollover] scheduler started (interval {_env_interval():.0f}s, "
          f"tick {_SCHED_TICK}s)", flush=True)
    while True:
        try:
            _run_due_capture()
        except Exception as exc:  # noqa: BLE001  (never kill the loop)
            print(f"[rollover] scheduler error: {type(exc).__name__}: {exc}"[:160],
                  flush=True)
        time.sleep(_SCHED_TICK)


def ensure_started() -> None:
    """Prune old day files and start the capture scheduler once (idempotent).

    The scheduler is a daemon thread and never raises. Extra calls are no-ops.
    """
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    try:
        removed = prune()
        if removed:
            print(f"[rollover] pruned {removed} file(s) older than {KEEP_DAYS}d",
                  flush=True)
    except Exception:  # noqa: BLE001  (retention is best-effort)
        pass
    threading.Thread(target=_loop, name="rollover-scheduler", daemon=True).start()


if __name__ == "__main__":  # pragma: no cover — manual smoke, no server
    import json

    if len(sys.argv) > 1 and sys.argv[1] not in ("__capture__",):
        print(json.dumps(rollover_series(sys.argv[1]),
                         indent=2, default=str)[:2000])
    else:
        out = scheduled_capture()
        out["records"] = out["records"][:3]
        print(json.dumps(out, indent=2, default=str)[:3000])
