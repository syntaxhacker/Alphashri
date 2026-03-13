#!/usr/bin/env python3
"""
Migration script to move existing single-user data to multi-user format.

This script:
1. Creates an admin user (admin@alphashri.dev)
2. Moves existing journal files to user-scoped directory (journals/1/)
3. Moves trade logs to user-scoped directory (trade_logs/1/)

Usage:
    python migrate_to_multiuser.py [--dry-run]
"""

import sys
import shutil
import argparse
from pathlib import Path
from datetime import datetime

# Add project path
sys.path.insert(0, str(Path(__file__).parent))

from db.database import SessionLocal, init_db
from db.models import User
from api.auth import hash_password


def migrate_journals(dry_run: bool = False) -> int:
    """
    Move journal files from journals/ to journals/1/

    Returns number of files moved.
    """
    journals_dir = Path(__file__).parent / "journals"
    user_journals_dir = journals_dir / "1"

    if not journals_dir.exists():
        print("No journals directory found, skipping journal migration.")
        return 0

    # Find all journal_*.json files in the root journals directory
    journal_files = list(journals_dir.glob("journal_*.json"))

    if not journal_files:
        print("No journal files found to migrate.")
        return 0

    print(f"Found {len(journal_files)} journal files to migrate.")

    if not dry_run:
        user_journals_dir.mkdir(parents=True, exist_ok=True)

    moved = 0
    for journal_file in journal_files:
        dest = user_journals_dir / journal_file.name
        if dest.exists():
            print(f"  [SKIP] {journal_file.name} already exists in user directory")
            continue

        if dry_run:
            print(f"  [DRY-RUN] Would move: {journal_file.name} -> journals/1/{journal_file.name}")
        else:
            shutil.move(str(journal_file), str(dest))
            print(f"  [MOVE] {journal_file.name} -> journals/1/{journal_file.name}")
        moved += 1

    return moved


def migrate_trade_logs(dry_run: bool = False) -> int:
    """
    Move trade log files from trade_logs/ to trade_logs/1/

    Returns number of files moved.
    """
    trade_logs_dir = Path(__file__).parent / "trade_logs"
    user_trade_logs_dir = trade_logs_dir / "1"

    if not trade_logs_dir.exists():
        print("No trade_logs directory found, skipping trade logs migration.")
        return 0

    # Find all files in the root trade_logs directory (not in subdirectories)
    trade_files = [f for f in trade_logs_dir.iterdir() if f.is_file()]

    if not trade_files:
        print("No trade log files found to migrate.")
        return 0

    print(f"Found {len(trade_files)} trade log files to migrate.")

    if not dry_run:
        user_trade_logs_dir.mkdir(parents=True, exist_ok=True)

    moved = 0
    for trade_file in trade_files:
        dest = user_trade_logs_dir / trade_file.name
        if dest.exists():
            print(f"  [SKIP] {trade_file.name} already exists in user directory")
            continue

        if dry_run:
            print(f"  [DRY-RUN] Would move: {trade_file.name} -> trade_logs/1/{trade_file.name}")
        else:
            shutil.move(str(trade_file), str(dest))
            print(f"  [MOVE] {trade_file.name} -> trade_logs/1/{trade_file.name}")
        moved += 1

    return moved


def create_admin_user(dry_run: bool = False) -> int:
    """
    Create the admin user for migrated data.

    Returns user ID (1) if created or already exists.
    """
    if dry_run:
        print("[DRY-RUN] Would create admin user: admin@alphashri.dev")
        return 1

    # Initialize database
    init_db()

    db = SessionLocal()
    try:
        # Check if admin user already exists
        existing = db.query(User).filter(User.email == "admin@alphashri.dev").first()
        if existing:
            print(f"Admin user already exists (id={existing.id})")
            return existing.id

        # Create admin user
        admin = User(
            email="admin@alphashri.dev",
            hashed_password=hash_password("admin123"),  # Default password
            display_name="Admin",
            initial_capital=1_000_000.0,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

        print(f"Created admin user (id={admin.id})")
        print(f"  Email: admin@alphashri.dev")
        print(f"  Password: admin123")
        print(f"  Please change the password after first login!")

        return admin.id

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Migrate single-user data to multi-user format")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    args = parser.parse_args()

    print("=" * 60)
    print("Alphashri Multi-User Migration")
    print("=" * 60)
    print()

    if args.dry_run:
        print("[DRY-RUN MODE] No changes will be made")
        print()

    # Step 1: Create admin user
    print("Step 1: Creating admin user...")
    user_id = create_admin_user(dry_run=args.dry_run)
    print()

    # Step 2: Migrate journals
    print("Step 2: Migrating journal files...")
    journals_moved = migrate_journals(dry_run=args.dry_run)
    print()

    # Step 3: Migrate trade logs
    print("Step 3: Migrating trade log files...")
    trade_logs_moved = migrate_trade_logs(dry_run=args.dry_run)
    print()

    # Summary
    print("=" * 60)
    print("Migration Summary")
    print("=" * 60)
    print(f"Admin user ID: {user_id}")
    print(f"Journal files moved: {journals_moved}")
    print(f"Trade log files moved: {trade_logs_moved}")
    print()

    if args.dry_run:
        print("Run without --dry-run to apply changes.")
    else:
        print("Migration complete!")
        print()
        print("Next steps:")
        print("1. Login as admin@alphashri.dev with password 'admin123'")
        print("2. Change the admin password")
        print("3. Create additional user accounts as needed")


if __name__ == "__main__":
    main()
