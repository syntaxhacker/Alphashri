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
        return row.to_dict()
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
        return row.to_dict()
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def get_job(job_id: str) -> Optional[dict]:
    session = _new_session()
    try:
        row = session.query(PatternComputeJob).filter(PatternComputeJob.id == job_id).first()
        return row.to_dict() if row else None
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
        return [row.to_dict() for row in q.limit(limit).all()]
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


def _apply_filters(query, filters: dict):
    join_job = bool(filters.get("universe")) 
    if join_job:
        query = query.join(PatternComputeJob, PatternComputeJob.id == PatternHit.job_id)

    if filters.get("job_id"):
        query = query.filter(PatternHit.job_id == filters["job_id"])
    if filters.get("universe"):
        query = query.filter(PatternComputeJob.universe == filters["universe"])
    if filters.get("timeframe"):
        query = query.filter(PatternHit.timeframe == filters["timeframe"])
    if filters.get("symbol"):
        query = query.filter(PatternHit.symbol == str(filters["symbol"]).upper())
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
    if filters.get("volume_confirmed") is not None:
        query = query.filter(PatternHit.volume_confirmed.is_(bool(filters["volume_confirmed"])))
    return query


def query_results(filters: dict, limit: int = 100, offset: int = 0):
    """Return ``(items, total, summary)`` for the given filters."""
    session = _new_session()
    try:
        base = _apply_filters(session.query(PatternHit), filters)
        total = base.count()
        rows = (
            base.order_by(PatternHit.confidence.desc().nullslast(), PatternHit.id.desc())
            .offset(max(0, int(offset)))
            .limit(max(0, int(limit)))
            .all()
        )
        items = [row.to_dict() for row in rows]

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
        "pattern_counts": _counts_by(base, PatternHit.pattern_id),
        "family_counts": _counts_by(base, PatternHit.family),
    }


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
            q = session.query(func.coalesce(func.sum(PatternComputeJob.total), 0))
            if filters.get("universe"):
                q = q.filter(PatternComputeJob.universe == filters["universe"])
            if filters.get("timeframe"):
                q = q.filter(PatternComputeJob.timeframe == filters["timeframe"])
            val = q.scalar()
            if val:
                return int(val)
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
        "pattern_counts": {},
        "family_counts": {},
    }


def compute_summary(filters: dict) -> dict:
    session = _new_session()
    try:
        base = _apply_filters(session.query(PatternHit), filters)
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
        rows = q.order_by(PatternHit.confidence.desc().nullslast(), PatternHit.id.desc()).all()
        patterns = [row.to_dict() for row in rows]
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
        return float(value)
    except (TypeError, ValueError):
        return None


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
