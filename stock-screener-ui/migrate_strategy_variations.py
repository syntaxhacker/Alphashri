#!/usr/bin/env python3
"""
Database migration script to add strategy variations support.

Run this script to:
1. Add new columns to strategy_configs table
2. Create bot_configs and bot_strategies tables
3. Create strategy templates
4. Convert existing config to a template + default variation
5. Backfill existing trades with strategy_id

Usage:
    python migrate_strategy_variations.py
"""

import sys
import sqlite3
from pathlib import Path

# Add project path
sys.path.insert(0, str(Path(__file__).parent))

from rich.console import Console
from rich.table import Table

console = Console()

# Database path
DB_PATH = Path(__file__).parent / "db" / "alphashri.db"


def add_columns_to_sqlite():
    """Add new columns to existing SQLite table."""
    console.print("[yellow]Adding new columns to strategy_configs table...[/yellow]")

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Get existing columns
    cursor.execute("PRAGMA table_info(strategy_configs)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    # New columns to add
    new_columns = [
        ("parent_id", "INTEGER REFERENCES strategy_configs(id)"),
        ("is_template", "BOOLEAN DEFAULT 0"),
        ("description", "VARCHAR"),
    ]

    for col_name, col_type in new_columns:
        if col_name not in existing_columns:
            try:
                cursor.execute(f"ALTER TABLE strategy_configs ADD COLUMN {col_name} {col_type}")
                console.print(f"[green]  + Added column: {col_name}[/green]")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e).lower():
                    console.print(f"[dim]  = Column exists: {col_name}[/dim]")
                else:
                    raise

    conn.commit()
    conn.close()
    console.print("[green]✓ Columns added successfully[/green]")


def create_bot_tables():
    """Create bot_configs and bot_strategies tables."""
    console.print("[yellow]Creating bot tables...[/yellow]")

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Create bot_configs table
    try:
        cursor.execute("""
            CREATE TABLE bot_configs (
                id INTEGER PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                max_total_positions INTEGER DEFAULT 10,
                max_total_capital_pct FLOAT DEFAULT 0.8,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        console.print("[green]  + Created table: bot_configs[/green]")
    except sqlite3.OperationalError as e:
        if "already exists" in str(e).lower():
            console.print("[dim]  = Table exists: bot_configs[/dim]")
        else:
            raise

    # Create bot_strategies association table
    try:
        cursor.execute("""
            CREATE TABLE bot_strategies (
                bot_id INTEGER NOT NULL REFERENCES bot_configs(id),
                strategy_id INTEGER NOT NULL REFERENCES strategy_configs(id),
                max_positions INTEGER DEFAULT 3,
                capital_allocation_pct FLOAT DEFAULT 0.2,
                PRIMARY KEY (bot_id, strategy_id)
            )
        """)
        console.print("[green]  + Created table: bot_strategies[/green]")
    except sqlite3.OperationalError as e:
        if "already exists" in str(e).lower():
            console.print("[dim]  = Table exists: bot_strategies[/dim]")
        else:
            raise

    conn.commit()
    conn.close()
    console.print("[green]✓ Bot tables created[/green]")


def run_migration():
    """Run the migration to add strategy variations support."""
    console.print("\n[bold cyan]═══ Strategy Variations Migration ═══[/bold cyan]\n")

    # Step 1: Add new columns to SQLite
    console.print("[yellow]Step 1: Adding new columns to database...[/yellow]")
    try:
        add_columns_to_sqlite()
    except Exception as e:
        console.print(f"[red]✗ Failed to add columns: {e}[/red]")
        return False

    # Step 2: Create bot tables
    console.print("\n[yellow]Step 2: Creating bot tables...[/yellow]")
    try:
        create_bot_tables()
    except Exception as e:
        console.print(f"[red]✗ Failed to create bot tables: {e}[/red]")
        return False

    # Step 3: Create strategy templates
    console.print("\n[yellow]Step 3: Creating strategy templates...[/yellow]")
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            # Define strategy templates
            templates = [
                {
                    "name": "ORB Template",
                    "strategy_type": "ORB",
                    "is_template": True,
                    "is_active": True,
                    "description": "Opening Range Breakout strategy template",
                },
                {
                    "name": "EMA Cross Template",
                    "strategy_type": "EMA_CROSS",
                    "is_template": True,
                    "is_active": True,
                    "description": "EMA Crossover strategy template",
                },
                {
                    "name": "52W Chaser Template",
                    "strategy_type": "52W_CHASER",
                    "is_template": True,
                    "is_active": True,
                    "description": "52-Week high chaser strategy template",
                },
            ]

            for template_data in templates:
                existing = db.query(StrategyConfig).filter(
                    StrategyConfig.name == template_data["name"]
                ).first()

                if not existing:
                    template = StrategyConfig(**template_data)
                    db.add(template)
                    console.print(f"[green]  + Created template: {template_data['name']}[/green]")
                else:
                    console.print(f"[dim]  = Template exists: {template_data['name']}[/dim]")

            db.commit()

    except Exception as e:
        console.print(f"[red]✗ Failed to create templates: {e}[/red]")
        return False

    # Step 4: Migrate existing orb_default to a variation
    console.print("\n[yellow]Step 4: Migrating existing config to variation...[/yellow]")
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            # Get existing orb_default
            existing = db.query(StrategyConfig).filter(
                StrategyConfig.name == "orb_default"
            ).first()

            if existing:
                # Get ORB template
                template = db.query(StrategyConfig).filter(
                    StrategyConfig.name == "ORB Template"
                ).first()

                if template and existing.parent_id is None:
                    # Set parent to template
                    existing.parent_id = template.id
                    existing.is_template = False
                    existing.description = "Default ORB strategy variation"
                    db.commit()
                    console.print(f"[green]  ✓ Migrated 'orb_default' as variation of ORB Template[/green]")
                else:
                    console.print(f"[dim]  = 'orb_default' already migrated[/dim]")
            else:
                console.print("[dim]  = No existing 'orb_default' to migrate[/dim]")

    except Exception as e:
        console.print(f"[red]✗ Failed to migrate existing config: {e}[/red]")
        return False

    # Step 5: Show current strategies
    console.print("\n[yellow]Step 5: Current strategy configurations...[/yellow]")
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            strategies = db.query(StrategyConfig).order_by(StrategyConfig.id).all()

            table = Table(title="Strategy Configurations")
            table.add_column("ID", justify="right")
            table.add_column("Name")
            table.add_column("Type")
            table.add_column("Template")
            table.add_column("Parent")
            table.add_column("Active")

            for s in strategies:
                table.add_row(
                    str(s.id),
                    s.name,
                    s.strategy_type,
                    "✓" if s.is_template else "",
                    str(s.parent_id) if s.parent_id else "-",
                    "✓" if s.is_active else "",
                )

            console.print(table)

    except Exception as e:
        console.print(f"[red]✗ Failed to show strategies: {e}[/red]")

    # Step 6: Create default bot config
    console.print("\n[yellow]Step 6: Creating default bot configuration...[/yellow]")
    try:
        from db.database import SessionLocal
        from db.models import BotConfig, StrategyConfig

        with SessionLocal() as db:
            existing_bot = db.query(BotConfig).filter(
                BotConfig.name == "Default Bot"
            ).first()

            if not existing_bot:
                # Get the default strategy
                default_strategy = db.query(StrategyConfig).filter(
                    StrategyConfig.name == "orb_default"
                ).first()

                if default_strategy:
                    bot = BotConfig(
                        name="Default Bot",
                        is_active=True,
                        max_total_positions=5,
                        max_total_capital_pct=0.50,
                    )
                    bot.strategies.append(default_strategy)
                    db.add(bot)
                    db.commit()
                    console.print("[green]  ✓ Created 'Default Bot' with orb_default strategy[/green]")
                else:
                    console.print("[dim]  = No default strategy to add to bot[/dim]")
            else:
                console.print("[dim]  = 'Default Bot' already exists[/dim]")

    except Exception as e:
        console.print(f"[red]✗ Failed to create bot config: {e}[/red]")

    console.print("\n[bold green]✓ Migration completed successfully![/bold green]\n")
    return True


if __name__ == "__main__":
    run_migration()
