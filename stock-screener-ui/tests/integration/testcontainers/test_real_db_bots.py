"""
Real PostgreSQL tests for bot configuration functionality.

Tests differences between SQLite and PostgreSQL:
- Bot-strategy relationship handling
- Cascade delete behavior
- Concurrent bot operations
- JSON serialization differences (if applicable)
"""

import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from db.models import User, StrategyConfig, BotConfig, bot_strategies

pytestmark = pytest.mark.testcontainers


class TestBotCreationPostgreSQL:
    """Test bot creation with real PostgreSQL database."""
    
    def test_create_bot_basic(self, clean_postgres_session: Session):
        """Test basic bot creation in PostgreSQL."""
        bot = BotConfig(
            name="Basic Bot",
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.8,
        )
        clean_postgres_session.add(bot)
        clean_postgres_session.commit()
        
        assert bot.id is not None
        assert bot.name == "Basic Bot"
        assert bot.created_at is not None
    
    def test_bot_name_unique_constraint(self, clean_postgres_session: Session):
        """Test unique bot name constraint in PostgreSQL."""
        bot1 = BotConfig(
            name="Unique Bot",
            is_active=True,
        )
        clean_postgres_session.add(bot1)
        clean_postgres_session.commit()
        
        bot2 = BotConfig(
            name="Unique Bot",
            is_active=True,
        )
        clean_postgres_session.add(bot2)
        
        with pytest.raises(IntegrityError) as exc_info:
            clean_postgres_session.commit()
        
        assert "unique" in str(exc_info.value).lower() or "duplicate" in str(exc_info.value).lower()
    
    def test_bot_default_values(self, clean_postgres_session: Session):
        """Test that default values are properly set in PostgreSQL."""
        bot = BotConfig(name="Defaults Bot")
        clean_postgres_session.add(bot)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(bot)
        assert bot.is_active is True
        assert bot.max_total_positions == 10
        assert bot.max_total_capital_pct == 0.8


def _add_bot_with_strategy(clean_postgres_session, name="Bot", strategy_id=None, max_positions=5, cap_pct=0.50):
    bot = BotConfig(name=name, is_active=True)
    clean_postgres_session.add(bot)
    clean_postgres_session.flush()
    if strategy_id is not None:
        clean_postgres_session.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy_id,
                max_positions=max_positions,
                capital_allocation_pct=cap_pct,
            )
        )
    return bot


def _create_strategy(clean_postgres_session, name="test_strategy", strategy_type="ORB", **kwargs):
    strategy = StrategyConfig(
        name=name,
        strategy_type=strategy_type,
        is_template=kwargs.pop("is_template", False),
        is_active=kwargs.pop("is_active", True),
        **kwargs,
    )
    clean_postgres_session.add(strategy)
    clean_postgres_session.flush()
    return strategy


def _setup_bot_with_association(clean_postgres_session, bot_name="Test Bot", strategy_id=None, max_positions=5, cap_pct=0.50):
    bot = BotConfig(name=bot_name, is_active=True)
    clean_postgres_session.add(bot)
    clean_postgres_session.flush()
    if strategy_id is not None:
        clean_postgres_session.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy_id,
                max_positions=max_positions,
                capital_allocation_pct=cap_pct,
            )
        )
    clean_postgres_session.commit()
    clean_postgres_session.refresh(bot)
    return bot


class TestBotStrategyRelationshipPostgreSQL:
    """Test bot-strategy many-to-many relationships."""
    
    def test_bot_with_single_strategy(
        self, 
        clean_postgres_session: Session, 
        pg_template_strategy: StrategyConfig
    ):
        """Test adding a single strategy to a bot."""
        bot = _add_bot_with_strategy(clean_postgres_session, "Single Strategy Bot", pg_template_strategy.id)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(bot)
        assert len(bot.strategies) == 1
        assert bot.strategies[0].name == "pg_template_orb"
    
    def test_bot_with_multiple_strategies(self, clean_postgres_session: Session):
        strategies = [
            _create_strategy(clean_postgres_session, f"multi_strategy_{i}")
            for i in range(3)
        ]

        bot = _add_bot_with_strategy(clean_postgres_session, "Multi Strategy Bot")

        for i, strategy in enumerate(strategies):
            clean_postgres_session.execute(
                bot_strategies.insert().values(
                    bot_id=bot.id,
                    strategy_id=strategy.id,
                    max_positions=3 + i,
                    capital_allocation_pct=0.30,
                )
            )

        clean_postgres_session.commit()

        clean_postgres_session.refresh(bot)
        assert len(bot.strategies) == 3
    
    def test_strategy_shared_by_multiple_bots(
        self,
        clean_postgres_session: Session,
        pg_template_strategy: StrategyConfig
    ):
        """Test that a strategy can be used by multiple bots."""
        bots = []
        for i in range(3):
            bot = _add_bot_with_strategy(
                clean_postgres_session, f"Shared Strategy Bot {i}", pg_template_strategy.id
            )
            bots.append(bot)
        
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(pg_template_strategy)
        assert len(pg_template_strategy.bots) == 3
    
    def test_duplicate_bot_strategy_pair_fails(
        self,
        clean_postgres_session: Session,
        pg_template_strategy: StrategyConfig
    ):
        """Test that adding same strategy to bot twice fails."""
        from sqlalchemy.exc import IntegrityError
        
        bot = _add_bot_with_strategy(clean_postgres_session, "Duplicate Test Bot", pg_template_strategy.id)
        clean_postgres_session.flush()
        
        # Second insert with same (bot_id, strategy_id) should fail
        with pytest.raises(IntegrityError):
            _add_bot_with_strategy(
                clean_postgres_session, "Dupe Bot 2", pg_template_strategy.id, max_positions=3, cap_pct=0.30
            )
            clean_postgres_session.flush()


class TestCascadeDeleteBehaviorPostgreSQL:
    """Test cascade delete behavior with PostgreSQL."""
    
    def test_delete_bot_does_not_delete_strategy(
        self,
        clean_postgres_session: Session,
        pg_template_strategy: StrategyConfig
    ):
        """Test that deleting a bot doesn't delete associated strategies."""
        bot = BotConfig(
            name="To Delete Bot",
            is_active=True,
        )
        clean_postgres_session.add(bot)
        clean_postgres_session.flush()
        
        clean_postgres_session.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=pg_template_strategy.id,
                max_positions=5,
                capital_allocation_pct=0.50,
            )
        )
        clean_postgres_session.commit()
        
        strategy_id = pg_template_strategy.id
        
        clean_postgres_session.delete(bot)
        clean_postgres_session.commit()
        
        strategy = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.id == strategy_id
        ).first()
        assert strategy is not None
        
        result = clean_postgres_session.execute(
            text("SELECT COUNT(*) FROM bot_strategies WHERE bot_id = :bot_id"),
            {"bot_id": bot.id}
        )
        count = result.scalar()
        assert count == 0
    
    def test_delete_strategy_removes_from_bot(
        self,
        clean_postgres_session: Session
    ):
        strategy = _create_strategy(clean_postgres_session, "strategy_to_delete")

        bot = _setup_bot_with_association(clean_postgres_session, "Bot With Delete Strategy", strategy.id)

        strategy_id = strategy.id
        bot_id = bot.id

        clean_postgres_session.delete(strategy)
        clean_postgres_session.commit()

        bot = clean_postgres_session.query(BotConfig).filter(
            BotConfig.id == bot_id
        ).first()
        assert bot is not None
        assert len(bot.strategies) == 0

        result = clean_postgres_session.execute(
            text("SELECT COUNT(*) FROM bot_strategies WHERE strategy_id = :sid"),
            {"sid": strategy_id}
        )
        count = result.scalar()
        assert count == 0


class TestConcurrentBotOperationsPostgreSQL:
    """Test concurrent bot operations."""
    
    def test_concurrent_bot_creation(self, postgres_engine):
        """Test creating multiple bots concurrently."""
        from sqlalchemy.orm import sessionmaker
        
        def create_bot(index):
            SessionLocal = sessionmaker(bind=postgres_engine)
            session = SessionLocal()
            
            try:
                bot = BotConfig(
                    name=f"Concurrent Bot {index}",
                    is_active=True,
                )
                session.add(bot)
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False
            finally:
                session.close()
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(create_bot, i) for i in range(10)]
            results = [f.result() for f in as_completed(futures)]
        
        assert all(results), "All concurrent bot creations should succeed"
    
    def test_concurrent_bot_name_conflict(self, postgres_engine):
        """Test concurrent creation with same bot name."""
        from sqlalchemy.orm import sessionmaker
        
        def create_bot_with_name(name):
            SessionLocal = sessionmaker(bind=postgres_engine)
            session = SessionLocal()
            
            try:
                bot = BotConfig(name=name, is_active=True)
                session.add(bot)
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False
            finally:
                session.close()
        
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(create_bot_with_name, "Same Bot Name")
                for _ in range(3)
            ]
            results = [f.result() for f in as_completed(futures)]
        
        successful = sum(1 for r in results if r)
        assert successful == 1, "Only one bot with same name should succeed"


class TestAssociationTableValuesPostgreSQL:
    """Test bot_strategies association table behavior."""
    
    def test_association_table_extra_columns(
        self,
        clean_postgres_session: Session,
        pg_template_strategy: StrategyConfig
    ):
        bot = _setup_bot_with_association(clean_postgres_session, "Association Test Bot", pg_template_strategy.id, max_positions=7, cap_pct=0.35)

        result = clean_postgres_session.execute(
            text("""
                SELECT max_positions, capital_allocation_pct 
                FROM bot_strategies 
                WHERE bot_id = :bot_id AND strategy_id = :sid
            """),
            {"bot_id": bot.id, "sid": pg_template_strategy.id}
        )
        row = result.fetchone()

        assert row is not None
        assert row[0] == 7
        assert row[1] == 0.35

    def test_update_association_values(
        self,
        clean_postgres_session: Session,
        pg_template_strategy: StrategyConfig
    ):
        bot = _setup_bot_with_association(clean_postgres_session, "Update Association Bot", pg_template_strategy.id)

        clean_postgres_session.execute(
            text("""
                UPDATE bot_strategies 
                SET max_positions = :max_pos, capital_allocation_pct = :cap
                WHERE bot_id = :bot_id AND strategy_id = :sid
            """),
            {
                "bot_id": bot.id,
                "sid": pg_template_strategy.id,
                "max_pos": 10,
                "cap": 0.75,
            }
        )
        clean_postgres_session.commit()

        result = clean_postgres_session.execute(
            text("""
                SELECT max_positions, capital_allocation_pct 
                FROM bot_strategies 
                WHERE bot_id = :bot_id AND strategy_id = :sid
            """),
            {"bot_id": bot.id, "sid": pg_template_strategy.id}
        )
        row = result.fetchone()

        assert row[0] == 10
        assert row[1] == 0.75
