#!/usr/bin/env python3
"""Tiered freshness for the India board — a "hot list" refreshed in seconds (W4a).

The full 210-name scan runs every ~5 min (``scan_data``). That is too slow for
the names that are actually moving, so this module keeps a small **hot list**
of the most interesting underlyings and refreshes their option chains on a
much shorter cadence (default **45 s**), well inside the shared Fyers pacer
budget (``fyers_pacer``: 8/s, 180/min, daily cap).

Design (see ``docs/EDGE_ROADMAP.md`` §3.2)::

    full sweep       ~5 min  (unchanged, scan_data)
    hot list        30-60 s  (this module; top ~20 + indices)
    everything under the pacing caps

Score & select
--------------
:func:`build_hotlist` unions four candidate sources:

* **(a) tape** — top rows by window ``premium`` (``sections.tape``);
* **(b) opportunities** — top rows by burst ``score`` (``sections.opportunities``);
* **(c) wall shift** — largest ``|ΔOI|`` derived from ``sections.rows``
  ``top_call.oich`` / ``top_put.oich`` plus the ``oi_change`` on tape /
  opportunities rows when present;
* **(d) signals** — names carrying today's logged signals (``signals_today``,
  injectable; defaults to ``signal_log.read_signals()``).

**NIFTY** and **BANKNIFTY** are always included (indices are never counted
against ``limit``).

Each name is scored by a documented weighted sum of **rank-derived** signals::

    score = 3.0 * (1 / premium_rank)      # W_PREMIUM
          + 3.0 * (1 / burst_rank)        # W_BURST
          + 2.0 * (1 / doi_rank)          # W_DOI
          + 1.0 * min(signal_count, 5)    # W_SIGNAL

A missing signal contributes 0; rank 1 = strongest. Ties break on ticker name
(A→Z) so a given scan always produces the same list. The result is JSON-safe
(no NaN/Inf) and deterministic.

Fast refresh
------------
:func:`refresh_once` fetches a **light** chain per hot ticker
(``strikecount=10``, ``greeks=False``) sequentially, capped per run by
``HOTLIST_MAX_CALLS`` (default 24) and skipped entirely when the pacer's
remaining daily budget is below ``HOTLIST_BUDGET_RESERVE``. One compact record
per ticker is appended to::

    india_board/data/hotlist/{YYYY-MM-DD}.jsonl

Record schema (one JSON object per line)::

    {
      "ts":          "<IST ISO-8601>",
      "ticker":      "RELIANCE",
      "spot":        <float>|<null>,
      "pcr":         <float>|<null>,     # put_oi / call_oi
      "top_call":    {"strike": <float>|<null>, "oi": <float>|<null>} | null,
      "top_put":     {"strike": <float>|<null>, "oi": <float>|<null>} | null,
      "oich_total":  <float>,            # sum(ce_oich + pe_oich)
      "atm_strike":  <float>|<null>
    }

Scheduler
---------
:func:`ensure_started` starts one daemon thread that, during market hours
(Mon-Fri 09:15-15:30 IST), rebuilds the (cached) hot list and refreshes it on
``HOTLIST_INTERVAL_SEC`` (default 45 s, floor 20 s). It never triggers a scan
and never raises. A cycle logs one line::

    [hotlist] cycle: 18 ok / 0 failed, calls=18, interval=45s, next=15:04:33

Persistence mirrors ``oi_tracker``: best-effort append-only JSONL, malformed
lines skipped on load, day files older than ``KEEP_DAYS`` pruned. Every disk
helper takes an overridable ``root=``.

Token hygiene: the Fyers token is only ever touched inside ``fyers_data`` —
this module never prints or logs credentials.
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

# Make sibling modules (``fyers_data`` / ``scan_data``) importable both when
# run directly and when imported as ``india_board.scripts.hotlist_data``.
sys.path.insert(0, str(Path(__file__).resolve().parent))

IST = ZoneInfo("Asia/Kolkata")

ROOT = Path(__file__).resolve().parent.parent
#: JSONL tree written by :func:`_append` / read by :func:`history`.
DATA_DIR = ROOT / "data" / "hotlist"

#: Indices are always present and never counted against ``limit``.
_INDICES: tuple[str, ...] = ("NIFTY", "BANKNIFTY")

#: Day files older than this are pruned at startup / on demand.
KEEP_DAYS = 30

#: Light chain shape for a hot refresh: few strikes, no greeks.
HOTLIST_STRIKECOUNT = 10

#: Scheduler tick — short sleeps keep cycles prompt.
_SCHED_TICK = 10
#: Refuse (clamp) an interval below this many seconds.
_MIN_INTERVAL = 20
#: Default hot-list size (excluding indices). ``HOTLIST_LIMIT`` overrides.
_DEFAULT_LIMIT = 20
#: Default inter-cycle interval (seconds). ``HOTLIST_INTERVAL_SEC`` overrides.
_DEFAULT_INTERVAL = 45
#: Default hard cap on Fyers chain calls inside one :func:`refresh_once`.
_DEFAULT_MAX_CALLS = 24
#: Default daily-budget headroom: stop refreshing below this many requests left.
_DEFAULT_BUDGET_RESERVE = 2000

#: Documented score weights (premium / burst / |ΔOI| / signal count).
WEIGHTS: dict[str, float] = {
    "premium": 3.0,
    "burst": 3.0,
    "doi": 2.0,
    "signal": 1.0,
}
#: Signal-count contribution is capped so one heavily-logged name cannot dominate.
SIGNAL_CAP = 5

#: Scheduler state.
_STARTED = False
_LAST_CYCLE_TS = 0.0


# ---------------------------------------------------------------------------
# Env helpers
# ---------------------------------------------------------------------------
def _env_int(name: str, default: int) -> int:
    """Positive int from ``name``; malformed/absent/non-positive -> default."""
    try:
        val = int(str(os.environ.get(name, "")).strip())
        return val if val > 0 else default
    except (TypeError, ValueError):
        return default


def _env_limit() -> int:
    """Hot-list size, honouring ``HOTLIST_LIMIT`` (read live, default 20)."""
    return _env_int("HOTLIST_LIMIT", _DEFAULT_LIMIT)


def _env_interval() -> float:
    """Interval in seconds, honouring ``HOTLIST_INTERVAL_SEC``.

    Read on every call so an override needs no re-import. Values below the
    :data:`_MIN_INTERVAL` floor are clamped (with a warning); malformed values
    fall back to :data:`_DEFAULT_INTERVAL`.
    """
    try:
        raw = float(os.environ.get("HOTLIST_INTERVAL_SEC", _DEFAULT_INTERVAL))
    except (TypeError, ValueError):
        return float(_DEFAULT_INTERVAL)
    if raw != raw:  # NaN
        return float(_DEFAULT_INTERVAL)
    if raw < _MIN_INTERVAL:
        print(
            f"[hotlist] HOTLIST_INTERVAL_SEC={raw:g} below floor; "
            f"clamping to {_MIN_INTERVAL}s",
            flush=True,
        )
        return float(_MIN_INTERVAL)
    return raw


#: Import-time snapshots (the scheduler re-reads via the helpers each cycle).
HOTLIST_LIMIT = _env_limit()
HOTLIST_INTERVAL_SEC = _env_interval()
HOTLIST_MAX_CALLS = _env_int("HOTLIST_MAX_CALLS", _DEFAULT_MAX_CALLS)
HOTLIST_BUDGET_RESERVE = _env_int("HOTLIST_BUDGET_RESERVE", _DEFAULT_BUDGET_RESERVE)


# ---------------------------------------------------------------------------
# coercion / sanitising
# ---------------------------------------------------------------------------
def _num_opt(v) -> float | None:
    """Finite float or ``None`` (never fabricates a value for junk/NaN/Inf)."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _num(v, default: float = 0.0) -> float:
    """Best-effort float (``None``/junk -> ``default``)."""
    out = _num_opt(v)
    return default if out is None else out


def _clean(value):
    """Recursively replace non-finite floats with ``None`` (JSON safety)."""
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return None
    return value


def _norm(ticker) -> str:
    """Normalise a ticker to ``UPPER`` or ``""``."""
    if not isinstance(ticker, str):
        return ""
    return ticker.upper().strip()


def _norm_list(tickers) -> list[str]:
    """Normalised, de-duplicated ticker list preserving input order."""
    out: list[str] = []
    seen: set[str] = set()
    for t in tickers or []:
        n = _norm(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


# ---------------------------------------------------------------------------
# Candidate extraction (pure over an already-fetched scan payload)
# ---------------------------------------------------------------------------
def _scan_payload(scan=None) -> dict:
    """Resolve the scan payload without ever triggering a fresh scan.

    An explicit ``scan`` is returned as-is. Otherwise the cached payload is
    used, falling back to a **disk** hydrate (never a network fetch).
    """
    if scan is not None:
        return scan if isinstance(scan, dict) else {}
    try:
        import scan_data  # noqa: PLC0415

        payload = (getattr(scan_data, "_CACHE", {}) or {}).get("payload")
        if isinstance(payload, dict) and payload:
            return payload
        # Cold start: restore last-good from disk only (no fetch is kicked).
        restored = scan_data._hydrate()  # type: ignore[attr-defined]
        if isinstance(restored, dict):
            return restored
    except Exception:  # noqa: BLE001  (module missing / mid-edit)
        pass
    return {}


def _section_rows(section) -> list[dict]:
    """``section['rows']`` as dicts (missing/malformed -> ``[]``)."""
    if isinstance(section, dict):
        rows = section.get("rows")
        if isinstance(rows, list):
            return [r for r in rows if isinstance(r, dict)]
    return []


def _max_map(rows: list[dict], key: str, *, absolute: bool = False) -> dict[str, float]:
    """Per-ticker max of a numeric row field (``absolute`` -> ``|value|``)."""
    out: dict[str, float] = {}
    for row in rows:
        t = _norm(row.get("ticker"))
        if not t:
            continue
        v = _num_opt(row.get(key))
        if v is None:
            continue
        if absolute:
            v = abs(v)
        if t not in out or v > out[t]:
            out[t] = v
    return out


def _merge_max(target: dict[str, float], extra: dict[str, float]) -> dict[str, float]:
    """Merge ``extra`` into ``target`` keeping the max per key; returns target."""
    for t, v in extra.items():
        if t not in target or v > target[t]:
            target[t] = v
    return target


def _doi_from_rows(rows: list[dict]) -> dict[str, float]:
    """Per-ticker wall shift ``max(|top_call.oich|, |top_put.oich|)``."""
    out: dict[str, float] = {}
    for row in rows:
        t = _norm(row.get("ticker"))
        if not t:
            continue
        best: float | None = None
        for key in ("top_call", "top_put"):
            block = row.get(key)
            if not isinstance(block, dict):
                continue
            v = _num_opt(block.get("oich"))
            if v is None:
                continue
            a = abs(v)
            best = a if best is None else max(best, a)
        if best is not None and (t not in out or best > out[t]):
            out[t] = best
    return out


def _signal_counts(signals_today=None) -> dict[str, int]:
    """Per-ticker count of today's logged signals.

    ``signals_today`` may be ``None`` (read today's ``signal_log`` archive), a
    callable returning records, an iterable of records/strings, or a mapping
    ``{ticker: count | list | record}``. Any failure yields ``{}``.
    """
    if signals_today is None:
        try:
            import signal_log  # noqa: PLC0415

            data = signal_log.read_signals()
        except Exception:  # noqa: BLE001
            return {}
    elif callable(signals_today):
        try:
            data = signals_today()
        except Exception:  # noqa: BLE001
            return {}
    else:
        data = signals_today

    counts: dict[str, int] = {}
    if isinstance(data, dict):
        for key, value in data.items():
            t = _norm(key)
            if not t:
                continue
            if isinstance(value, bool):
                n = int(value)
            elif isinstance(value, (int, float)):
                n = int(value)
            elif isinstance(value, (list, tuple, set, dict)):
                n = len(value)
            else:
                n = 1
            counts[t] = counts.get(t, 0) + max(0, n)
        return counts

    for rec in data or []:
        if isinstance(rec, dict):
            t = _norm(rec.get("ticker"))
        elif isinstance(rec, str):
            t = _norm(rec)
        else:
            t = ""
        if t:
            counts[t] = counts.get(t, 0) + 1
    return counts


def _ranks(mapping: dict[str, float]) -> dict[str, int]:
    """1-based ranks, strongest first; ties break on ticker name (A→Z)."""
    ordered = sorted(mapping.items(), key=lambda kv: (-kv[1], kv[0]))
    return {t: i + 1 for i, (t, _) in enumerate(ordered)}


def _score(
    premium: dict[str, float],
    burst: dict[str, float],
    doi: dict[str, float],
    counts: dict[str, int],
) -> tuple[dict[str, float], dict[str, list[str]]]:
    """Weighted, rank-based score + reason tags per candidate ticker.

    ``score = W_premium/rank_premium + W_burst/rank_burst + W_doi/rank_doi
    + W_signal * min(count, SIGNAL_CAP)``. A missing source contributes 0.
    """
    r_prem = _ranks(premium)
    r_burst = _ranks(burst)
    r_doi = _ranks(doi)
    tickers = set(premium) | set(burst) | set(doi) | set(counts)

    scores: dict[str, float] = {}
    reasons: dict[str, list[str]] = {}
    for t in tickers:
        s = 0.0
        why: list[str] = []
        if t in r_prem:
            s += WEIGHTS["premium"] / r_prem[t]
            why.append("premium")
        if t in r_burst:
            s += WEIGHTS["burst"] / r_burst[t]
            why.append("burst")
        if t in r_doi:
            s += WEIGHTS["doi"] / r_doi[t]
            why.append("doi")
        c = counts.get(t, 0)
        if c > 0:
            s += WEIGHTS["signal"] * min(c, SIGNAL_CAP)
            why.append("signal")
        scores[t] = s
        reasons[t] = why
    return scores, reasons


# ---------------------------------------------------------------------------
# Public: build the hot list
# ---------------------------------------------------------------------------
def build_hotlist(scan=None, signals_today=None, *, limit=None) -> dict:
    """Rank and select the hot list from a scan payload.

    Pure when ``scan`` and ``signals_today`` are supplied (no network). Returns::

        {"ts": "<IST ISO>",
         "tickers": ["NIFTY", "BANKNIFTY", ...],
         "count": <int>,
         "reasons": {"RELIANCE": ["premium", "burst", "signal"], ...},
         "source_counts": {"tape": n, "opportunities": n, "doi": n,
                           "signals": n, "indices": 2}}

    ``limit`` (default ``HOTLIST_LIMIT``, env) caps non-index names; NIFTY and
    BANKNIFTY are always present. The result is JSON-safe and deterministic.
    """
    payload = _scan_payload(scan)
    sections = payload.get("sections") if isinstance(payload, dict) else None
    sections = sections if isinstance(sections, dict) else {}

    tape_rows = _section_rows(sections.get("tape"))
    opp_rows = _section_rows(sections.get("opportunities"))
    row_rows = _section_rows(sections.get("rows"))

    premium = _max_map(tape_rows, "premium")
    burst = _max_map(opp_rows, "score")
    doi = _max_map(tape_rows, "oi_change", absolute=True)
    _merge_max(doi, _max_map(opp_rows, "oi_change", absolute=True))
    _merge_max(doi, _doi_from_rows(row_rows))

    counts = _signal_counts(signals_today)
    scores, reasons = _score(premium, burst, doi, counts)

    if limit is None:
        lim = _env_limit()
    else:
        lim = int(limit) if isinstance(limit, (int, float)) and int(limit) > 0 else 0

    ranked = sorted(scores, key=lambda t: (-scores[t], t))
    body = [t for t in ranked if t not in _INDICES][:lim]
    tickers = list(_INDICES) + body

    merged_reasons: dict[str, list[str]] = {}
    for t in tickers:
        why = list(reasons.get(t) or [])
        if t in _INDICES:
            why = ["index"] + [w for w in why if w != "index"]
        merged_reasons[t] = why

    out = {
        "ts": datetime.now(IST).isoformat(),
        "tickers": tickers,
        "count": len(tickers),
        "reasons": merged_reasons,
        "source_counts": {
            "tape": len(premium),
            "opportunities": len(burst),
            "doi": len(doi),
            "signals": len(counts),
            "indices": len(_INDICES),
        },
    }
    return _clean(out)


# ---------------------------------------------------------------------------
# Budget guard
# ---------------------------------------------------------------------------
def _default_budget_probe() -> dict | None:
    """Daily pacer budget: ``{used, cap, remaining, low}`` or ``None``.

    Uses the public ``fyers_pacer.requests_today()`` for usage. The daily cap
    has no public getter, so the module constant is read directly (env-derived)
    — this is the only private touch and it is best-effort.
    """
    try:
        import fyers_pacer  # noqa: PLC0415

        used = int(fyers_pacer.requests_today())
        cap = getattr(fyers_pacer, "DAILY_CAP", None)
        if cap is None:
            cap = getattr(fyers_pacer, "_DAILY_CAP", None)
        cap = int(cap) if cap is not None else None
        remaining = (cap - used) if cap is not None else None
        return {
            "used": used,
            "cap": cap,
            "remaining": remaining,
            "low": (remaining is not None and remaining < HOTLIST_BUDGET_RESERVE),
        }
    except Exception:  # noqa: BLE001
        return None


def _budget_low(probe, reserve: int) -> bool:
    """True when the injected probe reports less than ``reserve`` left.

    Accepts a callable or a value shaped like ``{"remaining", "used", "cap",
    "low"}``, ``(used, cap)``, or a bare remaining number. Unknown shapes are
    treated as "not low" so a broken probe never blocks refreshes entirely.
    """
    try:
        info = probe() if callable(probe) else probe
    except Exception:  # noqa: BLE001
        return False

    remaining: float | None = None
    if isinstance(info, dict):
        remaining = _num_opt(info.get("remaining"))
        if remaining is None:
            used = _num_opt(info.get("used"))
            cap = _num_opt(info.get("cap"))
            if used is not None and cap is not None:
                remaining = cap - used
        if remaining is None:
            return info.get("low") is True
        return remaining < reserve
    if isinstance(info, (list, tuple)) and len(info) >= 2:
        used, cap = _num_opt(info[0]), _num_opt(info[1])
        if used is not None and cap is not None:
            return (cap - used) < reserve
        return False
    remaining = _num_opt(info)
    return remaining is not None and remaining < reserve


# ---------------------------------------------------------------------------
# Persistence — append-only JSONL, one file per IST day (mirrors oi_tracker)
# ---------------------------------------------------------------------------
def _day_path(date_str: str, root: Path | str | None = None) -> Path:
    """``{root}/{date_str}.jsonl`` (root defaults to :data:`DATA_DIR`)."""
    base = Path(root) if root is not None else DATA_DIR
    return base / f"{date_str}.jsonl"


def _record_date(record: dict) -> str:
    """IST calendar date a record belongs to, from its ``ts`` (fallback today)."""
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
    """Append one record as a JSONL line (flush + best-effort fsync).

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
        print(f"[hotlist] persist failed: {type(exc).__name__}: {exc}"[:160], flush=True)
        return False


def _read_day(path: Path) -> list[dict]:
    """Parse one JSONL file, skipping blank/malformed lines (never raises)."""
    records: list[dict] = []
    try:
        if not path.is_file():
            return records
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception as exc:  # noqa: BLE001
        print(f"[hotlist] load failed: {type(exc).__name__}", flush=True)
        return records
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue  # malformed line — skip, don't crash
        if isinstance(obj, dict) and obj.get("ts") and obj.get("ticker"):
            records.append(obj)
    return records


def _resolve_date(value) -> str:
    """Coerce a date/datetime/ISO string into ``YYYY-MM-DD`` (default today)."""
    if value is None:
        return datetime.now(IST).date().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except (TypeError, ValueError):
        return datetime.now(IST).date().isoformat()


def history(ticker=None, date=None, *, root: Path | str | None = None) -> list[dict]:
    """Persisted records for one IST day (default today), oldest first.

    Optionally filtered by ``ticker``. Missing files yield ``[]``; malformed
    lines are skipped; never raises.
    """
    day = _resolve_date(date)
    records = _read_day(_day_path(day, root))
    if ticker:
        t = _norm(ticker)
        records = [r for r in records if _norm(r.get("ticker")) == t]
    records.sort(key=lambda r: str(r.get("ts") or ""))
    return records


def latest(ticker=None, *, date=None, root: Path | str | None = None):
    """Last record per ticker from one day's JSONL.

    With ``ticker`` given, returns that ticker's most recent record or
    ``None``. Without, returns ``{ticker: record}`` (last record per ticker).
    """
    records = history(None, date, root=root)
    if ticker is None:
        out: dict[str, dict] = {}
        for rec in records:
            t = _norm(rec.get("ticker"))
            if t:
                out[t] = rec
        return out
    t = _norm(ticker)
    match = [r for r in records if _norm(r.get("ticker")) == t]
    return match[-1] if match else None


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
# Fast refresh
# ---------------------------------------------------------------------------
def _sum_side(strikes: list[dict], key: str) -> float:
    """Sum a per-strike field across both CE/PE legs (best-effort)."""
    total = 0.0
    for r in strikes:
        total += _num(r.get(key))
    return total


def _top_strike(strikes: list[dict], oi_key: str) -> dict | None:
    """Strike dict with the largest OI on ``oi_key``, or ``None``."""
    best: dict | None = None
    best_oi: float | None = None
    for r in strikes:
        k = _num_opt(r.get("strike"))
        if k is None or k <= 0:
            continue
        oi = _num_opt(r.get(oi_key))
        if oi is None:
            continue
        if best_oi is None or oi > best_oi:
            best_oi = oi
            best = {"strike": k, "oi": oi}
    return best


def _atm_strike(strikes: list[dict], spot: float | None) -> float | None:
    """Strike nearest ``spot`` (``None`` when either is unavailable)."""
    if spot is None:
        return None
    best: float | None = None
    best_dist: float | None = None
    for r in strikes:
        k = _num_opt(r.get("strike"))
        if k is None or k <= 0:
            continue
        d = abs(k - spot)
        if best_dist is None or d < best_dist:
            best_dist = d
            best = k
    return best


def _build_record(ticker: str, chain, now: datetime) -> dict:
    """Compact light-chain record for ``ticker`` (see module docstring schema)."""
    if not isinstance(chain, dict):
        raise ValueError("chain is not a dict")
    strikes = [r for r in (chain.get("strikes") or []) if isinstance(r, dict)]
    spot = _num_opt(chain.get("spot"))

    call_oi = _num_opt(chain.get("call_oi"))
    put_oi = _num_opt(chain.get("put_oi"))
    if call_oi is None:
        call_oi = _sum_side(strikes, "ce_oi")
    if put_oi is None:
        put_oi = _sum_side(strikes, "pe_oi")
    pcr = (put_oi / call_oi) if call_oi else None

    oich_total = _sum_side(strikes, "ce_oich") + _sum_side(strikes, "pe_oich")

    return _clean(
        {
            "ts": now.isoformat(),
            "ticker": ticker,
            "spot": spot,
            "pcr": pcr,
            "top_call": _top_strike(strikes, "ce_oi"),
            "top_put": _top_strike(strikes, "pe_oi"),
            "oich_total": oich_total,
            "atm_strike": _atm_strike(strikes, spot),
        }
    )


def _default_chain_fn(ticker: str) -> dict:
    """Light chain fetch through ``fyers_data`` (paced; greeks off)."""
    import fyers_data  # noqa: PLC0415

    return fyers_data.get_chain(
        ticker, greeks=False, strikecount=HOTLIST_STRIKECOUNT
    )


def _auth_failed() -> bool:
    """True when Fyers cannot serve calls (dead token or rate-limit ban)."""
    try:
        import fyers_data  # noqa: PLC0415

        paused = getattr(fyers_data, "fyers_paused", None)
        return bool(paused()) if callable(paused) else bool(fyers_data.auth_failed())
    except Exception:  # noqa: BLE001
        return False


def refresh_once(
    tickers=None,
    *,
    chain_fn=None,
    now=None,
    budget_probe=None,
    root: Path | str | None = None,
) -> dict:
    """Refresh a light chain for each hot ticker and append one record each.

    Sequential and budget-aware: capped by ``HOTLIST_MAX_CALLS`` per run and
    skipped when the pacer budget probe reports less than
    ``HOTLIST_BUDGET_RESERVE`` requests left. Never raises — per-ticker
    failures are counted, not raised.

    Returns ``{ts, ok, failed, skipped, calls, max_calls, tickers,
    skipped_tickers, failed_tickers, details, records}`` where ``details``
    records one ``{ticker, status, skipped}`` entry per requested ticker
    (``skipped`` is ``true`` only for tickers not fetched).
    """
    cur = now if isinstance(now, datetime) else datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)

    if tickers is None:
        requested = _norm_list(build_hotlist().get("tickers"))
    else:
        requested = _norm_list(tickers)

    fetch = chain_fn
    if fetch is None:
        try:
            import fyers_data  # noqa: F401, PLC0415  (availability probe)

            fetch = _default_chain_fn
        except Exception:  # noqa: BLE001
            fetch = None

    max_calls = max(0, int(HOTLIST_MAX_CALLS))
    probe = budget_probe if budget_probe is not None else _default_budget_probe

    records: list[dict] = []
    skipped_tickers: list[str] = []
    failed_tickers: list[str] = []
    details: list[dict] = []
    ok = failed = skipped = calls = 0

    def _skip(ticker: str) -> None:
        nonlocal skipped
        skipped += 1
        skipped_tickers.append(ticker)
        details.append({"ticker": ticker, "status": "skipped", "skipped": True})

    for ticker in requested:
        if calls >= max_calls:
            _skip(ticker)
            continue
        if _budget_low(probe, HOTLIST_BUDGET_RESERVE):
            _skip(ticker)
            continue
        # A dead token fails every call: abort instead of skipping/failing the
        # whole hot list on each 45s cycle.
        if calls >= 2 and _auth_failed():
            _skip(ticker)
            continue

        calls += 1
        if fetch is None:
            failed += 1
            failed_tickers.append(ticker)
            details.append({"ticker": ticker, "status": "failed", "skipped": False})
            continue
        try:
            chain = fetch(ticker)
            record = _build_record(ticker, chain, cur)
        except Exception as exc:  # noqa: BLE001  (one bad ticker never aborts)
            failed += 1
            failed_tickers.append(ticker)
            details.append({"ticker": ticker, "status": "failed", "skipped": False})
            print(
                f"[hotlist] refresh failed for {ticker}: "
                f"{type(exc).__name__}"[:160],
                flush=True,
            )
            continue
        _append(record, root=root)
        records.append(record)
        ok += 1
        details.append({"ticker": ticker, "status": "ok", "skipped": False})

    return _clean(
        {
            "ts": cur.isoformat(),
            "ok": ok,
            "failed": failed,
            "skipped": skipped,
            "calls": calls,
            "max_calls": max_calls,
            "tickers": requested,
            "skipped_tickers": skipped_tickers,
            "failed_tickers": failed_tickers,
            "details": details,
            "records": records,
        }
    )


# ---------------------------------------------------------------------------
# Scheduler
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


def _run_due_cycle(now: datetime | None = None) -> bool:
    """Run one hot refresh when due (market open + interval elapsed).

    Uses the cached scan payload (never triggers a scan). Blocking, so ticks
    cannot overlap. Returns True when a cycle ran.
    """
    cur = now or datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)

    if not _is_market_open(cur):
        return False

    global _LAST_CYCLE_TS
    interval = _env_interval()
    ts = cur.timestamp()
    if _LAST_CYCLE_TS > 0 and (ts - _LAST_CYCLE_TS) < interval:
        return False

    hot = build_hotlist()
    result = refresh_once(hot.get("tickers"))
    _LAST_CYCLE_TS = ts

    nxt = (cur + timedelta(seconds=interval)).strftime("%H:%M:%S")
    print(
        f"[hotlist] cycle: {result.get('ok', 0)} ok / "
        f"{result.get('failed', 0)} failed, "
        f"calls={result.get('calls', 0)}, "
        f"interval={interval:g}s, next={nxt}",
        flush=True,
    )
    return True


def _loop() -> None:
    print(
        f"[hotlist] scheduler started (interval {_env_interval():g}s, "
        f"tick {_SCHED_TICK}s)",
        flush=True,
    )
    while True:
        try:
            _run_due_cycle()
        except Exception as exc:  # noqa: BLE001  (never kill the loop)
            print(
                f"[hotlist] scheduler error: {type(exc).__name__}: {exc}"[:160],
                flush=True,
            )
        time.sleep(_SCHED_TICK)


def ensure_started() -> None:
    """Prune old day files and start the refresh scheduler once (idempotent).

    The scheduler is a daemon thread and never raises. Extra calls are no-ops.
    """
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    try:
        removed = prune()
        if removed:
            print(
                f"[hotlist] pruned {removed} file(s) older than {KEEP_DAYS}d",
                flush=True,
            )
    except Exception:  # noqa: BLE001  (retention is best-effort)
        pass
    threading.Thread(target=_loop, name="hotlist-scheduler", daemon=True).start()


__all__ = [
    "DATA_DIR",
    "KEEP_DAYS",
    "HOTLIST_STRIKECOUNT",
    "WEIGHTS",
    "SIGNAL_CAP",
    "HOTLIST_LIMIT",
    "HOTLIST_INTERVAL_SEC",
    "HOTLIST_MAX_CALLS",
    "HOTLIST_BUDGET_RESERVE",
    "build_hotlist",
    "refresh_once",
    "latest",
    "history",
    "prune",
    "ensure_started",
]


if __name__ == "__main__":  # pragma: no cover — manual smoke, no network
    out = build_hotlist()
    out["tickers"] = out["tickers"][:10]
    print(json.dumps(out, indent=2, default=str)[:2000])
