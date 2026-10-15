"""Tests for the SSE alert bus (`api/reports_api/nifty_stream.py`).

Pure/state-only: no network, no tape, no event loop needed except where noted.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from api.reports_api import nifty_stream as stream


@pytest.fixture(autouse=True)
def _clean():
    stream._reset_state()
    stream._subscribers.clear()
    yield
    stream._reset_state()
    stream._subscribers.clear()


def _ev(eid, kind="burst"):
    return {"id": eid, "type": kind, "t": "2026-10-14T14:20:00+05:30", "side": "call"}


class TestPublish:
    def test_publishes_new_events_and_dedupes_by_id(self):
        assert stream.publish([_ev("a"), _ev("b")]) == 2
        # re-publishing the same ids pushes nothing
        assert stream.publish([_ev("a"), _ev("b")]) == 0
        assert stream.publish([_ev("c")]) == 1

    def test_events_without_an_id_are_ignored(self):
        assert stream.publish([{"type": "burst"}]) == 0

    def test_empty_publish_is_a_noop(self):
        assert stream.publish([]) == 0
        assert stream.publish(None) == 0

    def test_recent_events_returns_the_tail_newest_last(self):
        stream.publish([_ev("a"), _ev("b"), _ev("c")])
        assert [e["id"] for e in stream.recent_events(2)] == ["b", "c"]
        assert stream.recent_events(0) == []

    def test_retention_is_bounded(self):
        for i in range(stream.MAX_EVENTS + 50):
            stream.publish([_ev(f"e{i}")])
        assert len(stream.recent_events(stream.MAX_EVENTS + 10)) == stream.MAX_EVENTS

    def test_dedupe_set_is_pruned_not_unbounded(self):
        for i in range(stream.MAX_EVENTS * 6):
            stream.publish([_ev(f"e{i}")])
        assert len(stream._seen_ids) <= stream.MAX_EVENTS * 4


class TestSubscribers:
    @pytest.mark.asyncio
    async def test_subscriber_receives_published_events(self):
        q = stream.subscribe()
        try:
            stream.publish([_ev("a")])
            event = await asyncio.wait_for(q.get(), timeout=1)
            assert event["id"] == "a"
        finally:
            stream.unsubscribe(q)

    @pytest.mark.asyncio
    async def test_unsubscribe_stops_delivery(self):
        q = stream.subscribe()
        stream.unsubscribe(q)
        stream.publish([_ev("a")])
        assert q.empty()

    @pytest.mark.asyncio
    async def test_a_full_client_queue_never_blocks_the_publisher(self):
        q = stream.subscribe()
        try:
            for i in range(q.maxsize):
                q.put_nowait(_ev(f"fill{i}"))
            # must not raise even though the queue is full
            assert stream.publish([_ev("overflow")]) == 1
        finally:
            stream.unsubscribe(q)


class TestPayload:
    def test_sse_frame_is_data_prefixed_and_double_newline_terminated(self):
        payload = stream.sse_payload(_ev("a"))
        assert payload.startswith("data: ")
        assert payload.endswith("\n\n")
        assert json.loads(payload[len("data: "):-2])["id"] == "a"

    def test_payload_is_json_safe_for_non_serialisable_values(self):
        import datetime
        payload = stream.sse_payload({"id": "a", "when": datetime.datetime(2026, 10, 14)})
        json.loads(payload[len("data: "):-2])  # must not raise


class TestCollect:
    def test_collect_returns_events_that_can_be_published(self):
        rows = [{"t": "2026-10-14T14:20:00+05:30", "spot": 22700,
                 "call_doi": 0, "put_doi": 0, "call_tick": 0, "put_tick": 0}]
        # a bare row yields nothing, but must not raise
        assert stream._collect(rows) == []

    def test_collect_survives_a_broken_detector(self, monkeypatch):
        """One detector blowing up must not stop the others."""
        import api.reports_api.nifty_bursts as nb
        monkeypatch.setattr(nb, "detect_oi_bursts",
                            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
        assert stream._collect([{"t": "x"}]) == []


class TestWatchTaskGate:
    @pytest.mark.asyncio
    async def test_out_of_hours_the_watcher_does_not_scan(self, monkeypatch):
        """Market shut -> no tape read, no publish (just a sleep)."""
        import api.reports_api.nifty as nifty
        calls = {"read": 0}
        monkeypatch.setattr(nifty, "read_tape",
                            lambda *a, **k: calls.__setitem__("read", calls["read"] + 1) or [])
        monkeypatch.setattr("trading.utils.is_market_open", lambda: False)

        task = asyncio.create_task(stream.nifty_burst_watch_task(interval_sec=0.01))
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert calls["read"] == 0
