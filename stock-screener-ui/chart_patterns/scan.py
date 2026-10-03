"""Executes a chart-pattern compute job across a universe (CONTRACT.md §3).

Iterates the universe with a bounded ``ThreadPoolExecutor`` for the sync Upstox
V3 fetch, calls the detection engine per symbol, persists hits, and tracks
progress. Per-symbol failures never abort the job.
"""
from __future__ import annotations

import dataclasses
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from types import SimpleNamespace

from chart_patterns import candles, jobs as jobs_mod, store

try:
    from chart_patterns import engine as engine_mod
except Exception:  # pragma: no cover - integration env always has it
    engine_mod = None

try:
    from chart_patterns import universes as universes_mod
except Exception:  # pragma: no cover - integration env always has it
    universes_mod = None

SYMBOL_WORKERS = int(os.environ.get("PATTERN_SCAN_SYMBOL_WORKERS", "4"))
DEFAULT_MIN_BARS = 60
_PERSIST_EVERY = 10


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_min_bars(timeframe: str) -> int:
    try:
        from chart_patterns.timeframes import get_timeframe

        spec = get_timeframe(timeframe)
        if isinstance(spec, dict):
            return int(spec.get("min_bars") or DEFAULT_MIN_BARS)
        return int(getattr(spec, "min_bars", DEFAULT_MIN_BARS) or DEFAULT_MIN_BARS)
    except Exception:
        return DEFAULT_MIN_BARS


def _normalize_universe(raw) -> tuple[list[str], dict[str, str]]:
    """Return ``(symbols, name_by_symbol)`` from a variety of universe shapes."""
    symbols: list[str] = []
    names: dict[str, str] = {}
    for item in raw or []:
        if isinstance(item, dict):
            symbol = item.get("symbol") or item.get("trading_symbol") or item.get("ticker")
            if not symbol:
                continue
            symbols.append(str(symbol).upper())
            if item.get("name"):
                names[str(symbol).upper()] = item["name"]
        else:
            symbols.append(str(item).upper())
    # de-dupe, preserve order
    seen = set()
    unique = []
    for s in symbols:
        if s and s not in seen:
            seen.add(s)
            unique.append(s)
    return unique, names


def _load_symbols(universe: str):
    if universes_mod is None:
        raise RuntimeError("chart_patterns.universes unavailable")
    raw = universes_mod.get_universe(universe)
    return _normalize_universe(raw)


def _hit_to_dict(hit) -> dict:
    if isinstance(hit, dict):
        return dict(hit)
    if dataclasses.is_dataclass(hit):
        return dataclasses.asdict(hit)
    if hasattr(hit, "to_dict"):
        return hit.to_dict()
    if hasattr(hit, "__dict__"):
        return {k: v for k, v in vars(hit).items() if not k.startswith("_")}
    raise TypeError(f"cannot serialize pattern hit: {type(hit)!r}")


def _detect(df, timeframe: str, symbol: str):
    if engine_mod is None:
        raise RuntimeError("chart_patterns.engine unavailable")
    return engine_mod.detect_patterns(df, timeframe, symbol)


def _process_symbol(symbol: str, timeframe: str, job_id: str, name=None) -> dict:
    """Fetch + detect one symbol. Never raises; returns a status dict."""
    try:
        df = candles.fetch_for_timeframe(symbol, timeframe)
    except Exception:
        return {"status": "failed", "data_through": None}

    if df is None or getattr(df, "empty", True):
        return {"status": "failed", "data_through": None}

    data_through = candles.frame_last_date(df)
    if len(df) < _resolve_min_bars(timeframe):
        return {"status": "skipped", "data_through": data_through}

    try:
        hits = _detect(df, timeframe, symbol) or []
    except Exception:
        return {"status": "failed", "data_through": data_through}

    enriched = []
    for hit in hits:
        try:
            record = _hit_to_dict(hit)
        except Exception:
            continue
        record["symbol"] = symbol
        record["name"] = name
        record.setdefault("timeframe", timeframe)
        enriched.append(record)

    if enriched:
        try:
            store.save_hits(job_id, enriched)
        except Exception:
            return {"status": "failed", "data_through": data_through}

    return {"status": "ok", "data_through": data_through}


def run_job(job_id: str) -> None:
    """Run a single job end-to-end. Safe to call from a worker thread."""
    job = jobs_mod.get_job(job_id) or store.get_job(job_id)
    if not job:
        return
    if job.get("status") == "cancelled":
        return

    universe = job.get("universe")
    timeframe = job.get("timeframe")

    try:
        symbols, names = _load_symbols(universe)
    except Exception as exc:
        jobs_mod.update_state(
            job_id, status="failed", error=str(exc)[:500], finished_at=_now()
        )
        return

    total = len(symbols)
    jobs_mod.update_state(job_id, status="running", total=total)

    # Supersede any previous hits for this universe/timeframe so results never
    # mix stale rows from an earlier scan.
    try:
        store.delete_hits_for(universe, timeframe, keep_job_id=job_id)
    except Exception:
        pass

    done = failed = skipped = 0
    max_date = None
    lock = threading.Lock()

    if not symbols:
        jobs_mod.update_state(
            job_id, status="completed", total=0, done=0,
            failed=0, skipped=0, finished_at=_now(),
        )
        return

    with ThreadPoolExecutor(max_workers=max(1, SYMBOL_WORKERS)) as pool:
        futures = {
            pool.submit(_process_symbol, symbol, timeframe, job_id, names.get(symbol)): symbol
            for symbol in symbols
        }
        cancelled = False
        for future in as_completed(futures):
            if jobs_mod.is_cancelled(job_id):
                cancelled = True
                for pending in futures:
                    pending.cancel()
                break
            symbol = futures[future]
            try:
                result = future.result()
            except Exception:
                result = {"status": "failed", "data_through": None}
            with lock:
                done += 1
                if result.get("status") == "failed":
                    failed += 1
                elif result.get("status") == "skipped":
                    skipped += 1
                data_through = result.get("data_through")
                if data_through and (max_date is None or data_through > max_date):
                    max_date = data_through
                persist = done % _PERSIST_EVERY == 0 or done == total
            jobs_mod.update_state(
                job_id, persist=persist,
                done=done, failed=failed, skipped=skipped,
                data_through=max_date,
            )

    if cancelled or jobs_mod.is_cancelled(job_id):
        jobs_mod.update_state(
            job_id, status="cancelled", done=done, failed=failed,
            skipped=skipped, data_through=max_date, finished_at=_now(),
        )
    else:
        jobs_mod.update_state(
            job_id, status="completed", done=done, failed=failed,
            skipped=skipped, data_through=max_date, finished_at=_now(),
        )
