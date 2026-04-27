"""Job to record 52-week high touches into the database.

Runs periodically (e.g., after market close or intraday) to persist
which stocks touched their 52-week highs. This provides historical
memory for the screener UI to display "touched 2d ago" etc.
"""

import sys
from pathlib import Path
from datetime import datetime, timezone, date
import argparse

_project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_project_root))

import config
from db.database import SessionLocal, init_db
from db.models import Stock52WeekTouch
from api.screener_api.screener_scan import fetch_screener_data


def record_touches_for_screener(
    provider: str = "upstox",
    mode: str = "intraday",
    screener: str = "trending",
    lookback_days: int = 1,
) -> tuple[int, int]:
    """Record 52w touches for all stocks in the given screener.

    Args:
        provider: Data provider (upstox, etc.)
        mode: intraday or historical
        screener: Screener profile name
        lookback_days: How many past days to check for touches (1 = today only)

    Returns:
        (new_touches_count, updated_count)
    """
    print(f"[{datetime.now()}] Recording 52w touches for {screener}...")

    # Fetch screener data (this computes touched_52w from current data)
    data = fetch_screener_data(provider, mode, screener, profile_filters={})
    all_stocks = data.get('approaching', []) + data.get('touched', [])

    if not all_stocks:
        print("  No stocks found in screener")
        return 0, 0

    # Filter to only touched stocks
    touched_stocks = [s for s in all_stocks if s.get('touched_52w')]

    if not touched_stocks:
        print("  No stocks touched 52w today")
        return 0, 0

    print(f"  Found {len(touched_stocks)} stocks that touched 52w today")

    db = SessionLocal()
    try:
        new_count = 0
        updated_count = 0

        for stock in touched_stocks:
            symbol = stock.get('symbol')
            if not symbol:
                continue

            # Use today's date (or the date from the data if available)
            # For intraday, we use current date; for historical, use the date in data
            touch_date = datetime.now()
            # If the stock data has a date field, use that instead
            if 'date' in stock:
                try:
                    touch_date = datetime.fromisoformat(stock['date'].replace('Z', '+00:00'))
                except Exception:
                    pass

            touched_price = stock.get('upstox_price') or stock.get('tv_price') or 0.0

            # Check if we already have a record for this symbol on this date
            existing = (
                db.query(Stock52WeekTouch)
                .filter(
                    Stock52WeekTouch.symbol == symbol,
                    Stock52WeekTouch.touched_date >= touch_date.replace(hour=0, minute=0, second=0, microsecond=0),
                )
                .first()
            )

            if existing:
                # Update if price changed significantly? For now, skip
                updated_count += 1
            else:
                # Create new record
                record = Stock52WeekTouch(
                    symbol=symbol,
                    touched_date=touch_date,
                    touched_price=float(touched_price),
                    is_high=True,
                    is_current_52w_high=True,  # This is the latest touch
                )
                db.add(record)
                new_count += 1

        db.commit()
        print(f"  ✅ Recorded: {new_count} new, {updated_count} updated")
        return new_count, updated_count

    except Exception as e:
        db.rollback()
        print(f"  ❌ Error: {e}")
        raise
    finally:
        db.close()


def record_touches_for_all_screeners():
    """Record touches for all relevant 52w screeners."""
    screeners = ["trending", "near_52w_breakout"]
    total_new = 0
    total_updated = 0

    for screener in screeners:
        try:
            new_cnt, upd_cnt = record_touches_for_screener(screener=screener)
            total_new += new_cnt
            total_updated += upd_cnt
        except Exception as e:
            print(f"  ⚠️ Failed for {screener}: {e}")

    print(f"\n📊 Summary: {total_new} new touches, {total_updated} updates")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Record 52-week high touches")
    parser.add_argument("--screener", default="trending", help="Screener profile to use")
    parser.add_argument("--mode", default="intraday", choices=["intraday", "historical"], help="Data mode")
    parser.add_argument("--all", action="store_true", help="Run for all 52w screeners")
    args = parser.parse_args()

    init_db()

    if args.all:
        record_touches_for_all_screeners()
    else:
        record_touches_for_screener(screener=args.screener, mode=args.mode)
