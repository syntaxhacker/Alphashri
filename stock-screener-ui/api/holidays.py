"""
Holidays API - Endpoints for market holiday queries.
"""

from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.holiday import MarketHoliday, HolidayType

router = APIRouter(prefix="/api/holidays", tags=["holidays"])


@router.get("")
def get_holidays(
    year: Optional[int] = Query(None, description="Filter by year"),
    type: Optional[str] = Query(None, description="Filter by type: trading or clearing"),
    from_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    q = db.query(MarketHoliday)

    if year:
        q = q.filter(MarketHoliday.date.between(date(year, 1, 1), date(year, 12, 31)))
    if type and type in ("trading", "clearing"):
        q = q.filter(MarketHoliday.type == type)
    if from_date:
        try:
            q = q.filter(MarketHoliday.date >= date.fromisoformat(from_date))
        except ValueError:
            pass
    if to_date:
        try:
            q = q.filter(MarketHoliday.date <= date.fromisoformat(to_date))
        except ValueError:
            pass

    holidays = q.order_by(MarketHoliday.date).all()
    return {"holidays": [h.to_dict() for h in holidays]}


@router.get("/check")
def check_holiday(
    date_str: str = Query(..., alias="date", description="Date to check (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    try:
        d = date.fromisoformat(date_str)
    except (ValueError, AttributeError):
        return {"date": date_str, "is_holiday": False, "type": None, "description": None}

    holiday = db.query(MarketHoliday).filter(MarketHoliday.date == d).first()
    if holiday:
        return {
            "date": date_str,
            "is_holiday": True,
            "type": holiday.type.value,
            "description": holiday.description,
        }

    if d.weekday() >= 5:
        return {"date": date_str, "is_holiday": True, "type": "weekend", "description": "Saturday/Sunday"}

    return {"date": date_str, "is_holiday": False, "type": None, "description": None}


@router.get("/trading-dates")
def get_trading_dates(
    from_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    to_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    try:
        start = date.fromisoformat(from_date)
        end = date.fromisoformat(to_date)
    except ValueError:
        return {"trading_dates": [], "total": 0}

    holiday_dates = {
        h.date
        for h in db.query(MarketHoliday.date)
        .filter(MarketHoliday.date.between(start, end), MarketHoliday.type == HolidayType.TRADING)
        .all()
    }

    trading_dates = []
    current = start
    while current <= end:
        if current.weekday() < 5 and current not in holiday_dates:
            trading_dates.append(current.isoformat())
        current = current.replace(day=current.day + 1) if False else date.fromordinal(current.toordinal() + 1)

    return {"trading_dates": trading_dates, "total": len(trading_dates)}
