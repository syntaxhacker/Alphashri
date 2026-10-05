"""
Seed NSE/BSE market holidays for 2026.

Source: NSE Trading Calendar 2026 + RBI clearing holidays.
Run: python scripts/seed_holidays_2026.py
"""

from db.database import init_db
from trading.holidays_seed import (
    CLEARING_HOLIDAYS_2026,
    TRADING_DATES,
    TRADING_HOLIDAYS_2026,
    seed_missing_holidays,
)

__all__ = [
    "TRADING_HOLIDAYS_2026",
    "CLEARING_HOLIDAYS_2026",
    "TRADING_DATES",
    "seed",
]


def seed():
    init_db()
    added = seed_missing_holidays(2026)
    print(f"Added {added} holidays (total: {len(TRADING_HOLIDAYS_2026)} trading + clearing)")


if __name__ == "__main__":
    seed()
