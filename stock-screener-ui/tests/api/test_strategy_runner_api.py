"""Tests for strategy_runner_api — auth not required, 404 handling, health."""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from api_server_fastapi import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestStrategyRunnerApi:
    def test_health_via_docs_exists(self, client):
        # strategy runner has no health but app should still respond
        r = client.get("/health")
        assert r.status_code == 200

    def test_run_bot_not_found(self, client):
        mock_db = MagicMock()
        mock_query = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        with patch("api.strategy_runner_api.SessionLocal", return_value=mock_db):
            r = client.post("/api/strategy-runner/run", json={
                "bot_uuids": ["00000000-0000-0000-0000-000000000000"],
                "date": "2026-01-01",
                "symbols": ["RELIANCE"]
            })
            assert r.status_code == 200
            data = r.json()
            assert "bots" in data
            assert data["bots"][0]["error"] == "Bot not found"

    def test_run_empty_trades_summary(self, client):
        bot_config = MagicMock()
        bot_config.uuid = "uuid-1"
        bot_config.name = "TestBot"
        bot_config.strategies = []
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = bot_config
        mock_runner = MagicMock()
        mock_runner.run_replay.return_value = None
        with patch("api.strategy_runner_api.SessionLocal", return_value=mock_db):
            with patch("api.strategy_runner_api.MultiStrategyRunner.create_for_replay", return_value=mock_runner):
                r = client.post("/api/strategy-runner/run", json={
                    "bot_uuids": ["uuid-1"],
                    "date": "2026-01-01",
                    "symbols": ["RELIANCE"]
                })
                assert r.status_code == 200
                data = r.json()
                assert "summary" in data
                assert data["summary"]["total_trades"] == 0

    def test_no_hardcoded_secrets(self):
        text = Path(ROOT / "api" / "strategy_runner_api.py").read_text()
        assert "sk-" not in text.lower()
        assert "password" not in text.lower()
