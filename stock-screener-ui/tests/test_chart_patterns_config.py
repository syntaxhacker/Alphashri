"""Config tests for chart-pattern tuning constants (chart_patterns/config.py).

Every value is env-overridable with the previous hard-coded literal as the
default. These tests pin the defaults and prove env overrides (and invalid
env values) behave as documented. No network, no DB.
"""
import importlib

from chart_patterns import config as cp_config

_DEFAULTS = {
    "READ_LOOKBACK_BARS": 500,
    "CARD_MAX_BARS": 160,
    "CHART_MAX_BARS": 2000,
    "RESULTS_MAX_LIMIT": 1000,
    "CUSTOM_SYMBOLS_MAX": 200,
    "LOOKBACK_MIN": 60,
    "LOOKBACK_MAX": 5000,
}

_ENV_BY_ATTR = {
    "READ_LOOKBACK_BARS": "PATTERN_READ_LOOKBACK_BARS",
    "CARD_MAX_BARS": "PATTERN_CARD_MAX_BARS",
    "CHART_MAX_BARS": "PATTERN_CHART_MAX_BARS",
    "RESULTS_MAX_LIMIT": "PATTERN_RESULTS_MAX_LIMIT",
    "CUSTOM_SYMBOLS_MAX": "PATTERN_CUSTOM_SYMBOLS_MAX",
    "LOOKBACK_MIN": "PATTERN_LOOKBACK_MIN",
    "LOOKBACK_MAX": "PATTERN_LOOKBACK_MAX",
}


def _reload():
    return importlib.reload(cp_config)


def test_defaults_match_documented_literals():
    for attr, expected in _DEFAULTS.items():
        assert getattr(cp_config, attr) == expected, attr


def test_int_helper_parses_and_rejects(monkeypatch):
    monkeypatch.setenv("PATTERN_READ_LOOKBACK_BARS", "250")
    assert cp_config._int("PATTERN_READ_LOOKBACK_BARS", 500) == 250
    monkeypatch.setenv("PATTERN_READ_LOOKBACK_BARS", "not-an-int")
    assert cp_config._int("PATTERN_READ_LOOKBACK_BARS", 500) == 500
    monkeypatch.delenv("PATTERN_READ_LOOKBACK_BARS", raising=False)
    assert cp_config._int("PATTERN_READ_LOOKBACK_BARS", 500) == 500


def test_float_helper_parses_and_rejects(monkeypatch):
    monkeypatch.setenv("PATTERN_TEST_FLOAT", "1.25")
    assert cp_config._float("PATTERN_TEST_FLOAT", 0.6) == 1.25
    monkeypatch.setenv("PATTERN_TEST_FLOAT", "not-a-float")
    assert cp_config._float("PATTERN_TEST_FLOAT", 0.6) == 0.6


def test_env_override_changes_module_constant(monkeypatch):
    monkeypatch.setenv("PATTERN_READ_LOOKBACK_BARS", "250")
    try:
        reloaded = _reload()
        assert reloaded.READ_LOOKBACK_BARS == 250
    finally:
        monkeypatch.delenv("PATTERN_READ_LOOKBACK_BARS", raising=False)
        _reload()
    assert cp_config.READ_LOOKBACK_BARS == 500


def test_invalid_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("PATTERN_READ_LOOKBACK_BARS", "bogus")
    monkeypatch.setenv("PATTERN_CARD_MAX_BARS", "bogus")
    try:
        reloaded = _reload()
        assert reloaded.READ_LOOKBACK_BARS == 500
        assert reloaded.CARD_MAX_BARS == 160
    finally:
        monkeypatch.delenv("PATTERN_READ_LOOKBACK_BARS", raising=False)
        monkeypatch.delenv("PATTERN_CARD_MAX_BARS", raising=False)
        _reload()
    assert cp_config.READ_LOOKBACK_BARS == 500
    assert cp_config.CARD_MAX_BARS == 160


def test_every_constant_has_env_override(monkeypatch):
    """Each documented constant actually reads its env var."""
    for attr, env in _ENV_BY_ATTR.items():
        default = _DEFAULTS[attr]
        sentinel = "123456" if isinstance(default, int) else "123.456"
        monkeypatch.setenv(env, sentinel)
        try:
            reloaded = _reload()
            assert getattr(reloaded, attr) == int(sentinel)
        finally:
            monkeypatch.delenv(env, raising=False)
            _reload()
    for attr, expected in _DEFAULTS.items():
        assert getattr(cp_config, attr) == expected
