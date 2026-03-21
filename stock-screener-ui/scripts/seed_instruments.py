#!/usr/bin/env python3
"""
Seed instruments from JSON to PostgreSQL database.

Usage:
    DATABASE_URL=postgresql://... python scripts/seed_instruments.py
"""

import sys
import json
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import SessionLocal, engine
from db.models import Instrument

INSTRUMENT_FILES = [
    Path(__file__).parent.parent.parent / 'upstox_trader' / 'config_and_utils' / 'nse_instruments.json',
    Path(__file__).parent.parent.parent / 'upstox_trader' / 'screeners' / 'nse_instruments.json',
]

BATCH_SIZE = 1000


def parse_date(date_str):
    """Parse date string to datetime object."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except:
        return None


def seed():
    """Seed instruments from JSON files to database."""
    db = SessionLocal()
    try:
        # Drop existing instruments table (checkfirst=True to avoid error if not exists)
        Instrument.__table__.drop(engine, checkfirst=True)
        
        # Create new table
        Instrument.__table__.create(engine)
        print("Created instruments table")
        
        total = 0
        
        for file_path in INSTRUMENT_FILES:
            if not file_path.exists():
                print(f"File not found: {file_path}")
                continue
            
            print(f"Loading instruments from {file_path}...")
            file_size_mb = file_path.stat().st_size / (1024 * 1024)
            print(f"File size: {file_size_mb:.2f} MB")
            
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            print(f"Found {len(data)} instruments")
            
            batch = []
            for item in data:
                expiry = parse_date(item.get('expiry')) if item.get('expiry') else None
                
                inst = Instrument(
                    instrument_key=item.get('instrument_key', ''),
                    trading_symbol=item.get('trading_symbol', ''),
                    name=item.get('name', item.get('trading_symbol', '')),
                    exchange=item.get('exchange', ''),
                    segment=item.get('segment', ''),
                    lot_size=item.get('lot_size', 1),
                    tick_size=item.get('tick_size', 0),
                    expiry=expiry,
                    strike_price=item.get('strike_price'),
                    isin=item.get('isin', ''),
                )
                batch.append(inst)
                
                if len(batch) >= BATCH_SIZE:
                    db.bulk_save_objects(batch)
                    db.commit()
                    total += len(batch)
                    print(f"Inserted {total} instruments...")
                    batch = []

            if batch:
                db.bulk_save_objects(batch)
                db.commit()
                total += len(batch)
                print(f"Inserted {total} instruments...")

            break

        # Update statistics
        count = db.query(Instrument).count()
        print(f"\nTotal instruments in DB: {count}")
    finally:
        db.close()
    
    print(f"\nSeeding complete! Total: {total} instruments imported.")


if __name__ == "__main__":
    seed()
