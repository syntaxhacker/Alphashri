"""Regression: upstox_common must resolve the config-owned token before raw env."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from scripts import upstox_common


@pytest.mark.unit
def test_config_token_takes_precedence_over_raw_env(monkeypatch):
    monkeypatch.setattr(config, "UPSTOX_ACCESS_TOKEN", "config-token", raising=False)
    monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "env-token")
    assert upstox_common._token_from_env() == "config-token"


@pytest.mark.unit
def test_raw_env_is_fallback_when_config_has_no_token(monkeypatch):
    monkeypatch.setattr(config, "UPSTOX_ACCESS_TOKEN", "", raising=False)
    monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "env-token")
    assert upstox_common._token_from_env() == "env-token"


@pytest.mark.unit
def test_token_with_source_prefers_config_after_db_and_file(monkeypatch):
    monkeypatch.setattr(upstox_common, "_token_from_db", lambda: "")
    monkeypatch.setattr(upstox_common, "_token_from_file", lambda: ("", ""))
    monkeypatch.setattr(config, "UPSTOX_ACCESS_TOKEN", "config-token", raising=False)
    monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "env-token")
    assert upstox_common.token_with_source() == ("config-token", "UPSTOX_ACCESS_TOKEN env var")
