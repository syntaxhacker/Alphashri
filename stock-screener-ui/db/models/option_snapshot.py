"""Durable option-chain quotes for IV/history analytics.

One row per (underlying, expiry, strike, side, minute). The table is an append
log keyed on that tuple so a re-poll inside the same minute is idempotent while
the next minute produces a new observation. It is the raw material for IV rank,
term/skew history, surface history and payoff calibration — none of which can
be computed from today's in-memory chain alone.

Numeric columns stay nullable on purpose: a missing IV or LTP on an illiquid
strike is real information, not a zero. Only a non-finite LTP/strike disqualifies
a leg (see :mod:`api.options_snapshots`).
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    String,
    UniqueConstraint,
)

from .base import Base, IdMixin


class OptionChainSnapshot(Base, IdMixin):
    """A single CE/PE quote observed at one minute in an option chain."""

    __tablename__ = "option_chain_snapshots"

    ts = Column(DateTime(timezone=True), nullable=False)
    underlying = Column(String(20), nullable=False)
    expiry = Column(String(10), nullable=False)
    strike = Column(Float, nullable=False)
    side = Column(String(2), nullable=False)  # "CE" | "PE"

    ltp = Column(Float, nullable=True)
    iv = Column(Float, nullable=True)
    delta = Column(Float, nullable=True)
    gamma = Column(Float, nullable=True)
    theta = Column(Float, nullable=True)
    vega = Column(Float, nullable=True)
    oi = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    spot = Column(Float, nullable=True)

    session_date = Column(String(10), nullable=False)
    quotes_live = Column(Boolean, nullable=False, default=False)
    iv_source = Column(String(20), nullable=False, default="upstox")

    __table_args__ = (
        UniqueConstraint(
            "underlying", "expiry", "strike", "side", "ts",
            name="uq_option_chain_snapshot",
        ),
        Index("ix_ocs_underlying_ts", "underlying", "ts"),
        Index("ix_ocs_underlying_expiry_ts", "underlying", "expiry", "ts"),
        Index("ix_ocs_underlying_session_date", "underlying", "session_date"),
        # Retention/delete scans by ts only (`purge_old_snapshots`).
        Index("ix_ocs_ts", "ts"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ts": self.ts.isoformat() if self.ts else None,
            "underlying": self.underlying,
            "expiry": self.expiry,
            "strike": self.strike,
            "side": self.side,
            "ltp": self.ltp,
            "iv": self.iv,
            "delta": self.delta,
            "gamma": self.gamma,
            "theta": self.theta,
            "vega": self.vega,
            "oi": self.oi,
            "volume": self.volume,
            "spot": self.spot,
            "session_date": self.session_date,
            "quotes_live": bool(self.quotes_live),
            "iv_source": self.iv_source,
        }


__all__ = ["OptionChainSnapshot"]
