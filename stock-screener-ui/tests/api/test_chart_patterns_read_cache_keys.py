"""Read-cache key guards for /matrix, /summary and /patterns/lookup.

The matrix key used to carry every known frame identity (including per-symbol
intraday digests) and re-queried the scan stamp once per timeframe, so it churned
on every market-hours poll and the 3-second cache never hit. The key must instead
be stable while a session is in progress and change only when the completed
session or a scan stamp advances — without altering any response shape.
"""
from __future__ import annotations

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router


class _FakeUser:
    id = 1
    email = "qa@test.com"


@pytest.fixture(autouse=True)
def _clean_caches():
    cp_api._clear_read_caches()
    yield
    cp_api._clear_read_caches()


def _frame(closes, end: str) -> pd.DataFrame:
    idx = pd.date_range(end=end, periods=len(closes), freq="D", tz="UTC")
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c + 1 for c in closes],
            "low": [c - 1 for c in closes],
            "close": closes,
            "volume": [1000.0] * len(closes),
        },
        index=idx,
    )


def test_matrix_key_stable_across_unrelated_frames_but_tracks_session_and_scan(monkeypatch):
    stamps = {"1D": "2026-11-16T09:00:00"}
    monkeypatch.setattr(
        cp_api, "_scan_stamps_for",
        lambda universe, tf_ids: {tf: stamps.get(tf) for tf in tf_ids},
    )

    cp_api._remember_frame(("KAYNES", "1D"), _frame([3300.0, 3382.0], "2026-11-13"), 3382.0, 2.48)
    before = cp_api._matrix_cache_key("custom", ["1D"], 400)

    # Another symbol's frame advances inside the same completed session: the
    # coarse watermark must not churn the key.
    cp_api._remember_frame(("INFY", "1D"), _frame([100.0, 101.0], "2026-11-13"), 101.0, 1.0)
    assert cp_api._matrix_cache_key("custom", ["1D"], 400) == before

    # A newly published completed session must invalidate.
    cp_api._remember_frame(
        ("KAYNES", "1D"), _frame([3300.0, 3382.0, 3430.0], "2026-11-16"), 3430.0, 1.42
    )
    assert cp_api._matrix_cache_key("custom", ["1D"], 400) != before

    # So must a newer scan, even with the frame stamp held fixed.
    stamps["1D"] = "2026-11-16T10:00:00"
    after_scan = cp_api._matrix_cache_key("custom", ["1D"], 400)
    assert after_scan != before
    assert cp_api._matrix_cache_key("custom", ["1D"], 400) == after_scan


def test_one_scan_stamp_query_covers_every_matrix_timeframe(monkeypatch):
    """The batched helper is called once with all timeframes, not once per tf."""
    calls = []

    def fake_stamps(universe, tf_ids):
        calls.append((universe, tuple(tf_ids)))
        return {tf: "2026-11-16T09:00:00" for tf in tf_ids}

    monkeypatch.setattr(cp_api, "_scan_stamps_for", fake_stamps)
    cp_api._matrix_cache_key("custom", ["1D", "1h", "15m"], 400)
    assert calls == [("custom", ("1D", "1h", "15m"))]


def test_summary_and_lookup_payloads_are_identical_across_key_changes(monkeypatch):
    """Changing a key input only triggers a recompute; it never changes the body."""
    stamps = {"1D": "2026-11-16T09:00:00"}
    monkeypatch.setattr(
        cp_api, "_scan_stamps_for",
        lambda universe, tf_ids: {tf: stamps.get(tf) for tf in tf_ids},
    )
    hit = {
        "symbol": "KAYNES", "timeframe": "1D", "pattern_name": "Bull Flag",
        "pattern_id": "bull_flag", "confidence": 70.0, "status": "confirmed",
        "direction": "bullish", "bars_ago": 2, "end_date": "2026-11-13",
        "end_price": 3430.0,
    }
    monkeypatch.setattr(
        cp_api.store, "query_results",
        lambda *a, **k: ([hit], 1, {"data_through": "2026-11-13"}),
    )
    monkeypatch.setattr(
        cp_api.store, "compute_summary",
        lambda *a, **k: {
            "scanned": 1, "patterns": 1, "in_view": 1, "confirmed": 1,
            "forming": 0, "bullish": 1, "bearish": 0,
            "data_through": "2026-11-13", "last_scan_at": "2026-11-16T09:00:00",
            "pattern_counts": {"bull_flag": 1}, "family_counts": {"continuation": 1},
        },
    )

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    try:
        with TestClient(app) as client:
            summary_1 = client.get(
                "/api/chart-patterns/summary",
                params={"universe": "custom", "timeframe": "1D"},
            ).json()
            lookup_1 = client.post(
                "/api/chart-patterns/patterns/lookup",
                json={"symbols": ["KAYNES"], "timeframe": "1D", "universe": "custom"},
            ).json()

            stamps["1D"] = "2026-11-16T10:00:00"

            summary_2 = client.get(
                "/api/chart-patterns/summary",
                params={"universe": "custom", "timeframe": "1D"},
            ).json()
            lookup_2 = client.post(
                "/api/chart-patterns/patterns/lookup",
                json={"symbols": ["KAYNES"], "timeframe": "1D", "universe": "custom"},
            ).json()
    finally:
        app.dependency_overrides.clear()

    assert summary_1 == summary_2
    assert lookup_1 == lookup_2
