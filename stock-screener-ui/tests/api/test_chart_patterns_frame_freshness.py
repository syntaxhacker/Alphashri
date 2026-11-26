"""Backend frame-freshness guards for pattern enrichment (KAYNES incident).

A ``last_close``/``day_change_pct`` pair must always describe the exact candle
frame that produced the returned series — never an older persisted value that
happened to be cached under the same symbol+timeframe key.

Also guards the live 1D chart display edge (2026-11-16 KAYNES incident): a
lagging official daily frame must not hide today's bar, which is aggregated
from the 1-minute tape while detection stays on the completed-session base.
"""
from __future__ import annotations

import pickle
from datetime import date as _date
from types import SimpleNamespace

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


def _frame_hourly(closes, end: str) -> pd.DataFrame:
    idx = pd.date_range(end=end, periods=len(closes), freq="h", tz="UTC")
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
    )
    out_new = cp_api._finalize_item(
        _stale_item(), new, key=("KAYNES", "1D"), lookback_bars=500,
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
            lookback_bars=500,
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




def test_results_item_carries_close_bar_date_from_frame(monkeypatch):
    """A /results-style item is tagged with the IST date of the frame behind its close."""
    df = _frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)

    out = cp_api._enrich_with_candles([{"symbol": "KAYNES", "timeframe": "1D"}], "1D")

    assert out[0]["last_close"] == 3430.0
    assert out[0]["close_bar_date"] == "2026-11-13"


def test_intraday_frame_bar_date_converted_to_ist(monkeypatch):
    """08:45 UTC on 16 Nov is 14:15 IST — same date; 18:45 UTC rolls to the next."""
    df = _frame_hourly([100.0, 101.0, 102.0], "2026-11-16T08:45:00")
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)

    out = cp_api._enrich_with_candles([{"symbol": "TEST", "timeframe": "1h"}], "1h")

    assert out[0]["close_bar_date"] == "2026-11-16"
    assert cp_api._close_bar_date(_frame_hourly([100.0, 102.0], "2026-11-16T18:45:00")) == "2026-11-17"


def test_symbol_header_carries_close_bar_date(monkeypatch):
    df = _frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)

    fields = cp_api._candle_fields("KAYNES", "1D")

    assert fields["last_close"] == 3430.0
    assert fields["close_bar_date"] == "2026-11-13"


def test_no_frame_has_no_close_bar_date(monkeypatch):
    """No frame means neither a close nor a fabricated (e.g. today's) date."""
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: None)

    out = cp_api._enrich_with_candles([_stale_item()], "1D")

    assert out[0]["last_close"] is None
    assert out[0]["close_bar_date"] is None
    assert cp_api._candle_fields("KAYNES", "1D").get("close_bar_date") is None


def test_series_cache_preserves_close_bar_date():
    """The bar date travels with last_close in the cached tuple, not recomputed later."""
    df = _frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    key = ("KAYNES", "1D")

    first = cp_api._finalize_item(
        _stale_item(), df, key=key, lookback_bars=500,
    )
    second = cp_api._finalize_item(
        _stale_item(), df, key=key, lookback_bars=500,
    )

    assert first["close_bar_date"] == second["close_bar_date"] == "2026-11-13"
    cached = cp_api._enrichment_cache_get(
        ("KAYNES", "1D", 500, cp_api.config.CHART_MAX_BARS, cp_api._frame_identity(df))
    )
    assert cached[3] == "2026-11-13", "bar date must live in the cached close tuple"


def test_matrix_row_date_matches_its_close_frame():
    cp_api._remember_frame(("KAYNES", "1D"), _frame([3382.0, 3430.0], "2026-11-13"), 3430.0, 1.42)

    rows = cp_api._matrix_rows([("1D", [_stale_item()])])

    assert rows[0]["ltp"] == 3430.0
    assert rows[0]["close_bar_date"] == "2026-11-13"


def test_matrix_uses_newest_frame_date_with_its_close():
    """When symbols' frames disagree, the newest date wins with that frame's close."""
    cp_api._remember_frame(("KAYNES", "1D"), _frame([3300.0, 3430.0], "2026-11-13"), 3430.0, 1.42)
    cp_api._remember_frame(
        ("KAYNES", "1h"),
        _frame_hourly([100.0, 102.0], "2026-11-16T08:45:00"),
        102.0, 2.0,
    )
    stale = _stale_item()
    stale["close_bar_date"] = "2026-11-10"  # an older date must not win

    rows = cp_api._matrix_rows([
        ("1D", [stale]),
        ("1h", [dict(stale, timeframe="1h")]),
    ])

    assert rows[0]["close_bar_date"] == "2026-11-16"
    assert rows[0]["ltp"] == 102.0


def test_matrix_stale_item_cannot_pair_old_date_with_new_close():
    """With no known frame, the newest stored date keeps its own close."""
    old = _stale_item()
    old["close_bar_date"], old["last_close"] = "2026-11-10", 3382.0
    fresh = _stale_item()
    fresh["close_bar_date"], fresh["last_close"] = "2026-11-13", 3430.0

    rows = cp_api._matrix_rows([("1D", [old, fresh])])

    assert rows[0]["close_bar_date"] == "2026-11-13"
    assert rows[0]["ltp"] == 3430.0


def test_matrix_without_frame_has_no_bar_date():
    """Legacy stored close is kept, but no date is invented."""
    rows = cp_api._matrix_rows([("1D", [_stale_item()])])

    assert rows[0]["ltp"] == 3382.0
    assert rows[0].get("close_bar_date") is None


def _range_index_frame(closes) -> pd.DataFrame:
    """A frame with an identity but no bar date (non-datetime index)."""
    return pd.DataFrame({
        "open": closes,
        "high": [c + 1 for c in closes],
        "low": [c - 1 for c in closes],
        "close": closes,
        "volume": [1000.0] * len(closes),
    })


def _matrix_client_get(monkeypatch, items):
    """Drive the real /matrix endpoint with a controlled store response."""
    monkeypatch.setattr(
        cp_api.store, "query_results",
        lambda *a, **k: (list(items), len(items), {"data_through": "2026-11-10"}),
    )
    app = FastAPI()
    app.include_router(router)
    try:
        with TestClient(app) as client:
            return client.get(
                "/api/chart-patterns/matrix",
                params={"universe": "custom", "timeframes": "1D"},
            )
    finally:
        app.dependency_overrides.clear()


def test_matrix_rangeindex_frame_never_fuses_item_date_with_fresh_close(monkeypatch):
    """An identity without a bar date cannot fuse the item's date with the frame's close."""
    df = _range_index_frame([3300.0, 3430.0])
    assert cp_api._frame_identity(df) is not None
    assert cp_api._close_bar_date(df) is None
    cp_api._remember_frame(("KAYNES", "1D"), df, 3430.0, 1.42)

    item = _stale_item()
    item["close_bar_date"] = "2026-11-10"
    item["last_close"] = 3382.0
    item["day_change_pct"] = 2.48

    resp = _matrix_client_get(monkeypatch, [item])

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    # Never the item's stale date welded onto the fresh RangeIndex-frame close.
    assert (row["close_bar_date"], row["ltp"]) != ("2026-11-10", 3430.0)
    # The date is either absent or the item's own, and in both cases the close
    # and change are the item's own too — one triple from a single source.
    assert (row["close_bar_date"], row["ltp"], row["day_change_pct"]) in {
        (None, 3382.0, 2.48),
        ("2026-11-10", 3382.0, 2.48),
    }


def test_matrix_datetimeindex_frame_pairs_fresh_date_and_close(monkeypatch):
    """A normal datetime-index frame still contributes its whole fresh triple."""
    df = _frame([3300.0, 3430.0], "2026-11-13")
    cp_api._remember_frame(("KAYNES", "1D"), df, 3430.0, 1.42)

    item = _stale_item()
    item["close_bar_date"] = "2026-11-10"  # older date must not win

    resp = _matrix_client_get(monkeypatch, [item])

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    assert row["close_bar_date"] == "2026-11-13"
    assert row["ltp"] == 3430.0
    assert row["day_change_pct"] == 1.42


# ---------------------------------------------------------------------------
# The matrix reads one frame: the completed-session one. A chart request (whose
# displayed series may include today's forming bar) must never rebind it.
# ---------------------------------------------------------------------------


def _close(df) -> tuple:
    return cp_api._last_close_change(df)


def test_matrix_uses_stored_triple_when_no_frame_is_known(monkeypatch):
    """A stored hit on its own: the matrix reports that hit's complete triple."""
    item = _stale_item()
    item["close_bar_date"] = "2026-11-13"

    resp = _matrix_client_get(monkeypatch, [item])

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    assert (row["close_bar_date"], row["ltp"], row["day_change_pct"]) == (
        "2026-11-13", 3382.0, 2.48,
    )


def test_symbol_then_matrix_keeps_the_stored_triple(monkeypatch):
    """/symbol publishes a completed frame; the matrix picks it up whole."""
    item = _stale_item()
    item["close_bar_date"] = "2026-11-13"
    df = _daily_frame([3300.0, 3382.0], "2026-11-13")
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)

    cp_api._candle_fields("KAYNES", "1D")
    close, change = _close(df)

    resp = _matrix_client_get(monkeypatch, [item])

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    assert (row["close_bar_date"], row["ltp"], row["day_change_pct"]) == (
        "2026-11-13", close, change,
    )


def test_chart_with_a_partial_bar_does_not_change_the_matrix(monkeypatch, tmp_path):
    """A 16-Nov chart request (displaying today's forming bar) leaves the matrix
    on the completed 13-Nov session that detection is on."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 10, 30)
    _seed_cache(monkeypatch, tmp_path, base)
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: _date(2026, 11, 13),
    )
    monkeypatch.setattr(
        "market_data.market_data.get_api_client", lambda: _tape_client()
    )
    cp_api.candles._PARTIAL_CACHE.clear()
    # The network fetch appends today's tape bar, so the returned frame is
    # flagged ``partial_today`` — exactly the frame that used to be published.
    monkeypatch.setattr(
        cp_api.candles, "fetch_for_timeframe",
        lambda symbol, *a, **k: cp_api.candles.with_partial_today(base, symbol),
    )
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])

    app, client = _chart_client()
    try:
        chart = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D", "refresh": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert chart.status_code == 200
    body = chart.json()
    assert body["candles"][-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert body["candles"][-1]["c"] == 2980.0
    assert body["candles"][-1]["is_partial"] is True

    item = _stale_item()
    item["close_bar_date"] = "2026-11-13"
    resp = _matrix_client_get(monkeypatch, [item])

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    close, change = _close(base)
    assert row["close_bar_date"] == "2026-11-13"
    assert (row["ltp"], row["day_change_pct"]) == (close, change)
    assert row["ltp"] != 2980.0, "never the in-progress tape LTP"


def test_remember_frame_never_stores_a_partial_today_bar():
    """A frame flagged ``partial_today`` publishes its last completed bar."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    merged = base.copy()
    merged.loc[pd.Timestamp("2026-11-15 18:30", tz="UTC")] = {
        "open": 2980.0, "high": 2981.0, "low": 2979.0,
        "close": 2980.0, "volume": 500.0,
    }
    merged.attrs["partial_today"] = True

    cp_api._remember_frame(("KAYNES", "1D"), merged, *cp_api._last_close_change(merged))

    close, change, bar_date = cp_api._known_frame_close("KAYNES", "1D")
    assert bar_date == "2026-11-13"
    assert close == 3430.0
    assert change == _close(base)[1]


def test_universe_refresh_clears_a_frame_without_enrichment(monkeypatch):
    """refresh:true drops every frame for the timeframe, including one that only
    ``/symbol`` wrote (no enrichment payload to index it by)."""
    df = _daily_frame([3300.0, 3382.0], "2026-11-13")
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)
    cp_api._candle_fields("KAYNES", "1D")
    cp_api._remember_frame(("INFY", "1D"), df, *_close(df))
    assert cp_api._enrichment_cache == {}
    assert ("KAYNES", "1D") in cp_api._known_frame

    monkeypatch.setattr(cp_api.candles, "clear_cache", lambda *a, **k: True)
    monkeypatch.setattr(
        cp_api.jobs, "submit",
        lambda universe, tf, requested_by=None, params=None: {
            "job_id": "cpj_universe_refresh", "universe": universe, "timeframe": tf,
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
                json={"universe": "nifty50", "timeframe": "1D", "refresh": True},
            )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert [scope for scope in cp_api._known_frame if scope[1] == "1D"] == []




def _daily_frame(closes, session: str) -> pd.DataFrame:
    """Daily frame whose last bar is the given IST session (18:30 UTC stamp)."""
    y, m, d = (int(p) for p in session.split("-"))
    stamp = pd.Timestamp(_date(y, m, d)) - pd.Timedelta(hours=5, minutes=30)
    idx = pd.date_range(end=stamp, periods=len(closes), freq="D", tz="UTC")
    return pd.DataFrame({
        "open": closes,
        "high": [c + 1 for c in closes],
        "low": [c - 1 for c in closes],
        "close": closes,
        "volume": [1000.0] * len(closes),
    }, index=idx)


def _tape_client(day: str = "2026-11-16", n: int = 5):
    idx = pd.date_range(f"{day} 09:15", periods=n, freq="min",
                        tz="Asia/Kolkata").tz_convert("UTC")
    base = [2980.0] * n
    tape = pd.DataFrame({
        "open": base, "high": [b + 1 for b in base],
        "low": [b - 1 for b in base], "close": base,
        "volume": [500.0] * n,
    }, index=idx)
    return SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: tape)


def _chart_client():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    return app, TestClient(app)


def _seed_cache(monkeypatch, tmp_path, df, symbol="KAYNES"):
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    variant = f"lb{cp_api.config.READ_LOOKBACK_BARS}"
    path = cp_api.candles._cache_path("1D", symbol, None, variant=variant)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        pickle.dump(df, fh)
    return path


def _now_frozen(monkeypatch, day: str, hh: int, mm: int = 0,
                *, holiday: bool = False) -> None:
    """Freeze the session clock used by the append gate (and the close time).

    Pins ``candles._now_ist`` (the single clock read) and the trading-day
    predicate, so the date/partial logic never depends on the wall clock — the
    2026-11-16 incident was a live-Monday gate nobody could reproduce on demand.
    ``holiday=True`` makes only the frozen day a holiday, not every day.
    """
    from datetime import datetime as _dt

    from trading.timezone import IST

    frozen_day = _date.fromisoformat(day)
    frozen = _dt(frozen_day.year, frozen_day.month, frozen_day.day,
                 hh, mm, tzinfo=IST)
    holidays = {frozen_day} if holiday else set()
    monkeypatch.setattr(cp_api.candles, "_now_ist", lambda: frozen)
    monkeypatch.setattr(
        cp_api.candles, "_is_trading_day",
        lambda d: d.weekday() < 5 and d not in holidays,
    )


def _stale_chart_setup(monkeypatch, tmp_path, base, last_completed=None):
    """Wire a stale 1D disk frame + a 16-Nov 1-min tape, no network refresh."""
    if last_completed is not None:
        lc = _date.fromisoformat(last_completed)
        monkeypatch.setattr(
            cp_api.candles, "_last_completed_session", lambda now=None: lc
        )
    _seed_cache(monkeypatch, tmp_path, base)
    cp_api.candles._PARTIAL_CACHE.clear()
    monkeypatch.setattr(
        "market_data.market_data.get_api_client", lambda: _tape_client()
    )
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])
    monkeypatch.setattr(cp_api, "_kick_stale_first_refresh", lambda *a, **k: True)


def test_stale_1d_frame_gains_today_tape_bar_detection_on_base(monkeypatch, tmp_path):
    """A 13-Nov cached frame + a 16-Nov tape → the chart displays a 16-Nov
    candle and reports itself current (``as_of`` 16 Nov), while detection and
    ``detection_as_of`` stay on the 13-Nov base frame."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 16, 0)
    _stale_chart_setup(monkeypatch, tmp_path, base, last_completed="2026-11-16")
    seen = {}

    def _detect(df, timeframe, symbol):
        seen["detected_df"] = df
        return []

    monkeypatch.setattr(
        cp_api, "engine_mod", SimpleNamespace(detect_patterns=_detect)
    )

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D", "detect_patterns": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    series = body["candles"]
    assert len(series) == len(base) + 1
    # 16 Nov IST session is stamped 2026-11-15 18:30 UTC (same as the tape bar).
    assert series[-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert series[-1]["c"] == 2980.0
    # Detection never sees the tape bar — it stays a completed-session hit.
    assert "detected_df" in seen
    assert cp_api.candles.frame_last_date(seen["detected_df"]) == "2026-11-13"
    # ``as_of`` describes the displayed series: today's bar is present, so the
    # chart is current even though detection lags one session.
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
    assert body["detection_as_of"] == "2026-11-13"
    assert "expected_as_of" not in body
    assert "synthesized from the intraday tape" in body["note"]
    assert "detection through 2026-11-13" in body["note"]
    # The session is closed, so the appended bar is final (not in-progress).
    assert "is_partial" not in series[-1]


def test_mid_session_chart_today_bar_is_partial_and_current(monkeypatch, tmp_path):
    """Monday 10:30 IST: the cached frame ends on Friday 13, which *is* the last
    completed session, and the chart must still show the live 16-Nov bar.

    The old gate (``as_of < last_completed_session``) was False all session, so
    the chart served Friday until 15:30."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 10, 30)
    _stale_chart_setup(monkeypatch, tmp_path, base, last_completed="2026-11-13")

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D", "detect_patterns": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    series = body["candles"]
    assert len(series) == len(base) + 1
    assert series[-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert series[-1]["c"] == 2980.0
    assert series[-1]["is_partial"] is True, "before 15:30 the bar is in progress"
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
    assert body["detection_as_of"] == "2026-11-13"


def test_closed_session_tape_bar_has_no_partial_marker(monkeypatch, tmp_path):
    """After the 15:30 close the same gap yields a final bar, no ``is_partial``."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 16, 0)
    _stale_chart_setup(monkeypatch, tmp_path, base, last_completed="2026-11-16")

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D"},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["candles"]) == len(base) + 1
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
    assert "is_partial" not in body["candles"][-1]


def test_frame_already_ending_today_is_not_duplicated(monkeypatch, tmp_path):
    """A cached frame that already contains the 16-Nov session is served as-is."""
    base = _daily_frame([3300.0, 3382.0, 3430.0, 2980.0], "2026-11-16")
    _now_frozen(monkeypatch, "2026-11-16", 10, 30)
    _stale_chart_setup(monkeypatch, tmp_path, base, last_completed="2026-11-13")

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D"},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["candles"]) == len(base)
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
    assert "is_partial" not in body["candles"][-1]


@pytest.mark.parametrize(
    "day,holiday,expect_stale",
    [
        ("2026-11-14", False, False),  # Saturday: Friday 13 is the last session
        ("2026-11-15", False, False),  # Sunday: same
        ("2026-11-17", True, True),    # weekday holiday: last session is 16 Nov
    ],
)
def test_no_session_today_never_appends(monkeypatch, tmp_path, day, holiday, expect_stale):
    """Weekend/holiday: there is no session to append, even with tape rows.

    The frame stays the completed-session base and the freshness fields keep
    their pre-existing meaning: ``stale`` compares the display against the last
    completed session, which a holiday does not advance past its previous
    trading day."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, day, 10, 30, holiday=holiday)
    _stale_chart_setup(monkeypatch, tmp_path, base)

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D"},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["candles"]) == len(base), "no synthetic bar on a non-session"
    assert body["as_of"] == "2026-11-13"
    assert body["stale"] is expect_stale


def test_lagging_base_without_tape_bar_reports_stale(monkeypatch, tmp_path):
    """No intraday tape → no synthesized bar: the series ends on the base frame,
    so ``as_of`` is that date and the chart is stale versus the last session."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 16, 0)
    _stale_chart_setup(monkeypatch, tmp_path, base, last_completed="2026-11-16")
    monkeypatch.setattr(
        "market_data.market_data.get_api_client",
        lambda: SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: pd.DataFrame()),
    )
    cp_api.candles._PARTIAL_CACHE.clear()

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D"},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["candles"]) == len(base)
    assert body["as_of"] == "2026-11-13"
    assert body["stale"] is True
    assert body["detection_as_of"] == "2026-11-13"
    assert body["expected_as_of"] == "2026-11-16"


def test_in_progress_tape_bar_is_marked_partial(monkeypatch):
    """Before the 15:30 close the synthesized bar carries ``is_partial``; the
    chart marks only the trailing displayed candle."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 10, 30)
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: _date(2026, 11, 13),
    )
    cp_api.candles._PARTIAL_CACHE.clear()
    monkeypatch.setattr(
        "market_data.market_data.get_api_client", lambda: _tape_client()
    )
    merged = cp_api.candles.with_partial_today(base, "KAYNES")
    assert merged.attrs["partial_today"] is True
    assert merged.attrs["partial_today_in_progress"] is True

    # Feed the merged frame back through the network-path chart renderer.
    display, is_partial = cp_api._chart_display_frame(merged, "KAYNES", "1D")
    series = cp_api._mark_partial_last(
        cp_api._clamped_candle_series(display, None, cp_api.config.CHART_MAX_BARS),
        is_partial,
    )
    assert series[-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert series[-1]["is_partial"] is True
    assert all("is_partial" not in bar for bar in series[:-1])


def test_refresh_query_skips_stale_first_and_forces_fetch(monkeypatch, tmp_path):
    """``refresh=1`` bypasses the disk frame and re-fetches with force_refresh,
    and still answers with the freshness fields (no omission).

    The fetch returns a frame that ends on the *last completed* session and no
    tape bar, so nothing can be appended: the answer is the lagging frame and
    must say so."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 16, 0)
    _seed_cache(monkeypatch, tmp_path, base)
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: _date(2026, 11, 16),
    )
    monkeypatch.setattr(
        "market_data.market_data.get_api_client",
        lambda: SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: pd.DataFrame()),
    )
    cp_api.candles._PARTIAL_CACHE.clear()
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return base

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D", "refresh": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert seen.get("force_refresh") is True
    assert seen.get("include_partial_today") is True
    assert "cached" not in body, "refresh must not serve the disk frame"
    # Same freshness contract as a cache serve: the fields are never omitted.
    assert body["as_of"] == "2026-11-13"
    assert body["stale"] is True
    assert body["detection_as_of"] == "2026-11-13"
    assert body["expected_as_of"] == "2026-11-16"


def test_refresh_reports_today_when_the_tape_bar_is_appended(monkeypatch, tmp_path):
    """A forced refresh of a lagging daily frame still appends today's tape bar,
    so it answers ``as_of`` today and ``stale: false`` — not a stale payload."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 10, 30)
    _seed_cache(monkeypatch, tmp_path, base)
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: _date(2026, 11, 13),
    )
    monkeypatch.setattr(
        "market_data.market_data.get_api_client", lambda: _tape_client()
    )
    cp_api.candles._PARTIAL_CACHE.clear()

    def _fetch(symbol, timeframe, **kwargs):
        # Mirror candles.fetch_for_timeframe: the tape bar is appended live.
        return cp_api.candles.with_partial_today(base, symbol)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D", "refresh": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert "cached" not in body
    assert body["candles"][-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert body["candles"][-1]["is_partial"] is True
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
    assert body["detection_as_of"] == "2026-11-13"
    assert "expected_as_of" not in body


def test_refresh_appends_the_bar_even_if_the_fetch_returns_base_only(
    monkeypatch, tmp_path,
):
    """Mid-session ``refresh=1`` where the fetch itself did not append the tape
    bar must still display today: the append cannot depend on the fetch having
    done it."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 10, 30)
    _seed_cache(monkeypatch, tmp_path, base)
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: _date(2026, 11, 13),
    )
    monkeypatch.setattr(
        "market_data.market_data.get_api_client", lambda: _tape_client()
    )
    cp_api.candles._PARTIAL_CACHE.clear()
    monkeypatch.setattr(
        cp_api.candles, "fetch_for_timeframe", lambda *a, **k: base
    )
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart",
            params={"timeframe": "1D", "refresh": 1},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["candles"][-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert body["candles"][-1]["is_partial"] is True
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
    assert body["detection_as_of"] == "2026-11-13"


# ---------------------------------------------------------------------------
# Network-path freshness: a plain successful fetch carries the same freshness
# keys as a cache serve. Omission previously forced clients to assume "current".
# ---------------------------------------------------------------------------


def test_network_path_carries_freshness_keys(monkeypatch, tmp_path):
    """A plain 1D network fetch reports as_of/stale/detection_as_of just like a
    stale-first serve; a lagging frame is still labelled stale, never omitted."""
    base = _daily_frame([3300.0, 3382.0, 3430.0], "2026-11-13")
    _now_frozen(monkeypatch, "2026-11-16", 16, 0)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)  # empty: no stale-first
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: _date(2026, 11, 16),
    )
    monkeypatch.setattr(
        "market_data.market_data.get_api_client",
        lambda: SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: pd.DataFrame()),
    )
    cp_api.candles._PARTIAL_CACHE.clear()
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: base)
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/KAYNES/chart", params={"timeframe": "1D"}
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert "cached" not in body
    assert {"as_of", "stale", "detection_as_of"} <= set(body)
    assert body["as_of"] == "2026-11-13"
    assert body["stale"] is True
    assert body["detection_as_of"] == "2026-11-13"
    assert body["expected_as_of"] == "2026-11-16"


def test_network_path_intraday_current_without_expected_date(monkeypatch, tmp_path):
    """Intraday has no expected session date: a plain fetch reports a valid
    as_of with stale:false and no expected_as_of — the same freshness keys."""
    frame = _frame_hourly([100.0, 101.0, 102.0], "2026-11-16T08:45:00")
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: frame)
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])

    app, client = _chart_client()
    try:
        resp = client.get(
            "/api/chart-patterns/symbol/TEST/chart", params={"timeframe": "1h"}
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert {"as_of", "stale", "detection_as_of"} <= set(body)
    assert "expected_as_of" not in body
    assert body["as_of"] == "2026-11-16"
    assert body["stale"] is False
