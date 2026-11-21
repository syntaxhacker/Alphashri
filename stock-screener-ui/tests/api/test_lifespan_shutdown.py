"""Regression: every background task started by the API lifespan must be
cancelled on shutdown. Five recorder/poller tasks were started but never
cancelled, leaving threads (notably SEC EDGAR's 30s request) running past
``asyncio.run`` shutdown and hanging 131 lifespans in a single pytest file.
"""

import ast
import asyncio
from pathlib import Path

import pytest

import api_server_fastapi as mod

MISSED_TASKS = (
    "_event_radar_task",
    "_nifty_futures_task",
    "_sensex_futures_task",
    "_options_recorder_task",
    "_tick_tape_task",
)


class _FakeTask:
    """Awaitable task double that records cancel() calls without real work."""

    def __init__(self):
        self.cancel_calls = 0
        self._done = False

    def cancel(self):
        self.cancel_calls += 1
        self._done = True
        return True

    def done(self):
        return self._done

    def __await__(self):
        async def _resolve():
            return None

        return _resolve().__await__()


def test_shutdown_helper_cancels_every_task():
    fakes = [_FakeTask() for _ in MISSED_TASKS]
    asyncio.run(mod._shutdown_cancel_and_wait(*fakes, timeout=1))
    assert all(f.cancel_calls == 1 for f in fakes)


def test_lifespan_shutdown_references_all_five_missed_tasks():
    source = Path(mod.__file__).read_text()
    tree = ast.parse(source)
    lifespan = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "lifespan"
    )
    yield_line = next(node.lineno for node in ast.walk(lifespan) if isinstance(node, ast.Yield))
    shutdown_source = "\n".join(source.splitlines()[yield_line:])
    for name in MISSED_TASKS:
        assert name in shutdown_source, f"{name} is not referenced in lifespan shutdown"
