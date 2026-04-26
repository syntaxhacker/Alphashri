"""
Seed NSE/BSE market holidays for 2026.

Source: NSE Trading Calendar 2026 + RBI clearing holidays.
Run: python scripts/seed_holidays_2026.py
"""

from datetime import date
from db.database import SessionLocal, init_db
from db.models.holiday import MarketHoliday, HolidayType

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


def seed():
    init_db()
    db = SessionLocal()
    try:
        existing = {h.date for h in db.query(MarketHoliday.date).all()}
        added = 0

        for dt, desc in TRADING_HOLIDAYS_2026:
            if dt not in existing:
                db.add(MarketHoliday(date=dt, description=desc, type=HolidayType.TRADING))
                added += 1

        for dt, desc in CLEARING_HOLIDAYS_2026:
            if dt not in existing and dt not in TRADING_DATES:
                db.add(MarketHoliday(date=dt, description=desc, type=HolidayType.CLEARING))
                added += 1

        db.commit()
        print(f"Added {added} holidays (total: {len(TRADING_HOLIDAYS_2026)} trading + clearing)")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
