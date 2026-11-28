"""UI config re-exports value-equal settings from the root config.py."""
import importlib
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

UI_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = UI_DIR.parent
sys.path.insert(0, str(UI_DIR))

import config  # noqa: E402 — path must be set up first


@pytest.mark.unit
def test_import_config_from_ui_dir_resolves_ui_local_module():
    assert Path(config.__file__).resolve() == (UI_DIR / "config.py").resolve()


@pytest.mark.unit
def test_root_config_is_loaded_under_a_distinct_module_name():
    assert hasattr(config, "_root_config")
    assert Path(config._root_config.__file__).resolve() == (ROOT_DIR / "config.py").resolve()
    assert config._root_config.__name__ != "config"


@pytest.mark.unit
def test_value_equal_settings_match_root():
    names = (
        "IST", "PORT", "JWT_SECRET_KEY", "JWT_ALGORITHM",
        "ACCESS_TOKEN_EXPIRE_MINUTES", "REFRESH_TOKEN_EXPIRE_DAYS",
        "OPENROUTER_API_KEY", "API_BASE_URL", "FRONTEND_URL",
        "REDIS_URL", "TELEGRAM_CONFIG",
    )
    for name in names:
        assert getattr(config, name) == getattr(config._root_config, name), name
    # Mutable/stateful values are shared by reference, not copied.
    assert config.TELEGRAM_CONFIG is config._root_config.TELEGRAM_CONFIG
    assert config.IST is config._root_config.IST


@pytest.mark.unit
def test_divergent_settings_keep_ui_local_values():
    with patch.dict(os.environ, {}, clear=True):
        importlib.reload(config)
        assert config.ALLOWED_ORIGINS == ["http://localhost:5173"]
        assert "http://192.168.*.*:*" in config.ALLOWED_ORIGIN_PATTERNS
        assert config.ALLOWED_ORIGINS != config._root_config.ALLOWED_ORIGINS
        assert "access_token" in config.UPSTOX_CONFIG
        assert "username" in config.UPSTOX_CONFIG
        assert set(config.UPSTOX_CONFIG) > set(config._root_config.UPSTOX_CONFIG)
        assert config.DATABASE_URL == f"sqlite:///{UI_DIR / 'db' / 'alphashri.db'}"
    importlib.reload(config)
