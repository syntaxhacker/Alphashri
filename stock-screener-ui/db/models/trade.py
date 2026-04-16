import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("bot_configs.id"), nullable=True, index=True)
    strategy_id = Column(Integer, nullable=True, index=True)
    strategy_name = Column(String(100), nullable=False, default="")
    symbol = Column(String(50), nullable=False, index=True)
    side = Column(String(10), nullable=False)
    quantity = Column(Integer, nullable=False)
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=True)
    entry_time = Column(DateTime(timezone=True), nullable=False)
    exit_time = Column(DateTime(timezone=True), nullable=True)
    stop_loss = Column(Float, nullable=True, default=0.0)
    take_profit = Column(Float, nullable=True, default=0.0)
    pnl = Column(Float, nullable=True, default=0.0)
    pnl_pct = Column(Float, nullable=True, default=0.0)
    costs = Column(Float, nullable=True, default=0.0)
    net_pnl = Column(Float, nullable=True, default=0.0)
    exit_reason = Column(String(50), nullable=True)
    notes = Column(String(500), nullable=True, default="")
    reason = Column(String(500), nullable=True, default="")
    peak_price = Column(Float, nullable=True, default=0.0)
    low_price = Column(Float, nullable=True, default=0.0)
    is_test = Column(Boolean, nullable=False, default=False)
    source = Column(String(20), nullable=False, default="live")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="trades")
    bot = relationship("BotConfig", backref="trades")

    def to_dict(self):
        hold = None
        if self.entry_time and self.exit_time:
            try:
                hold = int((self.exit_time - self.entry_time).total_seconds() / 60)
            except Exception:
                pass
        return {
            "id": self.uuid,
            "trade_id": f"TRADE-{self.id:06d}",
            "symbol": self.symbol,
            "side": self.side,
            "quantity": self.quantity,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "entry_time": self.entry_time.isoformat() if self.entry_time else None,
            "exit_time": self.exit_time.isoformat() if self.exit_time else None,
            "pnl": self.pnl,
            "pnl_pct": self.pnl_pct,
            "exit_reason": self.exit_reason,
            "costs": self.costs,
            "net_pnl": self.net_pnl,
            "strategy_id": self.strategy_id,
            "strategy_name": self.strategy_name,
            "is_test": self.is_test,
            "source": self.source,
            "stop_loss": self.stop_loss,
            "take_profit": self.take_profit,
            "hold_duration_minutes": hold,
            "notes": self.notes or "",
            "reason": self.reason or "",
            "bot_id": self.bot_id,
            "peak_price": self.peak_price or 0.0,
            "low_price": self.low_price or 0.0,
        }


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("bot_configs.id"), nullable=False, index=True)
    strategy_id = Column(Integer, nullable=True, index=True)
    strategy_name = Column(String(100), nullable=False, default="")
    symbol = Column(String(50), nullable=False, index=True)
    side = Column(String(10), nullable=False)
    quantity = Column(Integer, nullable=False)
    entry_price = Column(Float, nullable=False)
    stop_loss = Column(Float, nullable=True, default=0.0)
    take_profit = Column(Float, nullable=True, default=0.0)
    entry_time = Column(DateTime(timezone=True), nullable=False)
    current_price = Column(Float, nullable=True, default=0.0)
    unrealized_pnl = Column(Float, nullable=True, default=0.0)
    unrealized_pnl_pct = Column(Float, nullable=True, default=0.0)
    is_test = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="positions")
    bot = relationship("BotConfig", backref="positions")

    __table_args__ = (
        UniqueConstraint("bot_id", "strategy_id", "symbol", name="uq_bot_strategy_symbol"),
    )

    def to_dict(self):
        return {
            "id": self.uuid,
            "symbol": self.symbol,
            "side": self.side,
            "quantity": self.quantity,
            "entry_price": self.entry_price,
            "current_price": self.current_price,
            "stop_loss": self.stop_loss,
            "take_profit": self.take_profit,
            "unrealized_pnl": self.unrealized_pnl,
            "unrealized_pnl_pct": self.unrealized_pnl_pct,
            "entry_time": self.entry_time.isoformat() if self.entry_time else None,
            "strategy_id": self.strategy_id,
            "strategy_name": self.strategy_name,
        }
