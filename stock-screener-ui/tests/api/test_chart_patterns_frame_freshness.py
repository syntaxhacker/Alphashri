"""Backend frame-freshness guards for pattern enrichment (KAYNES incident).

A ``last_close``/``day_change_pct`` pair must always describe the exact candle
frame that produced the returned series — never an older persisted value that
happened to be cached under the same symbol+timeframe key.
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
    cp_api._clear_chart_caches()
    cp_api._clear_read_caches()
    yield
    cp_api._clear_chart_caches()
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


def _stale_item() -> dict:
    return {
        "symbol": "KAYNES", "timeframe": "1D", "pattern_id": "descending_channel",
        "pattern_name": "Descending Channel", "direction": "bearish", "status": "confirmed",
        "confidence": 70.0, "bars_ago": 16, "end_price": 2986.0,
        "last_close": 3382.0, "day_change_pct": 2.48,
    }


def test_stale_stored_close_replaced_by_current_frame(monkeypatch):
    """A 3,382 stored close can never survive an enrichment on a 3,430 frame."""
    df = _frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    item = _stale_item()
    out = cp_api._enrich_with_candles([item], "1D")
    expected_close, expected_change = cp_api._last_close_change(df)

    assert out[0]["last_close"] == 3430.0
    assert out[0]["last_close"] == expected_close
    assert out[0]["day_change_pct"] == expected_change
    assert out[0]["candles"][-1]["c"] == expected_close


def test_no_frame_blanks_stored_close(monkeypatch):
    """When the frame is unavailable the stale value is dropped, not kept."""
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: None)
    item = _stale_item()
    out = cp_api._enrich_with_candles([item], "1D")
    assert out[0]["last_close"] is None
    assert out[0]["day_change_pct"] is None
    assert out[0]["candles"] == []


def test_series_cache_key_changes_with_frame_last_bar():
    """Two frames with different last bars produce two distinct cache entries."""
    old = _frame([3300.0, 3382.0], "2026-11-11")
    new = _frame([3300.0, 3382.0, 3430.0], "2026-11-13")

    out_old = cp_api._finalize_item(
        _stale_item(), old, key=("KAYNES", "1D"), lookback_bars=500,
        compute_trendlines=False, tl_cache={},
    )
    out_new = cp_api._finalize_item(
        _stale_item(), new, key=("KAYNES", "1D"), lookback_bars=500,
        compute_trendlines=False, tl_cache={},
    )

    assert out_old["last_close"] == 3382.0
    assert out_new["last_close"] == 3430.0
    assert len(cp_api._enrichment_cache) == 2, "a rolled frame must get its own entry"


def test_frame_watermark_changes_when_bar_rolls():
    """The matrix/read cache key carries frame identity, not just scan time."""
    cp_api._remember_frame(("KAYNES", "1D"), _frame([3300.0, 3382.0], "2026-11-11"), 3382.0, 2.48)
    before = cp_api._frame_watermark(["1D"])
    cp_api._remember_frame(("KAYNES", "1D"), _frame([3300.0, 3382.0, 3430.0], "2026-11-13"), 3430.0, 1.42)
    assert cp_api._frame_watermark(["1D"]) != before


def test_matrix_prefers_current_frame_close_over_stored_item():
    """A stored row's old close is superseded by a known current-frame close."""
    cp_api._remember_frame(("KAYNES", "1D"), _frame([3382.0, 3430.0], "2026-11-13"), 3430.0, 1.42)
    rows = cp_api._matrix_rows([("1D", [_stale_item()])])
    assert rows[0]["ltp"] == 3430.0
    assert rows[0]["day_change_pct"] == 1.42


def test_refresh_clears_only_target_symbol_enrichment(monkeypatch):
    """refresh=1 drops one symbol's enrichment; another symbol's survives."""
    frames = {
        "KAYNES": _frame([3300.0, 3382.0], "2026-11-11"),
        "INFY": _frame([100.0, 101.0], "2026-11-11"),
    }
    for symbol, df in frames.items():
        cp_api._finalize_item(
            {"symbol": symbol, "timeframe": "1D"}, df, key=(symbol, "1D"),
            lookback_bars=500, compute_trendlines=False, tl_cache={},
        )
    assert len(cp_api._enrichment_cache) == 2

    monkeypatch.setattr(cp_api.candles, "clear_cache", lambda *a, **k: True)
    monkeypatch.setattr(
        cp_api.jobs, "submit",
        lambda universe, tf, requested_by=None, params=None: {
            "job_id": "cpj_refresh", "universe": universe, "timeframe": tf,
            "status": "queued", "queue_position": 0,
        },
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/chart-patterns/scan",
                json={"universe": "custom", "timeframe": "1D", "symbols": ["kaynes"], "refresh": True},
            )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert cp_api._enrichment_cache_get(
        ("KAYNES", "1D", 500, cp_api.config.CHART_MAX_BARS, cp_api._frame_identity(frames["KAYNES"]))
    ) is None
    assert cp_api._enrichment_cache_get(
        ("INFY", "1D", 500, cp_api.config.CHART_MAX_BARS, cp_api._frame_identity(frames["INFY"]))
    ) is not None
    assert ("KAYNES", "1D") not in cp_api._known_frame
    assert ("INFY", "1D") in cp_api._known_frame
