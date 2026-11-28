"""Regression: telegram_notifier must use the config-owned TELEGRAM_ENABLED toggle."""
import importlib
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
import trading.telegram_notifier as tgn


def _enabled_from_config(env_value: str, config_enabled: bool) -> tuple[bool, bool]:
    env = {"TELEGRAM_ENABLED": env_value}
    cfg = {"enabled": config_enabled, "bot_token": "unit-token", "chat_id": "42"}
    with patch.dict(os.environ, env), patch.dict(config.TELEGRAM_CONFIG, cfg):
        module = importlib.reload(tgn)
        result = (module._ENABLED, module._is_available())
    importlib.reload(tgn)
    return result


@pytest.mark.unit
def test_config_disabled_wins_over_enabled_env():
    enabled, available = _enabled_from_config("true", False)
    assert enabled is False
    assert available is False


@pytest.mark.unit
def test_config_enabled_wins_over_disabled_env():
    enabled, available = _enabled_from_config("false", True)
    assert enabled is True
    assert available is True
