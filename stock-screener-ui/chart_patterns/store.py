"""Persistence helpers for chart-pattern jobs + hits.

The DB row is the durable source of truth; ``jobs.py`` mirrors live state to
Redis. All helpers accept the module-level session factory so tests can point
``set_session_factory`` at an in-memory engine.
"""
from __future__ import annotations

import json
from typing import Any, Iterable, Optional

from sqlalchemy import func

from db.database import SessionLocal

try:  # models are registered via db.models on normal import
    from db.models.chart_patterns import PatternComputeJob, PatternHit
except Exception:  # pragma: no cover
    PatternComputeJob = None
    PatternHit = None


_session_factory = SessionLocal

_JOB_FIELDS = (
    "universe", "timeframe", "status", "total", "done", "failed", "skipped",
    "queue_position", "data_through", "error", "requested_by", "params_json",
    "started_at", "finished_at",
)

_DATETIME_FIELDS = {"started_at", "finished_at"}


def _coerce_datetime(value):
    if value is None or not isinstance(value, str):
        return value
    try:
        from datetime import datetime

        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _parse_params(raw) -> dict:
    """Parse a ``params_json`` column value back into a params dict."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def _with_params(row_dict: dict, raw) -> dict:
    row_dict["params"] = _parse_params(raw)
    return row_dict


def set_session_factory(factory) -> None:
    """Point the store at a different sessionmaker (used by tests)."""
    global _session_factory
    _session_factory = factory


def reset_session_factory() -> None:
    global _session_factory
    _session_factory = SessionLocal


def _new_session():
    return _session_factory()


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

def save_job(job: dict) -> dict:
    """Insert or update a job row. ``job`` must carry the ``job_id`` key."""
    job_id = job.get("job_id") or job.get("id")
    if not job_id:
        raise ValueError("job dict requires 'job_id'")
    job = dict(job)
    # The API/jobs layer passes ``params`` (a dict); the column is ``params_json``.
    if "params_json" not in job and "params" in job:
        params = job.get("params")
        if params is None:
            job["params_json"] = None
        elif isinstance(params, str):
            job["params_json"] = params
        else:
            try:
                job["params_json"] = json.dumps(params)
            except (TypeError, ValueError):
                job["params_json"] = str(params)
    session = _new_session()
    try:
        row = session.query(PatternComputeJob).filter(PatternComputeJob.id == job_id).first()
        if row is None:
            row = PatternComputeJob(id=job_id)
            session.add(row)
        for field in _JOB_FIELDS:
            if field in job and job[field] is not None:
                value = _coerce_datetime(job[field]) if field in _DATETIME_FIELDS else job[field]
                setattr(row, field, value)
            elif field in ("total", "done", "failed", "skipped") and job.get(field) is None:
                setattr(row, field, 0)
        # universe/timeframe are required; default from job if present
        if not row.universe:
            row.universe = job.get("universe") or ""
        if not row.timeframe:
            row.timeframe = job.get("timeframe") or ""
        if not row.status:
            row.status = job.get("status") or "queued"
        session.commit()
        session.refresh(row)
        return _with_params(row.to_dict(), row.params_json)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def update_job(job_id: str, **fields) -> Optional[dict]:
    session = _new_session()
    try:
        row = session.query(PatternComputeJob).filter(PatternComputeJob.id == job_id).first()
        if row is None:
            return None
        for key, value in fields.items():
            if key in _JOB_FIELDS or key in ("id",):
                if key in _DATETIME_FIELDS:
                    value = _coerce_datetime(value)
                setattr(row, key, value)
        session.commit()
        session.refresh(row)
        return _with_params(row.to_dict(), row.params_json)
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def get_job(job_id: str) -> Optional[dict]:
    session = _new_session()
    try:
        row = session.query(PatternComputeJob).filter(PatternComputeJob.id == job_id).first()
        return _with_params(row.to_dict(), row.params_json) if row else None
    except Exception:
        return None
    finally:
        session.close()


def latest_completed_job(universe: str, timeframe: str) -> Optional[dict]:
    """Newest completed job for a universe/timeframe, else ``None``."""
    session = _new_session()
    try:
        row = (
            session.query(PatternComputeJob)
            .filter(
                PatternComputeJob.universe == universe,
                PatternComputeJob.timeframe == timeframe,
                PatternComputeJob.status == "completed",
            )
            .order_by(
                PatternComputeJob.finished_at.desc().nullslast(),
                PatternComputeJob.id.desc(),
            )
            .first()
        )
        return _with_params(row.to_dict(), row.params_json) if row else None
    except Exception:
        return None
    finally:
        session.close()


def list_jobs(active_only: bool = False, limit: int = 50) -> list[dict]:
    session = _new_session()
    try:
        q = session.query(PatternComputeJob)
        if active_only:
            q = q.filter(PatternComputeJob.status.in_(("queued", "running")))
        q = q.order_by(PatternComputeJob.created_at.desc())
        return [_with_params(row.to_dict(), row.params_json) for row in q.limit(limit).all()]
    except Exception:
        return []
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Hits
# ---------------------------------------------------------------------------

def delete_hits_for(universe: str, timeframe: str, keep_job_id: Optional[str] = None) -> int:
    """Remove hits from *previous* jobs for a universe/timeframe.

    A new scan supersedes the old one; without this, results would accumulate
    stale hits from earlier detector versions / prior runs and the UI would show
    duplicates. ``keep_job_id`` (the current job) is preserved. Returns rows deleted.
    """
    session = _new_session()
    try:
        q = session.query(PatternComputeJob.id).filter(
            PatternComputeJob.universe == universe,
            PatternComputeJob.timeframe == timeframe,
        )
        if keep_job_id:
            q = q.filter(PatternComputeJob.id != keep_job_id)
        job_ids = [row[0] for row in q]
        if not job_ids:
            return 0
        deleted = (
            session.query(PatternHit)
            .filter(PatternHit.job_id.in_(job_ids))
            .delete(synchronize_session=False)
        )
        session.commit()
        return int(deleted or 0)
    except Exception:
        session.rollback()
        return 0
    finally:
        session.close()


def save_hits(job_id: str, hits: Iterable[dict]) -> int:
    """Persist detected hits (already enriched with symbol/name/timeframe)."""
    session = _new_session()
    saved = 0
    try:
        for hit in hits:
            payload = {
                "trendlines": hit.get("trendlines") or [],
                "notes": hit.get("notes") or "",
                "pivots": hit.get("pivots") or [],
                "trend_lines": hit.get("trend_lines") or [],
                "trend_lines_sig": hit.get("trend_lines_sig") or "",
            }
            row = PatternHit(
                job_id=job_id,
                symbol=(hit.get("symbol") or "").upper(),
                name=hit.get("name"),
                timeframe=str(hit.get("timeframe") or ""),
                pattern_id=hit.get("pattern_id") or "",
                pattern_name=hit.get("pattern_name") or "",
                family=hit.get("family") or "",
                direction=hit.get("direction") or "",
                status=hit.get("status") or "",
                quality=hit.get("quality"),
                confidence=_num(hit.get("confidence")),
                start_date=_str(hit.get("start_date")),
                end_date=_str(hit.get("end_date")),
                start_price=_num(hit.get("start_price")),
                end_price=_num(hit.get("end_price")),
                breakout_level=_num(hit.get("breakout_level")),
                target=_num(hit.get("target")),
                stop=_num(hit.get("stop")),
                rr=_num(hit.get("rr")),
                bars_ago=_int(hit.get("bars_ago")),
                volume_confirmed=bool(hit.get("volume_confirmed")),
                base_days=_int(hit.get("base_days")),
                range_pct=_num(hit.get("range_pct")),
                range_pos=_num(hit.get("range_pos")),
                payload_json=json.dumps(payload),
            )
            session.add(row)
            saved += 1
        session.commit()
        return saved
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _payload_trend_lines(raw) -> list:
    """Scan-time ``trend_lines`` carried in a hit's ``payload_json``.

    ``PatternHit.to_dict`` only surfaces the legacy payload keys, so the store
    re-attaches the scan-time lines here (read path follows the same
    payload→dict route). Missing/blank/malformed values yield ``[]``.
    """
    if not raw:
        return []
    try:
        payload = json.loads(raw) if isinstance(raw, str) else {}
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []
    lines = payload.get("trend_lines") or []
    return list(lines) if isinstance(lines, list) else []


def _payload_trend_lines_sig(raw) -> Optional[str]:
    """Scan-time ``trend_lines_sig`` carried in a hit's ``payload_json``.

    Follows the same payload→dict route as ``_payload_trend_lines``.
    Missing/blank/malformed values yield ``None`` (treated as stale).
    """
    if not raw:
        return None
    try:
        payload = json.loads(raw) if isinstance(raw, str) else {}
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    sig = payload.get("trend_lines_sig")
    return str(sig) if sig else None


def _apply_filters(query, filters: dict, session=None):
    join_job = bool(filters.get("universe")) 
    if join_job:
        query = query.join(PatternComputeJob, PatternComputeJob.id == PatternHit.job_id)

    if filters.get("job_id"):
        query = query.filter(PatternHit.job_id == filters["job_id"])
    if filters.get("universe"):
        query = query.filter(PatternComputeJob.universe == filters["universe"])
    if filters.get("timeframe"):
        query = query.filter(PatternHit.timeframe == filters["timeframe"])
    symbols = filters.get("symbol")
    if symbols:
        if isinstance(symbols, str):
            symbols = [symbols]
        query = query.filter(PatternHit.symbol.in_([str(s).upper() for s in symbols]))
    if filters.get("q"):
        escaped = (
            str(filters["q"]).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        like = f"%{escaped}%"
        query = query.filter(
            PatternHit.symbol.ilike(like, escape="\\")
            | PatternHit.name.ilike(like, escape="\\")
        )
    pattern_ids = filters.get("pattern_id")
    if pattern_ids:
        if isinstance(pattern_ids, str):
            query = query.filter(PatternHit.pattern_id == pattern_ids)
        else:
            query = query.filter(PatternHit.pattern_id.in_(list(pattern_ids)))

    for key, column in (
        ("family", PatternHit.family),
        ("direction", PatternHit.direction),
        ("status", PatternHit.status),
        ("quality", PatternHit.quality),
    ):
        values = filters.get(key)
        if values:
            if isinstance(values, str):
                values = [values]
            query = query.filter(column.in_(list(values)))

    if filters.get("formed_within_bars") is not None:
        query = query.filter(PatternHit.bars_ago <= int(filters["formed_within_bars"]))
    if filters.get("min_rr") is not None:
        query = query.filter(PatternHit.rr >= float(filters["min_rr"]))
    if filters.get("min_base_days") is not None:
        query = query.filter(PatternHit.base_days >= int(filters["min_base_days"]))
    if filters.get("max_range_pct") is not None:
        query = query.filter(PatternHit.range_pct <= float(filters["max_range_pct"]))
    if filters.get("min_range_pos") is not None:
        # NULL range_pos rows compare NULL (not TRUE) and are excluded.
        query = query.filter(PatternHit.range_pos >= float(filters["min_range_pos"]))
    if filters.get("volume_confirmed") is not None:
        query = query.filter(PatternHit.volume_confirmed.is_(bool(filters["volume_confirmed"])))
    if filters.get("max_52w_gap") is not None:
        from db.models.stock_52w_touch import Stock52WeekRange
        sess = session if session is not None else query.session
        gap = (Stock52WeekRange.high_52w - Stock52WeekRange.close) / Stock52WeekRange.high_52w * 100
        near = sess.query(Stock52WeekRange.symbol).filter(gap <= float(filters["max_52w_gap"]))
        query = query.filter(PatternHit.symbol.in_(near))
    return query


def _needs_dedupe(filters: dict) -> bool:
    """True when hits may repeat across jobs (no explicit job/universe scope).

    A symbol can belong to several scanned universes, so the same detection is
    stored once per job. With an explicit ``job_id`` or ``universe`` the query
    is already scoped to one job family and keeps its exact behaviour.
    """
    return not filters.get("job_id") and not filters.get("universe")


def _attach_52w_gaps(session, items: list) -> None:
    """Attach ``to_52w_high`` (percent gap to the 52W high) to each item, in place.

    A single ``stock_52w_range`` query covers the whole page; symbols with no
    row get ``None``.
    """
    if not items:
        return
    try:
        from db.models.stock_52w_touch import Stock52WeekRange
    except Exception:
        for item in items:
            if isinstance(item, dict):
                item["to_52w_high"] = None
        return
    symbols = [str(item.get("symbol") or "").upper() for item in items if isinstance(item, dict)]
    symbols = [s for s in symbols if s]
    if not symbols:
        for item in items:
            if isinstance(item, dict):
                item["to_52w_high"] = None
        return
    try:
        rows = (
            session.query(Stock52WeekRange.symbol, Stock52WeekRange.high_52w, Stock52WeekRange.close)
            .filter(Stock52WeekRange.symbol.in_(symbols))
            .all()
        )
    except Exception:
        rows = []
    gaps: dict[str, float] = {}
    for symbol, high, close in rows:
        try:
            if high:
                gaps[str(symbol).upper()] = round(((high - close) / high) * 100, 2)
        except (TypeError, ZeroDivisionError, ArithmeticError):
            continue
    for item in items:
        if isinstance(item, dict):
            item["to_52w_high"] = gaps.get(str(item.get("symbol") or "").upper())


def _deduped_base(session, base):
    """Restrict ``base`` to the newest row per pattern identity.

    Identity is ``(symbol, timeframe, pattern_id, start_date)`` and newest is the
    largest autoincrement ``id`` (later jobs insert later rows). ``end_date`` is
    excluded so a pattern re-detected a bar later in another job collapses to its
    newest instance instead of listing twice.
    """
    ids_subq = (
        base.with_entities(func.max(PatternHit.id))
        .group_by(
            PatternHit.symbol,
            PatternHit.timeframe,
            PatternHit.pattern_id,
            PatternHit.start_date,
        )
        .subquery()
    )
    return session.query(PatternHit).filter(PatternHit.id.in_(ids_subq))


def query_results(filters: dict, limit: int = 100, offset: int = 0):
    """Return ``(items, total, summary)`` for the given filters.

    Ordering is confidence-first by default. ``filters["sort"] == "newest"``
    instead surfaces the freshest formations first (``bars_ago`` ascending),
    breaking ties by confidence then insertion order.
    ``filters["sort"] == "range_pos"`` orders by consolidation ``range_pos``
    descending (NULLs last), breaking ties by confidence then insertion order.
    """
    session = _new_session()
    try:
        base = _apply_filters(session.query(PatternHit), filters, session)
        if _needs_dedupe(filters):
            base = _deduped_base(session, base)
        total = base.count()
        if filters.get("sort") == "newest":
            order_by = (
                PatternHit.bars_ago.asc(),
                PatternHit.confidence.desc().nullslast(),
                PatternHit.id.desc(),
            )
        elif filters.get("sort") == "range_pos":
            order_by = (
                PatternHit.range_pos.desc().nullslast(),
                PatternHit.confidence.desc().nullslast(),
                PatternHit.id.desc(),
            )
        else:
            order_by = (PatternHit.confidence.desc().nullslast(), PatternHit.id.desc())
        rows = (
            base.order_by(*order_by)
            .offset(max(0, int(offset)))
            .limit(max(0, int(limit)))
            .all()
        )
        items = []
        for row in rows:
            dto = row.to_dict()
            dto["trend_lines"] = _payload_trend_lines(row.payload_json)
            dto["trend_lines_sig"] = _payload_trend_lines_sig(row.payload_json)
            items.append(dto)
        _attach_52w_gaps(session, items)

        summary = _summary_for(session, filters, base, total)
        return items, total, summary
    except Exception:
        return [], 0, _empty_summary()
    finally:
        session.close()


def _counts_by(base, column) -> dict[str, int]:
    """Group the *unlimited* filtered base query by ``column`` into counts.

    Powers the filter-rail chips, which must reflect the whole filtered result
    set rather than just the current (capped) page.
    """
    try:
        rows = (
            base.with_entities(column, func.count(PatternHit.id))
            .group_by(column)
            .all()
        )
        return {str(key): int(count) for key, count in rows if key}
    except Exception:
        return {}


def _summary_for(session, filters: dict, base, total: int) -> dict:
    confirmed = base.filter(PatternHit.status == "confirmed").count()
    forming = base.filter(PatternHit.status == "forming").count()
    bullish = base.filter(PatternHit.direction == "bullish").count()
    bearish = base.filter(PatternHit.direction == "bearish").count()
    data_through = base.with_entities(func.max(PatternHit.end_date)).scalar()
    scanned = _scanned_count(session, filters, base)
    return {
        "scanned": scanned,
        "patterns": total,
        "in_view": total,
        "confirmed": confirmed,
        "forming": forming,
        "bullish": bullish,
        "bearish": bearish,
        "data_through": data_through,
        "last_scan_at": _last_scan_at(session, filters),
        "pattern_counts": _counts_by(base, PatternHit.pattern_id),
        "family_counts": _counts_by(base, PatternHit.family),
    }


def _last_scan_at(session, filters: dict) -> Optional[str]:
    """ISO timestamp of the latest *completed* job for the combo, else ``None``.

    The Patterns UI uses this to decide whether the currently displayed (but
    possibly stale) hits need a background refresh. Only completed jobs count:
    queued/running jobs have no meaningful ``finished_at`` yet, and failed jobs
    produced no usable hit set.
    """
    if not filters.get("universe") and not filters.get("timeframe"):
        return None
    try:
        q = session.query(func.max(PatternComputeJob.finished_at)).filter(
            PatternComputeJob.status == "completed"
        )
        if filters.get("universe"):
            q = q.filter(PatternComputeJob.universe == filters["universe"])
        if filters.get("timeframe"):
            q = q.filter(PatternComputeJob.timeframe == filters["timeframe"])
        value = q.scalar()
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)
    except Exception:
        return None


def _scanned_count(session, filters: dict, base) -> int:
    try:
        if filters.get("job_id"):
            row = (
                session.query(PatternComputeJob)
                .filter(PatternComputeJob.id == filters["job_id"])
                .first()
            )
            if row:
                return int(row.total or row.done or 0)
        if filters.get("universe") or filters.get("timeframe"):
            # Report the symbol count of the latest completed scan for the combo,
            # not the sum across every historical job (which grows unbounded).
            q = session.query(PatternComputeJob.total).filter(
                PatternComputeJob.status == "completed",
                PatternComputeJob.total.isnot(None),
            )
            if filters.get("universe"):
                q = q.filter(PatternComputeJob.universe == filters["universe"])
            if filters.get("timeframe"):
                q = q.filter(PatternComputeJob.timeframe == filters["timeframe"])
            row = q.order_by(
                PatternComputeJob.finished_at.desc().nullslast(),
                PatternComputeJob.id.desc(),
            ).first()
            if row and row[0]:
                return int(row[0])
            # No completed job matches: fall back to the latest job's total
            # regardless of status (queued/running/failed/cancelled), else 0.
            # The distinct-hits count would under-report (hits may be empty or
            # filtered); the job row is the source of truth for scan size.
            q_latest = session.query(PatternComputeJob.total)
            if filters.get("universe"):
                q_latest = q_latest.filter(
                    PatternComputeJob.universe == filters["universe"]
                )
            if filters.get("timeframe"):
                q_latest = q_latest.filter(
                    PatternComputeJob.timeframe == filters["timeframe"]
                )
            latest = q_latest.order_by(
                PatternComputeJob.finished_at.desc().nullslast(),
                PatternComputeJob.created_at.desc(),
                PatternComputeJob.id.desc(),
            ).first()
            if latest and latest[0]:
                return int(latest[0])
            return 0
        return int(base.with_entities(func.count(func.distinct(PatternHit.symbol))).scalar() or 0)
    except Exception:
        return 0


def _empty_summary() -> dict:
    return {
        "scanned": 0,
        "patterns": 0,
        "in_view": 0,
        "confirmed": 0,
        "forming": 0,
        "bullish": 0,
        "bearish": 0,
        "data_through": None,
        "last_scan_at": None,
        "pattern_counts": {},
        "family_counts": {},
    }


def compute_summary(filters: dict) -> dict:
    session = _new_session()
    try:
        base = _apply_filters(session.query(PatternHit), filters, session)
        if _needs_dedupe(filters):
            base = _deduped_base(session, base)
        total = base.count()
        return _summary_for(session, filters, base, total)
    except Exception:
        return _empty_summary()
    finally:
        session.close()


def get_symbol_detail(symbol: str, timeframe: Optional[str] = None) -> dict:
    """Hits + counts for a single symbol (API enriches with candle fields)."""
    session = _new_session()
    symbol_u = str(symbol).upper()
    try:
        q = session.query(PatternHit).filter(PatternHit.symbol == symbol_u)
        if timeframe:
            q = q.filter(PatternHit.timeframe == timeframe)
        # A symbol can belong to several scanned universes (e.g. nifty50 and
        # nifty500), so the same detection is stored once per job. Keep only the
        # newest row per pattern identity (start_date, not end_date — a pattern
        # re-detected a bar later is the same instance), then sort by confidence.
        rows = q.order_by(PatternHit.id.desc()).all()
        best: dict[tuple, PatternHit] = {}
        for row in rows:
            key = (row.pattern_id, row.start_date)
            if key not in best:
                best[key] = row
        patterns = []
        for row in best.values():
            dto = row.to_dict()
            dto["trend_lines"] = _payload_trend_lines(row.payload_json)
            dto["trend_lines_sig"] = _payload_trend_lines_sig(row.payload_json)
            patterns.append(dto)
        patterns.sort(
            key=lambda p: (
                p.get("confidence") is None,
                -(p.get("confidence") or 0.0),
            )
        )
        counts = {
            "confirmed": sum(1 for p in patterns if p.get("status") == "confirmed"),
            "forming": sum(1 for p in patterns if p.get("status") == "forming"),
        }
        all_tf_rows = (
            session.query(func.distinct(PatternHit.timeframe))
            .filter(PatternHit.symbol == symbol_u)
            .all()
        )
        timeframes = sorted({r[0] for r in all_tf_rows if r[0]})
        name = next((p.get("name") for p in patterns if p.get("name")), None)
        return {
            "symbol": symbol_u,
            "name": name,
            "timeframe": timeframe,
            "counts": counts,
            "timeframes": timeframes,
            "patterns": patterns,
        }
    except Exception:
        return {
            "symbol": symbol_u,
            "name": None,
            "timeframe": timeframe,
            "counts": {"confirmed": 0, "forming": 0},
            "timeframes": [],
            "patterns": [],
        }
    finally:
        session.close()


def _num(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    try:
        # Reject NaN/Inf so non-finite floats never reach the DB/JSON layer.
        import math

        if not math.isfinite(out):
            return None
    except Exception:
        return None
    return out


def _int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)
