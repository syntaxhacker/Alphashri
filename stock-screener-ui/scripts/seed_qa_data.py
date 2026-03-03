#!/usr/bin/env python3
"""
Seed Script for Multi-Strategy QA Testing

Creates:
1. QA Test User (qa@test.com / qa123)
2. Multiple strategy variations
3. A multi-strategy bot
4. Sample trades in journal across multiple strategies

Run with: python scripts/seed_qa_data.py
"""

import sys
import random
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List
import bcrypt

# Add project path
sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import SessionLocal
from db.models import User, StrategyConfig, BotConfig, bot_strategies
from trading.journal import TradeJournal

from rich.console import Console
from rich.panel import Panel

console = Console()

# ============================================
# Configuration
# ============================================

QA_USER_EMAIL = "qa@test.com"
QA_USER_PASSWORD = "qa123"
QA_USER_NAME = "QA Test User"

INITIAL_CAPITAL = 1_000_000  # 10 Lakhs

# Strategy configurations
STRATEGIES = [
    {
        'name': 'ORB Conservative',
        'strategy_type': 'ORB',
        'description': 'Conservative ORB with tight SL',
        'or_minutes': 45,
        'sl_pct': 0.4,
        'tp_pct': 1.2,
        'min_or_range_pct': 0.5,
        'max_or_range_pct': 2.0,
        'max_positions': 3,
        'max_capital_per_trade_pct': 0.08,
    },
    {
        'name': 'ORB Aggressive',
        'strategy_type': 'ORB',
        'description': 'Aggressive ORB with wider targets',
        'or_minutes': 30,
        'sl_pct': 0.6,
        'tp_pct': 1.8,
        'min_or_range_pct': 1.0,
        'max_or_range_pct': 3.0,
        'max_positions': 3,
        'max_capital_per_trade_pct': 0.10,
    },
    {
        'name': '52W Chaser',
        'strategy_type': '52W_CHASER',
        'description': 'Follow 52-week high breakouts',
        'or_minutes': 45,
        'sl_pct': 0.5,
        'tp_pct': 2.0,
        'min_or_range_pct': 0.5,
        'max_or_range_pct': 2.5,
        'max_positions': 2,
        'max_capital_per_trade_pct': 0.05,
    },
]

# Sample stocks for dummy trades
SAMPLE_STOCKS = [
    {'symbol': 'RELIANCE', 'base_price': 2500},
    {'symbol': 'TCS', 'base_price': 3500},
    {'symbol': 'INFY', 'base_price': 1500},
    {'symbol': 'HDFC', 'base_price': 1600},
    {'symbol': 'ICICIBANK', 'base_price': 950},
    {'symbol': 'SBIN', 'base_price': 550},
    {'symbol': 'TATASteel', 'base_price': 120},
    {'symbol': 'BAJFINANCE', 'base_price': 6500},
    {'symbol': 'MARUTI', 'base_price': 10500},
    {'symbol': 'WIPRO', 'base_price': 450},
]


def hash_password(password: str) -> str:
    """Hash password using bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def create_qa_user(db) -> User:
    """Create or get QA test user."""
    user = db.query(User).filter(User.email == QA_USER_EMAIL).first()

    if user:
        console.print(f"[yellow]QA user already exists (ID: {user.id})[/yellow]")
        return user

    user = User(
        email=QA_USER_EMAIL,
        hashed_password=hash_password(QA_USER_PASSWORD),
        display_name=QA_USER_NAME,
        initial_capital=INITIAL_CAPITAL,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    console.print(f"[green]✓ Created QA user (ID: {user.id})[/green]")
    return user


def create_strategies(db, user_id: int) -> Dict:
    """Create strategy configurations for QA user."""
    strategies = {}

    for strat_config in STRATEGIES:
        # Check if exists
        existing = db.query(StrategyConfig).filter(
            StrategyConfig.name == strat_config['name']
        ).first()

        if existing:
            console.print(f"  [dim]Strategy '{strat_config['name']}' already exists (ID: {existing.id})[/dim]")
            strategies[existing.id] = existing
            continue

        # Create new strategy
        strategy = StrategyConfig(
            name=strat_config['name'],
            strategy_type=strat_config['strategy_type'],
            description=strat_config.get('description', ''),
            is_template=False,
            is_default=False,
            is_active=True,
        )
        # Copy all config fields
        for key, value in strat_config.items():
            if key not in ['name', 'strategy_type', 'description']:
                setattr(strategy, key, value)

        db.add(strategy)
        db.commit()
        db.refresh(strategy)
        strategies[strategy.id] = strategy
        console.print(f"  [green]✓ Created strategy '{strategy.name}' (ID: {strategy.id})[/green]")

    return strategies


def create_bot(db, strategies: Dict[int, StrategyConfig]) -> BotConfig:
    """Create multi-strategy bot with all strategies."""

    # Check if bot exists
    bot = db.query(BotConfig).filter(
        BotConfig.name == "Multi-ORB QA Bot"
    ).first()

    if bot:
        console.print(f"[yellow]Bot already exists (ID: {bot.id})[/yellow]")
        return bot

    # Create bot
    bot = BotConfig(
        name="Multi-ORB QA Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.90,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    console.print(f"[green]✓ Created bot '{bot.name}' (ID: {bot.id})[/green]")

    # Add strategies to bot
    allocations = [0.40, 0.40, 0.15]  # Conservative, Aggressive, 52W Chaser
    for idx, (strategy_id, strategy) in enumerate(strategies.items()):
        allocation_pct = allocations[idx] if idx < len(allocations) else 0.15
        max_positions = strategy.max_positions or 3

        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy.id,
                max_positions=max_positions,
                capital_allocation_pct=allocation_pct,
            )
        )
    db.commit()
    console.print(f"[green]✓ Added {len(strategies)} strategies to bot[/green]")

    return bot


def generate_trades(user_id: int, bot: BotConfig, strategies: Dict[int, StrategyConfig]) -> List[dict]:
    """Generate dummy trades for a multi-strategy bot."""
    trades = []
    trade_id = 0
    journal = TradeJournal(user_id=user_id)

    # Generate trades over past 5 trading days
    for day in range(5):
        base_date = datetime.now() - timedelta(days=day + 1)

        for _ in range(2):  # 2 trades per strategy per day
            for strategy_id, strategy in strategies.items():
                strategy_name = strategy.name

                # Select random stock
                stock = random.choice(SAMPLE_STOCKS)
                symbol = stock['symbol']
                base_price = stock['base_price']

                # Determine trade parameters
                sl_pct = strategy.sl_pct or 0.5
                tp_pct = strategy.tp_pct or 1.5

                # Randomize entry and exit
                side = random.choice(['BUY', 'SELL'])
                entry_time = base_date.replace(hour=9, minute=30, second=0) + timedelta(minutes=random.randint(0, 60))

                # Price variation
                price_var = random.uniform(-0.02, 0.02)
                entry_price = base_price * (1 + price_var)

                # Determine outcome (60% winners)
                is_winner = random.random() < 0.6
                if is_winner:
                    # Winner - hit TP
                    exit_price = entry_price * (1 + tp_pct / 100 * random.uniform(0.5, 1.0))
                    exit_reason = 'TP'
                else:
                    # Loser - hit SL
                    exit_price = entry_price * (1 - sl_pct / 100 * random.uniform(0.8, 1.2))
                    exit_reason = 'SL'

                # Calculate quantity (based on ~50k per trade)
                trade_value = 50000
                quantity = int(trade_value / entry_price)

                # Calculate P&L
                if side == 'BUY':
                    pnl = (exit_price - entry_price) * quantity
                    pnl_pct = (exit_price - entry_price) / entry_price * 100
                else:
                    pnl = (entry_price - exit_price) * quantity
                    pnl_pct = (entry_price - exit_price) / entry_price * 100

                # Add some variance
                pnl += random.uniform(-200, 200)

                # Calculate costs
                trade_value_total = entry_price * quantity
                costs = trade_value_total * 0.0006
                net_pnl = pnl - costs

                exit_time = entry_time + timedelta(hours=random.randint(1, 3))

                trade = {
                    'trade_id': f"QA-{trade_id:04d}",
                    'symbol': symbol,
                    'side': side,
                    'quantity': quantity,
                    'entry_price': round(entry_price, 2),
                    'exit_price': round(exit_price, 2),
                    'entry_time': entry_time.isoformat(),
                    'exit_time': exit_time.isoformat(),
                    'pnl': round(pnl, 2),
                    'pnl_pct': round(pnl_pct, 2),
                    'exit_reason': exit_reason,
                    'costs': round(costs, 2),
                    'net_pnl': round(net_pnl, 2),
                    'strategy_id': strategy_id,
                    'strategy_name': strategy_name,
                    'source': 'seed_test',
                    'is_test': True,
                }

                # Log to journal
                journal.log_trade(trade)
                trades.append(trade)
                trade_id += 1

    # Save journal
    journal.save_journal()
    console.print(f"[green]✓ Generated {len(trades)} trades and saved to journal[/green]")

    return trades


def print_summary(user: User, bot: BotConfig, strategies: Dict, trades: List[dict]):
    """Print summary of seeded data."""
    console.print("\n" + "=" * 60)
    console.print(Panel.fit(
        "[bold green]Multi-Strategy QA Data Seeding Complete![/bold green]",
    ))
    console.print(f"\nLogin Credentials:")
    console.print(f"  Email: [cyan]{QA_USER_EMAIL}[/cyan]")
    console.print(f"  Password: [cyan]{QA_USER_PASSWORD}[/cyan]")
    console.print(f"\nBot ID: [cyan]{bot.id}[/cyan]")
    console.print(f"User ID: [cyan]{user.id}[/cyan]")

    # Performance summary
    total_trades = len(trades)
    winners = sum(1 for t in trades if t['net_pnl'] > 0)
    losers = sum(1 for t in trades if t['net_pnl'] <= 0)
    total_pnl = sum(t['pnl'] for t in trades)
    total_net_pnl = sum(t['net_pnl'] for t in trades)
    win_rate = (winners / total_trades * 100) if total_trades > 0 else 0
    profit_factor = winners / losers if losers > 0 else float('inf')

    console.print(f"\n[bold]Performance Summary:[/bold]")
    console.print(f"  Total Trades: {total_trades}")
    console.print(f"  Winners: {winners} ({win_rate:.1f}%)")
    console.print(f"  Total P&L: ₹{total_pnl:,.2f}")
    console.print(f"  Net P&L: ₹{total_net_pnl:,.2f}")
    console.print(f"  Profit Factor: {profit_factor:.2f}")

    # Strategy breakdown
    console.print(f"\n[bold]Performance by Strategy:[/bold]")
    for strategy_id, strategy in strategies.items():
        strategy_trades = [t for t in trades if t['strategy_id'] == strategy_id]
        strategy_pnl = sum(t['net_pnl'] for t in strategy_trades)
        strategy_winners = sum(1 for t in strategy_trades if t['net_pnl'] > 0)
        strategy_win_rate = (strategy_winners / len(strategy_trades) * 100) if strategy_trades else 0

        console.print(f"  {strategy.name}:")
        console.print(f"    Trades: {len(strategy_trades)}")
        console.print(f"    Win Rate: {strategy_win_rate:.1f}%")
        console.print(f"    Net P&L: ₹{strategy_pnl:,.2f}")

    console.print("\n" + "=" * 60)


def clean_qa_data():
    """Clean existing QA data."""
    db = SessionLocal()
    try:
        # Delete bot strategies
        bot = db.query(BotConfig).filter(BotConfig.name == "Multi-ORB QA Bot").first()
        if bot:
            db.execute(bot_strategies.delete().where(bot_strategies.c.bot_id == bot.id))
            db.delete(bot)
            console.print("[yellow]Deleted existing bot[/yellow]")

        # Delete strategies
        for strat_config in STRATEGIES:
            existing = db.query(StrategyConfig).filter(
                StrategyConfig.name == strat_config['name']
            ).first()
            if existing:
                db.delete(existing)
                console.print(f"[yellow]Deleted strategy '{strat_config['name']}'[/yellow]")

        # Delete user
        user = db.query(User).filter(User.email == QA_USER_EMAIL).first()
        if user:
            db.delete(user)
            console.print("[yellow]Deleted QA user[/yellow]")

        db.commit()
        console.print("[green]✓ QA data cleaned[/green]")
    finally:
        db.close()


def seed_qa_data():
    """Seed QA data for multi-strategy testing."""
    db = SessionLocal()
    try:
        console.print("\n[bold]Seeding Multi-Strategy QA Data...[/bold]\n")

        # 1. Create QA user
        console.print("[bold]Step 1: Creating QA User[/bold]")
        user = create_qa_user(db)

        # 2. Create strategies
        console.print("\n[bold]Step 2: Creating Strategies[/bold]")
        strategies = create_strategies(db, user.id)

        # 3. Create bot
        console.print("\n[bold]Step 3: Creating Multi-Strategy Bot[/bold]")
        bot = create_bot(db, strategies)

        # 4. Generate trades
        console.print("\n[bold]Step 4: Generating Trades[/bold]")
        trades = generate_trades(user.id, bot, strategies)

        # 5. Print summary
        print_summary(user, bot, strategies, trades)

    finally:
        db.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Seed QA data for multi-strategy system')
    parser.add_argument('--clean', action='store_true', help='Clean existing QA data before seeding')
    args = parser.parse_args()

    if args.clean:
        print("Cleaning existing QA data...")
        clean_qa_data()
        print("Done.\n")
        print("Now seeding fresh data...")
        seed_qa_data()
    else:
        seed_qa_data()


if __name__ == "__main__":
    main()
