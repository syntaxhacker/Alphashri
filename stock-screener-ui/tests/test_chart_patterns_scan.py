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


# ---------------------------------------------------------------------------
# Cross-universe duplicates: unfiltered results/summary count a shared
# symbol/pattern once (store.query_results / compute_summary dedupe).
# ---------------------------------------------------------------------------


def _dupe_hit(symbol: str = "IRCON") -> dict:
    return {
        "symbol": symbol,
        "name": "Ircon International",
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


def test_unfiltered_results_dedupe_shared_symbol_across_universes(cp_store):
    store.save_job({"job_id": "cpj_x1", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_x1", [_dupe_hit()])
    store.save_job({"job_id": "cpj_x2", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_x2", [_dupe_hit()])

    items, total, summary = store.query_results({})
    assert total == 1, "same symbol/pattern stored by two universe jobs counts once"
    assert len(items) == 1
    # Newest job's row wins.
    assert items[0]["job_id"] == "cpj_x2"
    assert summary["patterns"] == 1
    assert summary["in_view"] == 1
    assert summary["confirmed"] == 1
    assert summary["bullish"] == 1
    assert summary["bearish"] == 0
    assert summary["pattern_counts"] == {"falling_wedge": 1}
    assert summary["family_counts"] == {"reversal": 1}


def test_unfiltered_summary_dedupes(cp_store):
    store.save_job({"job_id": "cpj_x3", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_x3", [_dupe_hit()])
    store.save_job({"job_id": "cpj_x4", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_x4", [_dupe_hit()])

    summary = store.compute_summary({})
    assert summary["patterns"] == 1
    assert summary["confirmed"] == 1
    assert summary["bullish"] == 1
    assert summary["pattern_counts"] == {"falling_wedge": 1}
    assert summary["family_counts"] == {"reversal": 1}


def test_explicit_job_and_universe_filters_keep_all_rows(cp_store):
    store.save_job({"job_id": "cpj_x5", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_x5", [_dupe_hit()])
    store.save_job({"job_id": "cpj_x6", "universe": "nifty500", "timeframe": "1D", "status": "completed"})
    store.save_hits("cpj_x6", [_dupe_hit()])

    _, total_job, _ = store.query_results({"job_id": "cpj_x5"})
    assert total_job == 1
    _, total_uni, _ = store.query_results({"universe": "nifty500"})
    assert total_uni == 1


# ---------------------------------------------------------------------------
# store._num rejects non-finite floats; save_job persists `params`.
# ---------------------------------------------------------------------------


def test_num_rejects_non_finite(cp_store):
    assert store._num(float("nan")) is None
    assert store._num(float("inf")) is None
    assert store._num(float("-inf")) is None
    assert store._num("nan") is None
    assert store._num("inf") is None
    assert store._num(1.5) == 1.5
    assert store._num("2.5") == 2.5
    assert store._num(None) is None


def test_save_hits_drops_non_finite_confidence(cp_store):
    store.save_job({"job_id": "cpj_nan", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    hit = _dupe_hit()
    hit["confidence"] = float("nan")
    hit["rr"] = float("inf")
    store.save_hits("cpj_nan", [hit])

    items, total, _ = store.query_results({"job_id": "cpj_nan"})
    assert total == 1
    assert items[0]["confidence"] is None
    assert items[0]["rr"] is None


def test_save_job_persists_params(cp_store):
    dto = store.save_job({
        "job_id": "cpj_params", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True, "note": "x"},
    })
    assert dto["params"] == {"force": True, "note": "x"}

    row = store.get_job("cpj_params")
    assert row["params"] == {"force": True, "note": "x"}

    # Raw column carries the JSON (proves `force` survives the round-trip).
    session = cp_store()
    try:
        from db.models.chart_patterns import PatternComputeJob

        raw = (
            session.query(PatternComputeJob.params_json)
            .filter(PatternComputeJob.id == "cpj_params")
            .scalar()
        )
    finally:
        session.close()
    assert raw is not None and "force" in raw


# ---------------------------------------------------------------------------
# `q` LIKE escaping: `%` / `_` match literally.
# ---------------------------------------------------------------------------


def test_q_escapes_like_wildcards(cp_store):
    store.save_job({"job_id": "cpj_q", "universe": "nifty50", "timeframe": "1D", "status": "completed"})
    hits = [
        dict(_dupe_hit("AAA"), name="Alpha Co"),
        dict(_dupe_hit("A%B"), name="Percent Co"),
        dict(_dupe_hit("A_B"), name="Under Co"),
    ]
    store.save_hits("cpj_q", hits)

    _, total_pct, _ = store.query_results({"job_id": "cpj_q", "q": "%"})
    assert total_pct == 1
    items, _, _ = store.query_results({"job_id": "cpj_q", "q": "100%"})
    assert items == []

    _, total_us, _ = store.query_results({"job_id": "cpj_q", "q": "_"})
    assert total_us == 1

    # A name containing a literal % still matches literally.
    store.save_hits("cpj_q", [dict(_dupe_hit("HOLD"), name="100% Pure")])
    items, total, _ = store.query_results({"job_id": "cpj_q", "q": "100%"})
    assert total == 1
    assert items[0]["symbol"] == "HOLD"


# ---------------------------------------------------------------------------
# _scanned_count fallback: latest job total regardless of status, else 0.
# ---------------------------------------------------------------------------


def test_scanned_falls_back_to_latest_job_total_any_status(cp_store):
    store.save_job({
        "job_id": "cpj_run1", "universe": "nifty50", "timeframe": "1D",
        "status": "running", "total": 7, "done": 2,
    })
    store.save_hits("cpj_run1", [_dupe_hit("AAA")])

    summary = store.compute_summary({"universe": "nifty50", "timeframe": "1D"})
    assert summary["scanned"] == 7


def test_scanned_is_zero_when_no_job_exists(cp_store):
    store.save_hits("cpj_ghost", [_dupe_hit("AAA")])

    summary = store.compute_summary({"universe": "nifty50", "timeframe": "1D"})
    assert summary["scanned"] == 0


# ---------------------------------------------------------------------------
# scan.run_job: `force` bypasses the freshness short-circuit; cancellation is
# honoured before each symbol's work with a terminal finished_at.
# ---------------------------------------------------------------------------


def _fresh_completed(factory_job_id: str, total: int = 3):
    from datetime import datetime, timezone

    store.save_job({
        "job_id": factory_job_id, "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": total, "done": total,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    })


def test_run_job_skips_fresh_combo_without_force(cp_store, patched_scan):
    _fresh_completed("cpj_fresh_prev")
    store.save_job({"job_id": "cpj_fresh_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_fresh_new")

    assert patched_scan["fetch"] == []
    row = store.get_job("cpj_fresh_new")
    assert row["status"] == "completed"
    assert row["total"] == 3
    assert row["finished_at"] is not None


def test_run_job_force_bypasses_freshness_short_circuit(cp_store, patched_scan):
    _fresh_completed("cpj_force_prev")
    store.save_job({
        "job_id": "cpj_force_new", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True},
    })

    scan.run_job("cpj_force_new")

    assert patched_scan["fetch"] == ["AAA", "BBB", "CCC"]
    row = store.get_job("cpj_force_new")
    assert row["status"] == "completed"
    assert row["finished_at"] is not None


def test_run_job_scans_explicit_symbol_scope(cp_store, monkeypatch):
    calls = {"fetch": [], "detect": []}

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None):
        calls["fetch"].append(symbol)
        return _make_df(80)

    def fake_detect(df, timeframe, symbol):
        calls["detect"].append(symbol)
        return [_hit(symbol)]

    def boom(_uid):
        raise AssertionError("universe lookup must not run for a symbol scope")

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=boom))

    store.save_job({
        "job_id": "cpj_scope", "universe": "custom", "timeframe": "1D",
        "status": "queued", "params": {"symbols": ["BSE", "INFY"]},
    })
    scan.run_job("cpj_scope")

    row = store.get_job("cpj_scope")
    assert row["status"] == "completed"
    assert row["total"] == 2
    assert sorted(calls["fetch"]) == ["BSE", "INFY"]
    items, total, _ = store.query_results({"job_id": "cpj_scope"})
    assert total == 2
    assert {i["symbol"] for i in items} == {"BSE", "INFY"}


def test_run_job_symbol_scope_bypasses_freshness(cp_store, monkeypatch):
    from datetime import datetime, timezone

    store.save_job({
        "job_id": "cpj_scope_prev", "universe": "custom", "timeframe": "1D",
        "status": "completed", "total": 1, "done": 1,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    })

    fetched = []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None):
        fetched.append(symbol)
        return _make_df(80)

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))

    store.save_job({
        "job_id": "cpj_scope_new", "universe": "custom", "timeframe": "1D",
        "status": "queued", "params": {"symbols": ["TCS"]},
    })
    scan.run_job("cpj_scope_new")

    assert fetched == ["TCS"]
    assert store.get_job("cpj_scope_new")["status"] == "completed"


def test_run_job_honours_cancellation_per_symbol(cp_store, patched_scan, monkeypatch):
    monkeypatch.setattr(jobs, "is_cancelled", lambda job_id: True)
    store.save_job({"job_id": "cpj_cancel", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_cancel")

    # No symbol work started once cancellation was signalled.
    assert patched_scan["fetch"] == []
    assert patched_scan["detect"] == []
    row = store.get_job("cpj_cancel")
    assert row["status"] == "cancelled"
    assert row["finished_at"] is not None


def test_process_symbol_checks_cancel_before_fetch(cp_store, monkeypatch):
    calls = []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None):
        calls.append(symbol)
        return _make_df(80)

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(jobs, "is_cancelled", lambda job_id: True)

    result = scan._process_symbol("AAA", "1D", "cpj_any")
    assert calls == []
    assert result["status"] == "skipped"


def test_job_params_reads_params_and_params_json():
    assert scan._job_params({"params": {"force": True}}) == {"force": True}
    assert scan._job_params({"params_json": '{"force": true}'}) == {"force": True}
    assert scan._job_params({}) == {}
    assert scan._is_fresh(None) is False
    assert scan._is_fresh("not-a-date") is False
    from datetime import datetime, timezone

    assert scan._is_fresh(datetime.now(timezone.utc).isoformat()) is True
    assert scan._is_fresh("2000-01-01T00:00:00+00:00") is False


# ---------------------------------------------------------------------------
# candles: Inf mapping, as_of_date cache key, IST-anchored resample bins.
# ---------------------------------------------------------------------------


def test_candles_f_maps_inf_to_default():
    from chart_patterns.candles import _f

    assert _f(float("inf")) == 0.0
    assert _f(float("-inf")) == 0.0
    assert _f(float("nan")) == 0.0
    assert _f(3.25) == 3.25
    assert _f(None, default=-1.0) == -1.0


def test_cache_path_keys_as_of_date():
    from chart_patterns.candles import _cache_path

    today_path = _cache_path("1D", "RELIANCE")
    hist_path = _cache_path("1D", "RELIANCE", "2020-01-05")
    assert today_path.name == "RELIANCE.pkl"
    assert hist_path != today_path
    assert "2020-01-05" in hist_path.name
    assert _cache_path("1D", "RELIANCE", None) == today_path


def test_historical_fetch_ignores_today_cache(cp_store, monkeypatch, tmp_path):
    from chart_patterns import candles as candles_mod

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    today_df = _make_df(80)
    today_path = candles_mod._cache_path("1D", "AAA")
    candles_mod._write_cached(today_path, today_df, is_today=True)

    fresh_df = _make_df(80) * 2.0
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles", lambda **kwargs: fresh_df
    )
    monkeypatch.setattr(
        candles_mod, "_resolve_timeframe",
        lambda tf_id: {"minutes": 1440, "source_tf": None, "max_lookback_days": 730},
    )

    got = candles_mod.fetch_for_timeframe("AAA", "1D", as_of_date="2020-01-05")
    assert got is fresh_df
    assert candles_mod._cache_path("1D", "AAA", "2020-01-05").exists()


def test_resample_bins_anchor_to_ist_midnight():
    from chart_patterns.candles import _resample

    idx = pd.date_range("2026-01-05 00:00", periods=24, freq="h", tz="UTC")
    base = np.arange(24, dtype=float) + 100.0
    df = pd.DataFrame(
        {"open": base, "high": base + 0.5, "low": base - 0.5,
         "close": base, "volume": np.full(24, 100.0)},
        index=idx,
    )
    out = _resample(df, 120)
    assert len(out) > 0
    # UTC-anchored 2h bins would land on :30 in IST; IST-anchored land on the hour.
    ist = out.index.tz_convert("Asia/Kolkata")
    assert all(ts.minute == 0 for ts in ist)
    assert all(ts.hour % 2 == 0 for ts in ist)
    # Index returns to the original timezone.
    assert str(out.index.tz) == "UTC"
