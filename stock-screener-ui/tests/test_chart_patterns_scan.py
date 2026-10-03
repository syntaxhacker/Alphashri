"""Tests for chart_patterns/scan.py (job execution + progress counters)."""
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import jobs, scan, store

# Real detector hit dataclass (import proves the detector surface is wired).
from chart_patterns.detectors.common import PatternHit


def _make_df(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 120.0, n)
    return pd.DataFrame(
        {
            "open": base,
            "high": base + 1.0,
            "low": base - 1.0,
            "close": base,
            "volume": np.full(n, 1000.0),
        },
        index=idx,
    )


def _hit(symbol: str) -> PatternHit:
    return PatternHit(
        pattern_id="double_bottom",
        pattern_name="Double Bottom",
        family="reversal",
        direction="bullish",
        status="confirmed",
        quality="strong",
        confidence=70.0,
        start_date="2026-01-01",
        end_date="2026-02-01",
        start_price=100.0,
        end_price=110.0,
        breakout_level=110.0,
        target=120.0,
        stop=95.0,
        rr=2.0,
        bars_ago=1,
        volume_confirmed=True,
        trendlines=[[{"t": "2026-01-01", "price": 100.0}, {"t": "2026-02-01", "price": 110.0}]],
        notes="synthetic",
        symbol=symbol,
        timeframe="1D",
    )


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


@pytest.fixture
def patched_scan(monkeypatch):
    calls = {"fetch": [], "detect": []}

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None):
        calls["fetch"].append(symbol)
        if symbol == "BBB":
            return None  # fetch failure
        if symbol == "CCC":
            return _make_df(5)  # below min_bars -> skipped
        return _make_df(80)

    def fake_detect(df, timeframe, symbol):
        calls["detect"].append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB", "CCC"]))
    return calls


def test_run_job_persists_hits_and_progress(cp_store, patched_scan):
    job_id = "cpj_scan_test"
    store.save_job({"job_id": job_id, "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job(job_id)

    row = store.get_job(job_id)
    assert row["status"] == "completed"
    assert row["total"] == 3
    assert row["done"] == 3
    assert row["failed"] == 1   # BBB returned None
    assert row["skipped"] == 1  # CCC had too few bars
    assert row["data_through"] is not None
    assert row["finished_at"] is not None

    items, total, summary = store.query_results({"job_id": job_id})
    assert total == 1
    assert items[0]["symbol"] == "AAA"
    assert items[0]["pattern_id"] == "double_bottom"
    assert items[0]["status"] == "confirmed"
    assert items[0]["trendlines"][0][0]["price"] == 100.0
    assert summary["confirmed"] == 1
    assert summary["bullish"] == 1
    # detect only ran for the symbol with enough bars
    assert patched_scan["detect"] == ["AAA"]


def test_run_job_universe_error_marks_failed(cp_store, monkeypatch):
    def boom(_uid):
        raise RuntimeError("no universe")

    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=boom))
    job_id = "cpj_scan_fail"
    store.save_job({"job_id": job_id, "universe": "nope", "timeframe": "1D", "status": "queued"})

    scan.run_job(job_id)

    row = store.get_job(job_id)
    assert row["status"] == "failed"
    assert "no universe" in (row["error"] or "")


def test_run_job_per_symbol_detector_error_does_not_abort(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None: _make_df(80),
    )

    def flaky(df, timeframe, symbol):
        if symbol == "AAA":
            raise ValueError("detector blew up")
        return [_hit(symbol)]

    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=flaky))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB"]))

    job_id = "cpj_scan_partial"
    store.save_job({"job_id": job_id, "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_job(job_id)

    row = store.get_job(job_id)
    assert row["status"] == "completed"
    assert row["failed"] == 1
    assert row["done"] == 2
    items, total, _ = store.query_results({"job_id": job_id})
    assert total == 1
    assert items[0]["symbol"] == "BBB"
