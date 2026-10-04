"""Store-level tests for chart-pattern persistence (chart_patterns/store.py).

Covers the save/query round-trip (including scan-time ``trend_lines`` /
``trend_lines_sig``), cross-job dedupe, LIKE escaping, and job helpers.
Uses the in-memory ``test_db_engine`` fixture — no ``*.db`` files.
"""
import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import store


@pytest.fixture
def cp_store(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    try:
        yield factory
    finally:
        store.reset_session_factory()


def _hit(symbol="AAA", **overrides):
    hit = {
        "symbol": symbol,
        "name": f"{symbol} Co",
        "timeframe": "1D",
        "pattern_id": "falling_wedge",
        "pattern_name": "Falling Wedge",
        "family": "reversal",
        "direction": "bullish",
        "status": "confirmed",
        "quality": "strong",
        "confidence": 78.4,
        "start_date": "2026-04-26",
        "end_date": "2026-09-26",
        "start_price": 129.8,
        "end_price": 112.6,
        "breakout_level": 112.6,
        "target": 129.6,
        "stop": 102.5,
        "rr": 1.7,
        "bars_ago": 1,
        "volume_confirmed": True,
        "trendlines": [],
        "notes": "synthetic",
    }
    hit.update(overrides)
    return hit


def _line(kind="support"):
    return {
        "kind": kind,
        "start_date": "2026-01-01T00:00:00+00:00",
        "start_price": 100.0,
        "end_date": "2026-02-01T00:00:00+00:00",
        "end_price": 110.0,
        "slope": 0.2,
        "touches": 3,
        "span_bars": 30,
        "violations": 0,
    }


def test_save_query_round_trip_fields(cp_store):
    store.save_job({"job_id": "cpj_s1", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    assert store.save_hits("cpj_s1", [_hit()]) == 1

    items, total, summary = store.query_results({"job_id": "cpj_s1"})

    assert total == 1
    item = items[0]
    assert item["symbol"] == "AAA"
    assert item["pattern_id"] == "falling_wedge"
    assert item["confidence"] == 78.4
    assert item["job_id"] == "cpj_s1"
    assert summary["patterns"] == 1
    assert summary["confirmed"] == 1


def test_trend_lines_and_sig_round_trip(cp_store):
    store.save_job({"job_id": "cpj_s2", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    lines = [_line("support"), _line("resistance")]
    store.save_hits("cpj_s2", [_hit(trend_lines=lines, trend_lines_sig="sig-123")])

    items, total, _ = store.query_results({"job_id": "cpj_s2"})

    assert total == 1
    assert items[0]["trend_lines"] == lines
    assert items[0]["trend_lines_sig"] == "sig-123"


def test_blank_trend_lines_yield_empty_and_none_sig(cp_store):
    store.save_job({"job_id": "cpj_s3", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_s3", [_hit()])

    items, total, _ = store.query_results({"job_id": "cpj_s3"})

    assert total == 1
    assert items[0]["trend_lines"] == []
    assert items[0]["trend_lines_sig"] is None


def test_dedupe_across_jobs_unfiltered(cp_store):
    store.save_job({"job_id": "cpj_d1", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_d1", [_hit()])
    store.save_job({"job_id": "cpj_d2", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_d2", [_hit()])

    items, total, summary = store.query_results({})

    assert total == 1
    assert items[0]["job_id"] == "cpj_d2"
    assert summary["patterns"] == 1


def test_explicit_job_filter_keeps_both_rows(cp_store):
    store.save_job({"job_id": "cpj_d3", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_d3", [_hit()])
    store.save_job({"job_id": "cpj_d4", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_d4", [_hit()])

    _, total_d3, _ = store.query_results({"job_id": "cpj_d3"})
    _, total_d4, _ = store.query_results({"job_id": "cpj_d4"})
    assert total_d3 == 1
    assert total_d4 == 1


def test_like_escaping_percent_underscore_backslash(cp_store):
    store.save_job({"job_id": "cpj_q", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_q", [
        _hit("AAA"),
        _hit("A%B"),
        _hit("A_B"),
        _hit("A\\B"),
    ])

    _, total_pct, _ = store.query_results({"job_id": "cpj_q", "q": "%"})
    assert total_pct == 1
    _, total_us, _ = store.query_results({"job_id": "cpj_q", "q": "_"})
    assert total_us == 1
    _, total_bs, _ = store.query_results({"job_id": "cpj_q", "q": "\\"})
    assert total_bs == 1

    items, total, _ = store.query_results({"job_id": "cpj_q", "q": "A%B"})
    assert total == 1
    assert items[0]["symbol"] == "A%B"


def test_delete_hits_for_keeps_current_job(cp_store):
    store.save_job({"job_id": "cpj_old", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_old", [_hit("AAA")])
    store.save_job({"job_id": "cpj_new", "universe": "nifty50", "timeframe": "1D", "status": "running"})
    store.save_hits("cpj_new", [_hit("BBB")])

    assert store.delete_hits_for("nifty50", "1D", keep_job_id="cpj_new") == 1

    _, total_old, _ = store.query_results({"job_id": "cpj_old"})
    _, total_new, _ = store.query_results({"job_id": "cpj_new"})
    assert total_old == 0
    assert total_new == 1


def test_latest_completed_job_returns_newest(cp_store):
    store.save_job({
        "job_id": "cpj_old_c", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "finished_at": "2026-09-20T10:00:00",
    })
    store.save_job({
        "job_id": "cpj_new_c", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "finished_at": "2026-09-30T10:00:00",
    })

    latest = store.latest_completed_job("nifty50", "1D")

    assert latest is not None
    assert latest["job_id"] == "cpj_new_c"
    assert store.latest_completed_job("nifty50", "15m") is None


def test_save_job_round_trip_params(cp_store):
    dto = store.save_job({
        "job_id": "cpj_p", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True, "lookback_bars": 250},
    })
    assert dto["params"] == {"force": True, "lookback_bars": 250}

    row = store.get_job("cpj_p")
    assert row["params"] == {"force": True, "lookback_bars": 250}
