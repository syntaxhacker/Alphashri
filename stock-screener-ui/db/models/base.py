import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, Boolean,
    ForeignKey, Table, UniqueConstraint, Index, Date,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class IdMixin:
    """Mixin for standard auto-incrementing integer primary key.

    Used by most entity tables.
    """
    id = Column(Integer, primary_key=True, autoincrement=True)


class UUIDMixin:
    """Mixin providing a secondary UUID identifier (string, auto-generated).

    Common across many models (Trade, Position, User, BotConfig, etc).
    Note: attribute variants (index=True/False, nullable) exist; override in subclass if needed
    by redeclaring the Column.
    """
    uuid = Column(
        String(36),
        unique=True,
        nullable=False,
        default=lambda: str(uuid.uuid4()),
    )


class TimestampMixin:
    """Mixin for standard created_at / updated_at using DB server defaults.

    Preferred for most models (config, chat, screener, etc).
    Uses timezone-aware DateTime.
    """
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PythonCreatedAtMixin:
    """Mixin using Python-side UTC default for created_at (explicit datetime.now(timezone.utc)).

    Used by Trade/Position (shared), and could be for others needing app-side ts.
    """
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class PythonUpdatedAtMixin:
    """Mixin using Python-side UTC default for updated_at (with onupdate)."""
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class PythonTimestampMixin(PythonCreatedAtMixin, PythonUpdatedAtMixin):
    """Both created+updated with python utc defaults. For models needing full pair."""
    pass


class PaperTradingMixin(IdMixin, UUIDMixin, PythonCreatedAtMixin):
    """Shared columns for paper trading entities: Trade and Position.

    Addresses ~7-line (and more) internal duplication of id/uuid/user/bot/strategy/symbol/side/qty/entry etc.
    Also extracts the duplicated stop_loss/take_profit/peak/low/is_test columns (DRY).
    Subclasses provide __tablename__, additional columns, relationships, to_dict, and __table_args__.

    bot_id nullable differs (True for Trade, False for Position) -> redeclare in Position.
    Trade gets only created_at (no updated); Position inherits extra PythonUpdatedAtMixin.
    """
    # Common paper trading fields (exact dups extracted)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("bot_configs.id"), nullable=True, index=True)
    strategy_id = Column(Integer, nullable=True, index=True)
    strategy_name = Column(String(100), nullable=False, default="")
    symbol = Column(String(50), nullable=False, index=True)
    side = Column(String(10), nullable=False)
    quantity = Column(Integer, nullable=False)
    entry_price = Column(Float, nullable=False)
    entry_time = Column(DateTime(timezone=True), nullable=False)

    # Common fields duplicated in Trade and Position (moved here for DRY; already in schema via prior migrations)
    stop_loss = Column(Float, nullable=True, default=0.0)
    take_profit = Column(Float, nullable=True, default=0.0)
    peak_price = Column(Float, nullable=True, default=0.0)
    low_price = Column(Float, nullable=True, default=0.0)
    is_test = Column(Boolean, nullable=False, default=False)

    # Note: created_at from PythonCreatedAtMixin; id/uuid too.
    # Relationships and specific fields (exit vs current, pnl, source, metadata etc) remain in subclasses.

    def _paper_base_to_dict(self) -> dict:
        """Shared serialization for common paper-trading fields (id as uuid, symbol, side, qty, entry, strategies, peak/low, sl/tp).
        Note: bot_id and is_test intentionally omitted here (Position.to_dict historically did not emit them; Trade adds them).
        Subclasses should call this and .update() with their specifics (e.g. exit_ vs current_, pnl fields).
        """
        return {
            "id": self.uuid,
            "symbol": self.symbol,
            "side": self.side,
            "quantity": self.quantity,
            "entry_price": self.entry_price,
            "entry_time": self.entry_time.isoformat() if self.entry_time else None,
            "strategy_id": self.strategy_id,
            "strategy_name": self.strategy_name,
            "peak_price": self.peak_price or 0.0,
            "low_price": self.low_price or 0.0,
            "stop_loss": self.stop_loss or 0.0,
            "take_profit": self.take_profit or 0.0,
        }


class UserOwnedConfigMixin(IdMixin, TimestampMixin):
    """Shared columns for user-owned named config tables e.g. Screener and ReplaySavedConfig.

    Addresses ~5-line similar model structures (id, user_id, name, desc, timestamps + unique).
    Subclasses add their JSON/config columns, the __table_args__ UniqueConstraint (names differ),
    and should call self._base_to_dict() then extend in their to_dict() for full DRY.
    """
    user_id = Column(Integer, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)

    # created/updated from TimestampMixin

    def _base_to_dict(self) -> dict:
        """Shared serialization for common fields. Subclasses should call and extend."""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "description": self.description or "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
