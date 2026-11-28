"""Second readers of config-owned env vars must not shadow config values."""
import runpy
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

import config


PROJECT_ROOT = Path(__file__).resolve().parent.parent


class _Socket:
    def connect(self):
        pass

    def subscribe(self, **kwargs):
        pass

    def switchChannel(self, **kwargs):
        pass

    def keep_running(self):
        pass


@pytest.mark.unit
def test_run_server_port_comes_from_config(monkeypatch):
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setattr(config, "PORT", 9123)
    monkeypatch.setenv("PORT", "9999")
    with patch("uvicorn.run") as run:
        runpy.run_path(str(PROJECT_ROOT / "run_server.py"), run_name="__main__")
    assert run.call_args.kwargs["port"] == 9123


@pytest.mark.unit
def test_redis_url_prefers_config_over_raw_env(monkeypatch):
    from cache import redis_client as rc

    monkeypatch.setattr(config, "REDIS_URL", "redis://canonical:6380/2")
    monkeypatch.setenv("REDIS_URL", "redis://raw:6381/3")
    assert rc._get_redis_url() == "redis://canonical:6380/2"


@pytest.mark.unit
def test_redis_url_still_falls_back_to_raw_env(monkeypatch):
    from cache import redis_client as rc

    monkeypatch.setattr(config, "REDIS_URL", "")
    monkeypatch.setenv("REDIS_URL", "redis://late:6382/4")
    assert rc._get_redis_url() == "redis://late:6382/4"


@pytest.mark.unit
def test_upstox_env_token_prefers_config(monkeypatch, tmp_path):
    import api.upstox_token as ut

    monkeypatch.setattr(ut.db.models, "get_shared_broker_token", lambda *a, **k: None)
    monkeypatch.setattr(ut, "TOKEN_FILE", tmp_path / "missing.json")
    monkeypatch.setattr(config, "UPSTOX_ACCESS_TOKEN", "config-token")
    monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "env-token")
    ut.clear_upstox_token_cache()
    assert ut.resolve_upstox_token(use_env=True) == "config-token"


@pytest.mark.unit
def test_upstox_env_token_falls_back_to_raw_env(monkeypatch, tmp_path):
    import api.upstox_token as ut

    monkeypatch.setattr(ut.db.models, "get_shared_broker_token", lambda *a, **k: None)
    monkeypatch.setattr(ut, "TOKEN_FILE", tmp_path / "missing.json")
    monkeypatch.setattr(config, "UPSTOX_ACCESS_TOKEN", "")
    monkeypatch.setenv("UPSTOX_ACCESS_TOKEN", "env-token")
    ut.clear_upstox_token_cache()
    assert ut.resolve_upstox_token(use_env=True) == "env-token"


@pytest.mark.unit
def test_backtest_credentials_prefer_config(monkeypatch):
    import backtest.utils as bu

    monkeypatch.setattr(config, "UPSTOX_API_KEY", "cfg-key")
    monkeypatch.setattr(config, "UPSTOX_API_SECRET", "cfg-secret")
    monkeypatch.setenv("UPSTOX_API_KEY", "env-key")
    monkeypatch.setenv("UPSTOX_API_SECRET", "env-secret")
    assert bu._get_api_credentials() == ("cfg-key", "cfg-secret")


@pytest.mark.unit
def test_backtest_credentials_fall_back_to_client_aliases(monkeypatch):
    import backtest.utils as bu

    monkeypatch.setattr(config, "UPSTOX_API_KEY", "")
    monkeypatch.setattr(config, "UPSTOX_API_SECRET", "")
    monkeypatch.delenv("UPSTOX_API_KEY", raising=False)
    monkeypatch.delenv("UPSTOX_API_SECRET", raising=False)
    monkeypatch.setenv("UPSTOX_CLIENT_ID", "alias-key")
    monkeypatch.setenv("UPSTOX_CLIENT_SECRET", "alias-secret")
    assert bu._get_api_credentials() == ("alias-key", "alias-secret")
    assert bu._resolve_api_secret() == "alias-secret"


@pytest.mark.unit
def test_fyers_connect_prefers_config_token(monkeypatch):
    from api.broker_hub.adapters import fyers as fy

    seen = {}
    monkeypatch.setattr(config, "FYERS_ACCESS_TOKEN", "APP:CONFIG")
    monkeypatch.setenv("FYERS_ACCESS_TOKEN", "APP:ENV")
    fy.FyersAdapter().connect(
        ["SBIN"],
        on_tick=lambda *a: None,
        socket_factory=lambda **kwargs: (seen.update(kwargs), _Socket())[1],
    )
    assert seen["access_token"] == "APP:CONFIG"


@pytest.mark.unit
def test_fyers_tbt_connect_prefers_config_token(monkeypatch):
    from api.broker_hub.adapters import fyers as fy

    seen = {}
    monkeypatch.setattr(config, "FYERS_ACCESS_TOKEN", "APP:CONFIG")
    monkeypatch.setenv("FYERS_ACCESS_TOKEN", "APP:ENV")
    fy.FyersTbtAdapter().connect(
        ["SBIN"],
        on_tick=lambda *a: None,
        tbt_factory=lambda **kwargs: (seen.update(kwargs), _Socket())[1],
        data_factory=lambda **kwargs: _Socket(),
    )
    assert seen["access_token"] == "APP:CONFIG"


@pytest.mark.unit
def test_fyers_connect_keeps_instance_and_env_precedence(monkeypatch):
    from api.broker_hub.adapters import fyers as fy

    def _token_for(adapter):
        seen = {}
        adapter.connect(
            ["SBIN"],
            on_tick=lambda *a: None,
            socket_factory=lambda **kwargs: (seen.update(kwargs), _Socket())[1],
        )
        return seen["access_token"]

    monkeypatch.setattr(config, "FYERS_ACCESS_TOKEN", "APP:CONFIG")
    monkeypatch.setenv("FYERS_ACCESS_TOKEN", "APP:ENV")
    assert _token_for(fy.FyersAdapter(access_token="APP:INSTANCE")) == "APP:INSTANCE"
    monkeypatch.setattr(config, "FYERS_ACCESS_TOKEN", "")
    assert _token_for(fy.FyersAdapter()) == "APP:ENV"
