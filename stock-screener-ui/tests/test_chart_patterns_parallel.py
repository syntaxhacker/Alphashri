"""Universe-scale executor tests (``chart_patterns/parallel.py``).

No I/O, no DB, no network. Process-mode tests use real worker processes
with module-level (picklable) functions only.
"""

from __future__ import annotations

import os

from chart_patterns import parallel as par


def _shout(symbol: str) -> str:
    """Top-level picklable worker: upper-case + bang."""
    return f"{str(symbol).upper()}!"


def _boom_on_b(symbol: str):
    """Top-level picklable worker that fails on one input."""
    if str(symbol).upper() == "B":
        raise RuntimeError("bad b")
    return str(symbol).upper()


def test_max_workers_bounds():
    assert 1 <= par.max_workers() <= 8
    assert par.max_workers(cap=2) <= 2
    assert par.max_workers(cap=0) >= 1
    assert par.max_workers() == min(os.cpu_count() or 1, 8)


def test_supports_processes_is_fork_check():
    assert par.supports_processes() == hasattr(os, "fork")


def test_run_symbols_empty():
    assert par.run_symbols(_shout, []) == []
    assert par.run_symbols_with_mode(_shout, []) == ([], "sequential")


def test_run_symbols_sequential_order():
    syms = ["aaa", "BBB", "c"]
    assert par.run_symbols(_shout, syms, workers=1) == ["AAA!", "BBB!", "C!"]
    values, mode = par.run_symbols_with_mode(_shout, syms, workers=1)
    assert (values, mode) == (["AAA!", "BBB!", "C!"], "sequential")


def test_run_symbols_threads_order():
    syms = [f"S{i:02d}" for i in range(12)]
    assert par.run_symbols(_shout, syms, workers=4, use_processes=False) == [
        f"{s}!" for s in syms
    ]
    values, mode = par.run_symbols_with_mode(_shout, syms, workers=4, use_processes=False)
    assert mode == "threads"
    assert values == [f"{s}!" for s in syms]


def test_run_symbols_processes_order():
    """Real multi-core run: results still in input order."""
    syms = [f"P{i:02d}" for i in range(8)]
    values, mode = par.run_symbols_with_mode(_shout, syms, workers=2, use_processes=True)
    assert values == [f"{s}!" for s in syms]
    assert mode in ("processes", "threads")  # fallback accepted, order required


def test_run_symbols_auto_small_is_threads():
    syms = [f"A{i}" for i in range(5)]
    values, mode = par.run_symbols_with_mode(_shout, syms)
    assert mode == "threads"
    assert values == [f"{s}!" for s in syms]


def test_run_symbols_auto_large_prefers_processes():
    """~200 symbols auto-pick processes on fork platforms, threads elsewhere."""
    syms = [f"L{i:03d}" for i in range(210)]
    values, mode = par.run_symbols_with_mode(_shout, syms)
    assert values == [f"{s}!" for s in syms]
    assert mode == ("processes" if par.supports_processes() else "threads")


def test_run_symbols_process_pool_failure_falls_back(monkeypatch):
    """A broken process pool degrades to threads/sequential, never raises."""
    def _raise(*args, **kwargs):
        raise RuntimeError("no fork today")

    monkeypatch.setattr(par, "ProcessPoolExecutor", _raise)
    syms = [f"F{i}" for i in range(6)]
    values, mode = par.run_symbols_with_mode(_shout, syms, workers=2, use_processes=True)
    assert values == [f"{s}!" for s in syms]
    assert mode in ("threads", "sequential")


def test_run_symbols_all_pools_broken_still_returns(monkeypatch):
    """Both pools broken: sequential fallback still delivers, never raises."""
    def _raise(*args, **kwargs):
        raise RuntimeError("no pools today")

    monkeypatch.setattr(par, "ProcessPoolExecutor", _raise)
    monkeypatch.setattr(par, "ThreadPoolExecutor", _raise)
    syms = ["x", "y"]
    assert par.run_symbols(_shout, syms, workers=4, use_processes=True) == ["X!", "Y!"]
    values, mode = par.run_symbols_with_mode(_shout, syms, workers=4, use_processes=True)
    assert mode == "sequential"
    assert values == ["X!", "Y!"]


def test_run_symbols_item_exception_becomes_none():
    """A failing item is ``None`` at its position; siblings unaffected."""
    assert par.run_symbols(_boom_on_b, ["a", "B", "c"], workers=1) == ["A", None, "C"]
    assert par.run_symbols(
        _boom_on_b, ["a", "B", "c"], workers=3, use_processes=False
    ) == ["A", None, "C"]
