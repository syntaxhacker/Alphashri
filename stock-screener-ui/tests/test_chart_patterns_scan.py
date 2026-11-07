"""Tests for chart_patterns/scan.py (job execution + progress counters)."""
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor as _RealThreadPool
from types import SimpleNamespace
from typing import Optional

import numpy as np
import pandas as pd
import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import jobs, parallel, scan, store

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

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
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


def test_run_job_persists_only_the_latest_hit_per_symbol(cp_store, monkeypatch):
    older = _hit("AAA")
    newer = replace(
        older,
        pattern_id="head_shoulders",
        pattern_name="Head & Shoulders",
        bars_ago=0,
        end_date="2026-02-02",
        confidence=90.0,
    )
    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        scan,
        "engine_mod",
        SimpleNamespace(detect_patterns=lambda *_: [older, newer]),
    )
    monkeypatch.setattr(
        scan,
        "universes_mod",
        SimpleNamespace(get_universe=lambda uid: ["AAA"]),
    )
    job_id = "cpj_latest_only"
    store.save_job({"job_id": job_id, "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job(job_id)

    items, total, summary = store.query_results({"job_id": job_id})
    assert total == 1
    assert items[0]["pattern_name"] == "Head & Shoulders"
    assert summary["patterns"] == 1


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
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
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
        "params": {"scan_signature": scan._detector_signature()},
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
    # The reuse is recorded on the job state (not a silent "completed").
    assert row["params"]["reused"] is True
    assert row["params"]["reused_from"] == "cpj_fresh_prev"


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

    # Serial workers: the in-memory test DB shares one StaticPool SQLite
    # connection, so concurrent save_hits commits race ("bad parameter or
    # other API misuse"). This test covers scope routing, not parallelism.
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
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

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
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

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
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
    from chart_patterns.candles import CACHE_VERSION, _cache_path

    today_path = _cache_path("1D", "RELIANCE")
    hist_path = _cache_path("1D", "RELIANCE", "2020-01-05")
    assert today_path.name == f"RELIANCE.v{CACHE_VERSION}.pkl"
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
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: fresh_df,
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


# ---------------------------------------------------------------------------
# lookback_bars (opt-in trailing window): fetch covers N bars, detection sees
# only the last N bars; Auto (omitted) leaves the full frame untouched.
# ---------------------------------------------------------------------------


def test_run_job_lookback_slices_to_last_n_bars(cp_store, monkeypatch):
    seen = {}

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
        seen["lookback_bars"] = lookback_bars
        return _make_df(100)

    def fake_detect(df, timeframe, symbol):
        seen["n"] = len(df)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))

    store.save_job({
        "job_id": "cpj_lb40", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"lookback_bars": 40},
    })
    scan.run_job("cpj_lb40")

    row = store.get_job("cpj_lb40")
    assert row["status"] == "completed"
    assert seen["lookback_bars"] == 40
    assert seen["n"] == 40


def test_run_job_without_lookback_passes_full_frame(cp_store, monkeypatch):
    seen = {}

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
        seen["lookback_bars"] = lookback_bars
        return _make_df(100)

    def fake_detect(df, timeframe, symbol):
        seen["n"] = len(df)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))

    store.save_job({
        "job_id": "cpj_lbauto", "universe": "nifty50", "timeframe": "1D",
        "status": "queued",
    })
    scan.run_job("cpj_lbauto")

    row = store.get_job("cpj_lbauto")
    assert row["status"] == "completed"
    assert seen["lookback_bars"] is None
    assert seen["n"] == 100


def test_cache_path_variant_does_not_poison_default():
    from chart_patterns.candles import _cache_path

    assert _cache_path("1D", "X", None, "lb250") != _cache_path("1D", "X")
    assert _cache_path("1D", "X", None) == _cache_path("1D", "X")


# ---------------------------------------------------------------------------
# Scan-time trend_lines: computed once per symbol in _process_symbol and
# persisted through save_hits → query_results.
# ---------------------------------------------------------------------------


def test_process_symbol_attaches_trend_lines(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    store.save_job({
        "job_id": "cpj_tlproc", "universe": "nifty50", "timeframe": "1D", "status": "queued",
    })

    result = scan._process_symbol("AAA", "1D", "cpj_tlproc")

    assert result["status"] == "ok"
    # _process_symbol no longer persists per symbol; persistence is batched in
    # run_job, so persist the returned hits explicitly here.
    store.save_hits("cpj_tlproc", result.get("hits") or [])
    items, total, _ = store.query_results({"job_id": "cpj_tlproc"})
    assert total == 1
    assert isinstance(items[0].get("trend_lines"), list)


def test_process_symbol_trendlines_failure_still_persists_hits(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(scan, "trendlines_mod", None)
    store.save_job({
        "job_id": "cpj_tlproc_fail", "universe": "nifty50", "timeframe": "1D", "status": "queued",
    })

    result = scan._process_symbol("AAA", "1D", "cpj_tlproc_fail")

    assert result["status"] == "ok"
    store.save_hits("cpj_tlproc_fail", result.get("hits") or [])
    items, total, _ = store.query_results({"job_id": "cpj_tlproc_fail"})
    assert total == 1
    assert items[0].get("trend_lines") == []


def test_save_hits_round_trips_trend_lines(cp_store):
    store.save_job({
        "job_id": "cpj_tlrt", "universe": "nifty50", "timeframe": "1D", "status": "completed",
    })
    line = {
        "kind": "support",
        "start_date": "2026-01-01T00:00:00+00:00",
        "start_price": 100.0,
        "end_date": "2026-02-01T00:00:00+00:00",
        "end_price": 110.0,
        "slope": 0.2,
        "touches": 3,
        "span_bars": 30,
        "violations": 0,
    }
    store.save_hits("cpj_tlrt", [dict(_dupe_hit(), trend_lines=[line])])

    items, total, _ = store.query_results({"job_id": "cpj_tlrt"})
    assert total == 1
    assert items[0]["trend_lines"] == [line]


def test_process_symbol_forwards_lookback_to_trendlines(cp_store, monkeypatch):
    """`_process_symbol` passes its `lookback_bars` into `detect_trendlines`."""
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    seen = {}

    def fake_tl(df, lookback_bars=None):
        seen["lookback_bars"] = lookback_bars
        return {"support": None, "resistance": None}

    monkeypatch.setattr(scan.trendlines_mod, "detect_trendlines", fake_tl)
    store.save_job({
        "job_id": "cpj_tlfwd", "universe": "nifty50", "timeframe": "1D", "status": "queued",
    })

    result = scan._process_symbol("AAA", "1D", "cpj_tlfwd", lookback_bars=40)
    assert result["status"] == "ok"
    assert seen["lookback_bars"] == 40

    result = scan._process_symbol("AAA", "1D", "cpj_tlfwd")
    assert result["status"] == "ok"
    assert seen["lookback_bars"] is None


def test_process_symbol_stamps_trend_lines_sig(cp_store, monkeypatch):
    """Hit records carry `trend_lines_sig` matching the detector signature."""
    from chart_patterns import config as cp_config

    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    store.save_job({
        "job_id": "cpj_tlsig", "universe": "nifty50", "timeframe": "1D", "status": "queued",
    })

    result = scan._process_symbol("AAA", "1D", "cpj_tlsig")

    assert result["status"] == "ok"
    store.save_hits("cpj_tlsig", result.get("hits") or [])
    items, total, _ = store.query_results({"job_id": "cpj_tlsig"})
    assert total == 1
    assert items[0].get("trend_lines_sig") == cp_config.trendline_signature()


def test_run_job_compute_trendlines_false_skips_detector(cp_store, monkeypatch):
    """`params={"compute_trendlines": False}` stores empty lines, no detector call."""
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))

    def _boom(df, lookback_bars=None):
        raise AssertionError("detect_trendlines must not run when compute_trendlines=false")

    monkeypatch.setattr(scan.trendlines_mod, "detect_trendlines", _boom)
    store.save_job({
        "job_id": "cpj_tlskip", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"compute_trendlines": False},
    })

    scan.run_job("cpj_tlskip")

    row = store.get_job("cpj_tlskip")
    assert row["status"] == "completed"
    items, total, _ = store.query_results({"job_id": "cpj_tlskip"})
    assert total == 1
    assert items[0].get("trend_lines") == []


# ---------------------------------------------------------------------------
# Missing coverage: empty/None frames, stale freshness, None flag default,
# and detection-input slicing.
# ---------------------------------------------------------------------------


def test_process_symbol_empty_frame_is_failed(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(0),
    )
    store.save_job({"job_id": "cpj_empty", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    assert scan._process_symbol("AAA", "1D", "cpj_empty")["status"] == "failed"


def test_process_symbol_none_frame_is_failed(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: None,
    )
    store.save_job({"job_id": "cpj_none", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    assert scan._process_symbol("AAA", "1D", "cpj_none")["status"] == "failed"


def test_run_job_stale_combo_reruns(cp_store, monkeypatch):
    """A completed job older than the freshness TTL does not short-circuit."""
    from datetime import datetime, timedelta, timezone

    # Pin market-open so the TTL branch applies regardless of when this runs.
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)
    stale = (datetime.now(timezone.utc) - timedelta(seconds=scan.SCAN_FRESH_SECONDS + 60)).isoformat()
    store.save_job({
        "job_id": "cpj_stale_prev", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 1, "done": 1, "finished_at": stale,
    })
    fetched = []
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: (
            fetched.append(symbol) or _make_df(80)
        ),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({"job_id": "cpj_stale_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_stale_new")

    assert fetched == ["AAA"]
    assert store.get_job("cpj_stale_new")["status"] == "completed"


def test_run_job_compute_trendlines_none_defaults_to_true(cp_store, monkeypatch):
    """An explicit `compute_trendlines=None` param still runs the detector."""
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    seen = {}

    def fake_tl(df, lookback_bars=None):
        seen["ran"] = True
        return {"support": None, "resistance": None}

    monkeypatch.setattr(scan.trendlines_mod, "detect_trendlines", fake_tl)
    store.save_job({
        "job_id": "cpj_tlnone", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"compute_trendlines": None},
    })

    scan.run_job("cpj_tlnone")

    assert seen.get("ran") is True
    items, total, _ = store.query_results({"job_id": "cpj_tlnone"})
    assert total == 1
    assert items[0].get("trend_lines_sig") is not None


def test_process_symbol_lookback_slices_detection_input(cp_store, monkeypatch):
    """The detector sees only the last N bars when `lookback_bars` is set."""
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(100),
    )
    seen = {}

    def fake_detect(df, timeframe, symbol):
        seen["n"] = len(df)
        return [_hit(symbol)]

    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    store.save_job({
        "job_id": "cpj_slice", "universe": "nifty50", "timeframe": "1D", "status": "queued",
    })

    result = scan._process_symbol("AAA", "1D", "cpj_slice", lookback_bars=40)

    assert result["status"] == "ok"
    assert seen["n"] == 40


# ---------------------------------------------------------------------------
# Session-aware freshness: TTL applies only while the market is open; when
# closed, a combo stays fresh until a new session completes.
# ---------------------------------------------------------------------------


def _market_closed(monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: False)


def _market_open(monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)


def _session_finished_iso() -> str:
    """An ISO `finished_at` inside the current last-completed session."""
    from datetime import datetime

    from trading.calendar import last_completed_session
    from trading.timezone import IST

    sess = last_completed_session()
    return datetime(sess.year, sess.month, sess.day, 16, 0, tzinfo=IST).isoformat()


def test_is_fresh_open_market_uses_ttl(monkeypatch):
    from datetime import datetime, timedelta, timezone

    _market_open(monkeypatch)
    assert scan._is_fresh(datetime.now(timezone.utc).isoformat()) is True
    old = (
        datetime.now(timezone.utc)
        - timedelta(seconds=scan.SCAN_FRESH_SECONDS + 60)
    ).isoformat()
    assert scan._is_fresh(old) is False


def test_is_fresh_closed_market_same_session(monkeypatch):
    from datetime import date

    _market_closed(monkeypatch)
    monkeypatch.setattr(
        "trading.calendar.last_completed_session", lambda ts=None: date(2026, 9, 25)
    )
    assert scan._is_fresh("2026-09-26T10:00:00+00:00") is True


def test_is_fresh_closed_market_new_session(monkeypatch):
    from datetime import date

    _market_closed(monkeypatch)
    sessions = iter([date(2026, 9, 24), date(2026, 9, 25)])
    monkeypatch.setattr(
        "trading.calendar.last_completed_session", lambda ts=None: next(sessions)
    )
    assert scan._is_fresh("2026-09-24T10:00:00+00:00") is False


def test_run_job_closed_market_same_session_skips_rescan(cp_store, patched_scan, monkeypatch):
    """Prev job finished in the last completed session: no re-scan when closed."""
    _market_closed(monkeypatch)
    store.save_job({
        "job_id": "cpj_sess_prev", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 3, "done": 3,
        "finished_at": _session_finished_iso(),
        "params": {"scan_signature": scan._detector_signature()},
    })
    store.save_job({"job_id": "cpj_sess_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_sess_new")

    assert patched_scan["fetch"] == []
    row = store.get_job("cpj_sess_new")
    assert row["status"] == "completed"
    assert row["total"] == 3
    assert row["finished_at"] is not None


def test_run_job_closed_market_new_session_reruns(cp_store, monkeypatch):
    """A new completed session since the scan makes the combo stale."""
    from datetime import date

    _market_closed(monkeypatch)
    sessions = iter([date(2026, 9, 24), date(2026, 9, 25)])
    monkeypatch.setattr(
        "trading.calendar.last_completed_session", lambda ts=None: next(sessions)
    )
    store.save_job({
        "job_id": "cpj_ns_prev", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 1, "done": 1,
        "finished_at": "2026-09-24T10:00:00+00:00",
    })
    fetched = []
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: (
            fetched.append(symbol) or _make_df(80)
        ),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({"job_id": "cpj_ns_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_ns_new")

    assert fetched == ["AAA"]
    assert store.get_job("cpj_ns_new")["status"] == "completed"


def test_run_job_force_bypasses_session_freshness(cp_store, monkeypatch):
    """`force=True` still recomputes even when the closed-market session is fresh."""
    _market_closed(monkeypatch)
    store.save_job({
        "job_id": "cpj_sforce_prev", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 1, "done": 1,
        "finished_at": _session_finished_iso(),
    })
    fetched = []
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: (
            fetched.append(symbol) or _make_df(80)
        ),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({
        "job_id": "cpj_sforce_new", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True},
    })

    scan.run_job("cpj_sforce_new")

    assert fetched == ["AAA"]
    assert store.get_job("cpj_sforce_new")["status"] == "completed"


# ---------------------------------------------------------------------------
# 4h resamples from 1h (Upstox V3 intraday serves 1-60min and hours/4 history
# is quarter-capped, so 4h is non-native like 2h/3h).
# ---------------------------------------------------------------------------


def _hourly_bars(start: str, n: int) -> pd.DataFrame:
    idx = pd.date_range(start, periods=n, freq="h", tz="UTC")
    base = np.arange(n, dtype=float) + 100.0
    return pd.DataFrame(
        {"open": base, "high": base + 0.5, "low": base - 0.5,
         "close": base, "volume": np.full(n, 100.0)},
        index=idx,
    )


def test_4h_registry_resamples_from_1h():
    from chart_patterns.timeframes import get_timeframe

    spec = get_timeframe("4h")
    assert spec.native is False
    assert spec.source_tf == "1h"
    assert spec.minutes == 240


def test_4h_fetch_pulls_1h_then_resamples_to_240m(monkeypatch, tmp_path):
    from chart_patterns import candles as candles_mod

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    # 03:30-14:30 UTC = 09:00-20:00 IST: spans four IST-anchored 4h bins.
    src = _hourly_bars("2026-09-29 03:30", 12)
    seen = {}

    def fake_core(symbol, timeframe, **kwargs):
        seen.update(symbol=symbol, timeframe=timeframe, **kwargs)
        return src

    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe", fake_core
    )

    got = candles_mod.fetch_for_timeframe("AAA", "4h", as_of_date="2026-09-30")

    assert seen["timeframe"] == "1h"
    assert seen["from_date"] == "2025-09-30" and seen["to_date"] == "2026-09-30"
    assert got is not None and not got.empty
    diffs = got.index.to_series().diff().dropna().dt.total_seconds() / 60.0
    assert len(diffs) == 3
    assert all(abs(d - 240.0) < 1e-6 for d in diffs)
    ist = got.index.tz_convert("Asia/Kolkata")
    assert all(ts.minute == 0 and ts.hour % 4 == 0 for ts in ist)


# ---------------------------------------------------------------------------
# 1D partial-today bar (today's in-progress session aggregated from the tape).
# ---------------------------------------------------------------------------


def _daily_bars(dates: list) -> pd.DataFrame:
    idx = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in dates])
    base = np.arange(len(idx), dtype=float) + 100.0
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0,
         "close": base, "volume": np.full(len(idx), 1000.0)},
        index=idx,
    )


def _minute_tape(day: str, n: int = 5) -> pd.DataFrame:
    idx = pd.date_range(f"{day} 09:15", periods=n, freq="min",
                        tz="Asia/Kolkata").tz_convert("UTC")
    base = np.arange(n, dtype=float) + 200.0
    return pd.DataFrame(
        {"open": base, "high": base + 0.5, "low": base - 0.5,
         "close": base, "volume": np.full(n, 500.0)},
        index=idx,
    )


def test_1d_partial_appends_synthetic_bar_from_tape(monkeypatch, tmp_path):
    from chart_patterns import candles as candles_mod

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(candles_mod, "_today_is_session", lambda: True)
    base = _daily_bars(["2020-01-01", "2020-01-02", "2020-01-03"])
    tape = _minute_tape("2020-06-01")
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: base,
    )
    api = SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: tape)

    got = candles_mod.fetch_for_timeframe(
        "AAA", "1D", api_client=api, include_partial_today=True
    )

    assert got is not None
    assert len(got) == len(base) + 1
    assert bool(getattr(got, "attrs", {}).get("partial_today", False)) is True
    last = got.iloc[-1]
    assert last["open"] == pytest.approx(tape["open"].iloc[0])
    assert last["high"] == pytest.approx(tape["high"].max())
    assert last["low"] == pytest.approx(tape["low"].min())
    assert last["close"] == pytest.approx(tape["close"].iloc[-1])
    assert last["volume"] == pytest.approx(tape["volume"].sum())
    # The synthetic bar is never cached: the disk entry holds the base frame.
    # Read unvalidated: the mocked base frame is dated 2020, so the session pin
    # would (correctly) reject it as stale on the today path.
    reread = candles_mod._read_cached(
        candles_mod._cache_path("1D", "AAA"), is_today=False
    )
    assert reread is not None and len(reread) == len(base)


def test_1d_partial_empty_tape_appends_nothing(monkeypatch, tmp_path):
    from chart_patterns import candles as candles_mod

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    base = _daily_bars(["2020-01-01", "2020-01-02", "2020-01-03"])
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: base,
    )
    api = SimpleNamespace(
        fetch_intraday_data_v3=lambda **kwargs: _minute_tape("2020-06-01").iloc[0:0]
    )

    got = candles_mod.fetch_for_timeframe(
        "AAA", "1D", api_client=api, include_partial_today=True
    )

    assert got is not None and len(got) == len(base)
    assert not getattr(got, "attrs", {}).get("partial_today", False)


def test_1d_partial_official_bar_wins(monkeypatch, tmp_path):
    from chart_patterns import candles as candles_mod

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    # Base already holds the tape session's UTC date: no duplicate bar.
    base = _daily_bars(["2020-05-29", "2020-06-01"])
    tape = _minute_tape("2020-06-01")
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: base,
    )
    api = SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: tape)

    got = candles_mod.fetch_for_timeframe(
        "AAA", "1D", api_client=api, include_partial_today=True
    )

    assert got is not None and len(got) == len(base)
    assert not getattr(got, "attrs", {}).get("partial_today", False)


def test_1d_without_flag_has_no_partial_bar(monkeypatch, tmp_path):
    from chart_patterns import candles as candles_mod

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    base = _daily_bars(["2020-01-01", "2020-01-02", "2020-01-03"])
    calls = []
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: base,
    )

    def _boom(**kwargs):
        calls.append(1)
        raise AssertionError("tape must not be consulted without the flag")

    api = SimpleNamespace(fetch_intraday_data_v3=_boom)

    got = candles_mod.fetch_for_timeframe("AAA", "1D", api_client=api)

    assert got is not None and len(got) == len(base)
    assert calls == []
    assert not getattr(got, "attrs", {}).get("partial_today", False)


# ---------------------------------------------------------------------------
# frame_last_date reports the IST session date, not the UTC calendar date.
# ---------------------------------------------------------------------------


def test_frame_last_date_reports_ist_session_date():
    from chart_patterns.candles import frame_last_date

    # 2026-09-30 19:00 UTC is 2026-10-01 00:30 IST: the bar belongs to Oct 1.
    late = pd.DataFrame(
        {"close": [1.0]},
        index=pd.DatetimeIndex([pd.Timestamp("2026-09-30 19:00", tz="UTC")]),
    )
    assert frame_last_date(late) == "2026-10-01"
    # Mid-session bars are unaffected (UTC and IST dates agree).
    mid = pd.DataFrame(
        {"close": [1.0]},
        index=pd.DatetimeIndex([pd.Timestamp("2026-09-30 10:00", tz="UTC")]),
    )
    assert frame_last_date(mid) == "2026-09-30"
    # Naive indexes are assumed UTC (same convention as the fetcher).
    naive = pd.DataFrame(
        {"close": [1.0]},
        index=pd.DatetimeIndex([pd.Timestamp("2026-09-30 19:00")]),
    )
    assert frame_last_date(naive) == "2026-10-01"
    assert frame_last_date(pd.DataFrame()) is None
    assert frame_last_date(None) is None


# ---------------------------------------------------------------------------
# TV volume/rel-volume pre-filter: one bulk query before any candle fetch.
# ---------------------------------------------------------------------------


def test_run_scan_prefilter_called_once_and_limits_symbols(cp_store, monkeypatch):
    """With volume filters, the prefilter runs once and only passing symbols fetch."""
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)
    fetched = []
    prefilter_calls = []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
        fetched.append(symbol)
        return _make_df(80)

    def fake_prefilter(symbols, *, min_rel_volume=None, min_volume_m=None, min_avg_volume_10d=None):
        prefilter_calls.append({
            "symbols": list(symbols),
            "min_rel_volume": min_rel_volume,
            "min_volume_m": min_volume_m,
            "min_avg_volume_10d": min_avg_volume_10d,
        })
        return ["AAA"], {"before": 3, "after": 1, "message": "TV prefilter: 3 → 1"}

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB", "CCC"]))
    monkeypatch.setattr(scan.tv_prefilter_mod, "prefilter_by_volume", fake_prefilter)

    store.save_job({
        "job_id": "cpj_tvpre", "universe": "nifty500", "timeframe": "1D",
        "status": "queued", "params": {"min_rel_volume": 1.5, "min_volume_m": 1.0, "min_avg_volume_10d": 150},
    })
    scan.run_scan("cpj_tvpre")

    assert len(prefilter_calls) == 1
    assert prefilter_calls[0]["symbols"] == ["AAA", "BBB", "CCC"]
    assert prefilter_calls[0]["min_rel_volume"] == 1.5
    assert prefilter_calls[0]["min_volume_m"] == 1.0
    assert prefilter_calls[0]["min_avg_volume_10d"] == 150
    assert fetched == ["AAA"]
    row = store.get_job("cpj_tvpre")
    assert row["status"] == "completed"
    assert row["total"] == 1
    assert row["done"] == 1
    message = jobs.get_job("cpj_tvpre").get("message")
    assert message == "TV prefilter: 3 → 1"


def test_run_scan_without_filters_never_calls_prefilter(cp_store, monkeypatch):
    """No volume params: prefilter is bypassed, behaviour unchanged."""
    def _boom(symbols, **kwargs):
        raise AssertionError("prefilter must not run without volume filters")

    fetched = []
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: (
            fetched.append(symbol) or _make_df(80)
        ),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB"]))
    monkeypatch.setattr(scan.tv_prefilter_mod, "prefilter_by_volume", _boom)

    store.save_job({"job_id": "cpj_tvnofilt", "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_scan("cpj_tvnofilt")

    assert sorted(fetched) == ["AAA", "BBB"]
    row = store.get_job("cpj_tvnofilt")
    assert row["status"] == "completed"
    assert row["total"] == 2


def test_run_scan_prefilter_fail_open_scans_everything(cp_store, monkeypatch):
    """TV unavailable (fail-open): every symbol is still scanned."""
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)
    fetched = []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None):
        fetched.append(symbol)
        return _make_df(80)

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB"]))
    monkeypatch.setattr(
        scan.tv_prefilter_mod, "prefilter_by_volume",
        lambda symbols, **kwargs: (list(symbols), {"fail_open": True}),
    )

    store.save_job({
        "job_id": "cpj_tvfailopen", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"min_rel_volume": 2.0},
    })
    scan.run_job("cpj_tvfailopen")

    assert sorted(fetched) == ["AAA", "BBB"]
    row = store.get_job("cpj_tvfailopen")
    assert row["status"] == "completed"
    assert row["total"] == 2


# ---------------------------------------------------------------------------
# Bug A: old hits are superseded only after a job completes — never at job
# start, never on cancel/failure. ``delete_hits_for(..., keep_job_id=job_id)``
# must preserve the rows the current job just wrote.
# ---------------------------------------------------------------------------


def test_run_job_supersedes_old_hits_after_completion_not_at_start(cp_store, monkeypatch):
    order: list = []
    real_delete = store.delete_hits_for
    real_save_batch = store.save_hits_batch

    def recording_delete(universe, timeframe, keep_job_id=None):
        order.append(("delete", keep_job_id))
        return real_delete(universe, timeframe, keep_job_id=keep_job_id)

    def recording_save_batch(entries):
        job_id = entries[0][0] if entries else None
        order.append(("save_batch", job_id, sum(len(hits) for _, hits in entries)))
        return real_save_batch(entries)

    monkeypatch.setattr(store, "delete_hits_for", recording_delete)
    monkeypatch.setattr(store, "save_hits_batch", recording_save_batch)

    # A previous completed job's hit for the same universe/timeframe.
    store.save_job({"job_id": "cpj_prev", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 1, "done": 1})
    store.save_hits("cpj_prev", [_dupe_hit("OLD")])

    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    store.save_job({"job_id": "cpj_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_job("cpj_new")

    saves = [o for o in order if o[0] == "save_batch"]
    deletes = [o for o in order if o[0] == "delete"]
    # The new job's hits were saved (batched at completion) ...
    assert any(o[1] == "cpj_new" for o in saves)
    # ... and previous hits were superseded exactly once, keeping this job's rows.
    assert len(deletes) == 1
    assert deletes[0][1] == "cpj_new"  # keep_job_id is the current job
    # The delete ran after the new job's saves (completion path), not at job start.
    save_idx = next(i for i, o in enumerate(order) if o[0] == "save_batch" and o[1] == "cpj_new")
    delete_idx = next(i for i, o in enumerate(order) if o[0] == "delete")
    assert save_idx < delete_idx

    # Old hit is gone; only the new job's hit remains for the combo.
    items, total, _ = store.query_results({"universe": "nifty50", "timeframe": "1D"})
    assert total == 1
    assert items[0]["symbol"] == "AAA"
    # The previous job's rows were deleted too.
    _, old_total, _ = store.query_results({"job_id": "cpj_prev"})
    assert old_total == 0


def test_cancelled_job_does_not_delete_old_hits(cp_store, monkeypatch):
    store.save_job({"job_id": "cpj_old", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 1, "done": 1})
    store.save_hits("cpj_old", [_dupe_hit("OLD")])

    delete_calls = []
    real_delete = store.delete_hits_for

    def recording_delete(universe, timeframe, keep_job_id=None):
        delete_calls.append(keep_job_id)
        return real_delete(universe, timeframe, keep_job_id=keep_job_id)

    monkeypatch.setattr(store, "delete_hits_for", recording_delete)
    # Cancel before any symbol work: the completion path is never reached.
    monkeypatch.setattr(jobs, "is_cancelled", lambda job_id: True)
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    store.save_job({"job_id": "cpj_cancel", "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_job("cpj_cancel")

    assert store.get_job("cpj_cancel")["status"] == "cancelled"
    assert delete_calls == []  # nothing superseded when a job produces nothing durable
    items, total, _ = store.query_results({"job_id": "cpj_old"})
    assert total == 1  # old hit intact


# ---------------------------------------------------------------------------
# Bug B: a symbol that fetched and detected cleanly but produced zero hits is
# ``status == "empty"`` — distinct from a real failure, never counted as
# ``failed``. Genuine exceptions still increment ``failed``.
# ---------------------------------------------------------------------------


def test_process_symbol_zero_hits_returns_empty(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [])
    )
    store.save_job({"job_id": "cpj_zero_proc", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    result = scan._process_symbol("AAA", "1D", "cpj_zero_proc")

    assert result["status"] == "empty"
    assert result["data_through"] is not None
    assert result["from_cache"] is False
    # Nothing was persisted for a symbol with no hits.
    items, total, _ = store.query_results({"job_id": "cpj_zero_proc"})
    assert total == 0


def test_run_job_zero_hit_symbol_is_empty_not_failed(cp_store, monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    def detect(df, tf, symbol):
        return [] if symbol == "EMPTY" else [_hit(symbol)]
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["HIT", "EMPTY"]))
    store.save_job({"job_id": "cpj_zero", "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_job("cpj_zero")

    row = store.get_job("cpj_zero")
    assert row["status"] == "completed"
    assert row["failed"] == 0       # zero hits is not a failure
    assert row["done"] == 2
    assert jobs.get_job("cpj_zero")["no_hits"] == 1  # tracked separately (in-memory + Redis only)
    items, total, _ = store.query_results({"job_id": "cpj_zero"})
    assert total == 1
    assert items[0]["symbol"] == "HIT"


def test_genuine_exception_increments_failed(cp_store, monkeypatch):
    logs = []
    monkeypatch.setattr(scan.logger, "warning", lambda *a, **k: logs.append(a))

    def fake_process(symbol, timeframe, job_id, name=None, lookback_bars=None,
                     compute_trendlines=True, as_of_date=None, from_date=None,
                     include_partial_today=None, partial_bar=None, prev_hit=None):
        if symbol == "BOOM":
            raise RuntimeError("symbol worker died")
        return {"status": "ok", "data_through": "2026-01-01", "from_cache": False}

    monkeypatch.setattr(scan, "_process_symbol", fake_process)
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["OK", "BOOM"]))
    store.save_job({"job_id": "cpj_boom", "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_job("cpj_boom")

    row = store.get_job("cpj_boom")
    assert row["status"] == "completed"
    assert row["failed"] == 1       # the real error is still counted
    assert row["done"] == 2
    assert jobs.get_job("cpj_boom")["no_hits"] == 0
    flat = str(logs)
    assert "cpj_boom" in flat and "BOOM" in flat and "RuntimeError" in flat


def test_custom_scan_delete_is_scoped_to_its_symbols(cp_store, monkeypatch):
    seen: dict = {}
    real_delete = store.delete_hits_for

    def recording_delete(universe, timeframe, keep_job_id=None, symbols=None):
        seen.update(universe=universe, symbols=symbols)
        return real_delete(universe, timeframe, keep_job_id=keep_job_id, symbols=symbols)

    monkeypatch.setattr(store, "delete_hits_for", recording_delete)
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None, include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    store.save_job({
        "job_id": "cpj_custom", "universe": "custom", "timeframe": "1D",
        "status": "queued", "params": {"symbols": ["AAA"]},
    })
    scan.run_job("cpj_custom")

    assert seen["universe"] == "custom"
    assert seen["symbols"] == ["AAA"]


# ---------------------------------------------------------------------------
# Source-signature symbol reuse: unchanged symbols skip detection + trendlines.
# ---------------------------------------------------------------------------


def _seed_prev_hit(job_id: str, symbol: str = "AAA", source_sig=None,
                   finished_age_sec: Optional[float] = None) -> None:
    """A completed previous job carrying one hit for `symbol`.

    `finished_age_sec` ages the job past the freshness TTL so the whole-job
    short-circuit does not fire and the symbol-level reuse path is exercised.
    """
    from datetime import datetime, timedelta, timezone

    finished_at = None
    if finished_age_sec is not None:
        finished_at = (
            datetime.now(timezone.utc) - timedelta(seconds=finished_age_sec)
        ).isoformat()
    store.save_job({
        "job_id": job_id, "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 1, "done": 1, "failed": 0, "skipped": 0,
        "finished_at": finished_at,
        "params": {"scan_signature": scan._detector_signature()},
    })
    hit = scan._hit_to_dict(_hit(symbol))
    if source_sig is not None:
        hit["source_sig"] = source_sig
    store.save_hits(job_id, [hit])


def _market_open(monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)


def test_consecutive_runs_second_run_detects_zero(cp_store, monkeypatch):
    """Run 1 detects; run 2 on an unchanged frame reuses every stored hit."""
    _market_open(monkeypatch)
    detect_calls = []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None,
                   lookback_bars=None, include_partial_today=None, partial_bar=None):
        return _make_df(80)

    def fake_detect(df, timeframe, symbol):
        detect_calls.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )

    store.save_job({
        "job_id": "cpj_consec1", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True},
    })
    scan.run_job("cpj_consec1")
    assert detect_calls == ["AAA"]
    first_symbols = {i["symbol"] for i in store.query_results({"job_id": "cpj_consec1"})[0]}

    # Age the previous job past the freshness TTL so run 2 must take the
    # symbol-level reuse path (the whole-job short-circuit is skipped).
    from datetime import datetime, timedelta, timezone

    stale = (
        datetime.now(timezone.utc) - timedelta(seconds=scan.SCAN_FRESH_SECONDS + 60)
    ).isoformat()
    store.update_job("cpj_consec1", finished_at=stale)

    store.save_job({
        "job_id": "cpj_consec2", "universe": "nifty50", "timeframe": "1D",
        "status": "queued",
    })
    scan.run_job("cpj_consec2")

    # Identical frame -> identical source signature -> zero new detections.
    assert detect_calls == ["AAA"]
    row = store.get_job("cpj_consec2")
    assert row["status"] == "completed"
    assert row["done"] == 1
    provenance = (jobs.get_job("cpj_consec2") or {}).get("provenance") or {}
    assert int(provenance.get("reused") or 0) >= 1
    items, total, _ = store.query_results({"job_id": "cpj_consec2"})
    assert total == 1
    assert {i["symbol"] for i in items} == first_symbols == {"AAA"}
    assert items[0]["source_sig"] is not None


def test_changed_last_close_forces_redetect(cp_store, monkeypatch):
    """A changed last close changes the source signature -> re-detect."""
    _market_open(monkeypatch)
    detect_calls = []
    prev_sig = scan._source_sig(_make_df(80), "1D", None, True)
    _seed_prev_hit("cpj_close_prev", "AAA", source_sig=prev_sig,
                   finished_age_sec=scan.SCAN_FRESH_SECONDS + 60)

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None,
                   lookback_bars=None, include_partial_today=None, partial_bar=None):
        df = _make_df(80)
        df.iloc[-1, df.columns.get_loc("close")] = 999.0  # last close moved
        return df

    def fake_detect(df, timeframe, symbol):
        detect_calls.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    store.save_job({
        "job_id": "cpj_close_new", "universe": "nifty50", "timeframe": "1D",
        "status": "queued",
    })
    scan.run_job("cpj_close_new")

    assert detect_calls == ["AAA"]
    assert store.get_job("cpj_close_new")["status"] == "completed"


def test_force_always_detects(cp_store, monkeypatch):
    """`force=True` re-detects even when the source signature matches."""
    _market_open(monkeypatch)
    detect_calls = []
    prev_sig = scan._source_sig(_make_df(80), "1D", None, True)
    _seed_prev_hit("cpj_force_prev", "AAA", source_sig=prev_sig,
                   finished_age_sec=scan.SCAN_FRESH_SECONDS + 60)

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None,
                   lookback_bars=None, include_partial_today=None, partial_bar=None):
        return _make_df(80)

    def fake_detect(df, timeframe, symbol):
        detect_calls.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    store.save_job({
        "job_id": "cpj_force_new", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True},
    })
    scan.run_job("cpj_force_new")

    assert detect_calls == ["AAA"]
    assert store.get_job("cpj_force_new")["status"] == "completed"


def test_missing_source_sig_legacy_row_detects(cp_store, monkeypatch):
    """Legacy hits without `source_sig` are re-detected (never silently reused)."""
    _market_open(monkeypatch)
    detect_calls = []
    _seed_prev_hit("cpj_legacy_prev", "AAA", source_sig=None,
                   finished_age_sec=scan.SCAN_FRESH_SECONDS + 60)

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None,
                   lookback_bars=None, include_partial_today=None, partial_bar=None):
        return _make_df(80)

    def fake_detect(df, timeframe, symbol):
        detect_calls.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    store.save_job({
        "job_id": "cpj_legacy_new", "universe": "nifty50", "timeframe": "1D",
        "status": "queued",
    })
    scan.run_job("cpj_legacy_new")

    assert detect_calls == ["AAA"]
    assert store.get_job("cpj_legacy_new")["status"] == "completed"


def _interior_frame_b() -> pd.DataFrame:
    """Frame B: 79 bars at 200, last bar untouched (close 120, len 80).

    Same last date/timestamp/close/length as _make_df(80) (frame A), different
    interior — the audit collision case.
    """
    df = _make_df(80)
    df.iloc[:-1] = 200.0  # interior bars all 200; last bar keeps close == 120
    return df


def test_different_frame_interior_forces_redetect(cp_store, monkeypatch):
    """Same tail stats but different interior -> new signature -> re-detect (no reuse).

    Reproduces the audit collision: frame A = linspace(100->120), frame B =
    79 bars at 200 then last bar 120. Both share last date/timestamp/close/length
    (old signature would collide), but the interior digest differs so detection
    must run and the stored hit reflects frame B.
    """
    _market_open(monkeypatch)
    detect_calls = []

    frame_a = _make_df(80)  # close 100->120, last close 120
    prev_sig = scan._source_sig(frame_a, "1D", None, True)
    _seed_prev_hit("cpj_interior_prev", "AAA", source_sig=prev_sig,
                   finished_age_sec=scan.SCAN_FRESH_SECONDS + 60)

    # Sanity: the new signature (with interior digest) separates these two frames
    # whose tail-only signature would collide (the bug).
    assert scan._frame_signature(frame_a) != scan._frame_signature(_interior_frame_b())

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None,
                   lookback_bars=None, include_partial_today=None, partial_bar=None):
        return _interior_frame_b()

    def fake_detect(df, timeframe, symbol):
        detect_calls.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    store.save_job({
        "job_id": "cpj_interior_new", "universe": "nifty50", "timeframe": "1D",
        "status": "queued",
    })
    scan.run_job("cpj_interior_new")

    # Detection MUST run (no silent reuse of the frame-A hit).
    assert detect_calls == ["AAA"]
    row = store.get_job("cpj_interior_new")
    assert row["status"] == "completed"
    provenance = (jobs.get_job("cpj_interior_new") or {}).get("provenance") or {}
    assert int(provenance.get("reused") or 0) == 0
    items, total, _ = store.query_results({"job_id": "cpj_interior_new"})
    assert total == 1
    assert items[0]["source_sig"] != prev_sig  # stored hit reflects frame B


# ---------------------------------------------------------------------------
# Process-based fan-out (PATTERN_SCAN_USE_PROCESSES / params.use_processes).
# The fake pool below is thread-backed so monkeypatched fetch/detect deps stay
# visible to the worker (real spawn re-imports the module and loses them), but
# it routes through scan's process-path code: functools.partial submission,
# as_completed, cancellation, and the spawn context.
# ---------------------------------------------------------------------------


class _FakeProcessPool:
    """Thread-backed stand-in for ProcessPoolExecutor exercising scan's process path."""

    instances: list = []

    def __init__(self, max_workers=None, mp_context=None, **kwargs):
        self.max_workers = max_workers
        self.mp_context = mp_context
        self._pool = _RealThreadPool(max_workers=max_workers or 1)
        _FakeProcessPool.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._pool.shutdown(wait=True, cancel_futures=True)
        return False

    def submit(self, fn, *args, **kwargs):
        return self._pool.submit(fn, *args, **kwargs)

    def shutdown(self, wait=True, cancel_futures=False):
        self._pool.shutdown(wait=wait, cancel_futures=cancel_futures)


class _FakeThreadPool:
    """Thread-backed stand-in for ThreadPoolExecutor recording instantiation."""

    instances: list = []

    def __init__(self, max_workers=None, **kwargs):
        self.max_workers = max_workers
        self._pool = _RealThreadPool(max_workers=max_workers or 1)
        _FakeThreadPool.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._pool.shutdown(wait=True, cancel_futures=True)
        return False

    def submit(self, fn, *args, **kwargs):
        return self._pool.submit(fn, *args, **kwargs)

    def shutdown(self, wait=True, cancel_futures=False):
        self._pool.shutdown(wait=wait, cancel_futures=cancel_futures)


def _eq_items(job_id: str) -> dict:
    items, _, _ = store.query_results({"job_id": job_id})
    return {
        i["symbol"]: {
            "pattern_id": i["pattern_id"],
            "pattern_name": i["pattern_name"],
            "status": i["status"],
            "direction": i["direction"],
            "source_sig": i.get("source_sig"),
            "trend_lines": i.get("trend_lines"),
            "trend_lines_sig": i.get("trend_lines_sig"),
            "confidence": i.get("confidence"),
        }
        for i in items
    }


def _eq_patch(monkeypatch):
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None,
        include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB", "CCC"])
    )


def test_process_mode_matches_threads_on_hits(cp_store, monkeypatch):
    """Process path yields identical hits/symbols/statuses/source_sig/trend_lines vs threads."""
    _eq_patch(monkeypatch)
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    def run(job_id: str, use_processes: bool) -> tuple[dict, int, int]:
        _FakeProcessPool.instances.clear()
        _FakeThreadPool.instances.clear()
        store.save_job({"job_id": job_id, "universe": "nifty50", "timeframe": "1D",
                        "status": "queued", "params": {"force": True, "use_processes": use_processes}})
        scan.run_job(job_id)
        row = store.get_job(job_id)
        assert row["status"] == "completed"
        assert row["done"] == 3
        return _eq_items(job_id), len(_FakeProcessPool.instances), len(_FakeThreadPool.instances)

    thread_items, t_proc, t_thread = run("cpj_eq_thread", False)
    proc_items, p_proc, p_thread = run("cpj_eq_proc", True)

    assert proc_items == thread_items
    assert set(proc_items) == {"AAA", "BBB", "CCC"}
    # Threads: only the thread pool was instantiated.
    assert t_thread >= 1 and t_proc == 0
    # Processes: only the process pool was instantiated, with a spawn context (never fork).
    assert p_proc == 1 and p_thread == 0
    assert _FakeProcessPool.instances[0].mp_context is not None
    assert type(_FakeProcessPool.instances[0].mp_context).__name__ == "SpawnContext"


def test_process_path_cancellation_terminates(cp_store, monkeypatch):
    """Cancellation stops the process path; old hits are never superseded."""
    fetched, detected = [], []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None,
                   include_partial_today=None, partial_bar=None):
        fetched.append(symbol)
        return _make_df(80)

    def fake_detect(df, tf, symbol):
        detected.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB", "CCC"])
    )
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    # Cancelled before any symbol work.
    monkeypatch.setattr(jobs, "is_cancelled", lambda job_id: True)

    store.save_job({"job_id": "cpj_cancel_old", "universe": "nifty50", "timeframe": "1D",
                    "status": "completed", "total": 1, "done": 1})
    store.save_hits("cpj_cancel_old", [_dupe_hit("OLD")])

    delete_calls = []
    real_delete = store.delete_hits_for

    def recording_delete(universe, timeframe, keep_job_id=None, symbols=None):
        delete_calls.append((keep_job_id, symbols))
        return real_delete(universe, timeframe, keep_job_id=keep_job_id, symbols=symbols)

    monkeypatch.setattr(store, "delete_hits_for", recording_delete)

    store.save_job({"job_id": "cpj_cancel_proc", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True, "use_processes": True}})
    scan.run_job("cpj_cancel_proc")

    row = store.get_job("cpj_cancel_proc")
    assert row["status"] == "cancelled"
    assert row["finished_at"] is not None
    # No symbol work started once cancellation was signalled.
    assert fetched == [] and detected == []
    # Cancel never supersedes previous hits.
    assert delete_calls == []
    items_o, total_o, _ = store.query_results({"job_id": "cpj_cancel_old"})
    assert total_o == 1  # old hit intact


def test_process_path_workers_never_call_store(cp_store, monkeypatch):
    """The worker (_process_symbol) never touches store; all writes stay in the parent."""
    store_write_calls = []
    real_save_batch = store.save_hits_batch
    real_update = jobs.update_state

    def recording_save_batch(entries):
        store_write_calls.append(("save_hits_batch", entries))
        return real_save_batch(entries)

    def recording_update(job_id, **fields):
        store_write_calls.append(("update_state", job_id, fields))
        return real_update(job_id, **fields)

    monkeypatch.setattr(store, "save_hits_batch", recording_save_batch)
    monkeypatch.setattr(jobs, "update_state", recording_update)

    _eq_patch(monkeypatch)
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB"]))
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)

    # Worker simulation: _process_symbol runs as a worker would. It must not write store.
    result = scan._process_symbol("AAA", "1D", "cpj_parent_only")
    assert result["status"] == "ok"
    assert not any(c[0] in ("save_hits_batch", "delete_hits_for") for c in store_write_calls), \
        "worker must not write store"

    # Full job: the parent performs all store writes (flush at completion).
    store.save_job({"job_id": "cpj_parent_only_job", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True, "use_processes": True}})
    scan.run_job("cpj_parent_only_job")
    assert store.get_job("cpj_parent_only_job")["status"] == "completed"
    assert any(c[0] == "save_hits_batch" for c in store_write_calls), "parent must flush hits"


def test_process_unavailable_falls_back_to_threads(cp_store, monkeypatch):
    """When the process pool cannot be created, the scan degrades to threads, never crashes."""
    fetched = []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None,
                   include_partial_today=None, partial_bar=None):
        fetched.append(symbol)
        return _make_df(80)

    def fake_detect(df, tf, symbol):
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB"])
    )
    # Force process mode, but the process pool cannot be created.
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)

    class _BrokenProcessPool:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("no processes allowed")

    monkeypatch.setattr(scan, "ProcessPoolExecutor", _BrokenProcessPool)

    used = {"threads": False}

    class _RecordingThreadPool(scan.ThreadPoolExecutor):
        def __init__(self, *a, **k):
            used["threads"] = True
            super().__init__(*a, **k)

    monkeypatch.setattr(scan, "ThreadPoolExecutor", _RecordingThreadPool)

    store.save_job({"job_id": "cpj_fallback", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True, "use_processes": True}})
    scan.run_job("cpj_fallback")

    row = store.get_job("cpj_fallback")
    assert row["status"] == "completed"
    assert row["done"] == 2
    assert used["threads"] is True  # degraded to threads, never crashed
    items, total, _ = store.query_results({"job_id": "cpj_fallback"})
    assert total == 2
    assert {i["symbol"] for i in items} == {"AAA", "BBB"}
    assert sorted(fetched) == ["AAA", "BBB"]


def test_both_pools_broken_still_runs_sequentially(cp_store, monkeypatch):
    """When neither pool is available, the scan still completes sequentially."""

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None,
                   include_partial_today=None, partial_bar=None):
        return _make_df(80)

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)]))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"])
    )
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)

    class _BrokenPool:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("no pools today")

    monkeypatch.setattr(scan, "ProcessPoolExecutor", _BrokenPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _BrokenPool)

    store.save_job({"job_id": "cpj_seq", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True, "use_processes": True}})
    scan.run_job("cpj_seq")

    row = store.get_job("cpj_seq")
    assert row["status"] == "completed"
    assert row["done"] == 1
    items, total, _ = store.query_results({"job_id": "cpj_seq"})
    assert total == 1


def test_default_stays_threads(cp_store, monkeypatch):
    """Without the opt-in flag, the process pool is never instantiated; threads are used."""
    _eq_patch(monkeypatch)
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)

    proc_insts = {"n": 0}
    real_pp = scan.ProcessPoolExecutor

    class _RecProc(real_pp):
        def __init__(self, *a, **k):
            proc_insts["n"] += 1
            super().__init__(*a, **k)

    thread_insts = {"n": 0}
    real_tp = scan.ThreadPoolExecutor

    class _RecThread(real_tp):
        def __init__(self, *a, **k):
            thread_insts["n"] += 1
            super().__init__(*a, **k)

    monkeypatch.setattr(scan, "ProcessPoolExecutor", _RecProc)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _RecThread)

    store.save_job({"job_id": "cpj_default", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_default")

    assert store.get_job("cpj_default")["status"] == "completed"
    assert proc_insts["n"] == 0, "process pool must not be used by default"
    assert thread_insts["n"] >= 1, "thread pool must be used by default"


# ---------------------------------------------------------------------------
# Auto process mode: threshold-based selection plus env/param overrides.
# The pools below are thread-backed stand-ins so monkeypatched fetch/detect
# deps stay visible; they record *which* pool scan chose (never fork).
# ---------------------------------------------------------------------------


def _auto_patch(monkeypatch, n: int) -> None:
    """Wire `n` symbols with fake, instant fetch/detect; no network calls.

    Callers that want a specific env override must set it (monkeypatch isolates
    env per test, so a clean auto environment is the default at test entry).
    """
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None,
        include_partial_today=None, partial_bar=None: _make_df(80),
    )
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(
        scan, "universes_mod",
        SimpleNamespace(get_universe=lambda uid: [f"S{i:03d}" for i in range(n)]),
    )
    # Skip the live 1D batch-quote path (would reach the network).
    monkeypatch.setattr("market_data.market_data.fetch_ohlc_batch", lambda *a, **k: {})


def _pool_counts() -> tuple[int, int]:
    return len(_FakeProcessPool.instances), len(_FakeThreadPool.instances)


def test_auto_below_threshold_uses_threads(cp_store, monkeypatch):
    """100 symbols (< threshold 300), nothing forced: threads, no process spawn."""
    _auto_patch(monkeypatch, 100)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    store.save_job({"job_id": "cpj_auto_small", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_auto_small")

    row = store.get_job("cpj_auto_small")
    assert row["status"] == "completed"
    assert row["done"] == 100
    proc, thread = _pool_counts()
    assert thread >= 1 and proc == 0


def test_auto_at_threshold_uses_processes(cp_store, monkeypatch):
    """300 symbols (>= threshold), nothing forced: process pool with spawn context."""
    if not parallel.supports_processes():
        pytest.skip("spawn not available on this platform")
    _auto_patch(monkeypatch, 300)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    store.save_job({"job_id": "cpj_auto_big", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_auto_big")

    row = store.get_job("cpj_auto_big")
    assert row["status"] == "completed"
    assert row["done"] == 300
    proc, thread = _pool_counts()
    assert proc == 1 and thread == 0
    assert _FakeProcessPool.instances[0].mp_context is not None
    assert type(_FakeProcessPool.instances[0].mp_context).__name__ == "SpawnContext"


def test_env_zero_forces_threads_above_threshold(cp_store, monkeypatch):
    """PATTERN_SCAN_USE_PROCESSES=0 forces threads even for a large universe."""
    monkeypatch.setenv("PATTERN_SCAN_USE_PROCESSES", "0")
    _auto_patch(monkeypatch, 400)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    store.save_job({"job_id": "cpj_env0", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_env0")

    assert store.get_job("cpj_env0")["status"] == "completed"
    proc, thread = _pool_counts()
    assert thread >= 1 and proc == 0


def test_env_one_forces_processes_below_threshold(cp_store, monkeypatch):
    """PATTERN_SCAN_USE_PROCESSES=1 forces processes even for a small universe."""
    if not parallel.supports_processes():
        pytest.skip("spawn not available on this platform")
    monkeypatch.setenv("PATTERN_SCAN_USE_PROCESSES", "1")
    _auto_patch(monkeypatch, 50)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    store.save_job({"job_id": "cpj_env1", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_env1")

    assert store.get_job("cpj_env1")["status"] == "completed"
    proc, thread = _pool_counts()
    assert proc == 1 and thread == 0


def test_param_false_forces_threads_above_threshold(cp_store, monkeypatch):
    """params use_processes=False forces threads even for a large universe."""
    _auto_patch(monkeypatch, 400)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    store.save_job({"job_id": "cpj_param_false", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True, "use_processes": False}})
    scan.run_job("cpj_param_false")

    assert store.get_job("cpj_param_false")["status"] == "completed"
    proc, thread = _pool_counts()
    assert thread >= 1 and proc == 0


def test_param_true_forces_processes_below_threshold(cp_store, monkeypatch):
    """params use_processes=True forces processes even for a small universe."""
    if not parallel.supports_processes():
        pytest.skip("spawn not available on this platform")
    _auto_patch(monkeypatch, 50)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    store.save_job({"job_id": "cpj_param_true", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True, "use_processes": True}})
    scan.run_job("cpj_param_true")

    assert store.get_job("cpj_param_true")["status"] == "completed"
    proc, thread = _pool_counts()
    assert proc == 1 and thread == 0


def test_auto_parent_only_writes_at_threshold(cp_store, monkeypatch):
    """At the process threshold the parent still performs all store writes."""
    if not parallel.supports_processes():
        pytest.skip("spawn not available on this platform")
    store_write_calls = []
    real_save_batch = store.save_hits_batch
    real_update = jobs.update_state

    def recording_save_batch(entries):
        store_write_calls.append(("save_hits_batch", entries))
        return real_save_batch(entries)

    def recording_update(job_id, **fields):
        store_write_calls.append(("update_state", job_id, fields))
        return real_update(job_id, **fields)

    monkeypatch.setattr(store, "save_hits_batch", recording_save_batch)
    monkeypatch.setattr(jobs, "update_state", recording_update)

    _auto_patch(monkeypatch, 300)
    _FakeProcessPool.instances.clear()
    _FakeThreadPool.instances.clear()
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    monkeypatch.setattr(scan, "ThreadPoolExecutor", _FakeThreadPool)

    # Direct worker call must not touch store.
    result = scan._process_symbol("S000", "1D", "cpj_auto_parent_direct")
    assert result["status"] == "ok"
    assert not any(c[0] in ("save_hits_batch", "delete_hits_for") for c in store_write_calls), \
        "worker must not write store"

    # Full job: the parent performs all store writes (flush at completion).
    store.save_job({"job_id": "cpj_auto_parent", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_auto_parent")
    assert store.get_job("cpj_auto_parent")["status"] == "completed"
    assert any(c[0] == "save_hits_batch" for c in store_write_calls), "parent must flush hits"


def test_auto_cancellation_still_works(cp_store, monkeypatch):
    """Cancellation stops the auto process path; no symbol work, old hits intact."""
    if not parallel.supports_processes():
        pytest.skip("spawn not available on this platform")
    fetched, detected = [], []

    def fake_fetch(symbol, timeframe, as_of_date=None, api_client=None, lookback_bars=None,
                   include_partial_today=None, partial_bar=None):
        fetched.append(symbol)
        return _make_df(80)

    def fake_detect(df, tf, symbol):
        detected.append(symbol)
        return [_hit(symbol)]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: [f"S{i:03d}" for i in range(300)])
    )
    monkeypatch.delenv("PATTERN_SCAN_USE_PROCESSES", raising=False)
    monkeypatch.setattr(scan, "ProcessPoolExecutor", _FakeProcessPool)
    # Cancelled before any symbol work.
    monkeypatch.setattr(jobs, "is_cancelled", lambda job_id: True)

    store.save_job({"job_id": "cpj_auto_cancel", "universe": "nifty50", "timeframe": "1D",
                    "status": "queued", "params": {"force": True}})
    scan.run_job("cpj_auto_cancel")

    row = store.get_job("cpj_auto_cancel")
    assert row["status"] == "cancelled"
    assert row["finished_at"] is not None
    assert fetched == [] and detected == []
