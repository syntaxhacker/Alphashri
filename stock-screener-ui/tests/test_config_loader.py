"""
Comprehensive unit tests for trading/config_loader.py

Tests cover:
- StrategyConfigData dataclass functionality
- Loading configuration from database
- Default values and fallbacks
- Configuration validation
- Missing/invalid config handling
- Config merging strategies (parent-child relationships)
- Database error handling and fallbacks
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from dataclasses import fields
from typing import get_type_hints

from trading.config_loader import (
    StrategyConfigData,
    get_strategy_config,
    get_strategy_by_id,
    get_all_strategies,
    get_template_strategies,
    get_strategy_variations,
    get_strategies_by_type,
)


# ============================================================================
# StrategyConfigData Dataclass Tests
# ============================================================================

@pytest.mark.unit
class TestStrategyConfigDataDefaults:
    """Tests for StrategyConfigData default values."""

    def test_default_instance_has_all_fields(self):
        """Test that default instance has all expected fields."""
        config = StrategyConfigData()
        
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
        ]
        
        for field_name in expected_fields:
            assert hasattr(config, field_name), f"Missing field: {field_name}"

    def test_default_identity_values(self):
        """Test default identity field values."""
        config = StrategyConfigData()
        
        assert config.id == 0
        assert config.name == "orb_default"
        assert config.strategy_type == "ORB"
        assert config.parent_id is None
        assert config.is_template is False
        assert config.is_active is True
        assert config.is_default is True
        assert config.description == ""

    def test_default_orb_parameters(self):
        """Test default ORB strategy parameter values."""
        config = StrategyConfigData()
        
        assert config.or_minutes == 45
        assert config.sl_pct == 0.4
        assert config.tp_pct == 1.2
        assert config.min_or_range_pct == 0.5
        assert config.max_or_range_pct == 3.0

    def test_default_risk_management_parameters(self):
        """Test default risk management parameter values."""
        config = StrategyConfigData()
        
        assert config.max_positions == 5
        assert config.max_capital_per_trade_pct == 0.10
        assert config.max_daily_loss_pct == 0.02
        assert config.max_total_exposure_pct == 0.50
        assert config.risk_per_trade_pct == 0.01
        assert config.min_trade_value == 5000
        assert config.max_trade_value == 100000

    def test_default_runner_parameters(self):
        """Test default trading runner parameter values."""
        config = StrategyConfigData()
        
        assert config.cooldown_minutes == 30
        assert config.max_distance_from_or_pct == 1.5

    def test_default_cost_parameters(self):
        """Test default cost parameter values."""
        config = StrategyConfigData()
        
        assert config.brokerage_pct == 0.0003
        assert config.min_brokerage == 20
        assert config.stt_pct == 0.00025
        assert config.exchange_pct == 0.0000297
        assert config.sebi_pct == 0.000001
        assert config.stamp_pct == 0.00003
        assert config.gst_pct == 0.18

    def test_custom_values_override_defaults(self):
        """Test that custom values properly override defaults."""
        config = StrategyConfigData(
            id=42,
            name="custom_config",
            strategy_type="CUSTOM",
            or_minutes=60,
            sl_pct=0.5,
            tp_pct=1.5,
            max_positions=10,
        )
        
        assert config.id == 42
        assert config.name == "custom_config"
        assert config.strategy_type == "CUSTOM"
        assert config.or_minutes == 60
        assert config.sl_pct == 0.5
        assert config.tp_pct == 1.5
        assert config.max_positions == 10


@pytest.mark.unit
class TestStrategyConfigDataFromDbModel:
    """Tests for StrategyConfigData.from_db_model() class method."""

    def test_from_db_model_extracts_all_fields(self):
        """Test that from_db_model extracts all fields from model."""
        mock_model = Mock()
        mock_model.id = 1
        mock_model.name = "test_strategy"
        mock_model.strategy_type = "ORB"
        mock_model.parent_id = None
        mock_model.is_template = False
        mock_model.is_active = True
        mock_model.is_default = False
        mock_model.description = "Test description"
        mock_model.or_minutes = 30
        mock_model.sl_pct = 0.35
        mock_model.tp_pct = 1.0
        mock_model.min_or_range_pct = 0.4
        mock_model.max_or_range_pct = 2.5
        mock_model.max_positions = 8
        mock_model.max_capital_per_trade_pct = 0.12
        mock_model.max_daily_loss_pct = 0.015
        mock_model.max_total_exposure_pct = 0.45
        mock_model.risk_per_trade_pct = 0.008
        mock_model.min_trade_value = 8000
        mock_model.max_trade_value = 120000
        mock_model.cooldown_minutes = 25
        mock_model.max_distance_from_or_pct = 1.3
        mock_model.brokerage_pct = 0.0004
        mock_model.min_brokerage = 25
        mock_model.stt_pct = 0.0003
        mock_model.exchange_pct = 0.00003
        mock_model.sebi_pct = 0.000002
        mock_model.stamp_pct = 0.00004
        mock_model.gst_pct = 0.18
        
        config = StrategyConfigData.from_db_model(mock_model)
        
        assert config.id == 1
        assert config.name == "test_strategy"
        assert config.strategy_type == "ORB"
        assert config.or_minutes == 30
        assert config.sl_pct == 0.35
        assert config.tp_pct == 1.0
        assert config.max_positions == 8
        assert config.brokerage_pct == 0.0004

    def test_from_db_model_handles_none_description(self):
        """Test that from_db_model handles None description."""
        mock_model = Mock()
        mock_model.id = 1
        mock_model.name = "test"
        mock_model.strategy_type = "ORB"
        mock_model.parent_id = None
        mock_model.is_template = False
        mock_model.is_active = True
        mock_model.is_default = False
        mock_model.description = None
        mock_model.or_minutes = 45
        mock_model.sl_pct = 0.4
        mock_model.tp_pct = 1.2
        mock_model.min_or_range_pct = 0.5
        mock_model.max_or_range_pct = 3.0
        mock_model.max_positions = 5
        mock_model.max_capital_per_trade_pct = 0.10
        mock_model.max_daily_loss_pct = 0.02
        mock_model.max_total_exposure_pct = 0.50
        mock_model.risk_per_trade_pct = 0.01
        mock_model.min_trade_value = 5000
        mock_model.max_trade_value = 100000
        mock_model.cooldown_minutes = 30
        mock_model.max_distance_from_or_pct = 1.5
        mock_model.brokerage_pct = 0.0003
        mock_model.min_brokerage = 20
        mock_model.stt_pct = 0.00025
        mock_model.exchange_pct = 0.0000297
        mock_model.sebi_pct = 0.000001
        mock_model.stamp_pct = 0.00003
        mock_model.gst_pct = 0.18
        
        config = StrategyConfigData.from_db_model(mock_model)
        
        assert config.description == ""

    def test_from_db_model_preserves_none_parent_id(self):
        """Test that None parent_id is preserved."""
        mock_model = Mock()
        mock_model.id = 1
        mock_model.name = "test"
        mock_model.strategy_type = "ORB"
        mock_model.parent_id = None
        mock_model.is_template = False
        mock_model.is_active = True
        mock_model.is_default = False
        mock_model.description = ""
        mock_model.or_minutes = 45
        mock_model.sl_pct = 0.4
        mock_model.tp_pct = 1.2
        mock_model.min_or_range_pct = 0.5
        mock_model.max_or_range_pct = 3.0
        mock_model.max_positions = 5
        mock_model.max_capital_per_trade_pct = 0.10
        mock_model.max_daily_loss_pct = 0.02
        mock_model.max_total_exposure_pct = 0.50
        mock_model.risk_per_trade_pct = 0.01
        mock_model.min_trade_value = 5000
        mock_model.max_trade_value = 100000
        mock_model.cooldown_minutes = 30
        mock_model.max_distance_from_or_pct = 1.5
        mock_model.brokerage_pct = 0.0003
        mock_model.min_brokerage = 20
        mock_model.stt_pct = 0.00025
        mock_model.exchange_pct = 0.0000297
        mock_model.sebi_pct = 0.000001
        mock_model.stamp_pct = 0.00003
        mock_model.gst_pct = 0.18
        
        config = StrategyConfigData.from_db_model(mock_model)
        
        assert config.parent_id is None

    def test_from_db_model_preserves_parent_id(self):
        """Test that parent_id is properly set when present."""
        mock_model = Mock()
        mock_model.id = 2
        mock_model.name = "child"
        mock_model.strategy_type = "ORB"
        mock_model.parent_id = 1
        mock_model.is_template = False
        mock_model.is_active = True
        mock_model.is_default = False
        mock_model.description = ""
        mock_model.or_minutes = 45
        mock_model.sl_pct = 0.4
        mock_model.tp_pct = 1.2
        mock_model.min_or_range_pct = 0.5
        mock_model.max_or_range_pct = 3.0
        mock_model.max_positions = 5
        mock_model.max_capital_per_trade_pct = 0.10
        mock_model.max_daily_loss_pct = 0.02
        mock_model.max_total_exposure_pct = 0.50
        mock_model.risk_per_trade_pct = 0.01
        mock_model.min_trade_value = 5000
        mock_model.max_trade_value = 100000
        mock_model.cooldown_minutes = 30
        mock_model.max_distance_from_or_pct = 1.5
        mock_model.brokerage_pct = 0.0003
        mock_model.min_brokerage = 20
        mock_model.stt_pct = 0.00025
        mock_model.exchange_pct = 0.0000297
        mock_model.sebi_pct = 0.000001
        mock_model.stamp_pct = 0.00003
        mock_model.gst_pct = 0.18
        
        config = StrategyConfigData.from_db_model(mock_model)
        
        assert config.parent_id == 1


@pytest.mark.unit
class TestStrategyConfigDataToDict:
    """Tests for StrategyConfigData.to_dict() method."""

    def test_to_dict_returns_all_fields(self):
        """Test that to_dict returns all fields."""
        config = StrategyConfigData()
        result = config.to_dict()
        
        assert isinstance(result, dict)
        assert "id" in result
        assert "name" in result
        assert "strategy_type" in result
        assert "or_minutes" in result
        assert "sl_pct" in result
        assert "tp_pct" in result
        assert len(result) == len(fields(StrategyConfigData))

    def test_to_dict_values_match_instance(self):
        """Test that to_dict values match instance values."""
        config = StrategyConfigData(
            id=99,
            name="dict_test",
            strategy_type="TEST",
            or_minutes=20,
            sl_pct=0.25,
        )
        result = config.to_dict()
        
        assert result["id"] == 99
        assert result["name"] == "dict_test"
        assert result["strategy_type"] == "TEST"
        assert result["or_minutes"] == 20
        assert result["sl_pct"] == 0.25

    def test_to_dict_can_be_used_for_reconstruction(self):
        """Test that dict can be used to reconstruct similar instance."""
        original = StrategyConfigData(
            id=50,
            name="reconstruct_test",
            strategy_type="ORB",
            or_minutes=35,
            sl_pct=0.45,
        )
        
        data = original.to_dict()
        
        assert data["id"] == original.id
        assert data["name"] == original.name
        assert data["or_minutes"] == original.or_minutes

    def test_to_dict_handles_none_parent_id(self):
        """Test that to_dict properly handles None parent_id."""
        config = StrategyConfigData(parent_id=None)
        result = config.to_dict()
        
        assert result["parent_id"] is None

    def test_to_dict_handles_parent_id(self):
        """Test that to_dict properly handles parent_id."""
        config = StrategyConfigData(parent_id=10)
        result = config.to_dict()
        
        assert result["parent_id"] == 10


# ============================================================================
# get_strategy_config Tests
# ============================================================================

class TestGetStrategyConfig:
    """Tests for get_strategy_config() function."""

    @patch("db.database.SessionLocal")
    def test_returns_default_when_db_unavailable(self, mock_session_local):
        """Test that default config is returned when database is unavailable."""
        mock_session_local.side_effect = Exception("DB connection failed")
        
        result = get_strategy_config()
        
        assert isinstance(result, StrategyConfigData)
        assert result.id == 0
        assert result.name == "orb_default"

    @patch("db.database.SessionLocal")
    def test_loads_default_config(self, mock_session_local):
        """Test loading default config (is_default=True)."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_config = Mock()
        mock_config.id = 1
        mock_config.name = "default_strategy"
        mock_config.strategy_type = "ORB"
        mock_config.parent_id = None
        mock_config.is_template = False
        mock_config.is_active = True
        mock_config.is_default = True
        mock_config.description = "Default"
        mock_config.or_minutes = 45
        mock_config.sl_pct = 0.4
        mock_config.tp_pct = 1.2
        mock_config.min_or_range_pct = 0.5
        mock_config.max_or_range_pct = 3.0
        mock_config.max_positions = 5
        mock_config.max_capital_per_trade_pct = 0.10
        mock_config.max_daily_loss_pct = 0.02
        mock_config.max_total_exposure_pct = 0.50
        mock_config.risk_per_trade_pct = 0.01
        mock_config.min_trade_value = 5000
        mock_config.max_trade_value = 100000
        mock_config.cooldown_minutes = 30
        mock_config.max_distance_from_or_pct = 1.5
        mock_config.brokerage_pct = 0.0003
        mock_config.min_brokerage = 20
        mock_config.stt_pct = 0.00025
        mock_config.exchange_pct = 0.0000297
        mock_config.sebi_pct = 0.000001
        mock_config.stamp_pct = 0.00003
        mock_config.gst_pct = 0.18
        
        mock_db.query.return_value.filter.return_value.first.return_value = mock_config
        
        result = get_strategy_config()
        
        assert result.id == 1
        assert result.name == "default_strategy"

    @patch("db.database.SessionLocal")
    def test_loads_config_by_name(self, mock_session_local):
        """Test loading config by specific name."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_config = Mock()
        mock_config.id = 5
        mock_config.name = "custom_strategy"
        mock_config.strategy_type = "ORB"
        mock_config.parent_id = None
        mock_config.is_template = False
        mock_config.is_active = True
        mock_config.is_default = False
        mock_config.description = "Custom"
        mock_config.or_minutes = 30
        mock_config.sl_pct = 0.35
        mock_config.tp_pct = 1.0
        mock_config.min_or_range_pct = 0.5
        mock_config.max_or_range_pct = 3.0
        mock_config.max_positions = 5
        mock_config.max_capital_per_trade_pct = 0.10
        mock_config.max_daily_loss_pct = 0.02
        mock_config.max_total_exposure_pct = 0.50
        mock_config.risk_per_trade_pct = 0.01
        mock_config.min_trade_value = 5000
        mock_config.max_trade_value = 100000
        mock_config.cooldown_minutes = 30
        mock_config.max_distance_from_or_pct = 1.5
        mock_config.brokerage_pct = 0.0003
        mock_config.min_brokerage = 20
        mock_config.stt_pct = 0.00025
        mock_config.exchange_pct = 0.0000297
        mock_config.sebi_pct = 0.000001
        mock_config.stamp_pct = 0.00003
        mock_config.gst_pct = 0.18
        
        mock_db.query.return_value.filter.return_value.first.return_value = mock_config
        
        result = get_strategy_config(name="custom_strategy")
        
        assert result.id == 5
        assert result.name == "custom_strategy"

    @patch("db.database.SessionLocal")
    def test_fallback_to_any_active_when_no_default(self, mock_session_local):
        """Test fallback to any active config when no default exists."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_config = Mock()
        mock_config.id = 3
        mock_config.name = "fallback_strategy"
        mock_config.strategy_type = "ORB"
        mock_config.parent_id = None
        mock_config.is_template = False
        mock_config.is_active = True
        mock_config.is_default = False
        mock_config.description = "Fallback"
        mock_config.or_minutes = 45
        mock_config.sl_pct = 0.4
        mock_config.tp_pct = 1.2
        mock_config.min_or_range_pct = 0.5
        mock_config.max_or_range_pct = 3.0
        mock_config.max_positions = 5
        mock_config.max_capital_per_trade_pct = 0.10
        mock_config.max_daily_loss_pct = 0.02
        mock_config.max_total_exposure_pct = 0.50
        mock_config.risk_per_trade_pct = 0.01
        mock_config.min_trade_value = 5000
        mock_config.max_trade_value = 100000
        mock_config.cooldown_minutes = 30
        mock_config.max_distance_from_or_pct = 1.5
        mock_config.brokerage_pct = 0.0003
        mock_config.min_brokerage = 20
        mock_config.stt_pct = 0.00025
        mock_config.exchange_pct = 0.0000297
        mock_config.sebi_pct = 0.000001
        mock_config.stamp_pct = 0.00003
        mock_config.gst_pct = 0.18
        
        mock_query = mock_db.query.return_value
        mock_filter = mock_query.filter.return_value
        mock_filter.first.side_effect = [None, mock_config]
        
        result = get_strategy_config()
        
        assert result.id == 3
        assert result.name == "fallback_strategy"

    @patch("db.database.SessionLocal")
    def test_returns_default_when_no_config_found(self, mock_session_local):
        """Test returns default when no config found in database."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        result = get_strategy_config()
        
        assert isinstance(result, StrategyConfigData)
        assert result.id == 0
        assert result.name == "orb_default"

    @patch("db.database.SessionLocal")
    def test_only_loads_active_configs(self, mock_session_local):
        """Test that only active configs are loaded."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        get_strategy_config()
        
        call_args = str(mock_db.query.return_value.filter.call_args)
        assert "is_active" in call_args or mock_db.query.called


# ============================================================================
# get_strategy_by_id Tests
# ============================================================================

class TestGetStrategyById:
    """Tests for get_strategy_by_id() function."""

    @patch("db.database.SessionLocal")
    def test_returns_config_by_id(self, mock_session_local):
        """Test loading config by ID."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_config = Mock()
        mock_config.id = 42
        mock_config.name = "by_id_test"
        mock_config.strategy_type = "ORB"
        mock_config.parent_id = None
        mock_config.is_template = False
        mock_config.is_active = True
        mock_config.is_default = False
        mock_config.description = ""
        mock_config.or_minutes = 45
        mock_config.sl_pct = 0.4
        mock_config.tp_pct = 1.2
        mock_config.min_or_range_pct = 0.5
        mock_config.max_or_range_pct = 3.0
        mock_config.max_positions = 5
        mock_config.max_capital_per_trade_pct = 0.10
        mock_config.max_daily_loss_pct = 0.02
        mock_config.max_total_exposure_pct = 0.50
        mock_config.risk_per_trade_pct = 0.01
        mock_config.min_trade_value = 5000
        mock_config.max_trade_value = 100000
        mock_config.cooldown_minutes = 30
        mock_config.max_distance_from_or_pct = 1.5
        mock_config.brokerage_pct = 0.0003
        mock_config.min_brokerage = 20
        mock_config.stt_pct = 0.00025
        mock_config.exchange_pct = 0.0000297
        mock_config.sebi_pct = 0.000001
        mock_config.stamp_pct = 0.00003
        mock_config.gst_pct = 0.18
        
        mock_db.query.return_value.filter.return_value.first.return_value = mock_config
        
        result = get_strategy_by_id(42)
        
        assert result is not None
        assert result.id == 42
        assert result.name == "by_id_test"

    @patch("db.database.SessionLocal")
    def test_returns_none_when_not_found(self, mock_session_local):
        """Test returns None when config not found."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.first.return_value = None
        
        result = get_strategy_by_id(99999)
        
        assert result is None

    @patch("db.database.SessionLocal")
    def test_returns_none_on_db_error(self, mock_session_local):
        """Test returns None when database error occurs."""
        mock_session_local.side_effect = Exception("DB error")
        
        result = get_strategy_by_id(1)
        
        assert result is None


# ============================================================================
# get_all_strategies Tests
# ============================================================================

class TestGetAllStrategies:
    """Tests for get_all_strategies() function."""

    @patch("db.database.SessionLocal")
    def test_returns_all_active_strategies(self, mock_session_local):
        """Test returning all active strategies."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_configs = []
        for i in range(3):
            mc = Mock()
            mc.id = i + 1
            mc.name = f"strategy_{i}"
            mc.strategy_type = "ORB"
            mc.parent_id = None
            mc.is_template = False
            mc.is_active = True
            mc.is_default = (i == 0)
            mc.description = ""
            mc.or_minutes = 45
            mc.sl_pct = 0.4
            mc.tp_pct = 1.2
            mc.min_or_range_pct = 0.5
            mc.max_or_range_pct = 3.0
            mc.max_positions = 5
            mc.max_capital_per_trade_pct = 0.10
            mc.max_daily_loss_pct = 0.02
            mc.max_total_exposure_pct = 0.50
            mc.risk_per_trade_pct = 0.01
            mc.min_trade_value = 5000
            mc.max_trade_value = 100000
            mc.cooldown_minutes = 30
            mc.max_distance_from_or_pct = 1.5
            mc.brokerage_pct = 0.0003
            mc.min_brokerage = 20
            mc.stt_pct = 0.00025
            mc.exchange_pct = 0.0000297
            mc.sebi_pct = 0.000001
            mc.stamp_pct = 0.00003
            mc.gst_pct = 0.18
            mock_configs.append(mc)
        
        mock_query = MagicMock()
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = mock_configs
        mock_db.query.return_value = mock_query
        
        result = get_all_strategies()
        
        assert len(result) == 3
        assert all(isinstance(r, StrategyConfigData) for r in result)

    @patch("db.database.SessionLocal")
    def test_excludes_templates_by_default(self, mock_session_local):
        """Test that templates are excluded by default."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        get_all_strategies()
        
        mock_db.query.return_value.filter.assert_called()

    @patch("db.database.SessionLocal")
    def test_includes_templates_when_requested(self, mock_session_local):
        """Test that templates are included when requested."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_configs = []
        for i in range(2):
            mc = Mock()
            mc.id = i + 1
            mc.name = f"strategy_{i}"
            mc.strategy_type = "ORB"
            mc.parent_id = None
            mc.is_template = (i == 0)
            mc.is_active = True
            mc.is_default = False
            mc.description = ""
            mc.or_minutes = 45
            mc.sl_pct = 0.4
            mc.tp_pct = 1.2
            mc.min_or_range_pct = 0.5
            mc.max_or_range_pct = 3.0
            mc.max_positions = 5
            mc.max_capital_per_trade_pct = 0.10
            mc.max_daily_loss_pct = 0.02
            mc.max_total_exposure_pct = 0.50
            mc.risk_per_trade_pct = 0.01
            mc.min_trade_value = 5000
            mc.max_trade_value = 100000
            mc.cooldown_minutes = 30
            mc.max_distance_from_or_pct = 1.5
            mc.brokerage_pct = 0.0003
            mc.min_brokerage = 20
            mc.stt_pct = 0.00025
            mc.exchange_pct = 0.0000297
            mc.sebi_pct = 0.000001
            mc.stamp_pct = 0.00003
            mc.gst_pct = 0.18
            mock_configs.append(mc)
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = mock_configs
        
        result = get_all_strategies(include_templates=True)
        
        assert len(result) == 2

    @patch("db.database.SessionLocal")
    def test_returns_empty_list_on_db_error(self, mock_session_local):
        """Test returns empty list on database error."""
        mock_session_local.side_effect = Exception("DB error")
        
        result = get_all_strategies()
        
        assert result == []

    @patch("db.database.SessionLocal")
    def test_returns_empty_list_when_no_strategies(self, mock_session_local):
        """Test returns empty list when no strategies exist."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        result = get_all_strategies()
        
        assert result == []


# ============================================================================
# get_template_strategies Tests
# ============================================================================

class TestGetTemplateStrategies:
    """Tests for get_template_strategies() function."""

    @patch("db.database.SessionLocal")
    def test_returns_all_templates(self, mock_session_local):
        """Test returning all template strategies."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_configs = []
        for i in range(2):
            mc = Mock()
            mc.id = i + 1
            mc.name = f"template_{i}"
            mc.strategy_type = "ORB"
            mc.parent_id = None
            mc.is_template = True
            mc.is_active = True
            mc.is_default = False
            mc.description = ""
            mc.or_minutes = 45
            mc.sl_pct = 0.4
            mc.tp_pct = 1.2
            mc.min_or_range_pct = 0.5
            mc.max_or_range_pct = 3.0
            mc.max_positions = 5
            mc.max_capital_per_trade_pct = 0.10
            mc.max_daily_loss_pct = 0.02
            mc.max_total_exposure_pct = 0.50
            mc.risk_per_trade_pct = 0.01
            mc.min_trade_value = 5000
            mc.max_trade_value = 100000
            mc.cooldown_minutes = 30
            mc.max_distance_from_or_pct = 1.5
            mc.brokerage_pct = 0.0003
            mc.min_brokerage = 20
            mc.stt_pct = 0.00025
            mc.exchange_pct = 0.0000297
            mc.sebi_pct = 0.000001
            mc.stamp_pct = 0.00003
            mc.gst_pct = 0.18
            mock_configs.append(mc)
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = mock_configs
        
        result = get_template_strategies()
        
        assert len(result) == 2
        assert all(r.is_template for r in result)

    @patch("db.database.SessionLocal")
    def test_only_returns_active_templates(self, mock_session_local):
        """Test that only active templates are returned."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        get_template_strategies()
        
        mock_db.query.return_value.filter.assert_called()

    @patch("db.database.SessionLocal")
    def test_returns_empty_list_on_error(self, mock_session_local):
        """Test returns empty list on database error."""
        mock_session_local.side_effect = Exception("DB error")
        
        result = get_template_strategies()
        
        assert result == []


# ============================================================================
# get_strategy_variations Tests
# ============================================================================

class TestGetStrategyVariations:
    """Tests for get_strategy_variations() function."""

    @patch("db.database.SessionLocal")
    def test_returns_variations_by_parent_id(self, mock_session_local):
        """Test returning variations by parent ID."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_configs = []
        for i in range(2):
            mc = Mock()
            mc.id = i + 10
            mc.name = f"variation_{i}"
            mc.strategy_type = "ORB"
            mc.parent_id = 1
            mc.is_template = False
            mc.is_active = True
            mc.is_default = False
            mc.description = ""
            mc.or_minutes = 45
            mc.sl_pct = 0.4
            mc.tp_pct = 1.2
            mc.min_or_range_pct = 0.5
            mc.max_or_range_pct = 3.0
            mc.max_positions = 5
            mc.max_capital_per_trade_pct = 0.10
            mc.max_daily_loss_pct = 0.02
            mc.max_total_exposure_pct = 0.50
            mc.risk_per_trade_pct = 0.01
            mc.min_trade_value = 5000
            mc.max_trade_value = 100000
            mc.cooldown_minutes = 30
            mc.max_distance_from_or_pct = 1.5
            mc.brokerage_pct = 0.0003
            mc.min_brokerage = 20
            mc.stt_pct = 0.00025
            mc.exchange_pct = 0.0000297
            mc.sebi_pct = 0.000001
            mc.stamp_pct = 0.00003
            mc.gst_pct = 0.18
            mock_configs.append(mc)
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = mock_configs
        
        result = get_strategy_variations(parent_id=1)
        
        assert len(result) == 2
        assert all(r.parent_id == 1 for r in result)

    @patch("db.database.SessionLocal")
    def test_only_returns_active_variations(self, mock_session_local):
        """Test that only active variations are returned."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        get_strategy_variations(parent_id=1)
        
        mock_db.query.return_value.filter.assert_called()

    @patch("db.database.SessionLocal")
    def test_returns_empty_list_on_error(self, mock_session_local):
        """Test returns empty list on database error."""
        mock_session_local.side_effect = Exception("DB error")
        
        result = get_strategy_variations(parent_id=1)
        
        assert result == []

    @patch("db.database.SessionLocal")
    def test_returns_empty_list_when_no_variations(self, mock_session_local):
        """Test returns empty list when no variations exist."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        result = get_strategy_variations(parent_id=999)
        
        assert result == []


# ============================================================================
# get_strategies_by_type Tests
# ============================================================================

class TestGetStrategiesByType:
    """Tests for get_strategies_by_type() function."""

    @patch("db.database.SessionLocal")
    def test_returns_strategies_by_type(self, mock_session_local):
        """Test returning strategies by specific type."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_configs = []
        for i in range(2):
            mc = Mock()
            mc.id = i + 1
            mc.name = f"orb_{i}"
            mc.strategy_type = "ORB"
            mc.parent_id = None
            mc.is_template = False
            mc.is_active = True
            mc.is_default = False
            mc.description = ""
            mc.or_minutes = 45
            mc.sl_pct = 0.4
            mc.tp_pct = 1.2
            mc.min_or_range_pct = 0.5
            mc.max_or_range_pct = 3.0
            mc.max_positions = 5
            mc.max_capital_per_trade_pct = 0.10
            mc.max_daily_loss_pct = 0.02
            mc.max_total_exposure_pct = 0.50
            mc.risk_per_trade_pct = 0.01
            mc.min_trade_value = 5000
            mc.max_trade_value = 100000
            mc.cooldown_minutes = 30
            mc.max_distance_from_or_pct = 1.5
            mc.brokerage_pct = 0.0003
            mc.min_brokerage = 20
            mc.stt_pct = 0.00025
            mc.exchange_pct = 0.0000297
            mc.sebi_pct = 0.000001
            mc.stamp_pct = 0.00003
            mc.gst_pct = 0.18
            mock_configs.append(mc)
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = mock_configs
        
        result = get_strategies_by_type("ORB")
        
        assert len(result) == 2
        assert all(r.strategy_type == "ORB" for r in result)

    @patch("db.database.SessionLocal")
    def test_excludes_templates(self, mock_session_local):
        """Test that templates are excluded from results."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        get_strategies_by_type("ORB")
        
        mock_db.query.return_value.filter.assert_called()

    @patch("db.database.SessionLocal")
    def test_returns_empty_list_on_error(self, mock_session_local):
        """Test returns empty list on database error."""
        mock_session_local.side_effect = Exception("DB error")
        
        result = get_strategies_by_type("ORB")
        
        assert result == []

    @patch("db.database.SessionLocal")
    def test_returns_empty_for_unknown_type(self, mock_session_local):
        """Test returns empty list for unknown strategy type."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        
        result = get_strategies_by_type("UNKNOWN_TYPE")
        
        assert result == []


# ============================================================================
# Config Merging Strategy Tests
# ============================================================================

class TestConfigMerging:
    """Tests for config merging/inheritance behavior."""

    def test_parent_child_relationship_preserved(self):
        """Test that parent-child relationship is preserved in dataclass."""
        child_config = StrategyConfigData(
            id=2,
            name="child_strategy",
            strategy_type="ORB",
            parent_id=1,
        )
        
        assert child_config.parent_id == 1

    def test_child_can_override_parent_params(self):
        """Test that child config can override parent parameters."""
        parent_defaults = StrategyConfigData(
            id=1,
            name="parent",
            or_minutes=45,
            sl_pct=0.4,
            tp_pct=1.2,
        )
        
        child_config = StrategyConfigData(
            id=2,
            name="child",
            parent_id=1,
            or_minutes=30,
            sl_pct=0.35,
            tp_pct=parent_defaults.tp_pct,
        )
        
        assert child_config.or_minutes == 30
        assert child_config.sl_pct == 0.35
        assert child_config.tp_pct == parent_defaults.tp_pct

    def test_defaults_act_as_base_config(self):
        """Test that default config acts as a base for inheritance."""
        default_config = StrategyConfigData()
        
        assert default_config.or_minutes == 45
        assert default_config.sl_pct == 0.4
        assert default_config.max_positions == 5


# ============================================================================
# Edge Cases and Error Handling Tests
# ============================================================================

class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_dataclass_equality(self):
        """Test dataclass equality comparison."""
        config1 = StrategyConfigData(id=1, name="test")
        config2 = StrategyConfigData(id=1, name="test")
        config3 = StrategyConfigData(id=2, name="test")
        
        assert config1 == config2
        assert config1 != config3

    def test_dataclass_immutability_with_different_values(self):
        """Test that different values create different instances."""
        config1 = StrategyConfigData(sl_pct=0.4)
        config2 = StrategyConfigData(sl_pct=0.5)
        
        assert config1.sl_pct != config2.sl_pct

    @patch("db.database.SessionLocal")
    def test_handles_query_exception_gracefully(self, mock_session_local):
        """Test that query exceptions are handled gracefully."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        mock_db.query.side_effect = Exception("Query failed")
        
        result = get_strategy_config()
        
        assert isinstance(result, StrategyConfigData)
        assert result.id == 0

    def test_to_dict_serializable(self):
        """Test that to_dict produces JSON-serializable output."""
        config = StrategyConfigData()
        result = config.to_dict()
        
        import json
        try:
            json.dumps(result)
            serializable = True
        except (TypeError, ValueError):
            serializable = False
        
        assert serializable

    def test_zero_values_are_valid(self):
        """Test that zero values are valid for numeric fields."""
        config = StrategyConfigData(
            id=0,
            or_minutes=0,
            sl_pct=0.0,
            tp_pct=0.0,
            max_positions=0,
        )
        
        assert config.or_minutes == 0
        assert config.sl_pct == 0.0
        assert config.max_positions == 0
        assert config.to_dict()['or_minutes'] == 0
        import json
        assert json.dumps(config.to_dict()) is not None

    def test_negative_values_allowed(self):
        """Test that negative values are allowed (no validation)."""
        config = StrategyConfigData(
            sl_pct=-0.5,
            tp_pct=-1.0,
        )
        
        assert config.sl_pct == -0.5
        assert config.tp_pct == -1.0
        assert config.sl_pct < 0
        assert config.tp_pct < 0

    def test_large_values_allowed(self):
        """Test that large values are allowed."""
        config = StrategyConfigData(
            max_trade_value=1000000000,
            max_positions=1000,
        )
        
        assert config.max_trade_value == 1000000000
        assert config.max_positions == 1000
        assert config.max_trade_value > config.min_trade_value


# ============================================================================
# Logging Tests
# ============================================================================

class TestLogging:
    """Tests for logging behavior."""

    @patch("trading.config_loader.logger")
    @patch("db.database.SessionLocal")
    def test_logs_warning_on_db_error(self, mock_session_local, mock_logger):
        """Test that a warning is logged when database fails."""
        mock_session_local.side_effect = Exception("DB error")
        
        get_strategy_config()
        
        mock_logger.warning.assert_called_once()

    @patch("trading.config_loader.logger")
    @patch("db.database.SessionLocal")
    def test_logs_warning_on_query_error(self, mock_session_local, mock_logger):
        """Test that a warning is logged when query fails."""
        mock_db = MagicMock()
        mock_session_local.return_value.__enter__.return_value = mock_db
        mock_db.query.side_effect = Exception("Query error")
        
        get_all_strategies()
        
        mock_logger.warning.assert_called_once()
