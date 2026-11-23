"""First-class storage for option paper structures placed from the dock.

Separate from the equity ``Position``/``Trade`` book: a structure has several
legs, an expiry lifecycle and replay metadata, none of which the equity runner
owns. The headless ``options_paper`` runner keeps its own JSONL ledger.
"""
import json

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    inspect as sa_inspect,
)
from sqlalchemy.orm import relationship

from .base import Base, IdMixin, TimestampMixin, UUIDMixin


class OptionPaperPosition(Base, IdMixin, UUIDMixin, TimestampMixin):
    """One multi-leg paper structure, live or backdated from a replay."""

    __tablename__ = "option_paper_positions"

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source = Column(String(16), nullable=False, default="live")  # "live" | "replay"
    status = Column(String(12), nullable=False, default="open", index=True)  # open|closed|expired
    underlying = Column(String(30), nullable=False)
    expiry = Column(String(10), nullable=False)  # ISO date, as in option_chain_snapshots
    name = Column(String(120), nullable=True, default="")

    entry_ts = Column(DateTime(timezone=True), nullable=False)
    entry_spot = Column(Float, nullable=False)
    lots = Column(Integer, nullable=False, default=1)
    net_debit = Column(Float, nullable=False, default=0.0)
    costs_est = Column(Float, nullable=False, default=0.0)
    max_profit = Column(Float, nullable=True)
    max_loss = Column(Float, nullable=True)
    # JSON string so an unbounded structure can carry more than two breakevens.
    breakevens = Column(Text, nullable=False, default="[]")
    realized_pnl = Column(Float, nullable=False, default=0.0)
    close_reason = Column(String(40), nullable=True, default="")
    closed_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(String(500), nullable=True, default="")

    user = relationship("User", backref="option_paper_positions")
    legs = relationship(
        "OptionPaperLeg",
        back_populates="position",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_opp_user_status", "user_id", "status"),
        Index("ix_opp_underlying_expiry", "underlying", "expiry"),
    )

    def _breakevens_list(self):
        try:
            parsed = json.loads(self.breakevens or "[]")
        except (json.JSONDecodeError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "uuid": self.uuid,
            "userId": self.user_id,
            "source": self.source,
            "status": self.status,
            "underlying": self.underlying,
            "expiry": self.expiry,
            "name": self.name or "",
            "entryTs": self.entry_ts.isoformat() if self.entry_ts else None,
            "entrySpot": self.entry_spot,
            "lots": self.lots,
            "netDebit": self.net_debit,
            "costsEst": self.costs_est,
            "maxProfit": self.max_profit,
            "maxLoss": self.max_loss,
            "breakevens": self._breakevens_list(),
            "realizedPnl": self.realized_pnl or 0.0,
            "closeReason": self.close_reason or "",
            "closedAt": self.closed_at.isoformat() if self.closed_at else None,
            "notes": self.notes or "",
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class OptionPaperLeg(Base, IdMixin):
    """A single option contract inside a paper structure."""

    __tablename__ = "option_paper_legs"

    position_id = Column(
        Integer,
        ForeignKey("option_paper_positions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action = Column(String(4), nullable=False)  # "BUY" | "SELL"
    opt_type = Column(String(2), nullable=False)  # "CE" | "PE"
    strike = Column(Float, nullable=False)
    lots = Column(Integer, nullable=False, default=1)
    qty = Column(Integer, nullable=False)
    instrument_key = Column(String(40), nullable=True)
    entry_premium = Column(Float, nullable=False)
    entry_ts = Column(DateTime(timezone=True), nullable=True)
    mark_premium = Column(Float, nullable=True)
    mark_ts = Column(DateTime(timezone=True), nullable=True)
    exit_premium = Column(Float, nullable=True)

    position = relationship("OptionPaperPosition", back_populates="legs")

    __table_args__ = (
        UniqueConstraint(
            "position_id", "action", "opt_type", "strike",
            name="uq_option_paper_leg_identity",
        ),
    )

    @property
    def effective_entry_ts(self):
        """Own entry time, or the parent's when the leg was part of the initial fill.

        A NULL ``entry_ts`` is the legacy representation of "entered with the
        position"; it stays NULL on disk so old rows keep their meaning.
        """
        if self.entry_ts is not None:
            return self.entry_ts
        if "position" in sa_inspect(self).unloaded:
            return None
        return self.position.entry_ts if self.position is not None else None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "positionId": self.position_id,
            "action": self.action,
            "optType": self.opt_type,
            "strike": self.strike,
            "lots": self.lots,
            "qty": self.qty,
            "instrumentKey": self.instrument_key,
            "entryPremium": self.entry_premium,
            "entryTs": self.entry_ts.isoformat() if self.entry_ts else None,
            "markPremium": self.mark_premium,
            "markTs": self.mark_ts.isoformat() if self.mark_ts else None,
            "exitPremium": self.exit_premium,
        }


__all__ = ["OptionPaperPosition", "OptionPaperLeg"]
