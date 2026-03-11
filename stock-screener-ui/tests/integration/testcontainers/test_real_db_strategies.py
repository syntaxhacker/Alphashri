"""
Real PostgreSQL tests for strategy configuration functionality.

Tests differences between SQLite and PostgreSQL:
- Strategy CRUD operations
- Parent-child relationships
- Template filtering
- Strategy type constraints
- Case sensitivity
"""

import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from db.models import StrategyConfig

pytestmark = pytest.mark.testcontainers


class TestStrategyCRUDPostgreSQL:
    """Test strategy CRUD operations with real PostgreSQL database."""
    
    def test_create_strategy_basic(self, clean_postgres_session: Session):
        """Test basic strategy creation in PostgreSQL."""
        strategy = StrategyConfig(
            name="basic_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            or_minutes=30,
            sl_pct=0.4,
            tp_pct=1.2,
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        assert strategy.id is not None
        assert strategy.name == "basic_strategy"
        assert strategy.strategy_type == "ORB"
        assert strategy.created_at is not None
    
    def test_strategy_name_unique_constraint(self, clean_postgres_session: Session):
        """Test unique strategy name constraint in PostgreSQL."""
        strategy1 = StrategyConfig(
            name="unique_strategy",
            strategy_type="ORB",
            is_template=False,
        )
        clean_postgres_session.add(strategy1)
        clean_postgres_session.commit()
        
        strategy2 = StrategyConfig(
            name="unique_strategy",
            strategy_type="52W_CHASER",
            is_template=False,
        )
        clean_postgres_session.add(strategy2)
        
        with pytest.raises(IntegrityError) as exc_info:
            clean_postgres_session.commit()
        
        assert "unique" in str(exc_info.value).lower() or "duplicate" in str(exc_info.value).lower()
    
    def test_strategy_default_values(self, clean_postgres_session: Session):
        """Test that default values are properly set in PostgreSQL."""
        strategy = StrategyConfig(
            name="defaults_strategy",
            strategy_type="ORB",
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(strategy)
        assert strategy.is_template is False
        assert strategy.is_active is True
        assert strategy.is_default is False
        assert strategy.or_minutes == 45
        assert strategy.sl_pct == 0.4
        assert strategy.tp_pct == 1.2
    
    def test_update_strategy(self, clean_postgres_session: Session):
        """Test updating a strategy."""
        strategy = StrategyConfig(
            name="update_strategy",
            strategy_type="ORB",
            is_active=True,
            sl_pct=0.4,
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        strategy.sl_pct = 0.5
        strategy.tp_pct = 1.5
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(strategy)
        assert strategy.sl_pct == 0.5
        assert strategy.tp_pct == 1.5
    
    def test_delete_strategy(self, clean_postgres_session: Session):
        """Test deleting a strategy."""
        strategy = StrategyConfig(
            name="delete_strategy",
            strategy_type="ORB",
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        strategy_id = strategy.id
        clean_postgres_session.delete(strategy)
        clean_postgres_session.commit()
        
        found = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.id == strategy_id
        ).first()
        assert found is None


class TestParentChildRelationshipsPostgreSQL:
    """Test parent-child relationships for strategy variations."""
    
    def test_create_child_strategy(self, clean_postgres_session: Session):
        """Test creating a child strategy from a template."""
        parent = StrategyConfig(
            name="parent_template",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            sl_pct=0.4,
            tp_pct=1.2,
        )
        clean_postgres_session.add(parent)
        clean_postgres_session.flush()
        
        child = StrategyConfig(
            name="child_variation",
            strategy_type="ORB",
            parent_id=parent.id,
            is_template=False,
            is_active=True,
            sl_pct=0.5,
            tp_pct=1.5,
        )
        clean_postgres_session.add(child)
        clean_postgres_session.commit()
        
        assert child.parent_id == parent.id
        
        clean_postgres_session.refresh(child)
        assert child.parent.name == "parent_template"
    
    def test_multiple_children_from_same_parent(self, clean_postgres_session: Session):
        """Test multiple child strategies from the same parent."""
        parent = StrategyConfig(
            name="multi_parent",
            strategy_type="ORB",
            is_template=True,
        )
        clean_postgres_session.add(parent)
        clean_postgres_session.flush()
        
        children = []
        for i in range(3):
            child = StrategyConfig(
                name=f"child_{i}",
                strategy_type="ORB",
                parent_id=parent.id,
                is_template=False,
                sl_pct=0.3 + i * 0.1,
            )
            clean_postgres_session.add(child)
            children.append(child)
        
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(parent)
        assert len(parent.variations) == 3
    
    def test_nested_parent_child(self, clean_postgres_session: Session):
        """Test nested parent-child relationships (grandchild)."""
        grandparent = StrategyConfig(
            name="grandparent",
            strategy_type="ORB",
            is_template=True,
        )
        clean_postgres_session.add(grandparent)
        clean_postgres_session.flush()
        
        parent = StrategyConfig(
            name="parent",
            strategy_type="ORB",
            parent_id=grandparent.id,
            is_template=False,
        )
        clean_postgres_session.add(parent)
        clean_postgres_session.flush()
        
        child = StrategyConfig(
            name="grandchild",
            strategy_type="ORB",
            parent_id=parent.id,
            is_template=False,
        )
        clean_postgres_session.add(child)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(child)
        assert child.parent_id == parent.id
        assert child.parent.parent_id == grandparent.id
    
    def test_delete_parent_keeps_children(self, clean_postgres_session: Session):
        """Test that deleting a parent doesn't delete children."""
        parent = StrategyConfig(
            name="delete_parent",
            strategy_type="ORB",
            is_template=True,
        )
        clean_postgres_session.add(parent)
        clean_postgres_session.flush()
        
        child = StrategyConfig(
            name="orphan_child",
            strategy_type="ORB",
            parent_id=parent.id,
            is_template=False,
        )
        clean_postgres_session.add(child)
        clean_postgres_session.commit()
        
        child_id = child.id
        
        clean_postgres_session.delete(parent)
        clean_postgres_session.commit()
        
        child = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.id == child_id
        ).first()
        assert child is not None
        assert child.parent_id is None


class TestTemplateFilteringPostgreSQL:
    """Test template filtering functionality."""
    
    def test_filter_templates_only(self, clean_postgres_session: Session):
        """Test filtering for template strategies only."""
        templates = [
            StrategyConfig(
                name=f"template_{i}",
                strategy_type="ORB",
                is_template=True,
                is_active=True,
            )
            for i in range(3)
        ]
        
        variations = [
            StrategyConfig(
                name=f"variation_{i}",
                strategy_type="ORB",
                is_template=False,
                is_active=True,
            )
            for i in range(2)
        ]
        
        clean_postgres_session.add_all(templates + variations)
        clean_postgres_session.commit()
        
        found_templates = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.is_template == True
        ).all()
        
        assert len(found_templates) == 3
        assert all(s.is_template for s in found_templates)
    
    def test_filter_active_only(self, clean_postgres_session: Session):
        """Test filtering for active strategies only."""
        active = [
            StrategyConfig(
                name=f"active_{i}",
                strategy_type="ORB",
                is_active=True,
            )
            for i in range(2)
        ]
        
        inactive = [
            StrategyConfig(
                name=f"inactive_{i}",
                strategy_type="ORB",
                is_active=False,
            )
            for i in range(3)
        ]
        
        clean_postgres_session.add_all(active + inactive)
        clean_postgres_session.commit()
        
        found_active = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.is_active == True
        ).all()
        
        assert len(found_active) == 2
        assert all(s.is_active for s in found_active)
    
    def test_filter_by_strategy_type(self, clean_postgres_session: Session):
        """Test filtering by strategy type."""
        orb_strategies = [
            StrategyConfig(
                name=f"orb_{i}",
                strategy_type="ORB",
            )
            for i in range(2)
        ]
        
        chaser_strategies = [
            StrategyConfig(
                name=f"chaser_{i}",
                strategy_type="52W_CHASER",
            )
            for i in range(3)
        ]
        
        clean_postgres_session.add_all(orb_strategies + chaser_strategies)
        clean_postgres_session.commit()
        
        found_orb = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.strategy_type == "ORB"
        ).all()
        
        assert len(found_orb) == 2
        assert all(s.strategy_type == "ORB" for s in found_orb)
    
    def test_filter_default_strategies(self, clean_postgres_session: Session):
        """Test filtering for default strategies."""
        defaults = [
            StrategyConfig(
                name=f"default_{i}",
                strategy_type="ORB",
                is_default=True,
            )
            for i in range(2)
        ]
        
        non_defaults = [
            StrategyConfig(
                name=f"nondefault_{i}",
                strategy_type="ORB",
                is_default=False,
            )
            for i in range(3)
        ]
        
        clean_postgres_session.add_all(defaults + non_defaults)
        clean_postgres_session.commit()
        
        found_defaults = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.is_default == True
        ).all()
        
        assert len(found_defaults) == 2


class TestStrategyTypeConstraintsPostgreSQL:
    """Test strategy type and constraint behavior."""
    
    def test_null_strategy_type_not_allowed(self, clean_postgres_session: Session):
        """Test that strategy_type cannot be null in PostgreSQL (NOT NULL constraint)."""
        from sqlalchemy.exc import IntegrityError
        
        strategy = StrategyConfig(
            name="null_type",
            strategy_type=None,
        )
        clean_postgres_session.add(strategy)
        
        # PostgreSQL enforces NOT NULL on strategy_type
        with pytest.raises(IntegrityError):
            clean_postgres_session.commit()
    
    def test_case_sensitivity_in_strategy_type(self, clean_postgres_session: Session):
        """
        Test case sensitivity in strategy_type field.
        
        PostgreSQL is case-sensitive for string comparisons.
        """
        strategy1 = StrategyConfig(
            name="case_lower",
            strategy_type="orb",
        )
        strategy2 = StrategyConfig(
            name="case_upper",
            strategy_type="ORB",
        )
        clean_postgres_session.add_all([strategy1, strategy2])
        clean_postgres_session.commit()
        
        found_lower = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.strategy_type == "orb"
        ).all()
        
        found_upper = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.strategy_type == "ORB"
        ).all()
        
        assert len(found_lower) == 1
        assert len(found_upper) == 1
        assert found_lower[0].name == "case_lower"
        assert found_upper[0].name == "case_upper"
    
    def test_case_sensitivity_in_name(self, clean_postgres_session: Session):
        """
        Test case sensitivity in strategy name.
        
        Names are unique but case-sensitive in PostgreSQL.
        """
        strategy1 = StrategyConfig(
            name="CaseStrategy",
            strategy_type="ORB",
        )
        strategy2 = StrategyConfig(
            name="casestrategy",
            strategy_type="ORB",
        )
        clean_postgres_session.add_all([strategy1, strategy2])
        clean_postgres_session.commit()
        
        found = clean_postgres_session.query(StrategyConfig).filter(
            StrategyConfig.name == "CaseStrategy"
        ).first()
        
        assert found is not None
        assert found.name == "CaseStrategy"


class TestStrategyNumericFieldsPostgreSQL:
    """Test numeric field handling in PostgreSQL."""
    
    def test_float_precision(self, clean_postgres_session: Session):
        """Test float precision in PostgreSQL."""
        strategy = StrategyConfig(
            name="precision_test",
            strategy_type="ORB",
            sl_pct=0.123456789,
            tp_pct=1.987654321,
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(strategy)
        assert abs(strategy.sl_pct - 0.123456789) < 0.000001
        assert abs(strategy.tp_pct - 1.987654321) < 0.000001
    
    def test_negative_values(self, clean_postgres_session: Session):
        """Test handling of negative numeric values."""
        strategy = StrategyConfig(
            name="negative_test",
            strategy_type="ORB",
            sl_pct=-0.5,
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(strategy)
        assert strategy.sl_pct == -0.5
    
    def test_large_values(self, clean_postgres_session: Session):
        """Test handling of large numeric values."""
        strategy = StrategyConfig(
            name="large_value_test",
            strategy_type="ORB",
            max_trade_value=999999999.99,
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(strategy)
        assert strategy.max_trade_value == 999999999.99


class TestStrategyToDictPostgreSQL:
    """Test strategy to_dict method with PostgreSQL data."""
    
    def test_to_dict_basic(self, clean_postgres_session: Session):
        """Test to_dict method returns correct data."""
        strategy = StrategyConfig(
            name="dict_test",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            or_minutes=30,
            sl_pct=0.4,
            tp_pct=1.2,
        )
        clean_postgres_session.add(strategy)
        clean_postgres_session.commit()
        
        result = strategy.to_dict()
        
        assert result["name"] == "dict_test"
        assert result["strategy_type"] == "ORB"
        assert result["is_template"] is True
        assert result["is_active"] is True
        assert result["or_minutes"] == 30
        assert result["sl_pct"] == 0.4
        assert result["tp_pct"] == 1.2
        assert "created_at" in result
        assert "updated_at" in result
    
    def test_to_dict_with_parent(self, clean_postgres_session: Session):
        """Test to_dict includes parent_id."""
        parent = StrategyConfig(
            name="dict_parent",
            strategy_type="ORB",
            is_template=True,
        )
        clean_postgres_session.add(parent)
        clean_postgres_session.flush()
        
        child = StrategyConfig(
            name="dict_child",
            strategy_type="ORB",
            parent_id=parent.id,
        )
        clean_postgres_session.add(child)
        clean_postgres_session.commit()
        
        result = child.to_dict()
        
        assert result["parent_id"] == parent.id


class TestConcurrentStrategyOperationsPostgreSQL:
    """Test concurrent strategy operations."""
    
    def test_concurrent_strategy_creation(self, postgres_engine):
        """Test creating strategies concurrently."""
        from sqlalchemy.orm import sessionmaker
        
        def create_strategy(index):
            SessionLocal = sessionmaker(bind=postgres_engine)
            session = SessionLocal()
            
            try:
                strategy = StrategyConfig(
                    name=f"concurrent_strategy_{index}",
                    strategy_type="ORB",
                )
                session.add(strategy)
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False
            finally:
                session.close()
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(create_strategy, i) for i in range(10)]
            results = [f.result() for f in as_completed(futures)]
        
        assert all(results), "All concurrent strategy creations should succeed"
    
    def test_concurrent_duplicate_name_detection(self, postgres_engine):
        """Test concurrent creation with same strategy name."""
        from sqlalchemy.orm import sessionmaker
        
        def create_strategy_with_name(name):
            SessionLocal = sessionmaker(bind=postgres_engine)
            session = SessionLocal()
            
            try:
                strategy = StrategyConfig(
                    name=name,
                    strategy_type="ORB",
                )
                session.add(strategy)
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False
            finally:
                session.close()
        
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(create_strategy_with_name, "Same Strategy Name")
                for _ in range(3)
            ]
            results = [f.result() for f in as_completed(futures)]
        
        successful = sum(1 for r in results if r)
        assert successful == 1, "Only one strategy with same name should succeed"
