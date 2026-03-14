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
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import SessionLocal, engine
from db.models import Instrument, Base

INSTRUMENT_FILES = [
    Path(__file__).parent.parent.parent / 'upstox_trader' / 'config_and_utils' / 'nse_instruments.json',
    Path(__file__).parent.parent.parent / 'upstox_trader' / 'screeners' / 'nse_instruments.json',
]

BATCH_SIZE = 1000


def parse_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except:
        return None


def seed_instruments(db: Session, file_path: Path) -> int:
    print(f"Loading instruments from {file_path}...")
    
    if not file_path.exists():
        print(f"File not found: {file_path}")
        return 0
    
    with open(file_path, 'r') as f:
        instruments = json.load(f)
    
    print(f"Found {len(instruments)} instruments in file")
    
    inserted = 0
    batch = []
    
    for item in instruments:
        instrument = Instrument(
            instrument_key=item.get('instrument_key', ''),
            trading_symbol=item.get('trading_symbol', ''),
            name=item.get('name', item.get('trading_symbol', '')),
            exchange=item.get('exchange', ''),
            segment=item.get('segment', ''),
            instrument_type=item.get('instrument_type', ''),
            asset_type=item.get('asset_type', ''),
            underlying_type=item.get('underlying_type', ''),
            underlying_symbol=item.get('underlying_symbol', ''),
            lot_size=item.get('lot_size', 1),
            tick_size=item.get('tick_size', 0.05),
            freeze_quantity=item.get('freeze_quantity'),
            exchange_token=item.get('exchange_token', ''),
            minimum_lot=item.get('minimum_lot', 1),
            expiry=parse_date(item.get('expiry')),
            strike_price=item.get('strike_price'),
            qty_multiplier=item.get('qty_multiplier'),
            isin=item.get('isin', ''),
        )
        batch.append(instrument)
        
        if len(batch) >= BATCH_SIZE:
            db.bulk_save_objects(batch)
            db.commit()
            inserted += len(batch)
            print(f"Inserted {inserted} instruments...")
            batch = []
    
    if batch:
        db.bulk_save_objects(batch)
        db.commit()
        inserted += len(batch)
    
    print(f"Total inserted: {inserted}")
    return inserted


def main():
    print("Creating instruments table...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        total = 0
        for file_path in INSTRUMENT_FILES:
            if file_path.exists():
                count = seed_instruments(db, file_path)
                total += count
        
        print(f"\nDone! Total instruments in DB: {total}")
        
        result = db.execute("SELECT COUNT(*) FROM instruments")
        count = result.scalar()
        print(f"Current instruments count: {count}")
        
    finally:
        db.close()


if __name__ == "__main__":
    main()
