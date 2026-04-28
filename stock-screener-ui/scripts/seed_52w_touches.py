"""Seed script to add test 52w touch data for ADANIGREEN.

Run: python3 scripts/seed_52w_touches.py
This will add a touch record for ADANIGREEN from 2 days ago.
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.database import SessionLocal, init_db, engine
from db.models import Stock52WeekTouch

def seed_test_data():
    init_db()
    print("Initialized DB")

    db = SessionLocal()
    try:
        # Check if ADANIGREEN already has recent touch data
        existing = db.query(Stock52WeekTouch).filter(
            Stock52WeekTouch.symbol == "ADANIGREEN"
        ).order_by(Stock52WeekTouch.touched_date.desc()).first()

        if existing:
            print(f"ADANIGREEN already has touch record from {existing.touched_date}")
            return

        # Create a touch record from 2 days ago
        touch_date = datetime.now() - timedelta(days=2)

        record = Stock52WeekTouch(
            symbol="ADANIGREEN",
            touched_date=touch_date,
            touched_price=1255.0,  # approximate
            is_high=True,
            is_current_52w_high=False,
        )
        db.add(record)
        db.commit()
        print(f"✅ Added touch record for ADANIGREEN from {touch_date.strftime('%Y-%m-%d')}")
        print("   The screener should now show ADANIGREEN as 'Yes (2d ago)' in the Touched column")

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_test_data()
