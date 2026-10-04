"""Config tests for chart-pattern tuning constants (chart_patterns/config.py).

Every value is env-overridable with the previous hard-coded literal as the
default. These tests pin the defaults and prove env overrides (and invalid
env values) behave as documented. No network, no DB.
"""
import importlib

from chart_patterns import config as cp_config

_DEFAULTS = {
    "TRENDLINE_LOOKBACK_BARS": 400,
    "TRENDLINE_SWING_ORDER": 6,
    "TRENDLINE_SWING_MIN_BARS": 500,
    "TRENDLINE_TOUCH_TOL_ATR": 0.6,
    "TRENDLINE_MIN_TOUCHES": 2,
    "TRENDLINE_MIN_SPAN": 20,
    "TRENDLINE_ENVELOPE_TOL_ATR": 0.25,
    "READ_LOOKBACK_BARS": 500,
    "CARD_MAX_BARS": 160,
    "CHART_MAX_BARS": 2000,
    "RESULTS_MAX_LIMIT": 1000,
    "CUSTOM_SYMBOLS_MAX": 200,
    "LOOKBACK_MIN": 60,
    "LOOKBACK_MAX": 5000,
}

_ENV_BY_ATTR = {
    "TRENDLINE_LOOKBACK_BARS": "PATTERN_TRENDLINE_LOOKBACK_BARS",
    "TRENDLINE_SWING_ORDER": "PATTERN_TRENDLINE_SWING_ORDER",
    "TRENDLINE_SWING_MIN_BARS": "PATTERN_TRENDLINE_SWING_MIN_BARS",
    "TRENDLINE_TOUCH_TOL_ATR": "PATTERN_TRENDLINE_TOUCH_TOL_ATR",
    "TRENDLINE_MIN_TOUCHES": "PATTERN_TRENDLINE_MIN_TOUCHES",
    "TRENDLINE_MIN_SPAN": "PATTERN_TRENDLINE_MIN_SPAN",
    "TRENDLINE_ENVELOPE_TOL_ATR": "PATTERN_TRENDLINE_ENVELOPE_TOL_ATR",
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
    monkeypatch.setenv("PATTERN_TRENDLINE_LOOKBACK_BARS", "250")
    assert cp_config._int("PATTERN_TRENDLINE_LOOKBACK_BARS", 400) == 250
    monkeypatch.setenv("PATTERN_TRENDLINE_LOOKBACK_BARS", "not-an-int")
    assert cp_config._int("PATTERN_TRENDLINE_LOOKBACK_BARS", 400) == 400
    monkeypatch.delenv("PATTERN_TRENDLINE_LOOKBACK_BARS", raising=False)
    assert cp_config._int("PATTERN_TRENDLINE_LOOKBACK_BARS", 400) == 400


def test_float_helper_parses_and_rejects(monkeypatch):
    monkeypatch.setenv("PATTERN_TRENDLINE_TOUCH_TOL_ATR", "1.25")
    assert cp_config._float("PATTERN_TRENDLINE_TOUCH_TOL_ATR", 0.6) == 1.25
    monkeypatch.setenv("PATTERN_TRENDLINE_TOUCH_TOL_ATR", "not-a-float")
    assert cp_config._float("PATTERN_TRENDLINE_TOUCH_TOL_ATR", 0.6) == 0.6


def test_env_override_changes_module_constant(monkeypatch):
    monkeypatch.setenv("PATTERN_TRENDLINE_LOOKBACK_BARS", "250")
    try:
        reloaded = _reload()
        assert reloaded.TRENDLINE_LOOKBACK_BARS == 250
    finally:
        monkeypatch.delenv("PATTERN_TRENDLINE_LOOKBACK_BARS", raising=False)
        _reload()
    assert cp_config.TRENDLINE_LOOKBACK_BARS == 400


def test_invalid_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("PATTERN_TRENDLINE_LOOKBACK_BARS", "bogus")
    monkeypatch.setenv("PATTERN_TRENDLINE_TOUCH_TOL_ATR", "bogus")
    try:
        reloaded = _reload()
        assert reloaded.TRENDLINE_LOOKBACK_BARS == 400
        assert reloaded.TRENDLINE_TOUCH_TOL_ATR == 0.6
    finally:
        monkeypatch.delenv("PATTERN_TRENDLINE_LOOKBACK_BARS", raising=False)
        monkeypatch.delenv("PATTERN_TRENDLINE_TOUCH_TOL_ATR", raising=False)
        _reload()
    assert cp_config.TRENDLINE_LOOKBACK_BARS == 400


def test_every_constant_has_env_override(monkeypatch):
    """Each documented constant actually reads its env var."""
    for attr, env in _ENV_BY_ATTR.items():
        default = _DEFAULTS[attr]
        sentinel = "123456" if isinstance(default, int) else "123.456"
        monkeypatch.setenv(env, sentinel)
        try:
            reloaded = _reload()
            assert getattr(reloaded, attr) == float(sentinel) if isinstance(default, float) else getattr(reloaded, attr) == int(sentinel)
        finally:
            monkeypatch.delenv(env, raising=False)
            _reload()
    for attr, expected in _DEFAULTS.items():
        assert getattr(cp_config, attr) == expected


def test_signature_stable_without_changes():
    assert cp_config.trendline_signature() == cp_config.trendline_signature()
