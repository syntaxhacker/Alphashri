"""BACKTEST_ENGINE flag switch tests.

Each case runs in its own interpreter: the shim swaps ``nautilus_trader`` modules
in ``sys.modules`` and ``backtest.strategies`` caches its engine choice at import,
so in-process resets cannot give the cases a clean slate. No network, no DB, no
market data — the imports never reach an Upstox client.
"""

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest

_UI_DIR = Path(__file__).resolve().parents[1]
_PYTHON = str(_UI_DIR / ".venv" / "bin" / "python")
_NAUTILUS_INSTALLED = importlib.util.find_spec("nautilus_trader") is not None


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


_SIM_CHILD = r'''
import backtest.sim as sim

assert not sim.is_installed(), "shim must start uninstalled in a fresh interpreter"
from backtest.strategies import list_strategies

assert sim.is_installed(), "the default (and explicit sim) engine must install the shim"
ids = [row["id"] for row in list_strategies()]
assert len(ids) >= 18, f"expected >=18 strategies, got {len(ids)}: {ids}"

import backtest.strategies.orb as orb

assert getattr(orb, "_NAUTILUS_AVAILABLE", False) is True, (
    "orb must see nautilus_trader available under the sim engine"
)
print("SIM_OK", len(ids))
'''

_NAUTILUS_CHILD = r'''
import backtest.sim as sim

from backtest.strategies import list_strategies

assert not sim.is_installed(), "the real engine must never install the shim"
ids = [row["id"] for row in list_strategies()]
assert len(ids) >= 18, f"expected >=18 strategies, got {len(ids)}: {ids}"
print("NAUTILUS_OK", len(ids))
'''


def test_default_engine_installs_shim():
    """No env var: sim is the default, and it must not need any external package."""
    proc = _run_child(_SIM_CHILD, engine=None)
    _assert_ok(proc, "default")
    assert "SIM_OK" in proc.stdout


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


@pytest.mark.skipif(not _NAUTILUS_INSTALLED, reason="nautilus_trader is not installed")
def test_nautilus_engine_uses_the_real_package_when_installed():
    proc = _run_child(_NAUTILUS_CHILD, engine="nautilus")
    _assert_ok(proc, "nautilus")
    assert "NAUTILUS_OK" in proc.stdout


@pytest.mark.skipif(_NAUTILUS_INSTALLED, reason="nautilus_trader is installed")
def test_nautilus_engine_fails_loudly_when_package_missing():
    """A missing package must be a named error, not silent unavailability."""
    proc = _run_child("import backtest.strategies", engine="nautilus")
    assert proc.returncode != 0, "nautilus engine without the package must fail"
    assert "requires nautilus_trader" in proc.stderr, (
        f"expected a named error in stderr, got:\n{proc.stderr}"
    )
