import enum
from sqlalchemy import Column, Integer, String, Date, Enum, DateTime, UniqueConstraint
from sqlalchemy.sql import func

from .base import Base


class HolidayType(str, enum.Enum):
    TRADING = "trading"
    CLEARING = "clearing"


class MarketHoliday(Base):
    __tablename__ = "market_holidays"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    description = Column(String(200), nullable=False)
    type = Column(Enum(HolidayType, name="holiday_type"), nullable=False, default=HolidayType.TRADING)
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("date", name="uq_market_holiday_date"),
    )

    def to_dict(self):
        return {
            "date": self.date.isoformat() if self.date else None,
            "description": self.description,
            "type": self.type.value if self.type else None,
        }
