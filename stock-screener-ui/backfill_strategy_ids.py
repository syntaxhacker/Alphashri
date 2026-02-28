#!/usr/bin/env python3
"""
Backfill strategy_id for existing trades.

This script updates existing trade records in journal files to include
the strategy_id pointing to the default ORB strategy (orb_default).
"""

import json
import sys
from pathlib import Path
from datetime import datetime

# Add project paths
sys.path.insert(0, str(Path(__file__).parent))

from db.database import SessionLocal
from db.models import StrategyConfig


def get_default_strategy_id() -> int:
    """Get the ID of the default ORB strategy."""
    with SessionLocal() as db:
        # First try to find orb_default
        config = db.query(StrategyConfig).filter(
            StrategyConfig.name == "orb_default"
        ).first()

        if config:
            return config.id

        # Fallback to any default config
        config = db.query(StrategyConfig).filter(
            StrategyConfig.is_default == True
        ).first()

        if config:
            return config.id

        # Last resort: get first active config
        config = db.query(StrategyConfig).filter(
            StrategyConfig.is_active == True
        ).first()

        if config:
            return config.id

    return 1  # Default fallback


def backfill_journal_trades(strategy_id: int, strategy_name: str = "orb_default"):
    """
    Backfill strategy_id in journal files.

    Args:
        strategy_id: The strategy ID to assign to trades
        strategy_name: The strategy name to assign to trades
    """
    journals_dir = Path(__file__).parent / "journals"

    if not journals_dir.exists():
        print("No journals directory found.")
        return

    updated_count = 0
    file_count = 0

    # Find all journal files (single-user and multi-user)
    for journal_file in journals_dir.rglob("journal_*.json"):
        try:
            with open(journal_file) as f:
                data = json.load(f)

            trades = data.get("trades", [])
            if not trades:
                continue

            # Check if any trades need updating
            needs_update = False
            for trade in trades:
                if not trade.get("strategy_id") or trade.get("strategy_id") == 0:
                    needs_update = True
                    break

            if not needs_update:
                continue

            # Update trades
            for trade in trades:
                if not trade.get("strategy_id") or trade.get("strategy_id") == 0:
                    trade["strategy_id"] = strategy_id
                    trade["strategy_name"] = strategy_name
                    updated_count += 1

            # Write back
            with open(journal_file, "w") as f:
                json.dump(data, f, indent=2, default=str)

            file_count += 1
            print(f"  ✓ Updated {journal_file.relative_to(journals_dir.parent)}")

        except Exception as e:
            print(f"  ✗ Error processing {journal_file}: {e}")

    print(f"\n📊 Backfill Summary:")
    print(f"   Files updated: {file_count}")
    print(f"   Trades updated: {updated_count}")
    print(f"   Strategy ID: {strategy_id}")
    print(f"   Strategy Name: {strategy_name}")


def main():
    print("═" * 50)
    print("   Backfill Strategy IDs for Existing Trades")
    print("═" * 50)
    print()

    # Get the default strategy ID
    strategy_id = get_default_strategy_id()
    strategy_name = "orb_default"

    print(f"Using strategy: {strategy_name} (ID: {strategy_id})")
    print()

    # Confirm before proceeding
    response = input("Continue with backfill? [y/N]: ").strip().lower()
    if response != "y":
        print("Cancelled.")
        return

    print("\nProcessing journal files...")
    backfill_journal_trades(strategy_id, strategy_name)

    print("\n✓ Backfill completed!")


if __name__ == "__main__":
    main()
