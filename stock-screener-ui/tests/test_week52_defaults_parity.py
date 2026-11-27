"""Parity guards for the canonical 52W Chaser/Target defaults.

The live generators, the Nautilus/sim backtest strategies and the UI defaults
all have to agree with trading.week52.defaults. This module also parses the
TypeScript sources with Path/re so a frontend-only drift fails the Python gate.
"""

import ast
import inspect
import re
import textwrap
from pathlib import Path

import pytest

from trading.week52.defaults import (
    CHASER_ADX_MIN,
    CHASER_ENABLE_FILTERS_DEFAULT,
    CHASER_RSI_HI,
    CHASER_VOLUME_MULT,
    ChaserDefaults,
    TargetDefaults,
)
from trading.week52_chaser_signals import Week52ChaserSignalGenerator
from trading.week52_target_signals import Week52TargetSignalGenerator

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TS_DEFAULTS = PROJECT_ROOT / "src/config/backtestDefaults.ts"
TS_REPLAY_CHASER = PROJECT_ROOT / "src/components/replay/strategies/week52Chaser.tsx"

try:
    import nautilus_trader  # noqa: F401
except ImportError:
    from backtest.sim import install as _install_sim

    _install_sim()

import backtest.strategies.week52_chaser as chaser_bt  # noqa: E402
import backtest.strategies.week52_target as target_bt  # noqa: E402
from nautilus_trader.model import BarType, InstrumentId  # noqa: E402


CHASER_BACKTEST_DEFAULTS = {
    "entry_threshold_pct": ChaserDefaults.entry_threshold_pct,
    "stop_loss_pct": ChaserDefaults.sl_pct,
    "take_profit_pct": ChaserDefaults.tp_pct,
    "enable_trailing_stop": ChaserDefaults.enable_trailing_stop,
    "trailing_stop_pct": ChaserDefaults.trailing_stop_pct,
    "trailing_activation_pct": ChaserDefaults.trailing_activation_pct,
    "max_holding_days": ChaserDefaults.max_holding_days,
    "cooldown_days": ChaserDefaults.cooldown_days,
    "trade_size": 100,
    "enable_filters": ChaserDefaults.enable_filters,
}
TARGET_BACKTEST_DEFAULTS = {
    "entry_threshold_pct": TargetDefaults.entry_threshold_pct,
    "stop_loss_pct": TargetDefaults.sl_pct,
    "trailing_stop_pct": TargetDefaults.trailing_stop_pct,
    "max_holding_days": TargetDefaults.max_holding_days,
    "cooldown_days": TargetDefaults.cooldown_days,
    "trade_size": 100,
}


def _configs():
    instrument_id = InstrumentId.from_str("TEST.SIMULATED")
    bar_type = BarType.from_str("TEST.SIMULATED-1-DAY-LAST-EXTERNAL")
    return (
        chaser_bt.Week52ChaserConfig(instrument_id=instrument_id, bar_type=bar_type),
        target_bt.Week52TargetConfig(instrument_id=instrument_id, bar_type=bar_type),
    )


def _resolve_default(expr, namespace):
    try:
        return ast.literal_eval(expr)
    except (TypeError, ValueError):
        if (
            isinstance(expr, ast.Attribute)
            and isinstance(expr.value, ast.Name)
            and expr.value.id in namespace
        ):
            return getattr(namespace[expr.value.id], expr.attr)
        raise AssertionError(f"unresolvable params.get default: {ast.dump(expr)}")


def _params_get_defaults(func, namespace):
    """Read the literal fallbacks of every ``params.get(key, default)`` in func."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(func)))
    defaults = {}
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "params"
            and len(node.args) >= 2
        ):
            continue
        key = ast.literal_eval(node.args[0])
        defaults[key] = _resolve_default(node.args[1], namespace)
    return defaults


def _ts_object_block(source: str, strategy_id: str) -> str:
    match = re.search(
        rf'"{re.escape(strategy_id)}"\s*:\s*\{{(.*?)\n\s*\}},', source, re.S
    )
    assert match, f"{strategy_id} defaults block missing from backtestDefaults.ts"
    return match.group(1)


def _ts_scalar(raw: str):
    raw = raw.strip().rstrip(",")
    if raw == "true":
        return True
    if raw == "false":
        return False
    try:
        return ast.literal_eval(raw)
    except (TypeError, ValueError):
        pytest.fail(f"unparseable TS default: {raw}")


def _ts_values(block: str) -> dict:
    return {
        match.group(1): _ts_scalar(match.group(2))
        for match in re.finditer(r"^\s*(\w+):\s*([^,\n]+),?\s*$", block, re.M)
    }


class TestCanonicalModule:
    def test_filter_aliases_are_derived_from_dataclass(self):
        assert CHASER_ADX_MIN == ChaserDefaults.adx_min == 25.0
        assert CHASER_RSI_HI == ChaserDefaults.rsi_hi == 75.0
        assert CHASER_VOLUME_MULT == ChaserDefaults.volume_mult == 1.8
        assert CHASER_ENABLE_FILTERS_DEFAULT is ChaserDefaults.enable_filters is False

    def test_module_has_no_env_reads(self):
        source = (PROJECT_ROOT / "trading/week52/defaults.py").read_text(encoding="utf-8")
        assert "os.environ" not in source
        assert "os.getenv" not in source
        assert "getenv(" not in source


class TestLiveGeneratorDefaults:
    def test_chaser(self):
        gen = Week52ChaserSignalGenerator(config={})
        expected = {
            "sl_pct": ChaserDefaults.sl_pct,
            "tp_pct": ChaserDefaults.tp_pct,
            "entry_threshold_pct": ChaserDefaults.entry_threshold_pct,
            "min_breakout_pct": ChaserDefaults.min_breakout_pct,
            "enable_trailing_stop": ChaserDefaults.enable_trailing_stop,
            "trailing_stop_pct": ChaserDefaults.trailing_stop_pct,
            "trailing_activation_pct": ChaserDefaults.trailing_activation_pct,
            "max_holding_days": ChaserDefaults.max_holding_days,
            "cooldown_days": ChaserDefaults.cooldown_days,
            "enable_filters": ChaserDefaults.enable_filters,
            "adx_min": ChaserDefaults.adx_min,
            "rsi_hi": ChaserDefaults.rsi_hi,
            "volume_mult": ChaserDefaults.volume_mult,
            "min_avg_volume": ChaserDefaults.min_avg_volume,
            "recent_touch_days": ChaserDefaults.recent_touch_days,
        }
        assert {key: getattr(gen, key) for key in expected} == expected

    def test_target(self):
        gen = Week52TargetSignalGenerator(config={})
        expected = {
            "sl_pct": TargetDefaults.sl_pct,
            "tp_pct": TargetDefaults.tp_pct,
            "entry_threshold_pct": TargetDefaults.entry_threshold_pct,
            "trailing_stop_pct": TargetDefaults.trailing_stop_pct,
            "near_high_activation_pct": TargetDefaults.near_high_activation_pct,
            "near_high_trail_pct": TargetDefaults.near_high_trail_pct,
            "max_holding_days": TargetDefaults.max_holding_days,
            "cooldown_days": TargetDefaults.cooldown_days,
            "recent_touch_days": TargetDefaults.recent_touch_days,
            "min_avg_volume": TargetDefaults.min_avg_volume,
        }
        assert {key: getattr(gen, key) for key in expected} == expected


class TestBacktestDefaults:
    def test_config_defaults(self):
        chaser_config, target_config = _configs()
        assert {
            key: getattr(chaser_config, key) for key in CHASER_BACKTEST_DEFAULTS
        } == CHASER_BACKTEST_DEFAULTS
        assert {
            key: getattr(target_config, key) for key in TARGET_BACKTEST_DEFAULTS
        } == TARGET_BACKTEST_DEFAULTS

    def test_get_params_defaults(self):
        chaser_params = {
            p.key: p.default for p in chaser_bt.Week52ChaserStrategy.get_params()
        }
        target_params = {
            p.key: p.default for p in target_bt.Week52TargetStrategy.get_params()
        }
        assert chaser_params == CHASER_BACKTEST_DEFAULTS
        assert target_params == TARGET_BACKTEST_DEFAULTS

    def test_run_single_param_fallbacks(self):
        assert (
            _params_get_defaults(
                chaser_bt.run_single_stock_backtest, {"ChaserDefaults": ChaserDefaults}
            )
            == CHASER_BACKTEST_DEFAULTS
            | {"include_costs": True}
        )
        assert (
            _params_get_defaults(
                target_bt.run_single_stock_week52_target,
                {"TargetDefaults": TargetDefaults},
            )
            == TARGET_BACKTEST_DEFAULTS | {"include_costs": True}
        )

    def test_validate_params_fallbacks(self):
        chaser_validate = _params_get_defaults(
            chaser_bt.Week52ChaserStrategy.validate_params,
            {"ChaserDefaults": ChaserDefaults},
        )
        assert chaser_validate == {
            "stop_loss_pct": ChaserDefaults.sl_pct,
            "take_profit_pct": ChaserDefaults.tp_pct,
            "entry_threshold_pct": ChaserDefaults.entry_threshold_pct,
            "enable_trailing_stop": ChaserDefaults.enable_trailing_stop,
            "trailing_stop_pct": ChaserDefaults.trailing_stop_pct,
        }

        target_validate = _params_get_defaults(
            target_bt.Week52TargetStrategy.validate_params,
            {"TargetDefaults": TargetDefaults},
        )
        assert target_validate == {
            "entry_threshold_pct": TargetDefaults.entry_threshold_pct,
            "stop_loss_pct": TargetDefaults.sl_pct,
            "trailing_stop_pct": TargetDefaults.trailing_stop_pct,
        }

    def test_canonical_fallbacks_are_valid(self):
        assert chaser_bt.Week52ChaserStrategy().validate_params({}) == []
        assert target_bt.Week52TargetStrategy().validate_params({}) == []


class TestFrontendDefaultsParity:
    def test_backtest_defaults_ts_matches_python(self):
        source = TS_DEFAULTS.read_text(encoding="utf-8")
        chaser = _ts_values(_ts_object_block(source, "52w_chaser"))
        target = _ts_values(_ts_object_block(source, "52w_target"))

        assert chaser == CHASER_BACKTEST_DEFAULTS
        assert target == TARGET_BACKTEST_DEFAULTS
        # strategyParamKeys names DB variation fields (sl_pct/tp_pct); the UI
        # remaps them to the backend names. Never ship both aliases in defaults.
        assert "sl_pct" not in chaser and "tp_pct" not in chaser
        assert "sl_pct" not in target and "tp_pct" not in target

    def test_replay_chaser_params_match_python(self):
        source = TS_REPLAY_CHASER.read_text(encoding="utf-8")
        params = {
            name: _ts_scalar(raw)
            for name, raw in re.findall(
                r'\{\s*name:\s*"([^"]+)"[^}]*?default:\s*([^,}]+)', source
            )
        }
        # trailing_activation_pct / cooldown_days are intentionally absent:
        # the replay engine's ParamSpec has no field for them.
        assert params == {
            "symbol": "NETWEB",
            "lookback_days": 400,
            "sl_pct": ChaserDefaults.sl_pct,
            "tp_pct": ChaserDefaults.tp_pct,
            "entry_threshold_pct": ChaserDefaults.entry_threshold_pct,
            "min_breakout_pct": ChaserDefaults.min_breakout_pct,
            "max_holding_days": ChaserDefaults.max_holding_days,
            "enable_trailing_stop": False,
            "trailing_stop_pct": ChaserDefaults.trailing_stop_pct,
        }
