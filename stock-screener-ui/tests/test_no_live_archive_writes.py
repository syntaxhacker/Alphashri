"""Regression guard: tests must never append into the live signal archive.

Background: two swing-emitter tests called ``run_once`` without an explicit
signal root and wrote fixture values into ``india_board/data/signals/`` — which
would poison the EV evaluation with numbers that never came from the market.

These tests prove the emitters redirect to a temp root under pytest, for both
the P1-P4 and the P5-P7 modules, and that the live archive stays untouched.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "india_board" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import signal_emitters as se  # noqa: E402
import signal_emitters_swing as swing  # noqa: E402
import signal_log  # noqa: E402

LIVE_ARCHIVE = Path(__file__).resolve().parent.parent / "india_board" / "data" / "signals"


def _live_archive_snapshot() -> dict:
    if not LIVE_ARCHIVE.exists():
        return {}
    return {
        p.name: (p.stat().st_size, p.stat().st_mtime_ns)
        for p in LIVE_ARCHIVE.glob("*.jsonl")
    }


def test_pytest_signal_root_is_redirected_under_pytest():
    # PYTEST_CURRENT_TEST is set while a test runs, so both guards must engage.
    root = se._pytest_signal_root()
    assert root is not None and root != LIVE_ARCHIVE
    assert "india_board_test_signals" in str(root)
    root2 = swing._pytest_signal_root()
    assert root2 is not None and root2 != LIVE_ARCHIVE


def test_p14_run_once_without_root_never_touches_live_archive(tmp_path, monkeypatch):
    before = _live_archive_snapshot()
    # No signal_root argument on purpose: the guard must redirect it.
    counts = se.run_once(tickers=["NIFTY"], enrich=False, oi_root=tmp_path / "oi_flow")
    assert set(counts) == {"P1", "P2", "P3", "P4"}
    assert _live_archive_snapshot() == before


def test_p57_emitters_never_touch_live_archive(tmp_path, monkeypatch):
    before = _live_archive_snapshot()
    monkeypatch.setattr(signal_log, "DATA_DIR", tmp_path / "signals")
    monkeypatch.setattr(swing, "_default_rollover_fn", lambda t: {"rollover": None, "basis": None})
    monkeypatch.setattr(swing, "_default_greeks_fn", lambda t: {})
    swing.reset_ledger()
    swing.run_once(["NIFTY"], scan={"sections": {}})
    assert _live_archive_snapshot() == before
