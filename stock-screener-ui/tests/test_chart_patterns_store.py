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


def test_dedupe_collapses_pattern_redetected_with_new_end(cp_store):
    """The same pattern re-detected a bar later (different end_date) is one row."""
    store.save_job({"job_id": "cpj_e1", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_e1", [_hit("AAA", end_date="2026-09-25")])
    store.save_job({"job_id": "cpj_e2", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_e2", [_hit("AAA", end_date="2026-09-26")])

    items, total, summary = store.query_results({})

    assert total == 1
    assert items[0]["end_date"] == "2026-09-26"  # newest instance wins
    assert items[0]["job_id"] == "cpj_e2"
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


def test_delete_hits_for_isolates_universes_same_timeframe(cp_store):
    """Superseding one universe must never wipe another scope's results."""
    store.save_job({"job_id": "cpj_n50_old", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_n50_old", [_hit("AAA")])
    store.save_job({"job_id": "cpj_n50_keep", "universe": "nifty50", "timeframe": "1D", "status": "running"})
    store.save_hits("cpj_n50_keep", [_hit("BBB")])
    store.save_job({"job_id": "cpj_n500", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_n500", [_hit("CCC")])
    store.save_job({"job_id": "cpj_custom", "universe": "custom", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_custom", [_hit("DDD")])

    assert store.delete_hits_for("nifty50", "1D", keep_job_id="cpj_n50_keep") == 1

    _, total_old, _ = store.query_results({"job_id": "cpj_n50_old"})
    _, total_keep, _ = store.query_results({"job_id": "cpj_n50_keep"})
    _, total_n500, _ = store.query_results({"job_id": "cpj_n500"})
    _, total_custom, _ = store.query_results({"job_id": "cpj_custom"})
    assert total_old == 0
    assert total_keep == 1
    assert total_n500 == 1
    assert total_custom == 1


def test_delete_hits_for_isolates_timeframes_same_universe(cp_store):
    """A 1D supersede must leave the same universe's 15m rows intact."""
    store.save_job({"job_id": "cpj_n50_1d", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_n50_1d", [_hit("AAA")])
    store.save_job({"job_id": "cpj_n50_15m", "universe": "nifty50", "timeframe": "15m", "status": "completed"})
    store.save_hits("cpj_n50_15m", [_hit("BBB", timeframe="15m")])

    assert store.delete_hits_for("nifty50", "1D") == 1

    _, total_1d, _ = store.query_results({"job_id": "cpj_n50_1d"})
    _, total_15m, _ = store.query_results({"job_id": "cpj_n50_15m"})
    assert total_1d == 0
    assert total_15m == 1


def test_delete_hits_for_no_matching_jobs_is_noop(cp_store):
    store.save_job({"job_id": "cpj_keep", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_keep", [_hit("AAA")])

    assert store.delete_hits_for("nope_universe", "1D") == 0
    assert store.delete_hits_for("nifty50", "15m") == 0

    _, total, _ = store.query_results({"job_id": "cpj_keep"})
    assert total == 1


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


def _seed_52w_ranges(cp_store, rows):
    """Seed ``stock_52w_range`` rows: ``[(symbol, high_52w, close), ...]``."""
    from db.models.stock_52w_touch import Stock52WeekRange

    session = cp_store()
    try:
        for symbol, high, close in rows:
            session.merge(Stock52WeekRange(
                symbol=symbol, high_52w=high, low_52w=close, close=close,
            ))
        session.commit()
    finally:
        session.close()


def test_max_52w_gap_filters_to_near_high(cp_store):
    # NEAR gap = (100-98)/100*100 = 2.0; FAR gap = (100-50)/100*100 = 50.0.
    _seed_52w_ranges(cp_store, [("NEAR", 100.0, 98.0), ("FAR", 100.0, 50.0)])
    store.save_job({"job_id": "cpj_52w", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_52w", [_hit("NEAR"), _hit("FAR")])

    items, total, summary = store.query_results({"job_id": "cpj_52w", "max_52w_gap": 3})

    assert total == 1
    assert items[0]["symbol"] == "NEAR"
    assert items[0]["to_52w_high"] == 2.0
    assert summary["patterns"] == 1


def test_max_52w_gap_absent_returns_both_with_gaps(cp_store):
    _seed_52w_ranges(cp_store, [("NEAR", 100.0, 98.0), ("FAR", 100.0, 50.0)])
    store.save_job({"job_id": "cpj_52w2", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_52w2", [_hit("NEAR"), _hit("FAR")])

    items, total, _ = store.query_results({"job_id": "cpj_52w2"})

    assert total == 2
    gaps = {item["symbol"]: item["to_52w_high"] for item in items}
    assert gaps == {"NEAR": 2.0, "FAR": 50.0}


def test_symbol_without_52w_row_has_none_gap_and_is_excluded(cp_store):
    _seed_52w_ranges(cp_store, [("NEAR", 100.0, 98.0)])
    store.save_job({"job_id": "cpj_52w3", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_52w3", [_hit("NEAR"), _hit("NOROW")])

    items, total, _ = store.query_results({"job_id": "cpj_52w3"})
    assert total == 2
    assert next(i for i in items if i["symbol"] == "NOROW")["to_52w_high"] is None

    filtered, filtered_total, _ = store.query_results({"job_id": "cpj_52w3", "max_52w_gap": 3})
    assert filtered_total == 1
    assert filtered[0]["symbol"] == "NEAR"


def test_min_range_pos_filters_and_excludes_null(cp_store):
    store.save_job({"job_id": "cpj_rp", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_rp", [
        _hit("HIGH", range_pos=90.0),
        _hit("LOW", range_pos=40.0),
        _hit("NULLRP"),  # range_pos None
    ])

    items, total, summary = store.query_results({"job_id": "cpj_rp", "min_range_pos": 80})

    assert total == 1
    assert items[0]["symbol"] == "HIGH"
    assert items[0]["range_pos"] == 90.0
    assert summary["patterns"] == 1


def test_min_range_pos_absent_returns_all(cp_store):
    store.save_job({"job_id": "cpj_rp2", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_rp2", [
        _hit("HIGH", range_pos=90.0),
        _hit("LOW", range_pos=40.0),
        _hit("NULLRP"),
    ])

    _, total, _ = store.query_results({"job_id": "cpj_rp2"})

    assert total == 3


def test_sort_range_pos_orders_desc(cp_store):
    """`sort="range_pos"` orders by range_pos desc, not confidence."""
    store.save_job({"job_id": "cpj_rps", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_rps", [
        _hit("LOWC", range_pos=40.0, confidence=99.0),
        _hit("HIGHC", range_pos=90.0, confidence=10.0),
        _hit("NULLC", confidence=95.0),
    ])

    items, total, _ = store.query_results({"job_id": "cpj_rps", "sort": "range_pos"})

    assert total == 3
    assert [item["symbol"] for item in items] == ["HIGHC", "LOWC", "NULLC"]


def test_breakout_score_formula():
    """Breakout score: 0.45*range_pos + 0.25*confidence + 0.20*status_w + 0.10*direction_w."""
    # 0.45*90 + 0.25*80 + 0.20*100 + 0.10*100 = 40.5 + 20 + 20 + 10 = 90.5
    assert store.breakout_score({
        "range_pos": 90.0, "confidence": 80.0,
        "status": "confirmed", "direction": "bullish",
    }) == 90.5
    # 0.45*50 + 0.25*60 + 0.20*60 + 0.10*50 = 22.5 + 15 + 12 + 5 = 54.5
    assert store.breakout_score({
        "range_pos": 50.0, "confidence": 60.0,
        "status": "forming", "direction": "neutral",
    }) == 54.5
    # bearish/other statuses contribute 0; Nones coalesce to 0.
    assert store.breakout_score({
        "range_pos": None, "confidence": None,
        "status": "failed", "direction": "bearish",
    }) == 0.0
    assert store.breakout_score({}) == 0.0


def test_query_results_attach_breakout_score(cp_store):
    store.save_job({"job_id": "cpj_bs", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_bs", [_hit("AAA", range_pos=90.0, confidence=80.0)])

    items, total, _ = store.query_results({"job_id": "cpj_bs"})

    assert total == 1
    assert items[0]["breakout_score"] == 90.5


def test_sort_breakout_orders_by_conviction(cp_store):
    """`sort="breakout"` ranks confirmed/bullish/high-range_pos first, not confidence."""
    store.save_job({"job_id": "cpj_bo", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_bo", [
        # High confidence but weak conviction: forming/bearish/low range_pos.
        _hit("WEAK", range_pos=10.0, confidence=99.0, status="forming", direction="bearish"),
        # Lower confidence but strong conviction: confirmed/bullish/high range_pos.
        _hit("STRONG", range_pos=90.0, confidence=10.0, status="confirmed", direction="bullish"),
        _hit("MID", range_pos=50.0, confidence=50.0, status="forming", direction="neutral"),
    ])

    items, total, _ = store.query_results({"job_id": "cpj_bo", "sort": "breakout"})

    assert total == 3
    assert [item["symbol"] for item in items] == ["STRONG", "MID", "WEAK"]
    scores = [item["breakout_score"] for item in items]
    assert scores == sorted(scores, reverse=True)


def test_symbol_detail_attaches_breakout_score(cp_store):
    store.save_job({"job_id": "cpj_bsd", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_bsd", [_hit("AAA", range_pos=90.0, confidence=80.0)])

    detail = store.get_symbol_detail("AAA", "1D")

    assert detail["patterns"][0]["breakout_score"] == 90.5


def test_delete_hits_for_scopes_custom_scans_by_symbol(cp_store):
    store.save_job({"job_id": "cpj_old", "universe": "custom", "timeframe": "1D",
                    "status": "completed", "total": 2, "done": 2})
    store.save_job({"job_id": "cpj_new", "universe": "custom", "timeframe": "1D",
                    "status": "completed", "total": 1, "done": 1})
    store.save_hits("cpj_old", [_hit("INFY"), _hit("BSE")])
    store.save_hits("cpj_new", [_hit("BSE")])

    deleted = store.delete_hits_for("custom", "1D", keep_job_id="cpj_new", symbols=["BSE"])

    assert deleted == 1
    items, _, _ = store.query_results({"universe": "custom", "timeframe": "1D"})
    assert sorted(row["symbol"] for row in items) == ["BSE", "INFY"]


def test_save_hits_payload_keeps_source_sig_and_query_results_exposes_it(cp_store):
    store.save_job({"job_id": "cpj_ss1", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed"})
    assert store.save_hits("cpj_ss1", [_hit(source_sig="sig-abc-123")]) == 1

    # The raw payload_json column carries the field (no schema change).
    session = cp_store()
    try:
        from db.models.chart_patterns import PatternHit

        raw = (
            session.query(PatternHit.payload_json)
            .filter(PatternHit.job_id == "cpj_ss1")
            .scalar()
        )
    finally:
        session.close()
    assert raw is not None and "source_sig" in raw and "sig-abc-123" in raw

    # query_results exposes it on the read path.
    items, total, _ = store.query_results({"job_id": "cpj_ss1"})
    assert total == 1
    assert items[0]["source_sig"] == "sig-abc-123"


def test_save_hits_without_source_sig_exposes_none(cp_store):
    """Legacy hits (no source_sig) expose None rather than blowing up."""
    store.save_job({"job_id": "cpj_ss2", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed"})
    store.save_hits("cpj_ss2", [_hit()])

    items, total, _ = store.query_results({"job_id": "cpj_ss2"})
    assert total == 1
    assert items[0]["source_sig"] is None


def test_latest_hits_by_symbol_promotes_source_sig(cp_store):
    store.save_job({"job_id": "cpj_lhs1", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed"})
    store.save_hits("cpj_lhs1", [_hit("AAA", source_sig="sig-1"), _hit("BBB")])

    by_symbol = store.latest_hits_by_symbol("nifty50", "1D")

    assert set(by_symbol) == {"AAA", "BBB"}
    assert by_symbol["AAA"]["source_sig"] == "sig-1"
    assert by_symbol["BBB"]["source_sig"] is None
    # Scan-time lines are promoted too so a reuse read has everything it needs.
    assert isinstance(by_symbol["AAA"].get("trend_lines"), list)


def test_latest_hits_by_symbol_is_scoped_and_excludes_current(cp_store):
    store.save_job({"job_id": "cpj_x1", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed"})
    store.save_job({"job_id": "cpj_x2", "universe": "nifty500", "timeframe": "1D",
                    "status": "completed"})
    store.save_hits("cpj_x1", [_hit("AAA", source_sig="s1")])
    store.save_hits("cpj_x2", [_hit("AAA", source_sig="s2")])

    # nifty500 scope returns only its own row.
    assert store.latest_hits_by_symbol("nifty500", "1D")["AAA"]["source_sig"] == "s2"
    # Excluding the current job falls back to the older job's hit.
    assert store.latest_hits_by_symbol("nifty50", "1D", exclude_job_id="cpj_x1") == {}
    assert store.latest_hits_by_symbol("nope", "1D") == {}


def test_summary_mixed_status_direction_and_counts(cp_store):
    store.save_job({"job_id": "cpj_mix", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 5, "done": 5})
    store.save_hits("cpj_mix", [
        _hit("AAA", pattern_id="pw", family="rev", direction="bullish", status="confirmed", end_date="2026-01-02"),
        _hit("BBB", pattern_id="pw", family="rev", direction="bearish", status="forming", end_date="2026-01-03"),
        _hit("CCC", pattern_id="db", family="cont", direction="bullish", status="forming", end_date="2026-01-04"),
        _hit("DDD", pattern_id="db", family="cont", direction="bearish", status="confirmed", end_date="2026-01-01"),
        _hit("EEE", pattern_id="db", family="cont", direction="neutral", status="failed", end_date="2026-01-05"),
    ])

    summary = store.compute_summary({"job_id": "cpj_mix"})

    assert summary["patterns"] == 5
    assert summary["in_view"] == 5
    assert summary["confirmed"] == 2
    assert summary["forming"] == 2
    assert summary["bullish"] == 2
    assert summary["bearish"] == 2
    assert summary["data_through"] == "2026-01-05"
    assert summary["pattern_counts"] == {"pw": 2, "db": 3}
    assert summary["family_counts"] == {"rev": 2, "cont": 3}
    _, _, qr_summary = store.query_results({"job_id": "cpj_mix"})
    assert qr_summary == summary


def test_summary_excludes_empty_keys_and_ignores_null_end_date(cp_store):
    store.save_job({"job_id": "cpj_null", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 2, "done": 2})
    store.save_hits("cpj_null", [
        _hit("AAA", pattern_id="pw", family="rev", direction="bullish", status="confirmed", end_date="2026-01-02"),
        _hit("BBB", pattern_id="", family="", direction="", status="", end_date=None),
    ])

    summary = store.compute_summary({"job_id": "cpj_null"})

    assert summary["patterns"] == 2
    assert summary["confirmed"] == 1
    assert summary["forming"] == 0
    assert summary["bullish"] == 1
    assert summary["bearish"] == 0
    assert summary["data_through"] == "2026-01-02"
    assert summary["pattern_counts"] == {"pw": 1}
    assert summary["family_counts"] == {"rev": 1}


def test_summary_all_null_end_dates_data_through_none(cp_store):
    store.save_job({"job_id": "cpj_allnull", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 2, "done": 2})
    store.save_hits("cpj_allnull", [
        _hit("AAA", end_date=None),
        _hit("BBB", end_date=None, status="forming", direction="bearish"),
    ])

    summary = store.compute_summary({"job_id": "cpj_allnull"})

    assert summary["patterns"] == 2
    assert summary["data_through"] is None
    assert summary["confirmed"] == 1
    assert summary["forming"] == 1


def test_summary_empty_result_set(cp_store):
    store.save_job({"job_id": "cpj_empty", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 7, "done": 7})

    summary = store.compute_summary({"job_id": "cpj_empty"})

    assert summary["patterns"] == 0
    assert summary["in_view"] == 0
    assert summary["confirmed"] == 0
    assert summary["forming"] == 0
    assert summary["bullish"] == 0
    assert summary["bearish"] == 0
    assert summary["data_through"] is None
    assert summary["pattern_counts"] == {}
    assert summary["family_counts"] == {}
    assert store.compute_summary({"job_id": "nope"})["patterns"] == 0
    assert store.compute_summary({})["patterns"] == 0


def test_summary_respects_filters(cp_store):
    store.save_job({"job_id": "cpj_flt", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 3, "done": 3})
    store.save_hits("cpj_flt", [
        _hit("AAA", pattern_id="pw", family="rev", direction="bullish", status="confirmed", end_date="2026-01-02"),
        _hit("BBB", pattern_id="db", family="cont", direction="bearish", status="forming", end_date="2026-01-03"),
        _hit("CCC", pattern_id="pw", family="rev", direction="bullish", status="forming", end_date="2026-01-04"),
    ])

    bullish = store.compute_summary({"job_id": "cpj_flt", "direction": ["bullish"]})

    assert bullish["patterns"] == 2
    assert bullish["confirmed"] == 1
    assert bullish["forming"] == 1
    assert bullish["bullish"] == 2
    assert bullish["bearish"] == 0
    assert bullish["data_through"] == "2026-01-04"
    assert bullish["pattern_counts"] == {"pw": 2}
    assert bullish["family_counts"] == {"rev": 2}

    via_join = store.compute_summary({"universe": "nifty50", "timeframe": "1D"})

    assert via_join["patterns"] == 3
    assert via_join["confirmed"] == 1
    assert via_join["forming"] == 2
    assert via_join["bullish"] == 2
    assert via_join["bearish"] == 1
    assert via_join["pattern_counts"] == {"pw": 2, "db": 1}
    assert via_join["family_counts"] == {"rev": 2, "cont": 1}


def test_summary_query_count_guard(cp_store, test_db_engine):
    from sqlalchemy import event

    store.save_job({"job_id": "cpj_qc", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 1, "done": 1})
    store.save_hits("cpj_qc", [_hit("AAA")])

    statements: list[str] = []

    @event.listens_for(test_db_engine, "before_cursor_execute")
    def _count(_conn, _cursor, statement, _params, _ctx, _em):
        statements.append(statement)

    try:
        summary = store.compute_summary({"job_id": "cpj_qc"})
    finally:
        event.remove(test_db_engine, "before_cursor_execute", _count)

    # total count + one GROUP BY + one UNION ALL + scanned; a regression to
    # per-status/direction/max/per-column queries would run ~9 here.
    assert len(statements) <= 4
    assert summary["patterns"] == 1
    assert summary["confirmed"] == 1
