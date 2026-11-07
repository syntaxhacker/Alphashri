"""Executes a chart-pattern compute job across a universe (CONTRACT.md §3).

Iterates the universe with a bounded ``ThreadPoolExecutor`` for the sync Upstox
V3 fetch, calls the detection engine per symbol, persists hits, and tracks
progress. Per-symbol failures never abort the job.
"""
from __future__ import annotations

import dataclasses
import hashlib
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Optional

import pandas as pd

from chart_patterns import candles, config, jobs as jobs_mod, store

try:
    from chart_patterns import tv_prefilter as tv_prefilter_mod
except Exception:  # pragma: no cover - tv_prefilter is a local module
    tv_prefilter_mod = None

try:
    from chart_patterns import engine as engine_mod
except Exception:  # pragma: no cover - integration env always has it
    engine_mod = None

try:
    from chart_patterns import universes as universes_mod
except Exception:  # pragma: no cover - integration env always has it
    universes_mod = None

try:
    from chart_patterns import trendlines as trendlines_mod
except Exception:  # pragma: no cover - a broken trendlines module must not break scans
    trendlines_mod = None

try:
    from trading import calendar as _calendar_mod
    from trading import utils as _market_mod
    from trading.timezone import IST as _IST
except Exception:  # pragma: no cover - trading package always present in app env
    _calendar_mod = None
    _market_mod = None
    _IST = timezone.utc

logger = logging.getLogger(__name__)

SYMBOL_WORKERS = int(os.environ.get("PATTERN_SCAN_SYMBOL_WORKERS", "4"))
DEFAULT_MIN_BARS = 60
# Upper bound on the resolved symbol count of an as-of (replay) scan. Replays
# fetch explicit historical windows per symbol; without a cap one request
# could enqueue a universe-sized replay by accident.
ASOF_SCAN_MAX_SYMBOLS = 200
_PERSIST_EVERY = 10
# Redis mirror cadence: mirror live job state (done/failed/skipped/no_hits) at
# most every N symbols or every ~500 ms, whichever comes first, plus the final
# symbol. DB persist keeps its own cadence (_PERSIST_EVERY / final). A 0.5 s
# UI lag is acceptable; the mirror is what was hitting Redis per symbol.
_MIRROR_EVERY = 10
_MIRROR_INTERVAL_SEC = 0.5
# Hit-write cadence: accumulate enriched hits and flush in one transaction
# every N symbols, plus at the end (and before any terminal state).
_HITS_EVERY = 20
# A non-forced scan for a universe/timeframe with a completed job younger than
# this is a no-op (results are still fresh); ``force=True`` always recomputes.
SCAN_FRESH_SECONDS = int(os.environ.get("PATTERN_SCAN_FRESH_SEC", "300"))
# Detector/data signature version for the freshness short-circuit. Bump when
# any detector changes so a non-forced scan recomputes once instead of
# silently reusing hits from the previous detector version.
SCAN_DETECTOR_VERSION = 5
# Columns hashed for the frame-interior digest. Fixed order keeps the digest
# deterministic; tail stats alone can't detect a historical correction/backfill
# that leaves the last bar untouched.
_FRAME_INTERIOR_COLS = ("close", "high", "low", "volume")


def _detector_signature(data_through: Optional[str] = None) -> str:
    """Cheap detector/data signature for the freshness key.

    ``v{version}|tl:{trendline settings}`` identifies the detector build; the
    trailing ``|data:{date}`` (the job's ``data_through``, when known) records
    which session's data produced the hits. The reuse gate compares the
    detector part — a detector change (or a job from before signatures
    existed) forces a recompute. Intra-session data freshness stays bounded
    by the ``_is_fresh`` TTL/session check, not by this string.
    """
    try:
        tl_sig = config.trendline_signature()
    except Exception:
        tl_sig = "unknown"
    base = f"v{SCAN_DETECTOR_VERSION}|tl:{tl_sig}"
    if data_through:
        return f"{base}|data:{data_through}"
    return base


def _frame_interior_digest(df) -> Optional[str]:
    """Stable 16-hex digest of the frame interior.

    Hashes the exact bytes of ``close``, ``high``, ``low`` and ``volume``
    (numpy ``to_numpy(dtype=float).tobytes()``) in a fixed order. Two frames
    with identical tail stats but different interiors (e.g. a backfilled
    correction) now produce different signatures instead of colliding.

    Never uses Python's ``hash()``: it is randomized per process and the
    signature is persisted and compared across restarts. Returns ``None`` when
    any column is missing or unreadable, which forces a re-detect (safe: never
    silently reuse a frame we can't fingerprint).
    """
    try:
        h = hashlib.sha1()
        for col in _FRAME_INTERIOR_COLS:
            h.update(df[col].to_numpy(dtype=float).tobytes())
        return h.hexdigest()[:16]
    except Exception:
        return None


def _frame_signature(df) -> Optional[str]:
    """Compact hash of the frame tail + interior that determines detection output.

    ``(frame_last_date, last_bar_timestamp, last_close, len(df), interior_digest)``.
    The tail stats catch a new/latest bar; the interior digest catches a
    historical correction or backfill that leaves the last bar untouched.
    Two frames with the same signature produce the same detection result, so
    detection + trendlines can be skipped.
    """
    if df is None or getattr(df, "empty", True):
        return None
    try:
        last_date = candles.frame_last_date(df)
        ts = pd.Timestamp(df.index[-1])
        if ts.tz is None:
            ts = ts.tz_localize("UTC")
        stamp = ts.isoformat()
        close = None
        try:
            close = float(df.iloc[-1]["close"])
        except (KeyError, TypeError, ValueError):
            close = None
        interior = _frame_interior_digest(df)
        if interior is None:
            # Cannot prove the interior is unchanged: never silently reuse.
            return None
        payload = f"{last_date}|{stamp}|{close}|{len(df)}|{interior}"
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]
    except Exception:
        return None


def _source_sig(
    df, timeframe: str, lookback_bars: Optional[int] = None,
    compute_trendlines: bool = True,
) -> Optional[str]:
    """Per-symbol source signature: frame + detector build + detection params.

    Stored with each hit (in ``payload_json``) and compared on the next scan to
    decide whether a symbol can be reused without re-detecting. Includes the
    detector signature so a detector change forces recompute, and the params
    that alter the detection input (``lookback_bars``, ``compute_trendlines``).
    Universe/timeframe are enforced by the store query scope, not the hash.
    """
    frame_sig = _frame_signature(df)
    if not frame_sig:
        return None
    payload = (
        f"{frame_sig}|{_detector_signature()}|{lookback_bars}|"
        f"{bool(compute_trendlines)}|{timeframe}"
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def _stored_scan_signature(prev: dict) -> Optional[str]:
    """Signature recorded on a previous job: top-level, else params mirror.

    ``store.save_job`` only persists ``_JOB_FIELDS`` + ``params_json``, so the
    signature is mirrored into ``params`` (which survives a restart) and read
    back from either location.
    """
    if not isinstance(prev, dict):
        return None
    sig = prev.get("scan_signature")
    if isinstance(sig, str) and sig:
        return sig
    try:
        sig = _job_params(prev).get("scan_signature")
    except Exception:
        return None
    return sig if isinstance(sig, str) and sig else None


def _signature_matches(prev: dict) -> bool:
    """True when a previous job's hits came from the current detector build."""
    current = _detector_signature()
    stored = _stored_scan_signature(prev)
    if not stored:
        return False
    return stored == current or stored.startswith(current + "|")


def _reuse_age_sec(finished_at) -> Optional[int]:
    """Seconds since ``finished_at`` (ISO str or datetime), else ``None``."""
    try:
        if isinstance(finished_at, str):
            finished = datetime.fromisoformat(finished_at)
        else:
            finished = finished_at
        if not isinstance(finished, datetime):
            return None
        if finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - finished).total_seconds()))
    except (ValueError, TypeError, OverflowError):
        return None


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


def _latest_record(records: list[dict]) -> dict:
    def bars(record: dict):
        value = record.get("bars_ago")
        return value if isinstance(value, (int, float)) else float("inf")

    floor = min(bars(record) for record in records)
    pool = [record for record in records if bars(record) == floor]
    return max(
        pool,
        key=lambda record: (str(record.get("end_date") or ""), record.get("confidence") or 0),
    )


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


def _job_params(job: dict) -> dict:
    """Params for a job, whether carried in-memory (``params``) or via DB."""
    params = job.get("params") if isinstance(job, dict) else None
    if isinstance(params, dict):
        return dict(params)
    if isinstance(params, str):
        try:
            import json as _json

            parsed = _json.loads(params)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    raw = job.get("params_json") if isinstance(job, dict) else None
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            import json as _json

            parsed = _json.loads(raw)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _is_fresh(finished_at, ttl_seconds: int = SCAN_FRESH_SECONDS) -> bool:
    """Session-aware freshness for a completed combo scan.

    - Market OPEN now: fresh when ``finished_at`` is younger than ``ttl_seconds``.
    - Market CLOSED: fresh when the last completed session hasn't changed since
      the scan finished (weekends/holidays never churn re-scans).
    """
    if not finished_at:
        return False
    try:
        if isinstance(finished_at, str):
            finished = datetime.fromisoformat(finished_at)
        else:
            finished = finished_at
        if isinstance(finished, datetime) and finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return False

    try:
        market_open = bool(_market_mod.is_market_open()) if _market_mod is not None else True
    except Exception:
        market_open = True
    if market_open:
        try:
            if not isinstance(finished, datetime):
                return False
            age = (datetime.now(timezone.utc) - finished).total_seconds()
            return 0 <= age < max(0, int(ttl_seconds))
        except (ValueError, TypeError, OverflowError):
            return False
    try:
        if _calendar_mod is None:
            return False
        if isinstance(finished, datetime):
            finished_ts = finished.astimezone(_IST)
        else:
            finished_ts = finished  # plain date: calendar treats as midnight IST
        return _calendar_mod.last_completed_session(finished_ts) == _calendar_mod.last_completed_session(
            datetime.now(_IST)
        )
    except (ValueError, TypeError, OverflowError, AttributeError):
        return False


def _is_cancelled(job_id: str) -> bool:
    try:
        return bool(jobs_mod.is_cancelled(job_id))
    except Exception:
        return False


def _process_symbol(symbol: str, timeframe: str, job_id: str, name=None,
                   lookback_bars=None, compute_trendlines: bool = True,
                   as_of_date=None, from_date=None,
                   include_partial_today: Optional[bool] = None,
                   prev_hit: Optional[dict] = None) -> dict:
    """Fetch + detect one symbol. Never raises; returns a status dict.

    With ``as_of_date`` set the fetch window ends on that date (its time
    portion truncates the frame via :func:`candles.truncate_frame_to` so
    detection only sees bars ``<= to_dt``); ``from_date`` pins the window
    start (winning over lookback sizing) and drops hits ending before it.
    Both default to ``None`` (live behaviour, unchanged).

    ``include_partial_today`` appends the current-session bar for daily
    frames so a breakout forming today is visible the same day (the detector
    then classifies it, e.g. a same-day cross shows ``confirmed``). ``None``
    (default) means on for ``1D`` — intraday frames already carry today's
    tape — and off otherwise; explicit ``False`` forces it off. It is never
    applied to an as-of replay. The partial bar is merged by
    :func:`candles.fetch_for_timeframe` (official bar wins, empty tape
    appends nothing, never cached), so it cannot be double-counted and
    ``frame_last_date``/``data_through`` reflect the current session.

    The returned dict always carries ``from_cache`` (True = candles served
    from disk, False = freshly fetched, None = no fetch attempted) so
    :func:`run_job` can aggregate cache provenance.
    """
    if _is_cancelled(job_id):
        return {"status": "skipped", "data_through": None, "from_cache": None}
    to_dt = None
    from_part = None
    fetch_kwargs: dict = {"lookback_bars": lookback_bars}
    if as_of_date is not None or from_date is not None:
        try:
            if as_of_date is not None:
                to_dt = candles.parse_asof_datetime(as_of_date)
                fetch_kwargs["as_of_date"] = to_dt.strftime("%Y-%m-%d")
            if from_date is not None:
                from_part = candles.parse_asof_datetime(from_date).strftime("%Y-%m-%d")
                fetch_kwargs["from_date"] = from_part
        except ValueError:
            return {"status": "failed", "data_through": None, "from_cache": None}
    if include_partial_today is None:
        want_partial = (timeframe == "1D")
    else:
        want_partial = bool(include_partial_today)
    if want_partial and to_dt is None:
        fetch_kwargs["include_partial_today"] = True
    prov: dict = {}
    try:
        try:
            df = candles.fetch_for_timeframe(
                symbol, timeframe, **{**fetch_kwargs, "provenance": prov}
            )
        except TypeError:
            # Backward compatible: patched/custom fetchers without the
            # ``provenance`` out-param.
            df = candles.fetch_for_timeframe(symbol, timeframe, **fetch_kwargs)
    except Exception:
        return {"status": "failed", "data_through": None, "from_cache": False}
    from_cache = bool(prov.get("from_cache", False))

    if df is None or getattr(df, "empty", True):
        return {"status": "failed", "data_through": None, "from_cache": from_cache}

    if to_dt is not None:
        df = candles.truncate_frame_to(df, to_dt)
        if df is None or getattr(df, "empty", True):
            return {"status": "skipped", "data_through": None, "from_cache": from_cache}

    data_through = candles.frame_last_date(df)
    if len(df) < _resolve_min_bars(timeframe):
        return {"status": "skipped", "data_through": data_through, "from_cache": from_cache}

    # Opt-in trailing window: cap the detection input at the last N bars.
    # The min_bars gate above runs on the full fetched frame so an explicit
    # small lookback still reaches detection.
    if isinstance(lookback_bars, int) and lookback_bars > 0 and len(df) > lookback_bars:
        df = df.iloc[-lookback_bars:]

    if _is_cancelled(job_id):
        return {"status": "skipped", "data_through": data_through, "from_cache": from_cache}

    # Source-signature reuse: if the frame that produced the previous hit for
    # this symbol is byte-identical (same last date/bar/close/length) and the
    # detector build + detection params match, skip detection + trendlines and
    # return the stored hit instead. A missing or legacy signature falls
    # through to a normal detect.
    source_sig = _source_sig(df, timeframe, lookback_bars, compute_trendlines)
    if prev_hit and source_sig:
        prev_sig = prev_hit.get("source_sig") if isinstance(prev_hit, dict) else None
        if prev_sig and prev_sig == source_sig:
            record = dict(prev_hit)
            record["symbol"] = symbol
            if name:
                record["name"] = name
            record.setdefault("timeframe", timeframe)
            record["source_sig"] = source_sig
            return {
                "status": "ok", "data_through": data_through, "from_cache": from_cache,
                "hits": [record], "reused": True, "source_sig": source_sig,
            }

    try:
        hits = _detect(df, timeframe, symbol) or []
    except Exception:
        return {"status": "failed", "data_through": data_through, "from_cache": from_cache}

    # Scan-time trendlines: computed once per symbol so read-time results can
    # reuse the stored lines instead of re-running the detector per item.
    scan_trend_lines: list = []
    if compute_trendlines and hits and trendlines_mod is not None:
        try:
            _tl_res = trendlines_mod.detect_trendlines(df, lookback_bars=lookback_bars)
            if isinstance(_tl_res, dict):
                scan_trend_lines = [
                    v for v in (_tl_res.get("support"), _tl_res.get("resistance")) if v
                ]
        except Exception:
            scan_trend_lines = []

    enriched = []
    for hit in hits:
        try:
            record = _hit_to_dict(hit)
        except Exception:
            continue
        if from_part and str(record.get("end_date") or "")[:10] < from_part:
            continue
        record["symbol"] = symbol
        record["name"] = name
        record.setdefault("timeframe", timeframe)
        record["trend_lines"] = list(scan_trend_lines)
        if compute_trendlines:
            record["trend_lines_sig"] = config.trendline_signature()
        record["source_sig"] = source_sig
        enriched.append(record)

    if enriched:
        if len(enriched) > 1:
            enriched = [_latest_record(enriched)]
        return {
            "status": "ok", "data_through": data_through, "from_cache": from_cache,
            "hits": enriched,
        }

    # Detector ran cleanly but found nothing: a distinct, non-error outcome so
    # the job's ``failed`` counter stays honest.
    return {"status": "empty", "data_through": data_through, "from_cache": from_cache, "hits": []}


def _provenance(
    scan_reused: bool,
    candles_cached: int,
    candles_fetched: int,
    prefilter_dropped: Optional[int],
    data_through: Optional[str],
    reused: int = 0,
) -> dict:
    """Cache provenance for a job (also mirrored into ``params`` for DB restarts).

    ``reused`` counts symbols whose source frame was unchanged since the last
    completed scan and whose stored hit was reused without re-detecting.
    """
    return {
        "scan_reused": bool(scan_reused),
        "candles_cached": int(candles_cached),
        "candles_fetched": int(candles_fetched),
        "prefilter_dropped": prefilter_dropped,
        "detector_version": SCAN_DETECTOR_VERSION,
        "data_through": data_through,
        "reused": int(reused),
    }


def run_job(job_id: str) -> None:
    """Run a single job end-to-end. Safe to call from a worker thread."""
    job = jobs_mod.get_job(job_id) or store.get_job(job_id)
    if not job:
        return
    if job.get("status") == "cancelled":
        return

    universe = job.get("universe")
    timeframe = job.get("timeframe")
    params = _job_params(job)
    raw_symbols = params.get("symbols")
    lookback_bars = params.get("lookback_bars")
    min_rel_volume = params.get("min_rel_volume")
    min_volume_m = params.get("min_volume_m")
    min_avg_volume_10d = params.get("min_avg_volume_10d")
    compute_trendlines = params.get("compute_trendlines", True)
    if compute_trendlines is None:
        compute_trendlines = True
    compute_trendlines = bool(compute_trendlines)
    as_of_date = params.get("as_of_date")
    from_date = params.get("from_date")
    is_replay = as_of_date is not None or from_date is not None
    include_partial_today = params.get("include_partial_today", None)

    try:
        if raw_symbols:
            # Explicit symbol scope: run only these, no universe lookup.
            symbols, names = _normalize_universe(raw_symbols)
        else:
            symbols, names = _load_symbols(universe)
    except Exception as exc:
        jobs_mod.update_state(
            job_id, status="failed", error=str(exc)[:500], finished_at=_now()
        )
        return

    total = len(symbols)

    # TV volume/rel-volume pre-filter: one bulk TradingView query BEFORE any
    # candle fetch, so low-energy symbols never cost an Upstox call. Fail-open
    # (all symbols pass) when TV is unavailable.
    prefilter_message: str | None = None
    prefilter_dropped: Optional[int] = None
    if min_rel_volume is not None or min_volume_m is not None or min_avg_volume_10d is not None:
        before = len(symbols)
        try:
            if tv_prefilter_mod is None:
                raise RuntimeError("chart_patterns.tv_prefilter unavailable")
            symbols, _prefilter_info = tv_prefilter_mod.prefilter_by_volume(
                symbols,
                min_rel_volume=min_rel_volume,
                min_volume_m=min_volume_m,
                min_avg_volume_10d=min_avg_volume_10d,
            )
            prefilter_message = str(
                _prefilter_info.get("message") or f"TV prefilter: {before} → {len(symbols)}"
            )
        except Exception as exc:
            symbols = list(symbols)
            prefilter_message = f"TV prefilter: {before} → {len(symbols)} (fail-open: {exc})"
        prefilter_dropped = before - len(symbols)
        names = {s: names.get(s) for s in symbols if s in names} if names else {}
        total = len(symbols)

    # Staleness short-circuit: a fresh completed scan already covers this
    # combo, so a non-forced rescan would just recompute identical hits.
    # ``force=True`` bypasses this and always recomputes. Symbol-scoped jobs
    # always run — their scope is explicit and may differ from the last custom
    # scan even when the (shared) ``custom`` universe looks fresh.
    force = bool(params.get("force"))
    if not force and not raw_symbols and not is_replay:
        try:
            prev = store.latest_completed_job(universe, timeframe)
        except Exception:
            prev = None
        if (prev and prev.get("job_id") != job_id
                and _is_fresh(prev.get("finished_at"))
                and _signature_matches(prev)):
            # Fresh + same detector build: reuse the previous counts without
            # re-detecting, but say so on the job state (reused*) so the UI
            # can tell a reuse from a fresh compute. The reuse fields are
            # mirrored into ``params`` because ``store.save_job`` only
            # persists ``params_json`` for extras (see jobs._overlay).
            # A detector change (signature mismatch) falls through and
            # recomputes.
            prev_finished = prev.get("finished_at")
            prev_finished_iso = (
                prev_finished if isinstance(prev_finished, str)
                else (prev_finished.isoformat() if hasattr(prev_finished, "isoformat") else None)
            )
            reuse_params = dict(params)
            reuse_provenance = _provenance(
                True, 0, 0, prefilter_dropped, prev.get("data_through")
            )
            reuse_params.update({
                "reused": True,
                "reused_from": prev.get("job_id"),
                "reused_age_sec": _reuse_age_sec(prev_finished),
                "reused_finished_at": prev_finished_iso,
                "reused_signature": _stored_scan_signature(prev),
                "scan_signature": _detector_signature(),
                "provenance": reuse_provenance,
            })
            jobs_mod.update_state(
                job_id, status="completed",
                total=int(prev.get("total") or 0), done=int(prev.get("done") or 0),
                failed=int(prev.get("failed") or 0), skipped=int(prev.get("skipped") or 0),
                data_through=prev.get("data_through"), finished_at=_now(),
                reused=True, reused_from=prev.get("job_id"),
                reused_age_sec=_reuse_age_sec(prev_finished),
                reused_finished_at=prev_finished_iso,
                reused_signature=_stored_scan_signature(prev),
                scan_signature=_detector_signature(),
                provenance=reuse_provenance,
                params=reuse_params,
            )
            return

    # Symbol-level reuse: load the previous completed job's hits for this
    # universe/timeframe so unchanged symbols skip detection + trendlines.
    # Never reuse when force/replay is set or when the symbol set differs.
    prev_by_symbol: dict[str, dict] = {}
    if not force and not is_replay:
        if raw_symbols:
            # Custom scans only reuse when the explicit symbol set matches the
            # previous completed job's set; any difference forces recompute.
            prev_job = store.latest_completed_job(universe, timeframe)
            prev_symbols = None
            if prev_job is not None:
                prev_symbols = [
                    str(s).upper() for s in (_job_params(prev_job).get("symbols") or [])
                ]
            if prev_symbols is not None and set(prev_symbols) == set(symbols):
                try:
                    prev_by_symbol = (
                        store.latest_hits_by_symbol(universe, timeframe, exclude_job_id=job_id)
                        or {}
                    )
                except Exception:
                    prev_by_symbol = {}
        else:
            try:
                prev_by_symbol = (
                    store.latest_hits_by_symbol(universe, timeframe, exclude_job_id=job_id) or {}
                )
            except Exception:
                prev_by_symbol = {}

    _running_state: dict = {"status": "running", "total": total}
    if prefilter_message:
        _running_state["message"] = prefilter_message
    jobs_mod.update_state(job_id, **_running_state)

    done = failed = skipped = no_hits = reused = 0
    candles_cached = candles_fetched = 0
    max_date = None
    lock = threading.Lock()
    pending_hits: list[dict] = []
    last_mirror = time.monotonic()

    def _flush_hits(force: bool = False) -> None:
        nonlocal pending_hits
        if not pending_hits and not force:
            return
        batch = pending_hits
        pending_hits = []
        if batch:
            try:
                # One session + one commit for the whole batch instead of one
                # per symbol.
                store.save_hits_batch([(job_id, batch)])
            except Exception:  # pragma: no cover - DB write failure must not abort a scan
                logger.warning("scan %s: hit batch flush failed", job_id, exc_info=True)

    if not symbols:
        _empty_provenance = _provenance(False, 0, 0, prefilter_dropped, None)
        _empty_state: dict = {
            "status": "completed", "total": 0, "done": 0,
            "failed": 0, "skipped": 0, "finished_at": _now(),
            "scan_signature": _detector_signature(),
            "provenance": _empty_provenance,
            "params": {**params, "scan_signature": _detector_signature(),
                       "provenance": _empty_provenance},
        }
        if prefilter_message:
            _empty_state["message"] = prefilter_message
        jobs_mod.update_state(job_id, **_empty_state)
        return

    with ThreadPoolExecutor(max_workers=max(1, SYMBOL_WORKERS)) as pool:
        futures = {
            pool.submit(
                _process_symbol, symbol, timeframe, job_id, names.get(symbol), lookback_bars,
                compute_trendlines, as_of_date, from_date, include_partial_today,
                prev_by_symbol.get(symbol),
            ): symbol
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
            except Exception as exc:  # _process_symbol never raises; defensive
                logger.warning("scan %s: %s failed: %s: %s", job_id, symbol, type(exc).__name__, exc)
                result = {"status": "failed", "data_through": None}
            with lock:
                done += 1
                if result.get("reused"):
                    reused += 1
                hits = result.get("hits") or []
                if hits:
                    pending_hits.extend(hits)
                if result.get("status") == "failed":
                    failed += 1
                elif result.get("status") == "skipped":
                    skipped += 1
                elif result.get("status") == "empty":
                    no_hits += 1
                if result.get("from_cache") is True:
                    candles_cached += 1
                elif result.get("from_cache") is False:
                    candles_fetched += 1
                data_through = result.get("data_through")
                if data_through and (max_date is None or data_through > max_date):
                    max_date = data_through

                now = time.monotonic()
                mirror_due = (
                    done == total
                    or done % _MIRROR_EVERY == 0
                    or now - last_mirror >= _MIRROR_INTERVAL_SEC
                )
                hits_due = done == total or len(pending_hits) >= _HITS_EVERY
            if mirror_due:
                # Mirror live counters to Redis (and persist to DB on the usual
                # cadence) at most every _MIRROR_EVERY symbols or every
                # _MIRROR_INTERVAL_SEC; the final symbol always mirrors.
                jobs_mod.update_state(
                    job_id, persist=(done % _PERSIST_EVERY == 0 or done == total),
                    done=done, failed=failed, skipped=skipped, no_hits=no_hits,
                    reused=reused, data_through=max_date,
                )
                last_mirror = now
            if hits_due:
                _flush_hits(force=done == total)

    if cancelled or jobs_mod.is_cancelled(job_id):
        # Persist any hits computed so far before terminal state; old hits of
        # previous jobs are intentionally left intact on cancel.
        _flush_hits(force=True)
        _cancel_provenance = _provenance(
            False, candles_cached, candles_fetched, prefilter_dropped, max_date,
            reused=reused,
        )
        jobs_mod.update_state(
            job_id, status="cancelled", done=done, failed=failed,
            skipped=skipped, no_hits=no_hits, reused=reused,
            data_through=max_date, finished_at=_now(),
            provenance=_cancel_provenance,
            params={**params, "reused": reused,
                    "provenance": _cancel_provenance},
        )
    else:
        # Flush pending hits first so this job's rows are durable before old
        # hits are superseded.
        _flush_hits(force=True)
        # Supersede previous hits now that this job's own hits are durable.
        # ``keep_job_id=job_id`` preserves the rows this job just wrote, so the
        # stored hits always belong to this (about-to-be) completed job. Old
        # hits stay visible while the scan runs (no empty result list mid
        # scan) and survive a cancel/failure, since the new job produced
        # nothing durable to replace them with.
        try:
            if universe == "custom":
                store.delete_hits_for(
                    universe, timeframe, keep_job_id=job_id, symbols=symbols
                )
            else:
                store.delete_hits_for(universe, timeframe, keep_job_id=job_id)
        except Exception:
            pass
        _done_provenance = _provenance(
            False, candles_cached, candles_fetched, prefilter_dropped, max_date,
            reused=reused,
        )
        _done_state: dict = {
            "status": "completed", "done": done, "failed": failed,
            "skipped": skipped, "no_hits": no_hits, "reused": reused,
            "data_through": max_date, "finished_at": _now(),
            "scan_signature": _detector_signature(max_date),
            "provenance": _done_provenance,
            "params": {**params, "reused": reused,
                       "scan_signature": _detector_signature(max_date),
                       "provenance": _done_provenance},
        }
        if prefilter_message:
            _done_state["message"] = prefilter_message
        jobs_mod.update_state(job_id, **_done_state)


# Alias for the ``run_scan`` name used by the TV-prefilter contract.
run_scan = run_job
