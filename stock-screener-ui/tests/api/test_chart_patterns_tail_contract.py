"""Contract tests for the live-tail stale-first chart path.

The stale-first branch serves a completed-session disk frame. While NSE is open
it must merge the provider's live tail (bounded), fall back to the cached frame
with a warning on failure, and never issue a provider call when the market is
closed. ``stale`` is bar-age/session-gap based on this path.
"""
from __future__ import annotations

import time as _time
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.chart_patterns as cp_api
from api.chart_patterns import router
from trading.timezone import IST

SYMBOL = "POWERMECH"
CACHED_SESSION = "2026-11-13"
LIVE_SESSION = "2026-11-16"
CHOSEN_PATH = Path("/cache/POWERMECH.lb500.pkl")


def _daily_frame(session: str = CACHED_SESSION, n: int = 80) -> pd.DataFrame:
    """Daily frame whose last bar is the given IST session (18:30 UTC stamp)."""
    stamp = pd.Timestamp(date.fromisoformat(session)) - pd.Timedelta(hours=5, minutes=30)
    idx = pd.date_range(end=stamp, periods=n, freq="D", tz="UTC")
    close = [100.0 + i for i in range(n)]
    return pd.DataFrame(
        {
            "open": close,
            "high": [c + 1.0 for c in close],
            "low": [c - 1.0 for c in close],
            "close": close,
            "volume": [1000.0] * n,
        },
        index=idx,
    )


def _append_bar(df: pd.DataFrame, session: str, close: float) -> pd.DataFrame:
    stamp = (
        pd.Timestamp(date.fromisoformat(session), tz="UTC")
        - pd.Timedelta(hours=5, minutes=30)
    )
    merged = df.copy()
    merged.loc[stamp] = {
        "open": close, "high": close + 1.0, "low": close - 1.0,
        "close": close, "volume": 500.0,
    }
    return merged


def _tail(frame, *, appended=0, updated=0, latest_bar=None, cache_through=None,
          provider_called=True, error=None):
    if latest_bar is None:
        latest_bar = frame.index[-1]
    if cache_through is None:
        cache_through = frame.index[-1]
    return type(
        "TailMerge",
        (),
        {
            "frame": frame,
            "appended": appended,
            "updated": updated,
            "cache_through": cache_through,
            "latest_bar": latest_bar,
            "provider_called": provider_called,
            "error": error,
        },
    )()


def _now(day: str = LIVE_SESSION, hh: int = 10, mm: int = 30) -> datetime:
    d = date.fromisoformat(day)
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=IST)


def _wire(monkeypatch, *, now, market_open, base=None, tail=None, tail_error=None,
          last_completed=CACHED_SESSION, as_of=CACHED_SESSION,
          chosen_path=CHOSEN_PATH):
    base = base if base is not None else _daily_frame()
    monkeypatch.setattr(cp_api, "_stale_first_frame",
                        lambda *a, **k: (base, as_of, 1.0, chosen_path))
    monkeypatch.setattr(cp_api, "_chart_now_ist", lambda: now)
    monkeypatch.setattr(cp_api, "_india_market_open", lambda *a, **k: market_open)
    monkeypatch.setattr(cp_api.candles, "_last_completed_session",
                        lambda now=None: date.fromisoformat(last_completed))
    monkeypatch.setattr(cp_api, "_stored_overlays", lambda *a, **k: [])
    monkeypatch.setattr(cp_api, "_stored_hits", lambda *a, **k: [])
    # The tail answer is the display source in these tests; never synthesize a
    # daily bar from the live tape (that is a provider call of its own).
    monkeypatch.setattr(cp_api.candles, "missing_today_bar", lambda _df: False)
    tail_calls: list = []
    kicks: list = []

    def _fetch(symbol, timeframe, cached, *, now=None, cache_path=None):
        tail_calls.append((symbol, timeframe, now, cache_path))
        if tail_error is not None:
            raise RuntimeError(tail_error)
        return tail

    monkeypatch.setattr(cp_api, "fetch_live_tail", _fetch)
    monkeypatch.setattr(
        cp_api, "_kick_stale_first_refresh",
        lambda symbol, timeframe, lb: kicks.append((symbol, timeframe, lb)) or True,
    )
    return base, tail_calls, kicks


def _client() -> tuple[FastAPI, TestClient]:
    app = FastAPI()
    app.include_router(router)
    return app, TestClient(app)


def _get(client, **params):
    return client.get(
        f"/api/chart-patterns/symbol/{SYMBOL}/chart",
        params={"timeframe": "1D", **params},
    )


@pytest.fixture(autouse=True)
def _clean_caches():
    cp_api._clear_chart_caches()
    cp_api._clear_read_caches()
    yield
    cp_api._clear_chart_caches()
    cp_api._clear_read_caches()


def test_open_market_uses_merged_tail_frame_and_skips_refresh(monkeypatch):
    base = _daily_frame()
    merged = _append_bar(base, LIVE_SESSION, 2980.0)
    tail = _tail(
        merged, appended=1,
        cache_through=base.index[-1],
    )
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=base, tail=tail,
    )
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert tail_calls and tail_calls[0][0] == SYMBOL
    assert tail_calls[0][3] == CHOSEN_PATH, "the chosen lb{N} entry must be rewritten"
    assert body["cached"] is True
    assert body["data_source"] == "cache+tail"
    assert body["market_open"] is True
    assert body["appended"] == 1 and body["updated"] == 0
    assert body["stale"] is False
    assert body["refreshing"] is False
    assert kicks == [], "a successful live tail replaces the daemon refresh"
    assert body["as_of"] == LIVE_SESSION
    assert body["detection_as_of"] == CACHED_SESSION
    assert body["close_bar_date"] == LIVE_SESSION
    assert body["latest_bar"] == body["candles"][-1]["t"]
    assert body["cache_through"] == base.index[-1].isoformat()
    assert body["cache_age_sec"] == 10 * 3600 + 30 * 60
    assert body["candles"][-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert body["candles"][-1]["c"] == 2980.0
    assert body["candles"][-1]["is_partial"] is True
    assert "source" not in body, "pattern-hit provenance must not describe candles"
    indicators = body["indicators"]
    assert indicators["aligned"] == "candles"
    for series in indicators["series"]:
        assert len(series["values"]) == len(body["candles"])


def test_closed_market_serves_cache_without_tail_or_refresh(monkeypatch):
    base = _daily_frame()
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now("2026-11-14", 10, 30), market_open=False,
        base=base, last_completed=CACHED_SESSION,
    )
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert tail_calls == []
    assert kicks == []
    assert body["cached"] is True
    assert body["data_source"] == "cache"
    assert body["market_open"] is False
    assert body["refreshing"] is False
    assert body["appended"] == 0 and body["updated"] == 0
    assert body["stale"] is False, "Friday is the last completed session"
    assert len(body["candles"]) == len(base)
    assert body["as_of"] == CACHED_SESSION


def test_tail_failure_returns_200_with_cached_candles_and_warning(monkeypatch):
    base = _daily_frame()
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=base, tail_error="feed down",
    )
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert tail_calls
    assert len(body["candles"]) == len(base), "a provider failure must never blank a chart"
    assert "error" not in body
    assert body["cached"] is True
    assert body["data_source"] == "cache+tail-failed"
    assert body["market_open"] is True
    assert body["stale"] is True
    assert body["refreshing"] is True
    assert "feed down" in body["warning"]
    assert "refreshing in background" in body["note"]
    assert kicks == [(SYMBOL, "1D", cp_api.config.READ_LOOKBACK_BARS)]
    assert body["appended"] == 0 and body["updated"] == 0
    assert body["latest_bar"] is not None


def test_tail_timeout_keeps_cache_and_kicks_refresh(monkeypatch):
    base = _daily_frame()

    def _slow(*args, **kwargs):
        _time.sleep(0.25)
        return _tail(base)

    _, _, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=base, tail=base,
    )
    monkeypatch.setattr(cp_api, "fetch_live_tail", _slow)
    monkeypatch.setenv("CHART_TAIL_TIMEOUT_SEC", "0.05")
    app, client = _client()
    try:
        started = _time.monotonic()
        resp = _get(client)
        elapsed = _time.monotonic() - started
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert elapsed < 1.5, "the tail budget must bound the request"
    assert len(body["candles"]) == len(base)
    assert body["data_source"] == "cache+tail-failed"
    assert body["stale"] is True
    assert body["refreshing"] is True
    assert "exceeded" in body["warning"]
    assert len(kicks) == 1


def test_successful_tail_with_no_new_bar_reports_zero_appended(monkeypatch):
    base = _daily_frame()
    _, _, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=base, tail=_tail(base, appended=0, updated=0),
    )
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["data_source"] == "cache+tail"
    assert body["appended"] == 0 and body["updated"] == 0
    assert body["stale"] is True, "1D open with no today bar is stale"
    assert body["refreshing"] is False
    assert kicks == []
    assert len(body["candles"]) == len(base)
    assert "no new bar" in body["note"]


def test_refresh_bypasses_stale_first_and_tail(monkeypatch):
    frame = _daily_frame(LIVE_SESSION)
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=_daily_frame(), last_completed=LIVE_SESSION,
    )
    stale_first_calls: list = []
    monkeypatch.setattr(cp_api, "_stale_first_frame",
                        lambda *a, **k: stale_first_calls.append(1))
    fetch_calls: list = []

    def _fetch(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return frame

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    app, client = _client()
    try:
        resp = _get(client, refresh=1)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert fetch_calls == [(SYMBOL, "1D")]
    assert stale_first_calls == []
    assert tail_calls == []
    assert kicks == []
    assert body["data_source"] == "provider"
    assert body["market_open"] is True
    assert "cached" not in body


def test_as_of_replay_bypasses_stale_first_and_tail(monkeypatch):
    frame = _daily_frame()
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=_daily_frame(),
    )
    fetch_calls: list = []

    def _fetch(symbol, timeframe, **kwargs):
        fetch_calls.append(kwargs)
        return frame

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    app, client = _client()
    try:
        resp = _get(client, as_of_date="2026-11-05")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert fetch_calls and fetch_calls[0].get("as_of_date") == "2026-11-05"
    assert tail_calls == []
    assert kicks == []
    assert "cached" not in body
    assert "data_source" not in body


def test_open_intraday_tail_uses_bar_age_for_staleness(monkeypatch):
    now = _now("2026-11-16", 10, 30)
    idx = pd.date_range(end=now - pd.Timedelta(minutes=1), periods=80, freq="min")
    frame = pd.DataFrame(
        {
            "open": [100.0] * 80,
            "high": [101.0] * 80,
            "low": [99.0] * 80,
            "close": [100.0] * 80,
            "volume": [1000.0] * 80,
        },
        index=idx,
    )
    _, _, _ = _wire(
        monkeypatch, now=now, market_open=True, base=frame,
        tail=_tail(frame),
    )
    # Intraday 1m threshold is max(2x1m, 2m) = 2m; a fresh bar is not stale.
    app, client = _client()
    try:
        fresh = _get(client, timeframe="1m")
        stale_frame = frame.iloc[:-3]
        monkeypatch.setattr(cp_api, "_stale_first_frame",
                            lambda *a, **k: (stale_frame, "2026-11-16", 1.0, CHOSEN_PATH))
        monkeypatch.setattr(cp_api, "fetch_live_tail",
                            lambda *a, **k: _tail(stale_frame))
        stale = _get(client, timeframe="1m")
    finally:
        app.dependency_overrides.clear()

    assert fresh.status_code == 200 and fresh.json()["stale"] is False
    assert stale.status_code == 200 and stale.json()["stale"] is True


def test_response_model_documents_the_freshness_contract():
    from api.chart_patterns import SymbolChartResponse

    props = SymbolChartResponse.model_json_schema()["properties"]
    required = {
        "cached", "close_bar_date", "data_source", "market_open",
        "cache_through", "latest_bar", "appended", "updated",
        "cache_age_sec", "refreshing", "stale",
    }
    assert required <= set(props)
    assert "provider" in props["data_source"]["description"]
    assert "cache+tail" in props["data_source"]["description"]
    assert "cache+tail-failed" in props["data_source"]["description"]


def test_skipped_tail_is_a_plain_cache_serve(monkeypatch):
    base = _daily_frame()
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=base, tail=_tail(base, provider_called=False),
    )
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert tail_calls
    assert body["data_source"] == "cache"
    assert body["refreshing"] is False
    assert "tail skipped (cooldown/kill switch/not open)" in body["note"]
    assert "live tail unavailable" not in body.get("warning", "")
    assert len(body["candles"]) == len(base)
    assert kicks == []


def test_no_provider_error_is_a_skip_not_a_failed_tail(monkeypatch):
    """A 1D frame with only today's bar yields an error from the tail guard
    without a provider call: that must be a plain cache serve, not a failure."""
    base = _daily_frame(LIVE_SESSION)
    skipped = _tail(base, provider_called=False, error="no completed cached frame")
    _, tail_calls, kicks = _wire(
        monkeypatch, now=_now(LIVE_SESSION, 10, 30), market_open=True,
        base=base, tail=skipped, as_of=LIVE_SESSION,
        last_completed=CACHED_SESSION,
    )
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert tail_calls
    assert body["data_source"] == "cache"
    assert "tail skipped" in body["note"]
    assert "warning" not in body
    assert body["refreshing"] is False
    assert kicks == []
    assert len(body["candles"]) == len(base)


def test_kill_switch_tail_result_reports_cache_not_cache_plus_tail(monkeypatch):
    from chart_patterns.tail_refresh import fetch_live_tail as real_tail

    base = _daily_frame()
    _, _, _ = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True, base=base,
    )
    monkeypatch.setenv("CHART_TAIL_REFRESH", "0")
    monkeypatch.setattr(cp_api, "fetch_live_tail", real_tail)
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["data_source"] == "cache"
    assert body["appended"] == 0 and body["updated"] == 0
    assert "tail skipped (cooldown/kill switch/not open)" in body["note"]
    assert "live tail unavailable" not in body.get("warning", "")


def test_closed_intraday_bar_before_close_is_stale_with_warning(monkeypatch):
    now = _now(LIVE_SESSION, 16, 0)
    last = pd.Timestamp("2026-11-16 11:00", tz="Asia/Kolkata").tz_convert("UTC")
    idx = pd.date_range(end=last, periods=80, freq="min")
    frame = pd.DataFrame(
        {
            "open": [100.0] * 80,
            "high": [101.0] * 80,
            "low": [99.0] * 80,
            "close": [100.0] * 80,
            "volume": [1000.0] * 80,
        },
        index=idx,
    )
    _, tail_calls, _ = _wire(
        monkeypatch, now=now, market_open=False, base=frame,
        as_of=LIVE_SESSION, last_completed=LIVE_SESSION,
    )
    app, client = _client()
    try:
        resp = _get(client, timeframe="1m")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert tail_calls == [], "a closed market never calls the tail provider"
    assert body["stale"] is True
    assert "before session close" in body["warning"]
    assert body["data_source"] == "cache"
    assert body["market_open"] is False


def test_tail_failure_keeps_todays_synthetic_daily_bar(monkeypatch):
    base = _daily_frame()
    _, _, kicks = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True,
        base=base, tail_error="feed down",
    )
    merged = _append_bar(base, LIVE_SESSION, 2980.0)
    merged.attrs["partial_today"] = True
    merged.attrs["partial_today_in_progress"] = True
    monkeypatch.setattr(cp_api.candles, "missing_today_bar", lambda _df: True)
    monkeypatch.setattr(cp_api.candles, "with_partial_today", lambda _df, _s: merged)
    app, client = _client()
    try:
        resp = _get(client)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["candles"]) == len(base) + 1
    assert body["candles"][-1]["t"] == "2026-11-15T18:30:00+00:00"
    assert body["candles"][-1]["is_partial"] is True
    assert body["as_of"] == LIVE_SESSION
    assert body["data_source"] == "cache+tail-failed"
    assert "feed down" in body["warning"]
    assert kicks


def test_first_tail_failure_then_cooldown_changes_the_label(monkeypatch):
    import market_data.market_data as md
    from chart_patterns import tail_refresh as tr

    base = _daily_frame()
    _, _, _ = _wire(
        monkeypatch, now=_now("2026-11-16", 10, 30), market_open=True, base=base,
    )
    monkeypatch.delenv("CHART_TAIL_REFRESH", raising=False)
    tr._reset_state()
    provider_calls: list = []

    def _fail(*args, **kwargs):
        provider_calls.append((args, kwargs))
        raise RuntimeError("provider down")

    monkeypatch.setattr(md, "fetch_candles_for_timeframe", _fail)
    monkeypatch.setattr(cp_api, "fetch_live_tail", tr.fetch_live_tail)
    app, client = _client()
    try:
        first = _get(client).json()
        second = _get(client).json()
    finally:
        app.dependency_overrides.clear()
        tr._reset_state()

    assert len(provider_calls) == 1, "a cooldown must suppress the immediate retry"
    assert first["data_source"] == "cache+tail-failed"
    assert "provider down" in first["warning"]
    assert second["data_source"] == "cache"
    assert "tail skipped (cooldown/kill switch/not open)" in second["note"]
    assert len(first["candles"]) == len(second["candles"]) == len(base)


def test_corrupt_lb_variant_falls_back_to_valid_default(monkeypatch, tmp_path):
    import pickle

    base = _daily_frame(LIVE_SESSION)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cp_api.candles, "_now_ist", lambda: _now(LIVE_SESSION, 10, 30))
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda now=None: date.fromisoformat(LIVE_SESSION),
    )
    variant = cp_api.candles._cache_path(
        "1D", SYMBOL, None, variant=f"lb{cp_api.config.READ_LOOKBACK_BARS}"
    )
    default = cp_api.candles._cache_path("1D", SYMBOL, None)
    variant.parent.mkdir(parents=True, exist_ok=True)
    variant.write_bytes(b"not a pickle")
    with default.open("wb") as fh:
        pickle.dump(base, fh)

    result = cp_api._stale_first_frame(SYMBOL, "1D", cp_api.config.READ_LOOKBACK_BARS)
    assert result is not None
    df, as_of, read_ms, chosen = result
    assert chosen == default
    assert as_of == LIVE_SESSION
    assert len(df) == len(base)
    assert read_ms >= 0
