"""
Strategy Management API Tests

Comprehensive tests for strategy endpoints:
- GET /api/strategies - List strategies
- GET /api/strategies/templates - List templates
- GET /api/strategies/{id} - Get specific strategy
- POST /api/strategies - Create strategy
- PUT /api/strategies/{id} - Update strategy
- DELETE /api/strategies/{id} - Delete strategy
- GET /api/strategies/{id}/performance - Get performance
- GET /api/strategies/{id}/trades - Get trades
- GET /api/strategies/{id}/variations - Get variations

Reference: API_TEST_SCENARIOS.md section 2
"""

import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from db.models import StrategyConfig


# ============================================================================
# 2.1 List Strategies
# ============================================================================

class TestListStrategies:
    """Tests for GET /api/strategies endpoint."""

    def test_list_all_non_template_strategies(
        self, client: TestClient, sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test listing all non-template strategies."""
        response = client.get("/api/strategies")
        assert response.status_code == 200

        data = response.json()
        assert "strategies" in data
        assert "count" in data
        assert data["count"] == len(sample_strategies)

        # Verify templates are not included
        for strategy in data["strategies"]:
            assert strategy["is_template"] is False

    def test_list_with_include_templates_true(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test listing with include_templates=true."""
        response = client.get("/api/strategies?include_templates=true")
        assert response.status_code == 200

        data = response.json()
        # Should include both templates and non-templates
        assert data["count"] >= len(sample_strategies) + 1

        # Verify at least the template is included
        template_uuids = [s["id"] for s in data["strategies"] if s["is_template"]]
        assert sample_template_strategy.uuid in template_uuids

    def test_filter_by_strategy_type(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test filtering by strategy_type."""
        # First get all ORB strategies
        response = client.get("/api/strategies?strategy_type=ORB")
        assert response.status_code == 200

        data = response.json()
        for strategy in data["strategies"]:
            assert strategy["strategy_type"] == "ORB"

        # Then get 52W_CHASER strategies
        response = client.get("/api/strategies?strategy_type=52W_CHASER")
        assert response.status_code == 200

        data = response.json()
        for strategy in data["strategies"]:
            assert strategy["strategy_type"] == "52W_CHASER"

    def test_response_structure(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test response has correct structure."""
        response = client.get("/api/strategies")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data["strategies"], list)
        assert isinstance(data["count"], int)
        assert data["count"] == len(data["strategies"])
        assert data["count"] >= 1
        assert data["strategies"][0]["strategy_type"] == sample_strategy.strategy_type

    def test_strategies_sorted_by_type_and_name(
        self, client: TestClient, sample_strategies: list[StrategyConfig]
    ):
        """Test strategies are sorted by type then name."""
        response = client.get("/api/strategies")
        assert response.status_code == 200

        data = response.json()
        strategies = data["strategies"]

        for i in range(len(strategies) - 1):
            current = strategies[i]
            next_item = strategies[i + 1]
            if current["strategy_type"] == next_item["strategy_type"]:
                assert current["name"] <= next_item["name"], \
                    f"Same type not sorted by name: {current['name']} vs {next_item['name']}"
            else:
                assert current["strategy_type"] < next_item["strategy_type"], \
                    f"Not sorted by type: {current['strategy_type']} vs {next_item['strategy_type']}"

    def test_list_empty_database(self, client: TestClient, db: Session):
        """Test listing strategies when database is empty."""
        response = client.get("/api/strategies")
        assert response.status_code == 200

        data = response.json()
        assert data["strategies"] == []
        assert data["count"] == 0


# ============================================================================
# 2.2 List Templates
# ============================================================================

class TestListTemplates:
    """Tests for GET /api/strategies/templates endpoint."""

    def test_list_all_active_templates(
        self, client: TestClient, sample_template_strategies: list[StrategyConfig]
    ):
        """Test listing all active templates."""
        response = client.get("/api/strategies/templates")
        assert response.status_code == 200

        data = response.json()
        assert "templates" in data
        assert "count" in data

        # Should only return active templates (3 out of 4 in fixture)
        active_templates = [t for t in sample_template_strategies if t.is_active]
        assert data["count"] == len(active_templates)

    def test_only_templates_returned(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategy: StrategyConfig
    ):
        """Test only templates with is_template=True are returned."""
        response = client.get("/api/strategies/templates")
        assert response.status_code == 200

        data = response.json()
        for template in data["templates"]:
            assert template["is_template"] is True
            assert template["is_active"] is True

    def test_inactive_templates_not_returned(
        self, client: TestClient, sample_template_strategies: list[StrategyConfig]
    ):
        """Test inactive templates are not returned."""
        response = client.get("/api/strategies/templates")
        assert response.status_code == 200

        data = response.json()
        template_names = [t["name"] for t in data["templates"]]

        # "Inactive Template" should not be in the list
        assert "Inactive Template" not in template_names

    def test_templates_sorted_by_name(
        self, client: TestClient, sample_template_strategies: list[StrategyConfig]
    ):
        """Test templates are sorted by name."""
        response = client.get("/api/strategies/templates")
        assert response.status_code == 200

        data = response.json()
        templates = data["templates"]

        for i in range(len(templates) - 1):
            assert templates[i]["name"] <= templates[i + 1]["name"]

    def test_empty_templates_list(self, client: TestClient, db: Session):
        """Test listing templates when none exist."""
        response = client.get("/api/strategies/templates")
        assert response.status_code == 200

        data = response.json()
        assert data["templates"] == []
        assert data["count"] == 0


# ============================================================================
# 2.3 Get Strategy
# ============================================================================

class TestGetStrategy:
    """Tests for GET /api/strategies/{id} endpoint."""

    def test_get_existing_strategy(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test getting an existing strategy by ID."""
        response = client.get(f"/api/strategies/{sample_strategy.id}")
        assert response.status_code == 200

        data = response.json()
        assert "strategy" in data
        assert data["strategy"]["id"] == sample_strategy.uuid
        assert data["strategy"]["name"] == sample_strategy.name

    def test_get_non_existent_strategy(self, client: TestClient):
        """Test getting a non-existent strategy returns 404."""
        response = client.get("/api/strategies/99999")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_get_template_includes_variations(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test that getting a template includes its variations."""
        response = client.get(f"/api/strategies/{sample_template_strategy.id}")
        assert response.status_code == 200

        data = response.json()
        assert "strategy" in data
        assert "variations" in data

        # Variations should be included
        assert isinstance(data["variations"], list)

        # Only active variations should be returned
        for variation in data["variations"]:
            assert variation["is_active"] is True
            assert variation["parent_id"] == sample_template_strategy.id

    def test_get_non_template_no_variations(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test that getting a non-template strategy returns empty variations."""
        response = client.get(f"/api/strategies/{sample_strategy.id}")
        assert response.status_code == 200

        data = response.json()
        assert "strategy" in data
        assert "variations" in data
        # Non-templates should have empty variations list
        assert data["variations"] == []

    def test_get_strategy_response_structure(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test get strategy response has all expected fields."""
        response = client.get(f"/api/strategies/{sample_strategy.id}")
        assert response.status_code == 200

        data = response.json()
        strategy = data["strategy"]

        # Verify all expected fields are present
        expected_fields = [
            "id", "name", "strategy_type", "parent_id", "is_template",
            "is_active", "is_default", "description",
            "or_minutes", "sl_pct", "tp_pct",
            "min_or_range_pct", "max_or_range_pct",
            "max_positions", "max_capital_per_trade_pct",
            "max_daily_loss_pct", "max_total_exposure_pct",
            "risk_per_trade_pct", "min_trade_value", "max_trade_value",
            "cooldown_minutes", "max_distance_from_or_pct",
            "brokerage_pct", "min_brokerage", "stt_pct",
            "exchange_pct", "sebi_pct", "stamp_pct", "gst_pct",
            "created_at", "updated_at"
        ]

        for field in expected_fields:
            assert field in strategy


# ============================================================================
# 2.4 Create Strategy
# ============================================================================

class TestCreateStrategy:
    """Tests for POST /api/strategies endpoint."""

    def test_create_strategy_with_minimal_fields(self, client: TestClient, db: Session):
        """Test creating a strategy with minimal required fields."""
        strategy_data = {
            "name": "Minimal Strategy",
            "strategy_type": "ORB"
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "success"
        assert "strategy" in data
        assert data["strategy"]["name"] == "Minimal Strategy"
        assert data["strategy"]["strategy_type"] == "ORB"
        assert data["strategy"]["is_template"] is False
        assert data["strategy"]["is_active"] is True

        # Verify in database
        strategy = db.query(StrategyConfig).filter(
            StrategyConfig.name == "Minimal Strategy"
        ).first()
        assert strategy is not None

    def test_create_strategy_with_all_parameters(
        self, client: TestClient, sample_template_strategy: StrategyConfig
    ):
        """Test creating a strategy with all parameters."""
        strategy_data = {
            "name": "Complete Strategy",
            "strategy_type": "ORB",
            "parent_id": sample_template_strategy.id,
            "description": "A complete strategy with all parameters",
            "or_minutes": 30,
            "sl_pct": 0.35,
            "tp_pct": 1.0,
            "min_or_range_pct": 0.4,
            "max_or_range_pct": 2.5,
            "max_positions": 4,
            "max_capital_per_trade_pct": 0.12,
            "max_daily_loss_pct": 0.015,
            "max_total_exposure_pct": 0.45,
            "risk_per_trade_pct": 0.008,
            "min_trade_value": 8000,
            "max_trade_value": 120000,
            "cooldown_minutes": 25,
            "max_distance_from_or_pct": 1.3,
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 200

        data = response.json()
        strategy = data["strategy"]

        assert strategy["name"] == "Complete Strategy"
        assert strategy["or_minutes"] == 30
        assert strategy["sl_pct"] == 0.35
        assert strategy["tp_pct"] == 1.0
        assert strategy["max_positions"] == 4

    def test_create_strategy_from_template(
        self, client: TestClient, sample_template_strategy: StrategyConfig, db: Session
    ):
        """Test creating a strategy from template (with parent_id)."""
        strategy_data = {
            "name": "Template Child",
            "strategy_type": "ORB",
            "parent_id": sample_template_strategy.id,
            "description": "Child of template",
            # Override some values
            "sl_pct": 0.5,
            "tp_pct": 1.8,
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 200

        data = response.json()
        strategy = data["strategy"]

        # Should have parent defaults for unspecified values
        assert strategy["parent_id"] == sample_template_strategy.id
        assert strategy["sl_pct"] == 0.5  # Overridden
        assert strategy["tp_pct"] == 1.8  # Overridden
        assert strategy["or_minutes"] == 45  # Inherited from template

    def test_create_with_duplicate_name(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test creating with duplicate name returns 400."""
        strategy_data = {
            "name": sample_strategy.name,  # Duplicate
            "strategy_type": "ORB"
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    def test_create_with_non_existent_parent_id(self, client: TestClient):
        """Test creating with non-existent parent_id returns 400."""
        strategy_data = {
            "name": "Orphan Strategy",
            "strategy_type": "ORB",
            "parent_id": 99999  # Non-existent
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 400
        assert "parent" in response.json()["detail"].lower()

    def test_verify_parent_defaults_inherited(
        self, client: TestClient, sample_template_strategy: StrategyConfig
    ):
        """Test that parent defaults are properly inherited."""
        # Template has specific values
        assert sample_template_strategy.or_minutes == 45
        assert sample_template_strategy.sl_pct == 0.4

        strategy_data = {
            "name": "Inheritance Test",
            "strategy_type": "ORB",
            "parent_id": sample_template_strategy.id,
            # Only override one value
            "tp_pct": 2.0,
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 200

        data = response.json()
        strategy = data["strategy"]

        # Should inherit parent defaults
        assert strategy["or_minutes"] == 45
        assert strategy["sl_pct"] == 0.4
        # But override specified value
        assert strategy["tp_pct"] == 2.0

    def test_verify_request_values_override_parent_defaults(
        self, client: TestClient, sample_template_strategy: StrategyConfig
    ):
        """Test that request values override parent defaults."""
        strategy_data = {
            "name": "Override Test",
            "strategy_type": "ORB",
            "parent_id": sample_template_strategy.id,
            # Override parent values
            "or_minutes": 15,
            "sl_pct": 0.2,
            "max_positions": 10,
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 200

        data = response.json()
        strategy = data["strategy"]

        assert strategy["or_minutes"] == 15
        assert strategy["sl_pct"] == 0.2
        assert strategy["max_positions"] == 10

    def test_verify_strategy_created_in_database(
        self, client: TestClient, db: Session
    ):
        """Test that strategy is persisted to database."""
        strategy_data = {
            "name": "Persistence Test",
            "strategy_type": "ORB"
        }

        response = client.post("/api/strategies", json=strategy_data)
        assert response.status_code == 200

        strategy_uuid = response.json()["strategy"]["id"]

        # Verify in database - API returns UUID as 'id'
        strategy = db.query(StrategyConfig).filter(
            StrategyConfig.uuid == strategy_uuid
        ).first()
        assert strategy is not None
        assert strategy.name == "Persistence Test"


# ============================================================================
# 2.5 Update Strategy
# ============================================================================

class TestUpdateStrategy:
    """Tests for PUT /api/strategies/{id} endpoint."""

    def test_update_strategy_name(self, client: TestClient, sample_strategy: StrategyConfig, db: Session):
        """Test updating strategy name."""
        new_name = "Updated Strategy Name"
        update_data = {"name": new_name}

        response = client.put(f"/api/strategies/{sample_strategy.id}", json=update_data)
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "success"
        assert data["strategy"]["name"] == new_name

        # Verify in database
        db.refresh(sample_strategy)
        assert sample_strategy.name == new_name

    def test_update_strategy_parameters(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test updating strategy parameters (sl_pct, tp_pct, etc.)."""
        update_data = {
            "sl_pct": 0.6,
            "tp_pct": 2.0,
            "max_positions": 8,
            "or_minutes": 20,
        }

        response = client.put(f"/api/strategies/{sample_strategy.id}", json=update_data)
        assert response.status_code == 200

        data = response.json()
        strategy = data["strategy"]

        assert strategy["sl_pct"] == 0.6
        assert strategy["tp_pct"] == 2.0
        assert strategy["max_positions"] == 8
        assert strategy["or_minutes"] == 20

    def test_update_is_active_status(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test updating is_active status."""
        update_data = {"is_active": False}

        response = client.put(f"/api/strategies/{sample_strategy.id}", json=update_data)
        assert response.status_code == 200

        data = response.json()
        assert data["strategy"]["is_active"] is False

        # Reactivate
        update_data = {"is_active": True}
        response = client.put(f"/api/strategies/{sample_strategy.id}", json=update_data)
        assert response.status_code == 200

        data = response.json()
        assert data["strategy"]["is_active"] is True

    def test_set_strategy_as_default(
        self, client: TestClient, sample_strategy: StrategyConfig,
        default_strategy: StrategyConfig, db: Session
    ):
        """Test setting strategy as default (is_default=True)."""
        # Verify we have an existing default
        assert default_strategy.is_default is True

        update_data = {"is_default": True}
        response = client.put(f"/api/strategies/{sample_strategy.id}", json=update_data)
        assert response.status_code == 200

        # Old default should be unset
        db.refresh(default_strategy)
        assert default_strategy.is_default is False

        # New strategy should be default
        data = response.json()
        assert data["strategy"]["is_default"] is True

    def test_update_non_existent_strategy(self, client: TestClient):
        """Test updating non-existent strategy returns 404."""
        update_data = {"name": "New Name"}

        response = client.put("/api/strategies/99999", json=update_data)
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_update_template_strategy(self, client: TestClient, sample_template_strategy: StrategyConfig):
        """Test updating template strategy returns 400."""
        update_data = {"name": "Should Not Work"}

        response = client.put(f"/api/strategies/{sample_template_strategy.id}", json=update_data)
        assert response.status_code == 400
        assert "template" in response.json()["detail"].lower()

    def test_verify_other_defaults_unset_when_setting_new_default(
        self, client: TestClient, db: Session
    ):
        """Test that other defaults are unset when setting new default."""
        # Create multiple strategies
        strategies = []
        for i in range(3):
            strategy = StrategyConfig(
                name=f"Strategy {i}",
                strategy_type="ORB",
                is_template=False,
                is_active=True,
                is_default=(i == 0),  # First one is default
            )
            db.add(strategy)
            strategies.append(strategy)
        db.commit()

        # Verify first is default
        assert strategies[0].is_default is True

        # Set second as default
        response = client.put(f"/api/strategies/{strategies[1].id}", json={"is_default": True})
        assert response.status_code == 200

        # Check all strategies
        db.refresh(strategies[0])
        db.refresh(strategies[1])
        db.refresh(strategies[2])

        assert strategies[0].is_default is False
        assert strategies[1].is_default is True
        assert strategies[2].is_default is False

    def test_verify_changes_persisted(
        self, client: TestClient, sample_strategy: StrategyConfig, db: Session
    ):
        """Test that changes are persisted to database."""
        original_description = sample_strategy.description
        new_description = "Updated description"

        update_data = {"description": new_description}
        response = client.put(f"/api/strategies/{sample_strategy.id}", json=update_data)
        assert response.status_code == 200

        # Clear session and reload from database
        db.expire_all()
        reloaded = db.query(StrategyConfig).filter(
            StrategyConfig.id == sample_strategy.id
        ).first()

        assert reloaded.description == new_description


# ============================================================================
# 2.6 Delete Strategy
# ============================================================================

class TestDeleteStrategy:
    """Tests for DELETE /api/strategies/{id} endpoint."""

    def test_delete_existing_strategy(self, client: TestClient, db: Session):
        """Test deleting existing strategy (soft delete)."""
        strategy = StrategyConfig(
            name="To Be Deleted",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        strategy_id = strategy.id

        response = client.delete(f"/api/strategies/{strategy_id}")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "success"
        assert "deleted" in data["message"].lower()

    def test_delete_non_existent_strategy(self, client: TestClient):
        """Test deleting non-existent strategy returns 404."""
        response = client.delete("/api/strategies/99999")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_delete_template_strategy(self, client: TestClient, sample_template_strategy: StrategyConfig):
        """Test deleting template strategy returns 400."""
        response = client.delete(f"/api/strategies/{sample_template_strategy.id}")
        assert response.status_code == 400
        assert "template" in response.json()["detail"].lower()

    def test_verify_is_active_set_to_false(
        self, client: TestClient, db: Session
    ):
        """Test that is_active is set to False after soft delete."""
        strategy = StrategyConfig(
            name="Soft Delete Test",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        strategy_id = strategy.id

        response = client.delete(f"/api/strategies/{strategy_id}")
        assert response.status_code == 200

        # Verify is_active is False
        db.refresh(strategy)
        assert strategy.is_active is False

    def test_verify_strategy_still_exists_in_database(
        self, client: TestClient, db: Session
    ):
        """Test that strategy still exists in database after soft delete."""
        strategy = StrategyConfig(
            name="Still Exists",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        strategy_id = strategy.id

        response = client.delete(f"/api/strategies/{strategy_id}")
        assert response.status_code == 200

        # Strategy should still exist in database
        deleted_strategy = db.query(StrategyConfig).filter(
            StrategyConfig.id == strategy_id
        ).first()
        assert deleted_strategy is not None
        assert deleted_strategy.is_active is False

    def test_deleted_strategy_marked_inactive(
        self, client: TestClient, db: Session
    ):
        """Test that deleted strategy is marked as inactive (soft delete)."""
        strategy = StrategyConfig(
            name="Soft Deleted Strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        strategy_id = strategy.id

        # Verify it's active before deletion
        db.refresh(strategy)
        assert strategy.is_active is True

        # Delete it (soft delete)
        response = client.delete(f"/api/strategies/{strategy_id}")
        assert response.status_code == 200

        # Verify is_active is set to False
        db.refresh(strategy)
        assert strategy.is_active is False

        # Note: The list endpoint doesn't filter by is_active,
        # so the strategy will still appear in the list but with is_active=False
        response = client.get(f"/api/strategies/{strategy_id}")
        assert response.status_code == 200
        assert response.json()["strategy"]["is_active"] is False


# ============================================================================
# 2.7 Get Strategy Performance
# ============================================================================

class TestGetStrategyPerformance:
    """Tests for GET /api/strategies/{id}/performance endpoint."""

    def test_get_performance_for_strategy_with_trades(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test getting performance for strategy with trades."""
        response = client.get(f"/api/strategies/{sample_strategy.id}/performance")
        assert response.status_code == 200

        data = response.json()
        assert data["strategy_id"] == sample_strategy.id
        assert data["strategy_name"] == sample_strategy.name
        assert "total_trades" in data
        assert "winners" in data
        assert "losers" in data
        assert "win_rate" in data
        assert "net_pnl" in data

    def test_get_performance_for_strategy_with_no_trades(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ):
        """Test getting performance for strategy with no trades."""
        # Mock to return empty trades for this specific test
        def mock_load_empty(user_id: int):
            return []

        monkeypatch.setattr("api.strategies._load_all_trades", mock_load_empty)

        strategy = StrategyConfig(
            name="No Trades Strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()

        response = client.get(f"/api/strategies/{strategy.id}/performance")
        assert response.status_code == 200

        data = response.json()
        assert data["total_trades"] == 0
        assert data["winners"] == 0
        assert data["losers"] == 0
        assert data["win_rate"] == 0
        assert data["net_pnl"] == 0

    def test_filter_out_test_trades(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test filtering out test trades (include_test=false)."""
        # First get all trades
        response = client.get(
            f"/api/strategies/{sample_strategy.id}/performance?include_test=true"
        )
        assert response.status_code == 200
        data_with_test = response.json()

        # Then get without test trades
        response = client.get(
            f"/api/strategies/{sample_strategy.id}/performance?include_test=false"
        )
        assert response.status_code == 200
        data_without_test = response.json()

        assert data_with_test["total_trades"] == 1
        assert data_without_test["total_trades"] == 1

    def test_get_performance_for_non_existent_strategy(self, client: TestClient):
        """Test getting performance for non-existent strategy returns 404."""
        response = client.get("/api/strategies/99999/performance")
        assert response.status_code == 404

    def test_verify_performance_stats(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test performance stats are calculated correctly."""
        response = client.get(f"/api/strategies/{sample_strategy.id}/performance")
        assert response.status_code == 200

        data = response.json()

        # Verify calculations
        total_trades = data["total_trades"]
        winners = data["winners"]
        losers = data["losers"]

        assert total_trades == winners + losers

        # Win rate should be calculated correctly
        expected_win_rate = (winners / total_trades * 100) if total_trades > 0 else 0
        assert data["win_rate"] == round(expected_win_rate, 1)

    def test_verify_test_trades_count(
        self, client: TestClient, sample_template_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test that test_trades count and has_test_data flag are correct."""
        response = client.get(f"/api/strategies/{sample_template_strategy.id}/performance")
        assert response.status_code == 200

        data = response.json()
        assert data["test_trades"] == 1
        assert data["has_test_data"] is True
        assert data["total_trades"] == 2


# ============================================================================
# 2.8 Get Strategy Trades
# ============================================================================

class TestGetStrategyTrades:
    """Tests for GET /api/strategies/{id}/trades endpoint."""

    def test_get_trades_with_default_limit(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test getting trades with default limit (50)."""
        response = client.get(f"/api/strategies/{sample_strategy.id}/trades")
        assert response.status_code == 200

        data = response.json()
        assert data["strategy_id"] == sample_strategy.id
        assert "trades" in data
        assert "total" in data
        assert len(data["trades"]) <= 50  # Default limit

    def test_get_trades_with_custom_limit(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test getting trades with custom limit."""
        limit = 2
        response = client.get(
            f"/api/strategies/{sample_strategy.id}/trades?limit={limit}"
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["trades"]) <= limit

    def test_filter_out_test_trades(
        self, client: TestClient, sample_template_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test filtering out test trades (include_test=false)."""
        # Get with test trades
        response = client.get(
            f"/api/strategies/{sample_template_strategy.id}/trades?include_test=true"
        )
        data_with_test = response.json()

        # Get without test trades
        response = client.get(
            f"/api/strategies/{sample_template_strategy.id}/trades?include_test=false"
        )
        data_without_test = response.json()

        assert len(data_with_test["trades"]) == 2
        assert len(data_without_test["trades"]) == 1

    def test_get_trades_for_non_existent_strategy(self, client: TestClient):
        """Test getting trades for non-existent strategy returns 404."""
        response = client.get("/api/strategies/99999/trades")
        assert response.status_code == 404

    def test_verify_trades_sorted_by_exit_time(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test trades are sorted by exit_time descending."""
        response = client.get(f"/api/strategies/{sample_strategy.id}/trades")
        assert response.status_code == 200

        data = response.json()
        trades = data["trades"]

        exit_times = [t["exit_time"] for t in trades if t.get("exit_time")]
        assert exit_times == sorted(exit_times, reverse=True), \
            "Trades not sorted by exit_time descending"

    def test_verify_response_includes_strategy_name(
        self, client: TestClient, sample_strategy: StrategyConfig,
        mock_load_all_trades
    ):
        """Test response includes strategy_name."""
        response = client.get(f"/api/strategies/{sample_strategy.id}/trades")
        assert response.status_code == 200

        data = response.json()
        assert "strategy_name" in data
        assert data["strategy_name"] == sample_strategy.name


# ============================================================================
# 2.9 Get Strategy Variations
# ============================================================================

class TestGetStrategyVariations:
    """Tests for GET /api/strategies/{id}/variations endpoint."""

    def test_get_variations_for_template_strategy(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test getting variations for a template strategy."""
        response = client.get(f"/api/strategies/{sample_template_strategy.id}/variations")
        assert response.status_code == 200

        data = response.json()
        assert "parent" in data
        assert "variations" in data
        assert "count" in data

        assert data["parent"]["id"] == sample_template_strategy.uuid
        assert data["parent"]["is_template"] is True

    def test_get_variations_for_non_template(
        self, client: TestClient, sample_strategy: StrategyConfig
    ):
        """Test getting variations for non-template strategy returns 400."""
        response = client.get(f"/api/strategies/{sample_strategy.id}/variations")
        assert response.status_code == 400
        assert "template" in response.json()["detail"].lower()

    def test_get_variations_for_non_existent_strategy(self, client: TestClient):
        """Test getting variations for non-existent strategy returns 404."""
        response = client.get("/api/strategies/99999/variations")
        assert response.status_code == 404

    def test_verify_only_active_variations_returned(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig], db: Session
    ):
        """Test that only active variations are returned."""
        # Create an inactive variation
        inactive_var = StrategyConfig(
            name="Inactive Variation",
            strategy_type="ORB",
            parent_id=sample_template_strategy.id,
            is_template=False,
            is_active=False,
        )
        db.add(inactive_var)
        db.commit()

        response = client.get(f"/api/strategies/{sample_template_strategy.id}/variations")
        assert response.status_code == 200

        data = response.json()
        # Inactive variation should not be in the list
        variation_ids = [v["id"] for v in data["variations"]]
        assert inactive_var.id not in variation_ids

    def test_verify_variations_sorted_by_name(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test variations are sorted by name."""
        response = client.get(f"/api/strategies/{sample_template_strategy.id}/variations")
        assert response.status_code == 200

        data = response.json()
        variations = data["variations"]

        for i in range(len(variations) - 1):
            assert variations[i]["name"] <= variations[i + 1]["name"]

    def test_variations_include_parent_reference(
        self, client: TestClient,
        sample_template_strategy: StrategyConfig,
        sample_strategies: list[StrategyConfig]
    ):
        """Test that variations correctly reference their parent."""
        response = client.get(f"/api/strategies/{sample_template_strategy.id}/variations")
        assert response.status_code == 200

        data = response.json()
        for variation in data["variations"]:
            assert variation["parent_id"] == sample_template_strategy.id


# ============================================================================
# Edge Cases and Additional Tests
# ============================================================================

class TestStrategyEdgeCases:
    """Additional edge case tests for strategy endpoints."""

    def test_create_strategy_with_negative_parameters(self, client: TestClient):
        """Test creating strategy with negative percentage values."""
        strategy_data = {
            "name": "Negative Values",
            "strategy_type": "ORB",
            "sl_pct": -0.5,
        }

        response = client.post("/api/strategies", json=strategy_data)
        # API does not validate parameter ranges; negative values are accepted as-is
        assert response.status_code == 200
        assert response.json()["strategy"]["sl_pct"] == -0.5

    def test_create_strategy_with_zero_parameters(self, client: TestClient):
        """Test creating strategy with zero values."""
        strategy_data = {
            "name": "Zero Values",
            "strategy_type": "ORB",
            "max_positions": 0,
        }

        response = client.post("/api/strategies", json=strategy_data)
        # API does not validate parameter ranges; zero values are accepted as-is
        assert response.status_code == 200
        assert response.json()["strategy"]["max_positions"] == 0

    def test_update_strategy_with_empty_body(
        self, client: TestClient, sample_strategy: StrategyConfig
    ):
        """Test updating strategy with empty body (no changes)."""
        response = client.put(f"/api/strategies/{sample_strategy.id}", json={})
        assert response.status_code == 200
        data = response.json()
        assert data["strategy"]["name"] == sample_strategy.name
        assert data["strategy"]["sl_pct"] == sample_strategy.sl_pct
        assert data["strategy"]["tp_pct"] == sample_strategy.tp_pct

    def test_get_strategy_by_id_as_string(self, client: TestClient, sample_strategy: StrategyConfig):
        """Test getting strategy with string ID (FastAPI coercion)."""
        response = client.get(f"/api/strategies/{str(sample_strategy.id)}")
        assert response.status_code == 200
        data = response.json()
        assert "strategy" in data
        assert data["strategy"]["id"] == sample_strategy.uuid
        assert data["strategy"]["name"] == sample_strategy.name

    def test_concurrent_strategy_creation(self, client: TestClient):
        """Test creating strategies with similar names (race condition)."""
        name = f"Concurrent Test {datetime.now().timestamp()}"

        # Create first
        response1 = client.post("/api/strategies", json={
            "name": name,
            "strategy_type": "ORB"
        })
        assert response1.status_code == 200

        # Try to create duplicate
        response2 = client.post("/api/strategies", json={
            "name": name,
            "strategy_type": "ORB"
        })
        assert response2.status_code == 400

    def test_delete_already_deleted_strategy(
        self, client: TestClient, db: Session
    ):
        """Test deleting a strategy that's already inactive."""
        strategy = StrategyConfig(
            name="Already Inactive",
            strategy_type="ORB",
            is_template=False,
            is_active=False,  # Already inactive
        )
        db.add(strategy)
        db.commit()

        # Should still return success
        response = client.delete(f"/api/strategies/{strategy.id}")
        assert response.status_code == 200

    def test_performance_with_large_pnl_values(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ):
        """Test performance calculation with large P&L values."""
        strategy = StrategyConfig(
            name="High PnL Strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()

        # Mock trades with large values
        large_trades = [
            {
                "symbol": "BIG",
                "pnl": 1000000.0,
                "net_pnl": 999000.0,
                "strategy_id": strategy.id,
                "is_test": False,
            },
            {
                "symbol": "LOSS",
                "pnl": -500000.0,
                "net_pnl": -501000.0,
                "strategy_id": strategy.id,
                "is_test": False,
            },
        ]

        def mock_load(user_id):
            return large_trades

        monkeypatch.setattr("api.strategies._load_all_trades", mock_load)

        response = client.get(f"/api/strategies/{strategy.id}/performance")
        assert response.status_code == 200

        data = response.json()
        assert data["total_trades"] == 2
        assert data["net_pnl"] == 498000.0  # 999000 - 501000
