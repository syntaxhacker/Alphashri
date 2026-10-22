"""Pure helper tests for scripts/eval_pin_reversal.py metrics.

Fixtures only — no tape I/O, no strategy runs (those live in the eval script).
Run: source .venv/bin/activate && python -m pytest tests/test_eval_pin_reversal.py -q
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

_EVAL = Path(__file__).resolve().parent.parent / "scripts" / "eval_pin_reversal.py"
_spec = importlib.util.spec_from_file_location("eval_pin_reversal", _EVAL)
assert _spec and _spec.loader
eval_mod = importlib.util.module_from_spec(_spec)
sys.modules["eval_pin_reversal"] = eval_mod
_spec.loader.exec_module(eval_mod)


@dataclass
class FakeTrade:
    net_pnl: float = 0.0
    hold_min: float = 0.0


@pytest.fixture
def mixed_trades():
    return [FakeTrade(100.0, 10.0), FakeTrade(-50.0, 20.0),
            FakeTrade(50.0, 30.0), FakeTrade(-25.0, 40.0)]


@pytest.fixture
def all_winners():
    return [FakeTrade(100.0, 5.0), FakeTrade(200.0, 15.0)]


def test_profit_factor_mixed():
    # wins 150 / losses 75 -> 2.0
    assert eval_mod.profit_factor([100.0, -50.0, 50.0, -25.0]) == pytest.approx(2.0)


def test_profit_factor_empty_is_zero():
    assert eval_mod.profit_factor([]) == 0.0


def test_profit_factor_all_winners_is_inf(all_winners):
    assert eval_mod.profit_factor([t.net_pnl for t in all_winners]) == float("inf")


def test_profit_factor_all_losses_is_zero():
    assert eval_mod.profit_factor([-10.0, -20.0]) == pytest.approx(0.0)


def test_max_drawdown_fixture():
    # cum: 100, 50, 150, 120 -> trough 50 off peak 100, then 120 off 150 -> max 50
    assert eval_mod.max_drawdown([100.0, -50.0, 100.0, -30.0]) == pytest.approx(50.0)


def test_max_drawdown_monotone_gain_is_zero():
    assert eval_mod.max_drawdown([10.0, 20.0, 30.0]) == pytest.approx(0.0)


def test_max_drawdown_empty_is_zero():
    assert eval_mod.max_drawdown([]) == pytest.approx(0.0)


def test_aggregate_mixed(mixed_trades):
    m = eval_mod.aggregate_metrics(mixed_trades)
    assert m["n"] == 4
    assert m["wins"] == 2 and m["losses"] == 2
    assert m["net"] == pytest.approx(75.0)
    assert m["pf"] == pytest.approx(2.0)
    assert m["win_rate"] == pytest.approx(0.5)
    assert m["avg_hold"] == pytest.approx(25.0)


def test_aggregate_empty():
    m = eval_mod.aggregate_metrics([])
    assert m == {"n": 0, "wins": 0, "losses": 0, "net": 0,
                 "win_rate": 0.0, "pf": 0.0, "avg_hold": 0.0}
