"""Tests for the bounded chart-pattern compute queue (chart_patterns/jobs.py)."""
import threading
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import jobs, store
from db.models.chart_patterns import PatternComputeJob


def _wait_for(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return pred()


@pytest.fixture
def cp_store(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()
    try:
        yield factory
    finally:
        jobs.reset()
        store.reset_session_factory()


def _seed_job(factory, job_id, status="queued"):
    session = factory()
    try:
        session.add(PatternComputeJob(
            id=job_id, universe="nifty50", timeframe="1D", status=status,
            total=0, done=0, failed=0, skipped=0,
        ))
        session.commit()
    finally:
        session.close()


def test_submit_transitions_and_persist(cp_store):
    started = threading.Event()
    release = threading.Event()

    def runner(job_id):
        started.set()
        release.wait(5)
        jobs.update_state(
            job_id, status="completed",
            finished_at=datetime.now(timezone.utc).isoformat(),
        )

    jobs.configure(max_workers=1, runner=runner)

    dto = jobs.submit("nifty50", "1D", requested_by=7, params={"force": False})
    assert dto["job_id"].startswith("cpj_")
    assert dto["status"] in ("queued", "running")

    assert started.wait(5)
    live = jobs.get_job(dto["job_id"])
    assert live["status"] == "running"
    assert live["requested_by"] == 7

    # persisted as running while in flight
    row = store.get_job(dto["job_id"])
    assert row is not None and row["status"] == "running"

    release.set()
    assert _wait_for(lambda: jobs.get_job(dto["job_id"])["status"] == "completed")
    assert store.get_job(dto["job_id"])["status"] == "completed"


def test_queue_full_raises(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=1, max_workers=1, runner=runner)
    jobs.submit("nifty50", "1D")

    # A *different* combo isn't coalesced, so it must hit the queue cap.
    with pytest.raises(jobs.QueueFullError):
        jobs.submit("nifty500", "1D")

    assert jobs.queue_size() == 1
    release.set()


def test_submit_coalesces_same_combo(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)
        jobs.update_state(job_id, status="completed")

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    first = jobs.submit("nifty50", "1D")
    again = jobs.submit("nifty50", "1D")

    assert again["job_id"] == first["job_id"], "same combo must coalesce"
    assert jobs.queue_size() == 1
    release.set()


def test_cancel_queued_job(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)
        jobs.update_state(job_id, status="completed")

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    jobs.submit("nifty50", "1D")  # occupies the single worker
    second = jobs.submit("nifty500", "1D")  # distinct combo stays queued

    assert jobs.get_job(second["job_id"])["status"] == "queued"
    cancelled = jobs.cancel(second["job_id"])
    assert cancelled["status"] == "cancelled"
    assert store.get_job(second["job_id"])["status"] == "cancelled"
    release.set()


def test_rehydrate_active_jobs(cp_store):
    _seed_job(cp_store, "cpj_rehydrate1", "queued")
    _seed_job(cp_store, "cpj_rehydrate2", "running")

    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=8, max_workers=1, runner=runner)
    count = jobs.rehydrate()

    assert count == 2
    assert _wait_for(lambda: jobs.get_job("cpj_rehydrate1")["status"] == "running")
    assert jobs.get_job("cpj_rehydrate2")["status"] in ("queued", "running")

    active_ids = {j["job_id"] for j in jobs.list_active()}
    assert {"cpj_rehydrate1", "cpj_rehydrate2"}.issubset(active_ids)
    release.set()


def test_get_job_falls_back_to_db(cp_store):
    _seed_job(cp_store, "cpj_dbonly", "completed")
    dto = jobs.get_job("cpj_dbonly")
    assert dto is not None
    assert dto["status"] == "completed"
    assert dto["universe"] == "nifty50"


# ---------------------------------------------------------------------------
# Missing coverage: scope-aware coalescing/supersede, running-cancel,
# queue-full accounting.
# ---------------------------------------------------------------------------


def test_scope_signature_defaults():
    assert jobs._scope_signature(None) == ((), None)
    assert jobs._scope_signature("not-a-dict") == ((), None)
    assert jobs._scope_signature({}) == ((), None)
    assert jobs._scope_signature({"symbols": ["B", "A"]}) == (("A", "B"), None)
    # No dedupe at this layer (the API normalizes before submit); sorting only.
    assert jobs._scope_signature({"symbols": ["B", "A", "B"]}) == (("A", "B", "B"), None)
    assert jobs._scope_signature({"lookback_bars": 250}) == ((), 250)


def test_same_scope_coalesces_no_new_slot(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D", params={"lookback_bars": 250})
        same = jobs.submit("nifty50", "1D", params={"lookback_bars": 250})
        assert same["job_id"] == first["job_id"]
        assert jobs.queue_size() == 1
    finally:
        release.set()


def test_scope_change_supersedes_and_cancels(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D", params={"lookback_bars": 250})
        changed = jobs.submit("nifty50", "1D", params={"lookback_bars": 500})
        assert changed["job_id"] != first["job_id"]
        assert jobs.get_job(first["job_id"])["status"] == "cancelled"
    finally:
        jobs.configure(max_queue=8, max_workers=3)
        release.set()


def test_symbol_scope_change_supersedes(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        scoped = jobs.submit("custom", "1D", params={"symbols": ["AAA"]})
        same = jobs.submit("custom", "1D", params={"symbols": ["AAA"]})
        assert same["job_id"] == scoped["job_id"]
        other = jobs.submit("custom", "1D", params={"symbols": ["BBB"]})
        assert other["job_id"] != scoped["job_id"]
        assert jobs.get_job(scoped["job_id"])["status"] == "cancelled"
    finally:
        jobs.configure(max_queue=8, max_workers=3)
        release.set()


def test_cancel_running_job_marks_cancelled(cp_store):
    started = threading.Event()
    release = threading.Event()

    def runner(job_id):
        started.set()
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        dto = jobs.submit("nifty50", "1D")
        assert started.wait(5)
        assert jobs.get_job(dto["job_id"])["status"] == "running"
        cancelled = jobs.cancel(dto["job_id"])
        assert cancelled["status"] == "cancelled"
        assert jobs.is_cancelled(dto["job_id"]) is True
    finally:
        release.set()


def test_cancel_unknown_returns_none(cp_store):
    jobs.configure(max_queue=4, max_workers=1, runner=lambda job_id: None)
    assert jobs.cancel("cpj_nope_missing") is None


def test_queue_full_counts_running_and_coalesced_bypasses(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=1, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D")
        # Same combo coalesces: no new slot, no QueueFullError.
        assert jobs.submit("nifty50", "1D")["job_id"] == first["job_id"]
        # A different combo needs a new slot: queue is full.
        with pytest.raises(jobs.QueueFullError):
            jobs.submit("nifty500", "1D")
        assert jobs.queue_size() == 1
    finally:
        jobs.configure(max_queue=8, max_workers=3)
        release.set()
