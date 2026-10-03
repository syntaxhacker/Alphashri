"""Models for chart-pattern compute jobs and detected pattern hits.

Two tables (see chart_patterns/CONTRACT.md §4):

- ``pattern_compute_jobs`` — one row per bounded scan job (universe + timeframe).
- ``pattern_hits`` — one row per detected pattern for a symbol/job.

The job row is the durable source of truth (jobs.py mirrors live state to Redis).
"""
import json
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from .base import Base


class PatternComputeJob(Base):
    """A bounded chart-pattern compute job (universe x timeframe)."""

    __tablename__ = "pattern_compute_jobs"

    id = Column(String(40), primary_key=True)
    universe = Column(String(32), nullable=False)
    timeframe = Column(String(8), nullable=False)
    status = Column(String(16), nullable=False, index=True)
    total = Column(Integer, nullable=False, default=0)
    done = Column(Integer, nullable=False, default=0)
    failed = Column(Integer, nullable=False, default=0)
    skipped = Column(Integer, nullable=False, default=0)
    queue_position = Column(Integer, nullable=True)
    data_through = Column(String(20), nullable=True)
    error = Column(String(500), nullable=True)
    requested_by = Column(Integer, nullable=True)
    params_json = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "job_id": self.id,
            "universe": self.universe,
            "timeframe": self.timeframe,
            "status": self.status,
            "total": self.total or 0,
            "done": self.done or 0,
            "failed": self.failed or 0,
            "skipped": self.skipped or 0,
            "queue_position": self.queue_position,
            "data_through": self.data_through,
            "error": self.error,
            "requested_by": self.requested_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


class PatternHit(Base):
    """A single detected chart pattern for a symbol within a job."""

    __tablename__ = "pattern_hits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), nullable=True, unique=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String(40), nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    name = Column(String(128), nullable=True)
    timeframe = Column(String(8), nullable=False, index=True)
    pattern_id = Column(String(48), nullable=False, index=True)
    pattern_name = Column(String(96), nullable=False)
    family = Column(String(24), nullable=False)
    direction = Column(String(12), nullable=False)
    status = Column(String(16), nullable=False)
    quality = Column(String(16), nullable=True)
    confidence = Column(Float, nullable=True)
    start_date = Column(String(20), nullable=True)
    end_date = Column(String(20), nullable=True)
    start_price = Column(Float, nullable=True)
    end_price = Column(Float, nullable=True)
    breakout_level = Column(Float, nullable=True)
    target = Column(Float, nullable=True)
    stop = Column(Float, nullable=True)
    rr = Column(Float, nullable=True)
    bars_ago = Column(Integer, nullable=True)
    volume_confirmed = Column(Boolean, nullable=False, default=False)
    payload_json = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_pattern_hits_symbol_timeframe", "symbol", "timeframe"),
        Index("ix_pattern_hits_job_status", "job_id", "status"),
    )

    def to_dict(self) -> dict:
        payload = {}
        if self.payload_json:
            try:
                payload = json.loads(self.payload_json)
            except (ValueError, TypeError):
                payload = {}
        return {
            "id": self.id,
            "uuid": self.uuid,
            "job_id": self.job_id,
            "symbol": self.symbol,
            "name": self.name,
            "timeframe": self.timeframe,
            "pattern_id": self.pattern_id,
            "pattern_name": self.pattern_name,
            "family": self.family,
            "direction": self.direction,
            "status": self.status,
            "quality": self.quality,
            "confidence": self.confidence,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "start_price": self.start_price,
            "end_price": self.end_price,
            "breakout_level": self.breakout_level,
            "target": self.target,
            "stop": self.stop,
            "rr": self.rr,
            "bars_ago": self.bars_ago,
            "volume_confirmed": bool(self.volume_confirmed),
            "trendlines": payload.get("trendlines") or [],
            "notes": payload.get("notes") or "",
            "pivots": payload.get("pivots") or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
