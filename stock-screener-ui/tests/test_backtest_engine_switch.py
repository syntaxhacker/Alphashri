"""BACKTEST_ENGINE flag switch tests.

Each case runs in its own interpreter: the shim swaps ``nautilus_trader`` modules
in ``sys.modules`` and ``backtest.strategies`` caches its engine choice at import,
so in-process resets cannot give the cases a clean slate. No network, no DB, no
market data — the imports never reach an Upstox client.
"""

import os
import subprocess
from pathlib import Path

import pytest

_UI_DIR = Path(__file__).resolve().parents[1]
_PYTHON = str(_UI_DIR / ".venv" / "bin" / "python")


def _run_child(script: str, *, engine: str | None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env.pop("BACKTEST_ENGINE", None)
    if engine is not None:
        env["BACKTEST_ENGINE"] = engine
    return subprocess.run(
        [_PYTHON, "-c", script],
        env=env,
        cwd=str(_UI_DIR),
        capture_output=True,
        text=True,
        timeout=30,
    )


def _assert_ok(proc: subprocess.CompletedProcess, label: str) -> None:
    assert proc.returncode == 0, (
        f"{label} child failed (rc={proc.returncode})\n"
        f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )


_UNSET_CHILD = r'''
import backtest.sim as sim

assert not sim.is_installed(), "shim must not be installed before importing strategies"
from backtest.strategies import list_strategies

assert not sim.is_installed(), "unset BACKTEST_ENGINE must not install the shim"
ids = [row["id"] for row in list_strategies()]
assert isinstance(ids, list)
assert not sim.is_installed(), "listing strategies must not install the shim"
print("UNSET_OK", len(ids))
'''


_SIM_CHILD = r'''
import backtest.sim as sim

assert not sim.is_installed(), "shim must start uninstalled in a fresh interpreter"
from backtest.strategies import list_strategies

assert sim.is_installed(), "BACKTEST_ENGINE=sim must install the shim"
ids = [row["id"] for row in list_strategies()]
assert len(ids) >= 18, f"expected >=18 strategies, got {len(ids)}: {ids}"

import backtest.strategies.orb as orb

assert getattr(orb, "_NAUTILUS_AVAILABLE", False) is True, (
    "orb must see nautilus_trader available under the sim engine"
)
print("SIM_OK", len(ids))
'''


def test_unset_engine_does_not_install_shim():
    proc = _run_child(_UNSET_CHILD, engine=None)
    _assert_ok(proc, "unset")
    assert "UNSET_OK" in proc.stdout


def test_sim_engine_installs_shim_and_exposes_strategies():
    proc = _run_child(_SIM_CHILD, engine="sim")
    _assert_ok(proc, "sim")
    assert "SIM_OK" in proc.stdout


def test_invalid_engine_is_rejected():
    proc = _run_child("import backtest.strategies", engine="bogus")
    assert proc.returncode != 0, "bogus BACKTEST_ENGINE must fail the import"
    assert "must be 'nautilus' or 'sim'" in proc.stderr, (
        f"expected validation error in stderr, got:\n{proc.stderr}"
    )


def test_nautilus_engine_is_explicitly_accepted():
    proc = _run_child(_UNSET_CHILD.replace("UNSET_OK", "NAUTILUS_OK"), engine="nautilus")
    _assert_ok(proc, "nautilus")
    assert "NAUTILUS_OK" in proc.stdout
