"""Cache-provenance for chart-pattern scans.

Covers:
- ``candles.fetch_for_timeframe(..., provenance=d)`` hit vs miss.
- ``scan.run_job`` aggregation (``candles_cached``/``candles_fetched``,
  ``prefilter_dropped``) and the ``provenance`` job-state/pub field
  (``jobs.get_job`` + the ``params`` DB mirror).
- Backward compatibility with fetchers that lack the ``provenance`` kwarg.
"""
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from sqlalchemy.orm import sessionmaker

from chart_patterns import candles as candles_mod
from chart_patterns import jobs, scan, store
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
        trendlines=[],
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


def _mock_tf(monkeypatch):
    monkeypatch.setattr(
        candles_mod, "_resolve_timeframe",
        lambda tf_id: {"minutes": 1440, "source_tf": None, "max_lookback_days": 730},
    )


def test_fetch_provenance_miss(monkeypatch, tmp_path):
    """Cache miss: fresh fetch, ``from_cache`` False, no age/session."""
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _mock_tf(monkeypatch)
    fresh = _make_df(80)
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: fresh,
    )

    prov: dict = {}
    got = candles_mod.fetch_for_timeframe("AAA", "1D", provenance=prov)

    assert got is fresh
    assert prov["from_cache"] is False
    assert prov["cache_age_sec"] is None
    assert prov["session_pin"] is None


def test_fetch_provenance_hit(monkeypatch, tmp_path):
    """Cache hit: served from disk, age/session come from the ``.meta`` sidecar."""
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _mock_tf(monkeypatch)
    cached_df = _make_df(80)
    candles_mod._write_cached(
        candles_mod._cache_path("1D", "AAA"), cached_df, is_today=True
    )

    def _boom(symbol, timeframe, **kwargs):
        raise AssertionError("hit must not touch the network fetcher")

    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe", _boom
    )

    prov: dict = {}
    got = candles_mod.fetch_for_timeframe("AAA", "1D", provenance=prov)

    assert got is not None and len(got) == 80
    assert prov["from_cache"] is True
    assert isinstance(prov["cache_age_sec"], int) and prov["cache_age_sec"] >= 0
    assert isinstance(prov["session_pin"], str) and prov["session_pin"]


def test_fetch_provenance_hit_without_meta(monkeypatch, tmp_path):
    """A historical ``.pkl`` without a ``.meta`` sidecar is a hit, age/session None."""
    import pickle

    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _mock_tf(monkeypatch)
    path = candles_mod._cache_path("1D", "BBB", "2020-01-05")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(_make_df(80), f)
    assert not path.with_suffix(".meta").exists()

    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: (_ for _ in ()).throw(
            AssertionError("must not fetch on a hit")
        ),
    )

    prov: dict = {}
    got = candles_mod.fetch_for_timeframe(
        "BBB", "1D", as_of_date="2020-01-05", provenance=prov
    )

    assert got is not None and len(got) == 80
    assert prov["from_cache"] is True
    assert prov["cache_age_sec"] is None
    assert prov["session_pin"] is None


def test_fetch_without_provenance_arg_unchanged(monkeypatch, tmp_path):
    """Omitting ``provenance`` keeps the old call shape working."""
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _mock_tf(monkeypatch)
    fresh = _make_df(80)
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: fresh,
    )

    assert candles_mod.fetch_for_timeframe("AAA", "1D") is fresh


def _run_scan_with_fake_fetch(cp_store, monkeypatch, fake_fetch, params=None,
                              universe_symbols=None, job_id="cpj_prov_0"):
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)
    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(
        scan, "universes_mod",
        SimpleNamespace(get_universe=lambda uid: list(universe_symbols or ["AAA", "BBB", "CCC"])),
    )
    store.save_job({
        "job_id": job_id, "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": params or {},
    })
    scan.run_job(job_id)
    return job_id


def test_run_job_aggregates_cache_provenance(cp_store, monkeypatch):
    """One cache hit + two misses aggregate into cached/fetched counters."""
    def fake_fetch(symbol, timeframe, provenance=None, **kwargs):
        if provenance is not None:
            provenance.update({
                "from_cache": symbol == "AAA",
                "cache_age_sec": 3 if symbol == "AAA" else None,
                "session_pin": None,
            })
        return _make_df(80)

    job_id = _run_scan_with_fake_fetch(cp_store, monkeypatch, fake_fetch)

    dto = jobs.get_job(job_id)
    prov = dto.get("provenance")
    assert prov == {
        "scan_reused": False,
        "candles_cached": 1,
        "candles_fetched": 2,
        "prefilter_dropped": None,
        "detector_version": scan.SCAN_DETECTOR_VERSION,
        "data_through": dto.get("data_through"),
    }
    assert prov["data_through"] is not None
    # The params mirror carries provenance so it survives a DB round-trip.
    row = store.get_job(job_id)
    assert row["params"]["provenance"] == prov


def test_run_job_provenance_prefilter_dropped(cp_store, monkeypatch):
    """The TV prefilter drop count (before − after) lands in provenance."""
    def fake_fetch(symbol, timeframe, provenance=None, **kwargs):
        if provenance is not None:
            provenance.update({
                "from_cache": symbol == "AAA",
                "cache_age_sec": 1 if symbol == "AAA" else None,
                "session_pin": None,
            })
        return _make_df(80)

    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)
    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [_hit(s)])
    )
    monkeypatch.setattr(
        scan, "universes_mod",
        SimpleNamespace(get_universe=lambda uid: ["AAA", "BBB", "CCC"]),
    )
    monkeypatch.setattr(
        scan.tv_prefilter_mod, "prefilter_by_volume",
        lambda symbols, **kwargs: (
            ["AAA", "BBB"], {"before": 3, "after": 2, "message": "TV prefilter: 3 → 2"}
        ),
    )
    store.save_job({
        "job_id": "cpj_prov_pre", "universe": "nifty500", "timeframe": "1D",
        "status": "queued", "params": {"min_rel_volume": 1.5},
    })
    scan.run_job("cpj_prov_pre")

    dto = jobs.get_job("cpj_prov_pre")
    prov = dto.get("provenance")
    assert prov["prefilter_dropped"] == 1
    assert prov["candles_cached"] == 1
    assert prov["candles_fetched"] == 1
    assert dto["total"] == 2


def test_run_job_legacy_fetcher_without_provenance_kwarg(cp_store, monkeypatch):
    """Fetchers without the ``provenance`` out-param still scan (all fetched)."""
    def legacy_fetch(symbol, timeframe, as_of_date=None, api_client=None,
                     lookback_bars=None, include_partial_today=None):
        return _make_df(80)

    job_id = _run_scan_with_fake_fetch(cp_store, monkeypatch, legacy_fetch)

    dto = jobs.get_job(job_id)
    assert dto["status"] == "completed"
    prov = dto.get("provenance")
    assert prov["candles_cached"] == 0
    assert prov["candles_fetched"] == 3
    assert prov["scan_reused"] is False


def test_run_job_reuse_carries_provenance(cp_store, monkeypatch):
    """A freshness-reused job reports ``scan_reused`` with zero candle counts."""
    from datetime import datetime, timezone

    store.save_job({
        "job_id": "cpj_prov_prev", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 2, "done": 2,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "params": {"scan_signature": scan._detector_signature()},
    })

    def _boom(symbol, timeframe, **kwargs):
        raise AssertionError("reused scan must not fetch")

    job_id = _run_scan_with_fake_fetch(
        cp_store, monkeypatch, _boom, universe_symbols=["AAA", "BBB"]
    )

    dto = jobs.get_job(job_id)
    assert dto["status"] == "completed"
    prov = dto.get("provenance")
    assert prov["scan_reused"] is True
    assert prov["candles_cached"] == 0
    assert prov["candles_fetched"] == 0
    assert prov["detector_version"] == scan.SCAN_DETECTOR_VERSION
    # Reuse markers are untouched.
    assert dto.get("reused") is True
    assert dto["params"]["reused"] is True
