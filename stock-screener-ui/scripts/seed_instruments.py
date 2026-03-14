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
from db.models import Instrument

INSTRUMENT_FILES = [
    Path(__file__).parent.parent / 'upstox_trader' / 'config_and_utils' / 'nse_instruments.json',
    Path(__file__).parent.parent / 'upstox_trader' / 'screeners' / 'nse_instruments.json',
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
        # Drop existing instruments table
        Instrument.__table__.drop(engine, checkfirst=False)
        
        # Create new table
        Instrument.__table__.create(engine)
        print("Created instruments table")
        
        total = 0
        
        for file_path in INSTRUMENT_FILES:
            if not file_path.exists():
                print(f"File not found: {file_path}")
                continue
            
            print(f"Loading instruments from {file_path}...")
            file_size = file_path.stat().st_size / (1024 * 1024)
            print(f"File size: {file_size:.2f} MB")
            
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
                    instrument_type=item.get('instrument_type', ''),
                    asset_type=item.get('asset_type', ''),
                    underlying_type=item.get('underlying_type', ''),
                    underlying_symbol=item.get('underlying_symbol', ''),
                    lot_size=item.get('lot_size', 1),
                    tick_size=item.get('tick_size', 0.05),
                    freeze_quantity=item.get('freeze_quantity'),
                    exchange_token=item.get('exchange_token', ''),
                    minimum_lot=item.get('minimum_lot', 1),
                    expiry=expiry,
                    strike_price=item.get('strike_price'),
                    qty_multiplier=item.get('qty_multiplier'),
                    isin=item.get('isin', ''),
                )
                batch.append(inst)
                
                if len(batch) >= BATCH_SIZE:
                    db.bulk_save_objects(batch)
                    total += len(batch)
                    print(f"Inserted {total} instruments...")
                    batch = []
            
            if batch:
                db.bulk_save_objects(batch)
                total += len(batch)
                print(f"Inserted {total} instruments...")
        
        # Update statistics
        count = db.query(Instrument).count()
        print(f"\nTotal instruments in DB: {count}")
    finally:
        db.close()
    
    print(f"\nSeeding complete! Total: {total} instruments imported.")


if __name__ == "__main__":
    seed()
