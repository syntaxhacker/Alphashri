from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime

import config

from ..database import Base
from .base import IdMixin


class PriceSurgeEvent(IdMixin, Base):
    __tablename__ = "price_surge_events"

    symbol = Column(String(20), nullable=False, index=True)
    move_pct = Column(Float, nullable=False)
    direction = Column(String(4), nullable=False)
    price = Column(Float, nullable=True)
    screener_id = Column(String(50), nullable=False)
    screen_label = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(config.IST), nullable=False)

    def to_dict(self) -> dict:
        dt = self.created_at
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc).astimezone(config.IST)
        return {
            "id": self.id,
            "symbol": self.symbol,
            "move_pct": self.move_pct,
            "direction": self.direction,
            "price": self.price,
            "screener_id": self.screener_id,
            "screen_label": self.screen_label,
            "created_at": dt.isoformat() if dt else None,
        }
