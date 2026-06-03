import json
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base, PaperTradingMixin, PythonUpdatedAtMixin


class Trade(PaperTradingMixin, Base):
    __tablename__ = "trades"

    # id, uuid, user_id, bot_id (nullable), strategy_*, symbol, side, quantity, entry_price, entry_time, created_at,
    # stop_loss, take_profit, peak_price, low_price, is_test
    # are provided by PaperTradingMixin (DRY fix for ~7+ line dup with Position; mixin now also covers sl/tp/peak/low/is_test)

    exit_price = Column(Float, nullable=True)
    exit_time = Column(DateTime(timezone=True), nullable=True)
    pnl = Column(Float, nullable=True, default=0.0)
    pnl_pct = Column(Float, nullable=True, default=0.0)
    costs = Column(Float, nullable=True, default=0.0)
    net_pnl = Column(Float, nullable=True, default=0.0)
    exit_reason = Column(String(50), nullable=True)
    notes = Column(String(500), nullable=True, default="")
    reason = Column(String(500), nullable=True, default="")
    source = Column(String(20), nullable=False, default="live")

    user = relationship("User", backref="trades")
    bot = relationship("BotConfig", backref="trades")

    def to_dict(self):
        hold = None
        if self.entry_time and self.exit_time:
            try:
                hold = int((self.exit_time - self.entry_time).total_seconds() / 60)
            except Exception:
                pass
        d = self._paper_base_to_dict()
        d.update({
            "trade_id": f"TRADE-{self.id:06d}",
            "exit_price": self.exit_price,
            "exit_time": self.exit_time.isoformat() if self.exit_time else None,
            "pnl": self.pnl,
            "pnl_pct": self.pnl_pct,
            "exit_reason": self.exit_reason,
            "costs": self.costs,
            "net_pnl": self.net_pnl,
            "source": self.source,
            "is_test": self.is_test,
            "bot_id": self.bot_id,
            "hold_duration_minutes": hold,
            "notes": self.notes or "",
            "reason": self.reason or "",
        })
        return d


class Position(PaperTradingMixin, PythonUpdatedAtMixin, Base):
    __tablename__ = "positions"

    # id, uuid, user_id, bot_id, strategy_*, symbol, side, quantity, entry_price, entry_time, created_at,
    # stop_loss, take_profit, peak_price, low_price, is_test
    # from PaperTradingMixin (DRY).
    # bot_id redeclared below for nullable=False (stricter).
    # updated_at from PythonUpdatedAtMixin (DRY).

    bot_id = Column(Integer, ForeignKey("bot_configs.id"), nullable=False, index=True)  # stricter than mixin's True

    current_price = Column(Float, nullable=True, default=0.0)
    unrealized_pnl = Column(Float, nullable=True, default=0.0)
    unrealized_pnl_pct = Column(Float, nullable=True, default=0.0)
    strategy_type = Column(String(20), nullable=True, default="")
    metadata_json = Column(String(2000), nullable=True, default="")

    user = relationship("User", backref="positions")
    bot = relationship("BotConfig", backref="positions")

    __table_args__ = (
        UniqueConstraint("bot_id", "strategy_id", "symbol", name="uq_bot_strategy_symbol"),
    )

    def to_dict(self):
        metadata = {}
        if self.metadata_json:
            try:
                metadata = json.loads(self.metadata_json)
            except (json.JSONDecodeError, TypeError):
                pass
        entry_reason = metadata.get("entry_reason", "") if isinstance(metadata, dict) else ""
        notes = metadata.get("notes", "") if isinstance(metadata, dict) else ""
        d = self._paper_base_to_dict()
        d.update({
            "current_price": self.current_price,
            "unrealized_pnl": self.unrealized_pnl,
            "unrealized_pnl_pct": self.unrealized_pnl_pct,
            "strategy_type": self.strategy_type or "",
            "entry_reason": entry_reason,
            "notes": notes,
        })
        return d
