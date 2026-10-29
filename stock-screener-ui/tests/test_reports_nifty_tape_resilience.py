"""The Nifty tape recorder must SURVIVE an upstream failure.

On 2026-10-22 the Upstox token 401'd at 13:23 and the tape stopped: the
recorder's failure was swallowed with no log, no retry and no restart, so the
burst feed, the structure evidence and the desk watchers went blind for ten
minutes (and an API restart was the only way back).

These tests pin the three properties that fix it:
  1. a failing chain fetch is logged, journalled and retried on the next tick;
  2. the recorder task is never killed by a tick failure;
  3. a dead recorder is restarted by the watchdog.
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

import config
import api.reports_api.nifty as nifty


def _fake_report() -> dict:
    return {
        "expiry": "2026-10-13", "spot": 25000.0,
        "pcr_oi": 1.92, "pcr_vol": 1.21, "max_pain": 25000.0,
        "walls": {"calls": [{"strike": 25000.0, "oi": 1000}],
                  "puts": [{"strike": 25000.0, "oi": 2000}]},
        "gex": {"zero_cross": 25100.0},
        "strikes": [
            {"strike": 25000.0,
             "ce": {"oi": 1000, "volume": 5000},
             "pe": {"oi": 2000, "volume": 6000}},
            {"strike": 25100.0,
             "ce": {"oi": 200, "volume": 200},
             "pe": {"oi": 300, "volume": 300}},
        ],
    }


@pytest.fixture()
def _tmp_tape(tmp_path, monkeypatch):
    """Redirect every tape write into tmp_path (never the real tape dir)."""
    monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path)
    monkeypatch.setattr(nifty, "SNAPSHOT_LOG_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path / "day_snapshots")
    monkeypatch.setattr(
        nifty, "_compute_sensex_live",
        AsyncMock(side_effect=RuntimeError("no sensex in tests")), raising=False)
    nifty._sensex_cache.clear()
    nifty._GAP_MINUTES.clear()
    yield tmp_path
    nifty._sensex_cache.clear()
    nifty._GAP_MINUTES.clear()


@pytest.fixture()
def _reset_recorder_state():
    """The recorder's module state is global — snapshot and restore it."""
    saved = (nifty._tape_task, nifty._tape_loop, nifty._tape_last_error,
             nifty._tape_last_skip, nifty._tape_failure_streak)
    nifty._tape_task = None
    nifty._tape_loop = None
    nifty._tape_last_error = None
    nifty._tape_last_skip = None
    nifty._tape_failure_streak = 0
    yield
    task, loop, err, skip, streak = saved
    nifty._tape_task = task
    nifty._tape_loop = loop
    nifty._tape_last_error = err
    nifty._tape_last_skip = skip
    nifty._tape_failure_streak = streak


def _today() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d")


class TestTickFailureIsSurvivable:
    async def test_a_failing_chain_fetch_is_logged_and_journalled(
            self, _tmp_tape, caplog):
        """A 401 must leave a trace: log line + gap-journal entry."""
        with patch.object(nifty, "_compute_live",
                          AsyncMock(side_effect=RuntimeError("401 Unauthorized"))):
            with caplog.at_level("WARNING", logger="api.reports_api.nifty"):
                assert await nifty.record_nifty_tape_tick() is None
        assert "chain fetch failed" in caplog.text
        assert "401" in caplog.text
        # The journal says WHICH minute was lost and WHY.
        entries = [__import__("json").loads(line) for line in
                   (nifty.gap_log_path(_today())).read_text().splitlines()
                   if line.strip()]
        assert entries, "the failed minute was not journalled"
        assert entries[-1]["reason"] == "chain-failed"
        assert "401" in entries[-1].get("detail", "")
        # The status endpoint must be able to explain the hole.
        assert "401" in (nifty._tape_last_error or "")

    async def test_the_next_tick_writes_after_a_failure(self, _tmp_tape):
        """The failure is a bad MINUTE — the recorder carries on."""
        calls = {"n": 0}

        async def flaky(*_a, **_k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("401 Unauthorized")
            return _fake_report()

        with patch.object(nifty, "_compute_live", AsyncMock(side_effect=flaky)):
            assert await nifty.record_nifty_tape_tick() is None
            row = await nifty.record_nifty_tape_tick()
        assert row is not None, "the recorder did not recover on the next tick"
        assert row["spot"] == 25000.0

    async def test_the_recorder_loop_survives_a_failing_tick(
            self, _tmp_tape, _reset_recorder_state):
        """The task keeps its schedule: a bad minute never ends it."""
        calls = {"n": 0}

        async def flaky(*_a, **_k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("401 Unauthorized")
            return _fake_report()

        with patch.object(nifty, "_compute_live", AsyncMock(side_effect=flaky)), \
                patch("trading.utils.is_market_open", return_value=True):
            task = asyncio.create_task(nifty.start_nifty_tape_task(poll_sec=0.05))
            try:
                await asyncio.sleep(0.6)
                assert not task.done(), "the recorder died on a chain failure"
            finally:
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
        assert calls["n"] >= 2, "the recorder stopped ticking after the failure"
        rows = nifty.read_tape(_today())
        assert rows, "no tape row was written after the recovery"
        assert nifty._tape_iterations >= 2


class TestRecorderWatchdog:
    async def test_a_dead_recorder_is_restarted(self, _reset_recorder_state,
                                                 monkeypatch):
        """A task that died is replaced — the tape never stays blind."""
        started = asyncio.Event()

        async def stub():
            started.set()
            await asyncio.sleep(3600)

        monkeypatch.setattr(nifty, "start_nifty_tape_task", stub)
        dead = asyncio.create_task(asyncio.sleep(0))
        await dead
        nifty._tape_task = dead
        nifty._ensure_tape_task()
        await asyncio.wait_for(started.wait(), timeout=2)
        assert nifty._tape_task is not dead
        assert not nifty._tape_task.done()
        nifty._tape_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await nifty._tape_task

    async def test_the_watchdog_is_a_no_op_while_the_recorder_runs(
            self, _reset_recorder_state, monkeypatch):
        started = {"n": 0}

        async def stub():
            started["n"] += 1
            await asyncio.sleep(3600)

        monkeypatch.setattr(nifty, "start_nifty_tape_task", stub)
        live = asyncio.create_task(stub())
        nifty._tape_task = live
        nifty._ensure_tape_task()
        await asyncio.sleep(0)
        assert started["n"] == 1, "a second recorder was started"
        live.cancel()
        with pytest.raises(asyncio.CancelledError):
            await live
