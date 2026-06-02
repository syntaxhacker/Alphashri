"""Model for tracking when stocks touch 52-week highs/lows."""
import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, UniqueConstraint, Index
from sqlalchemy.sql import func

from .base import Base


class Stock52WeekRange(Base):
    """Current 52-week high and low for each symbol.

    Updated every 5 minutes during market hours via TradingView broad screener.
    """
    __tablename__ = "stock_52w_range"

    symbol = Column(String(32), primary_key=True, index=True)
    high_52w = Column(Float, nullable=False)
    low_52w = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "high_52w": self.high_52w,
            "low_52w": self.low_52w,
            "close": self.close,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Stock52WeekTouch(Base):
    """Tracks when a stock touches its 52-week high or low.

    This provides historical memory so the screener UI can show
    "touched 52w 2 days ago" instead of just "No".

    Each symbol has at most one record per date (unique constraint on symbol + date).
    """
    __tablename__ = "stock_52week_touches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), nullable=True, unique=True, default=lambda: str(uuid.uuid4()))
    symbol = Column(String(32), nullable=False, index=True)
    touched_date = Column(DateTime, nullable=False, index=True)
    touched_price = Column(Float, nullable=False)
    is_high = Column(Boolean, default=True, nullable=False)
    is_current_52w_high = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint('symbol', 'touched_date', name='uq_symbol_touched_date'),
        Index('ix_stock_52week_touches_symbol_touched_date', 'symbol', 'touched_date'),
    )

    def __repr__(self):
        return (f"<Stock52WeekTouch(symbol='{self.symbol}', "
                f"touched_date='{self.touched_date}', "
                f"touched_price={self.touched_price}, is_high={self.is_high})>")

    def to_dict(self) -> dict:
        return {
            "id": self.uuid,
            "symbol": self.symbol,
            "touched_date": self.touched_date.isoformat() if self.touched_date else None,
            "touched_price": self.touched_price,
            "is_high": self.is_high,
            "is_current_52w_high": self.is_current_52w_high,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }