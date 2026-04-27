"""Model for tracking when stocks touch 52-week highs/lows."""
import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, UniqueConstraint
from sqlalchemy.sql import func

from .base import Base


class Stock52WeekTouch(Base):
    """Tracks when a stock touches its 52-week high or low.

    This provides historical memory so the screener UI can show
    "touched 52w 2 days ago" instead of just "No".

    Each symbol has at most one record per date (unique constraint on symbol + date).
    """
    __tablename__ = "stock_52week_touches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    symbol = Column(String(32), nullable=False, index=True)
    touched_date = Column(DateTime, nullable=False, index=True)  # The date when touch occurred
    touched_price = Column(Float, nullable=False)  # Price at touch
    is_high = Column(Boolean, default=True, nullable=False)  # True=52w high, False=52w low
    is_current_52w_high = Column(Boolean, default=False, nullable=False)  # Is still the 52w high record
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint('symbol', 'touched_date', name='uq_symbol_touched_date'),
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
