"""
Config Endpoint Tests.

Tests for api/paper/endpoints.py — get_strategy_config_endpoint,
update_strategy_config_endpoint, reset_strategy_config_endpoint.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from unittest.mock import patch, MagicMock, PropertyMock
import pytest


def _make_config_data(**overrides):
    """Build a StrategyConfigData with optional field overrides."""
    from trading.config_loader import StrategyConfigData
    defaults = dict(
        id=1,
        name="orb_default",
        strategy_type="ORB",
        or_minutes=45,
        sl_pct=0.4,
        tp_pct=1.2,
        min_or_range_pct=0.5,
        max_or_range_pct=3.0,
        max_positions=5,
        max_capital_per_trade_pct=0.10,
        max_daily_loss_pct=0.02,
        max_total_exposure_pct=0.50,
        risk_per_trade_pct=0.01,
        min_trade_value=5000,
        max_trade_value=100000,
        cooldown_minutes=30,
        max_distance_from_or_pct=1.5,
        brokerage_pct=0.0003,
        min_brokerage=20,
        stt_pct=0.00025,
        exchange_pct=0.0000297,
        sebi_pct=0.000001,
        stamp_pct=0.00003,
        gst_pct=0.18,
    )
    defaults.update(overrides)
    return StrategyConfigData(**defaults)


def _make_mock_config_row(**overrides):
    """Build a MagicMock that behaves like a StrategyConfig DB row."""
    defaults = dict(
        id=1, name="orb_default", strategy_type="ORB", is_default=True,
        is_template=False, is_active=True, parent_id=None, description="",
        or_minutes=45, sl_pct=0.4, tp_pct=1.2,
        min_or_range_pct=0.5, max_or_range_pct=3.0,
        max_positions=5, max_capital_per_trade_pct=0.10,
        max_daily_loss_pct=0.02, max_total_exposure_pct=0.50,
        risk_per_trade_pct=0.01, min_trade_value=5000, max_trade_value=100000,
        cooldown_minutes=30, max_distance_from_or_pct=1.5,
        brokerage_pct=0.0003, min_brokerage=20, stt_pct=0.00025,
        exchange_pct=0.0000297, sebi_pct=0.000001, stamp_pct=0.00003, gst_pct=0.18,
        entry_threshold_pct=3.0, enable_trailing_stop=False, trailing_stop_pct=3.0,
        trailing_activation_pct=2.0, max_holding_days=30, cooldown_days=30,
        enable_filters=False, pivot_type="classic", breakout_buffer_pct=0.3,
        enable_shorts=False, eod_exit_hour=14, eod_exit_minute=45, min_rr_ratio=2.0,
        screener_profiles="[]", ema_fast_period=9, ema_slow_period=21,
    )
    defaults.update(overrides)

    row = MagicMock()
    for k, v in defaults.items():
        setattr(row, k, v)
    row.to_dict.return_value = {k: v for k, v in defaults.items()
                                 if k not in ("screener_profiles",)}
    return row


def _mock_session_with_row(mock_row):
    """Build a mock SessionLocal context manager that returns mock_row from query."""
    mock_session = MagicMock()
    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = mock_row
    mock_session.query.return_value = mock_query

    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_session)
    mock_ctx.__exit__ = MagicMock(return_value=False)

    def session_factory():
        return mock_ctx

    return session_factory, mock_session


@pytest.mark.unit
class TestGetStrategyConfig:
    """GET /api/paper/config — fetch config by name or strategy_id."""

    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_by_name_returns_config(self, mock_get, client):
        cfg = _make_config_data(name="orb_default", id=1)
        mock_get.return_value = cfg

        resp = client.get("/api/paper/config", params={"name": "orb_default"})

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        assert body["config"]["name"] == "orb_default"
        assert body["config"]["sl_pct"] == 0.4

    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_by_name_no_arg_returns_default(self, mock_get, client):
        cfg = _make_config_data(name="orb_default")
        mock_get.return_value = cfg

        resp = client.get("/api/paper/config")

        assert resp.status_code == 200
        body = resp.json()
        assert body["config"]["name"] == "orb_default"

    @patch("trading.config_loader.get_strategy_by_id")
    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_by_strategy_id(self, mock_get, mock_by_id, client):
        cfg = _make_config_data(id=42, name="my_strategy", sl_pct=0.6)
        mock_by_id.return_value = cfg

        resp = client.get("/api/paper/config", params={"strategy_id": 42})

        assert resp.status_code == 200
        body = resp.json()
        assert body["config"]["id"] == 42
        assert body["config"]["name"] == "my_strategy"
        assert body["config"]["sl_pct"] == 0.6

    @patch("trading.config_loader.get_strategy_by_id")
    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_by_strategy_id_not_found_404(self, mock_get, mock_by_id, client):
        mock_by_id.return_value = None

        resp = client.get("/api/paper/config", params={"strategy_id": 999})

        assert resp.status_code == 404
        assert "999" in resp.json()["detail"]

    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_by_name_not_found_returns_defaults(self, mock_get, client):
        cfg = _make_config_data(name="orb_default")
        mock_get.return_value = cfg

        resp = client.get("/api/paper/config", params={"name": "nonexistent"})

        assert resp.status_code == 200
        assert resp.json()["config"]["name"] == "orb_default"

    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_exception_returns_500(self, mock_get, client):
        mock_get.side_effect = RuntimeError("DB connection failed")

        resp = client.get("/api/paper/config")

        assert resp.status_code == 500
        assert "Failed to load config" in resp.json()["detail"]

    @patch("trading.config_loader.get_strategy_config")
    def test_get_config_returns_all_fields(self, mock_get, client):
        cfg = _make_config_data()
        mock_get.return_value = cfg

        resp = client.get("/api/paper/config")

        body = resp.json()["config"]
        expected_keys = {
            "id", "name", "strategy_type", "or_minutes", "sl_pct", "tp_pct",
            "min_or_range_pct", "max_or_range_pct", "max_positions",
            "max_capital_per_trade_pct", "max_daily_loss_pct",
            "max_total_exposure_pct", "risk_per_trade_pct", "min_trade_value",
            "max_trade_value", "cooldown_minutes", "max_distance_from_or_pct",
            "brokerage_pct", "min_brokerage", "stt_pct", "exchange_pct",
            "sebi_pct", "stamp_pct", "gst_pct",
        }
        assert expected_keys.issubset(body.keys())


@pytest.mark.unit
class TestUpdateStrategyConfig:
    """PUT /api/paper/config — update or create strategy config (requires auth)."""

    def test_update_existing_config_success(self, auth_client):
        mock_row = _make_mock_config_row(
            or_minutes=45, sl_pct=0.4, tp_pct=1.2,
        )
        factory, mock_session = _mock_session_with_row(mock_row)

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.put(
                "/api/paper/config",
                params={"name": "orb_default"},
                json={"sl_pct": 0.6, "tp_pct": 1.5},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        # Verify setattr was called on the mock row
        assert mock_row.sl_pct == 0.6
        assert mock_row.tp_pct == 1.5
        mock_session.commit.assert_called_once()
        mock_session.refresh.assert_called_once_with(mock_row)

    def test_update_config_create_new_when_missing(self, auth_client):
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_query.filter.return_value.first.return_value = None
        mock_session.query.return_value = mock_query

        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_session)
        mock_ctx.__exit__ = MagicMock(return_value=False)

        def factory():
            return mock_ctx

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.put(
                "/api/paper/config",
                params={"name": "orb_default"},
                json={"sl_pct": 0.5, "tp_pct": 1.0},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        assert "orb_default" in body["message"]
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()

    def test_update_config_partial_update_only_changes_specified(self, auth_client):
        mock_row = _make_mock_config_row(
            or_minutes=45, sl_pct=0.4, tp_pct=1.2,
            cooldown_minutes=30, max_positions=5,
        )
        factory, mock_session = _mock_session_with_row(mock_row)

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.put(
                "/api/paper/config",
                params={"name": "orb_default"},
                json={"cooldown_minutes": 60},
            )

        assert resp.status_code == 200
        # cooldown_minutes should be updated
        assert mock_row.cooldown_minutes == 60
        # sl_pct and tp_pct should NOT have been overwritten
        assert mock_row.sl_pct == 0.4
        assert mock_row.tp_pct == 1.2

    def test_update_config_multiple_fields(self, auth_client):
        mock_row = _make_mock_config_row(
            or_minutes=45, sl_pct=0.4, tp_pct=1.2,
        )
        factory, mock_session = _mock_session_with_row(mock_row)

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.put(
                "/api/paper/config",
                params={"name": "orb_default"},
                json={
                    "or_minutes": 30,
                    "sl_pct": 0.3,
                    "tp_pct": 1.0,
                    "max_positions": 8,
                    "cooldown_minutes": 45,
                },
            )

        assert resp.status_code == 200
        assert mock_row.or_minutes == 30
        assert mock_row.sl_pct == 0.3
        assert mock_row.tp_pct == 1.0
        assert mock_row.max_positions == 8
        assert mock_row.cooldown_minutes == 45


@pytest.mark.unit
class TestResetStrategyConfig:
    """POST /api/paper/config/reset — reset config to defaults (requires auth)."""

    def test_reset_existing_config_success(self, auth_client):
        mock_row = _make_mock_config_row(
            or_minutes=30, sl_pct=0.8, tp_pct=2.0,
        )
        factory, mock_session = _mock_session_with_row(mock_row)

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.post(
                "/api/paper/config/reset",
                params={"name": "orb_default"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "success"
        assert "reset" in body["message"].lower()
        # Verify defaults were set on the mock row
        assert mock_row.or_minutes == 45
        assert mock_row.sl_pct == 0.4
        assert mock_row.tp_pct == 1.2
        assert mock_row.cooldown_minutes == 30
        assert mock_row.max_positions == 5
        mock_session.commit.assert_called_once()

    def test_reset_config_not_found_404(self, auth_client):
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_query.filter.return_value.first.return_value = None
        mock_session.query.return_value = mock_query

        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_session)
        mock_ctx.__exit__ = MagicMock(return_value=False)

        def factory():
            return mock_ctx

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.post(
                "/api/paper/config/reset",
                params={"name": "nonexistent"},
            )

        assert resp.status_code == 404
        assert "nonexistent" in resp.json()["detail"]

    def test_reset_config_resets_all_defaults(self, auth_client):
        mock_row = _make_mock_config_row(
            sl_pct=99, tp_pct=99, or_minutes=99,
        )
        factory, mock_session = _mock_session_with_row(mock_row)

        with patch("api.paper.endpoints.SessionLocal", factory):
            resp = auth_client.post(
                "/api/paper/config/reset",
                params={"name": "orb_default"},
            )

        assert resp.status_code == 200
        # Verify every default value was set
        assert mock_row.or_minutes == 45
        assert mock_row.sl_pct == 0.4
        assert mock_row.tp_pct == 1.2
        assert mock_row.min_or_range_pct == 0.5
        assert mock_row.max_or_range_pct == 3.0
        assert mock_row.max_positions == 5
        assert mock_row.max_capital_per_trade_pct == 0.10
        assert mock_row.max_daily_loss_pct == 0.02
        assert mock_row.max_total_exposure_pct == 0.50
        assert mock_row.risk_per_trade_pct == 0.01
        assert mock_row.min_trade_value == 5000
        assert mock_row.max_trade_value == 100000
        assert mock_row.cooldown_minutes == 30
        assert mock_row.max_distance_from_or_pct == 1.5
        assert mock_row.brokerage_pct == 0.0003
        assert mock_row.min_brokerage == 20
        assert mock_row.stt_pct == 0.00025
        assert mock_row.exchange_pct == 0.0000297
        assert mock_row.sebi_pct == 0.000001
        assert mock_row.stamp_pct == 0.00003
        assert mock_row.gst_pct == 0.18
        mock_session.commit.assert_called_once()
