"""
Single source of truth for NSE/BSE market holidays + RBI clearing holidays.

Source: NSE Trading Calendar 2026 + RBI clearing holidays.

Use ``seed_missing_holidays()`` to idempotently backfill any missing rows
(e.g. when the manual ``scripts/seed_holidays_2026.py`` was never run).
Safe to call repeatedly: dates already present in ``market_holidays`` are
skipped, and a date listed as both trading and clearing is stored once as
TRADING.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

TRADING_HOLIDAYS_2026 = [
    (date(2026, 1, 15), "Municipal Corporation Election - Maharashtra"),
    (date(2026, 1, 26), "Republic Day"),
    (date(2026, 3, 3), "Holi"),
    (date(2026, 3, 26), "Shri Ram Navami"),
    (date(2026, 3, 31), "Shri Mahavir Jayanti"),
    (date(2026, 4, 3), "Good Friday"),
    (date(2026, 4, 14), "Dr. Baba Saheb Ambedkar Jayanti"),
    (date(2026, 5, 1), "Maharashtra Day"),
    (date(2026, 5, 28), "Bakri Id"),
    (date(2026, 6, 26), "Muharram"),
    (date(2026, 9, 14), "Ganesh Chaturthi"),
    (date(2026, 10, 2), "Mahatma Gandhi Jayanti"),
    (date(2026, 10, 20), "Dussehra"),
    (date(2026, 11, 10), "Diwali - Balipratipada"),
    (date(2026, 11, 24), "Prakash Gurpurb Sri Guru Nanak Dev"),
    (date(2026, 12, 25), "Christmas"),
    (date(2026, 11, 8), "Diwali Laxmi Pujan (Muhurat Trading)"),
]

CLEARING_HOLIDAYS_2026 = [
    (date(2026, 1, 15), "Municipal Corporation Election in Maharashtra"),
    (date(2026, 1, 26), "Republic Day"),
    (date(2026, 2, 19), "Chhatrapati Shivaji Maharaj Jayanti"),
    (date(2026, 3, 3), "Holi (Second Day)"),
    (date(2026, 3, 19), "Gudhi Padwa"),
    (date(2026, 3, 26), "Ram Navami"),
    (date(2026, 3, 31), "Mahavir Jayanti"),
    (date(2026, 4, 1), "Annual Bank Closing"),
    (date(2026, 4, 3), "Good Friday"),
    (date(2026, 4, 14), "Dr. Babasaheb Ambedkar Jayanti"),
    (date(2026, 5, 1), "Maharashtra Din / Buddha Pournima"),
    (date(2026, 5, 28), "Bakri ID (Id-Uz-Zuha)"),
    (date(2026, 6, 26), "Muharram"),
    (date(2026, 8, 26), "Id-E-Milad"),
    (date(2026, 9, 14), "Ganesh Chaturthi"),
    (date(2026, 10, 2), "Mahatma Gandhi Jayanti"),
    (date(2026, 10, 20), "Dussehra"),
    (date(2026, 11, 10), "Diwali (Bali Pratipada)"),
    (date(2026, 11, 24), "Guru Nanak Jayanti"),
    (date(2026, 12, 25), "Christmas"),
]

TRADING_DATES = {d for d, _ in TRADING_HOLIDAYS_2026}


def seed_missing_holidays(year: Optional[int] = None) -> int:
    """Insert seed holiday rows for ``year`` that are missing from the DB.

    Idempotent: dates already present in ``market_holidays`` are skipped, so
    repeated calls (or a DB that already has data) add 0 rows and never raise
    a unique-constraint error. A date present in both the trading and clearing
    lists is stored once as TRADING.

    Returns the number of rows added. Years with no seed data return 0.
    """
    if year is None:
        from trading.timezone import IST

        year = datetime.now(IST).year

    # Late imports so tests can monkeypatch db.database.SessionLocal with an
    # in-memory session factory.
    from db.database import SessionLocal
    from db.models.holiday import HolidayType, MarketHoliday

    trading_rows = [(dt, desc) for dt, desc in TRADING_HOLIDAYS_2026 if dt.year == year]
    clearing_rows = [(dt, desc) for dt, desc in CLEARING_HOLIDAYS_2026 if dt.year == year]
    if not trading_rows and not clearing_rows:
        return 0

    trading_dates = {dt for dt, _ in trading_rows}
    db = SessionLocal()
    try:
        existing = {h.date for h in db.query(MarketHoliday.date).all()}
        added = 0

        for dt, desc in trading_rows:
            if dt not in existing:
                db.add(MarketHoliday(date=dt, description=desc, type=HolidayType.TRADING))
                existing.add(dt)
                added += 1

        for dt, desc in clearing_rows:
            if dt not in existing and dt not in trading_dates:
                db.add(MarketHoliday(date=dt, description=desc, type=HolidayType.CLEARING))
                existing.add(dt)
                added += 1

        db.commit()
        return added
    finally:
        db.close()
