"""Breakout Watch background snapshot tests (``chart_patterns/watch.py``).

``refresh_snapshot`` / ``get_snapshot`` plus the lifespan task seam in
``api_server_fastapi``. ``arm`` / ``live`` are stubbed (no network, no DB);
the snapshot dict is isolated per test.
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, patch

import pytest

from chart_patterns import watch as watch_mod


@pytest.fixture
def snapshot_env(monkeypatch):
    """Isolated snapshot: empty in-memory dict, Redis mirror disabled."""
    monkeypatch.setattr(watch_mod, "_SNAPSHOT", {})
    monkeypatch.setattr(
        watch_mod, "_read_mirrored_snapshot", lambda key: (None, None)
    )
    monkeypatch.setattr(
        watch_mod, "_mirror_snapshot", lambda key, payload, ts: None
    )
    return watch_mod._SNAPSHOT


def _fake_arm(setup_id, *, universe=None, timeframe="1D", **kwargs):
    return [
        {
            "symbol": "AAA",
            "setup_id": setup_id,
            "trigger_level": 105.0,
            "invalidate_level": 95.0,
        }
    ]


def _fake_live(rows, *, min_rel_volume=0.7):
    return [{**r, "ltp": 106.0, "state": "triggered"} for r in rows]


def test_refresh_snapshot_builds_all_combos(monkeypatch, snapshot_env):
    """One payload per setup × universe × 1D, stored with the right shape."""
    seen: list = []

    def fake_arm(setup_id, *, universe=None, timeframe="1D", **kwargs):
        seen.append((setup_id, universe, timeframe))
        return _fake_arm(setup_id, universe=universe, timeframe=timeframe)

    def fake_live(rows, *, min_rel_volume=0.7):
        assert min_rel_volume == pytest.approx(
            watch_mod.SETUPS[rows[0]["setup_id"]]["default_min_rel_volume"]
        )
        return _fake_live(rows, min_rel_volume=min_rel_volume)

    monkeypatch.setattr(watch_mod, "arm", fake_arm)
    monkeypatch.setattr(watch_mod, "live", fake_live)

    assert watch_mod.refresh_snapshot() == len(watch_mod.SETUPS) * len(
        watch_mod._SNAPSHOT_UNIVERSES
    )
    assert sorted(seen) == sorted(
        (setup_id, universe, "1D")
        for setup_id in watch_mod.SETUPS
        for universe in watch_mod._SNAPSHOT_UNIVERSES
    )
    for setup_id in watch_mod.SETUPS:
        for universe in watch_mod._SNAPSHOT_UNIVERSES:
            payload = snapshot_env[(setup_id, universe, "1D")][0]
            assert set(payload) == {
                "setup", "min_rel_volume", "updated_at", "items",
            }
            assert payload["setup"] == setup_id
            assert payload["min_rel_volume"] == pytest.approx(
                watch_mod.SETUPS[setup_id]["default_min_rel_volume"]
            )
            assert payload["updated_at"]
            assert payload["items"][0]["state"] == "triggered"


def test_refresh_snapshot_skips_failing_combo(monkeypatch, snapshot_env):
    """One bad combo is logged + skipped; the rest still build. Never raises."""

    def fake_arm(setup_id, *, universe=None, timeframe="1D", **kwargs):
        if setup_id == "breakout" and universe == "nifty500":
            raise RuntimeError("store down")
        return _fake_arm(setup_id, universe=universe, timeframe=timeframe)

    monkeypatch.setattr(watch_mod, "arm", fake_arm)
    monkeypatch.setattr(watch_mod, "live", _fake_live)

    total = len(watch_mod.SETUPS) * len(watch_mod._SNAPSHOT_UNIVERSES)
    assert watch_mod.refresh_snapshot() == total - 1
    assert ("breakout", "nifty500", "1D") not in snapshot_env
    assert ("breakout", "nifty50", "1D") in snapshot_env


def test_get_snapshot_fresh_hit(monkeypatch, snapshot_env):
    monkeypatch.setattr(watch_mod, "arm", _fake_arm)
    monkeypatch.setattr(watch_mod, "live", _fake_live)
    assert watch_mod.refresh_snapshot() > 0

    payload = watch_mod.get_snapshot("breakout", universe="nifty500")
    assert payload["setup"] == "breakout"
    assert payload["items"][0]["symbol"] == "AAA"


def test_get_snapshot_missing_is_none(snapshot_env):
    assert snapshot_env == {}
    assert watch_mod.get_snapshot("breakout", universe="nifty500") is None
    assert watch_mod.get_snapshot("nope", universe="nifty500") is None


def test_get_snapshot_stale_is_none(monkeypatch, snapshot_env):
    monkeypatch.setattr(watch_mod, "arm", _fake_arm)
    monkeypatch.setattr(watch_mod, "live", _fake_live)
    assert watch_mod.refresh_snapshot() > 0

    key = ("breakout", "nifty500", "1D")
    payload, _ts = snapshot_env[key]
    snapshot_env[key] = (payload, time.monotonic() - 1000.0)  # older than 90s
    assert watch_mod.get_snapshot("breakout", universe="nifty500") is None
    # A generous window still serves the same entry.
    assert (
        watch_mod.get_snapshot(
            "breakout", universe="nifty500", max_age_seconds=3600
        ) is payload
    )


def test_get_snapshot_redis_mirror_fallback(monkeypatch, snapshot_env):
    """In-memory miss + fresh Redis mirror → payload (and re-cached)."""
    mirrored = {
        "setup": "breakout",
        "min_rel_volume": 0.7,
        "updated_at": "2026-10-06T00:00:00+05:30",
        "items": [],
    }
    ts = time.monotonic()
    monkeypatch.setattr(
        watch_mod, "_read_mirrored_snapshot", lambda key: (mirrored, ts)
    )
    payload = watch_mod.get_snapshot("breakout", universe="nifty500")
    assert payload is mirrored
    assert snapshot_env[("breakout", "nifty500", "1D")] == (mirrored, ts)


def test_get_snapshot_stale_mirror_is_none(monkeypatch, snapshot_env):
    """A stale Redis mirror is not served either."""
    monkeypatch.setattr(
        watch_mod,
        "_read_mirrored_snapshot",
        lambda key: ({"setup": "breakout"}, time.monotonic() - 1000.0),
    )
    assert watch_mod.get_snapshot("breakout", universe="nifty500") is None


async def test_run_watch_snapshot_once_returns_count(monkeypatch):
    from api_server_fastapi import run_watch_snapshot_once

    with patch(
        "chart_patterns.watch.refresh_snapshot", return_value=4
    ) as mock_refresh:
        assert await run_watch_snapshot_once() == 4
        mock_refresh.assert_called_once()


async def test_run_watch_snapshot_once_never_raises(monkeypatch):
    from api_server_fastapi import run_watch_snapshot_once

    with patch(
        "chart_patterns.watch.refresh_snapshot",
        side_effect=RuntimeError("boom"),
    ):
        assert await run_watch_snapshot_once() == 0


async def test_watch_snapshot_task_breaks_cleanly():
    """The lifespan task coroutine starts without error and exits on cancel
    (mirrors the week52 task test: first sleep raises → clean break)."""
    import asyncio

    from api_server_fastapi import watch_snapshot_task

    with patch(
        "api_server_fastapi._is_market_hours", return_value=False
    ), patch(
        "api_server_fastapi.asyncio.sleep", new_callable=AsyncMock
    ) as mock_sleep:
        async def fake_sleep(secs):
            raise asyncio.CancelledError()

        mock_sleep.side_effect = fake_sleep
        await watch_snapshot_task()  # CancelledError → break, no raise


async def test_watch_snapshot_task_refreshes_when_open():
    """Market open → one refresh per cycle via the off-loop seam."""
    import asyncio

    from api_server_fastapi import watch_snapshot_task

    calls = {"sleeps": 0}
    with patch(
        "api_server_fastapi._is_market_hours", return_value=True
    ), patch(
        "api_server_fastapi.asyncio.sleep", new_callable=AsyncMock
    ) as mock_sleep, patch(
        "api_server_fastapi.run_watch_snapshot_once",
        new_callable=AsyncMock,
        return_value=4,
    ) as mock_once:
        async def fake_sleep(secs):
            calls["sleeps"] += 1
            if calls["sleeps"] >= 2:
                raise asyncio.CancelledError()

        mock_sleep.side_effect = fake_sleep
        await watch_snapshot_task()
        mock_once.assert_called_once()
