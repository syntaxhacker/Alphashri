"""The screener prewarm must not fire all six screeners in one burst.

Unstaggered, the loop ran every screener back to back: six TradingView fetches
plus up to 6 x MAX_WORKERS(20) = 120 threads in the same tick, every ~4 minutes
(fresh_ttl 300 - PREWARM_INTERVAL 60). That burst is why an unrelated
`/api/market/snapshot` measured ~500ms during market hours.

These tests pin the loop's shape, not its wall-clock timing. Importing
`api_server_fastapi` builds the app, so it is imported once via the session
fixture and never reloaded.
"""

import pytest

import api_server_fastapi as server


def test_stagger_is_configurable_and_positive_by_default():
    # A zero stagger would reintroduce the burst; the default must spread.
    assert server.PREWARM_STAGGER_SEC > 0
    assert server.PREWARM_STAGGER_SEC <= server.PREWARM_INTERVAL


def test_interval_is_read_from_the_environment():
    """The loop's cadence must be tunable without a code change."""
    import os

    source = open(server.__file__, encoding="utf-8").read()
    assert 'os.environ.get("PREWARM_INTERVAL_SEC"' in source
    assert 'os.environ.get("PREWARM_STAGGER_SEC"' in source


@pytest.mark.asyncio
async def test_screeners_are_separated_by_the_stagger():
    """Six screeners must produce five waits between them, not one burst."""
    sleeps: list[float] = []
    computes: list[str] = []

    async def fake_compute(provider, mode, screener, filters):
        computes.append(screener)
        return {"screener": screener}

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        # One full pass = every screener computed once; stop before looping.
        if len(computes) >= len(server.PREWARM_SCREENERS):
            raise KeyboardInterrupt

    async def fake_revalidate(key, fn, **kwargs):
        return await fn(), "computed"

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(server, "_is_market_hours", lambda: True)
        mp.setattr(server.asyncio, "sleep", fake_sleep)
        mp.setattr(server, "_compute_screener", fake_compute)
        mp.setattr(server, "cache_ttl", lambda key: None, raising=False)
        mp.setattr("cache.redis_client.make_cache_key", lambda *a: "k")
        mp.setattr("cache.redis_client.stale_while_revalidate", fake_revalidate)
        with pytest.raises(KeyboardInterrupt):
            await server.screener_prewarm_task()

    n = len(server.PREWARM_SCREENERS)
    stagger_waits = [s for s in sleeps if s == server.PREWARM_STAGGER_SEC]
    assert len(stagger_waits) == n - 1, f"expected {n - 1} stagger waits, got {len(stagger_waits)}"
    assert computes == list(server.PREWARM_SCREENERS)
