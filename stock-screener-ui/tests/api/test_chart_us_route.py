"""US-stock chart route (``market=usa``) — backend integration guards.

The provider/cache/session stack from lanes 1-2 is injected as fake modules, so
these tests never touch the network, Upstox, the NSE calendar or the pattern
store. They pin the route contract: a thin, honest US candle payload and an
India path that is byte-identical to before the ``market`` param existed.
"""
from __future__ import annotations

import sys
from datetime import datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from zoneinfo import ZoneInfo

import api.chart_patterns as cp_api
from api.chart_patterns import router
from api.rate_limit import US_CHART_RATE_CAPACITY, US_CHART_RATE_DETAIL, us_chart_limiter


ROUTE = "/api/chart-patterns/symbol/{symbol}/chart"


class ProviderNoData(Exception):
    """Stand-in for the lane-1 provider no-data signal."""

    kind = "no_data"


class ProviderAuthError(ProviderNoData):
    """Stand-in for an upstream 401/403 / missing-credentials failure."""

    kind = "auth"


class ProviderRateLimitError(ProviderNoData):
    """Stand-in for an upstream 429, carrying a (possibly unsafe) retry hint."""

    kind = "rate_limit"

    def __init__(self, message: str = "rate limited", *, retry_after=None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def _module(name: str, **attrs) -> ModuleType:
    mod = ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    return mod


def _us_frame(n: int = 3, *, tz: str = "UTC") -> pd.DataFrame:
    idx = pd.date_range("2026-11-17 14:00", periods=n, freq="min", tz=tz)
    return pd.DataFrame(
        {
            "open": [100.0 + i for i in range(n)],
            "high": [101.0 + i for i in range(n)],
            "low": [99.0 + i for i in range(n)],
            "close": [100.5 + i for i in range(n)],
            "volume": [1000.0 + i for i in range(n)],
        },
        index=idx,
    )


def _us_pattern_frame() -> pd.DataFrame:
    """Provider-like frame (UTC index, int64 volume) with triple-bottom geometry."""
    return _pattern_frame(pd.date_range("2026-11-10 14:00", periods=70, freq="min", tz="UTC"))


def _us_daily_pattern_frame() -> pd.DataFrame:
    """The 1D shape the live AAPL chart serves: tz-aware UTC daily UTC bars."""
    return _pattern_frame(pd.date_range("2026-06-01", periods=70, freq="D", tz="UTC"))


def _pattern_frame(idx: pd.DatetimeIndex) -> pd.DataFrame:
    anchors = [(0, 112), (10, 100), (20, 115), (30, 100), (45, 115), (52, 100), (65, 118)]
    n = len(idx)
    close = np.interp(np.arange(n), [a[0] for a in anchors], [a[1] for a in anchors])
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "volume": np.full(n, 1000, dtype=np.int64),
        },
        index=idx,
    )


@pytest.fixture(autouse=True)
def _clean_caches():
    us_chart_limiter.reset()
    cp_api._clear_chart_caches()
    cp_api._clear_read_caches()
    yield
    us_chart_limiter.reset()
    cp_api._clear_chart_caches()
    cp_api._clear_read_caches()


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def us_stack(monkeypatch):
    """Inject the lanes 1/2 contract modules with a mock provider + cache."""
    import chart_patterns
    import market_data

    df = _us_frame()
    provider = SimpleNamespace(
        candles=Mock(return_value=df),
        feed="yahoo",
        delay_label="~1 min (forming)",
    )
    registry = _module(
        "market_data.providers.registry", provider_for=Mock(return_value=provider)
    )
    sessions = _module(
        "market_data.providers.sessions",
        session_date=Mock(return_value="2026-11-17"),
        is_us_open=Mock(return_value=True),
        ET=ZoneInfo("America/New_York"),
    )
    base = _module("market_data.providers.base", ProviderNoData=ProviderNoData)
    providers_pkg = _module(
        "market_data.providers",
        ProviderNoData=ProviderNoData,
        registry=registry,
        sessions=sessions,
        base=base,
    )
    cache = _module(
        "chart_patterns.us_cache",
        get_us_candles=Mock(return_value=None),
        put_us_candles=Mock(),
    )

    modules = {
        "market_data.providers": providers_pkg,
        "market_data.providers.registry": registry,
        "market_data.providers.sessions": sessions,
        "market_data.providers.base": base,
        "chart_patterns.us_cache": cache,
    }
    for name, mod in modules.items():
        monkeypatch.setitem(sys.modules, name, mod)
    monkeypatch.setattr(market_data, "providers", providers_pkg, raising=False)
    monkeypatch.setattr(chart_patterns, "us_cache", cache, raising=False)

    return SimpleNamespace(
        df=df,
        provider=provider,
        registry=registry,
        sessions=sessions,
        cache=cache,
        no_data=ProviderNoData,
        auth_error=ProviderAuthError,
        rate_limit_error=ProviderRateLimitError,
    )


def _get(client, symbol="AAPL", **params):
    return client.get(ROUTE.format(symbol=symbol), params=params)


# --- success path ----------------------------------------------------------


def test_usa_response_shape_and_tz_aware_candles(client, us_stack):
    resp = _get(client, market="usa", timeframe="1m")
    assert resp.status_code == 200
    body = resp.json()

    assert body["market"] == "usa"
    assert body["symbol"] == "AAPL"
    assert body["timeframe"] == "1m"
    assert body["feed"] == "yahoo"
    assert body["delay_label"] == "~1 min (forming)"
    assert body["session_date"] == "2026-11-17"
    assert body["overlays"] == []
    assert body["trend_lines"] == []
    assert body["hits"] == []

    assert len(body["candles"]) == 3
    for candle in body["candles"]:
        assert set(candle) == {"t", "o", "h", "l", "c", "v"}
        # tz-aware ISO with an explicit offset — never a naive string.
        assert candle["t"].endswith("+00:00"), candle["t"]
        assert datetime.fromisoformat(candle["t"]).tzinfo is not None


def test_usa_detect_patterns_uses_engine_not_nse_stack(client, us_stack, monkeypatch):
    """Opt-in detection uses the pure engine; never the NSE/Upstox/stored stack."""
    us_stack.cache.get_us_candles.return_value = _us_pattern_frame()
    forbidden = Mock(side_effect=AssertionError("NSE/Upstox stack called for USA"))
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", forbidden)
    monkeypatch.setattr(cp_api.candles, "_last_completed_session", forbidden)
    monkeypatch.setattr(cp_api.store, "get_symbol_detail", forbidden)
    monkeypatch.setattr("trading.utils.is_trading_holiday", forbidden)

    resp = _get(
        client, market="usa", timeframe="1m",
        detect_patterns="true", compute_trendlines="true",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["hits"], "expected live pattern hits on triple-bottom geometry"
    assert all(hit["source"] == "live" for hit in body["hits"])
    assert any(hit["pattern_id"] == "triple_bottom" for hit in body["hits"])
    assert body["overlays"], "overlays come from live hits, not the store"
    assert body["trend_lines"], "support/resistance computed from the provider frame"
    forbidden.assert_not_called()
    us_stack.registry.provider_for.assert_called_once_with("usa")


def test_usa_daily_live_hits_regression(client, us_stack):
    """A provider-style 1D frame must yield live hits, overlays and trend lines.

    The stale pre-fix route ignored ``detect_patterns`` and answered ``[]``
    even though the engine found patterns on the very same frame; the chart
    then had nothing to draw. This pins the whole AAPL-1D response shape.
    """
    us_stack.cache.get_us_candles.return_value = _us_daily_pattern_frame()

    resp = _get(
        client, market="usa", timeframe="1D",
        detect_patterns="true", compute_trendlines="true",
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["hits"], "US 1D chart must return live pattern hits"
    assert all(hit["source"] == "live" for hit in body["hits"])
    assert any(hit["pattern_id"] == "triple_bottom" for hit in body["hits"])
    assert body["overlays"], "overlays must be derived from the live hits"
    assert body["trend_lines"], "support/resistance must come from the provider frame"
    assert len(body["candles"]) == 70
    assert all(c["t"].endswith("+00:00") for c in body["candles"])


def test_usa_detect_patterns_empty_frame_returns_empty_hits(client, us_stack):
    """Too few bars for detection -> [], not an error (shape test already covers off)."""
    us_stack.cache.get_us_candles.return_value = _us_frame(n=3)

    resp = _get(client, market="usa", timeframe="1m", detect_patterns="true")

    assert resp.status_code == 200
    body = resp.json()
    assert body["hits"] == []
    assert body["overlays"] == []
    assert body["candles"] and len(body["candles"]) == 3


def test_usa_cache_hit_skips_provider(client, us_stack):
    us_stack.cache.get_us_candles.return_value = us_stack.df

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 200
    us_stack.cache.get_us_candles.assert_called_once_with("AAPL", "1m")
    us_stack.provider.candles.assert_not_called()
    us_stack.cache.put_us_candles.assert_not_called()


def test_usa_cache_miss_fetches_and_caches(client, us_stack):
    us_stack.cache.get_us_candles.return_value = None

    resp = _get(client, market="usa", timeframe="5m")

    assert resp.status_code == 200
    us_stack.provider.candles.assert_called_once_with("AAPL", "5m")
    us_stack.cache.put_us_candles.assert_called_once_with(
        "AAPL", "5m", us_stack.df,
    )


def test_usa_naive_index_is_localized_to_utc(client, us_stack):
    us_stack.cache.get_us_candles.return_value = _us_frame(tz=None)

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 200
    assert resp.json()["candles"][0]["t"].endswith("+00:00")


def test_usa_partial_last_bar_is_flagged(client, us_stack):
    df = _us_frame()
    df.attrs["partial_last"] = True
    us_stack.cache.get_us_candles.return_value = df

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 200
    candles = resp.json()["candles"]
    assert "is_partial" not in candles[0]
    assert candles[-1]["is_partial"] is True


def test_usa_dropped_forming_bar_leaves_completed_tail_unflagged(client, us_stack):
    """The 1m smoke case: a dropped forming bar must not mark the completed tail.

    The provider sets ``partial_last=True`` when it *saw* a forming bar and
    ``forming_dropped=True`` when it removed it. After the drop the last candle
    is complete, so ``is_partial`` must be absent even though a forming bar was
    observed upstream.
    """
    df = _us_frame()
    df.attrs["partial_last"] = True
    df.attrs["forming_dropped"] = True
    us_stack.cache.get_us_candles.return_value = df

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 200
    candles = resp.json()["candles"]
    assert all("is_partial" not in candle for candle in candles)


def test_usa_kept_forming_bar_flags_partial_tail(client, us_stack):
    """A provider that keeps the forming bar must still flag the last candle."""
    df = _us_frame()
    df.attrs["partial_last"] = True
    df.attrs["forming_dropped"] = False
    us_stack.cache.get_us_candles.return_value = df

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 200
    candles = resp.json()["candles"]
    assert "is_partial" not in candles[0]
    assert candles[-1]["is_partial"] is True


# --- validation / error mapping -------------------------------------------


@pytest.mark.parametrize("bad_tf", ["30m", "2h", "1W", "1M", "5s", ""])
def test_usa_invalid_timeframe_400(client, us_stack, bad_tf):
    resp = _get(client, market="usa", timeframe=bad_tf)
    assert resp.status_code == 400
    us_stack.provider.candles.assert_not_called()


def test_usa_as_of_date_rejected_400(client, us_stack):
    resp = _get(client, market="usa", as_of_date="2026-11-16")
    assert resp.status_code == 400
    us_stack.provider.candles.assert_not_called()


def test_usa_no_data_404(client, us_stack):
    us_stack.provider.candles.side_effect = us_stack.no_data

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 404
    assert resp.json() == {"error": "us_no_data", "symbol": "AAPL"}


def test_usa_empty_frame_is_no_data_404(client, us_stack):
    us_stack.provider.candles.return_value = us_stack.df.iloc[0:0]

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 404
    assert resp.json()["error"] == "us_no_data"


def test_usa_provider_failure_502_without_upstream_text(client, us_stack):
    us_stack.provider.candles.side_effect = RuntimeError("secret upstream detail")

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 502
    body = resp.json()
    assert body["error"] == "us_data_unavailable"
    assert body["detail"] == cp_api._US_UNAVAILABLE_DETAIL
    assert "secret upstream detail" not in resp.text


@pytest.mark.parametrize("status", [401, 403])
def test_usa_upstream_auth_error_maps_502_without_upstream_text(
    client, us_stack, status
):
    """Upstream 401/403 (and missing config) are availability failures, not no-data."""
    us_stack.provider.candles.side_effect = ProviderAuthError(
        f"Alpaca authentication failed (HTTP {status}) secret-upstream-body"
    )

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 502
    body = resp.json()
    assert body["error"] == "us_data_unavailable"
    assert body["detail"] == cp_api._US_UNAVAILABLE_DETAIL
    assert "secret-upstream-body" not in resp.text


def test_usa_upstream_rate_limit_maps_429_with_retry_after(client, us_stack):
    us_stack.provider.candles.side_effect = ProviderRateLimitError(
        "Alpaca rate limit exceeded (HTTP 429) secret-upstream-body",
        retry_after=17,
    )

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 429
    assert resp.json() == {"code": "rate_limited", "detail": US_CHART_RATE_DETAIL}
    assert int(resp.headers["retry-after"]) == 17
    assert "secret-upstream-body" not in resp.text


@pytest.mark.parametrize("raw", [None, "not-a-number", "-5", "0"])
def test_usa_rate_limit_unsafe_retry_hint_uses_fixed_default(client, us_stack, raw):
    us_stack.provider.candles.side_effect = ProviderRateLimitError(
        "Alpaca rate limit exceeded", retry_after=raw
    )

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 429
    assert int(resp.headers["retry-after"]) == cp_api._US_UPSTREAM_RETRY_DEFAULT
    assert resp.json() == {"code": "rate_limited", "detail": US_CHART_RATE_DETAIL}


def test_usa_rate_limit_huge_retry_hint_is_capped(client, us_stack):
    us_stack.provider.candles.side_effect = ProviderRateLimitError(
        "Alpaca rate limit exceeded", retry_after="99999"
    )

    resp = _get(client, market="usa", timeframe="1m")

    assert resp.status_code == 429
    assert int(resp.headers["retry-after"]) == cp_api._US_UPSTREAM_RETRY_CAP


# --- symbol allowlist -------------------------------------------------------


@pytest.mark.parametrize("bad_symbol", [
    "AAPL;DROP",
    "A AAPL",
    "aapl$",
    "A" * 21,
    "BRK.B;EVIL",
    "A..B",  # path-traversal dot pair, rejected like us_cache._safe_symbol
    "BRK..B",
    ".AAPL",  # leading separator
    "AAPL.",  # trailing separator
    "AAPL-",  # trailing separator
])
def test_usa_invalid_symbol_400_fixed_detail(client, us_stack, bad_symbol):
    resp = _get(client, bad_symbol, market="usa", timeframe="1m")

    assert resp.status_code == 400
    assert resp.json()["detail"] == cp_api._US_INVALID_SYMBOL_DETAIL
    us_stack.cache.get_us_candles.assert_not_called()
    us_stack.registry.provider_for.assert_not_called()
    us_stack.provider.candles.assert_not_called()


@pytest.mark.parametrize("symbol", ["AAPL", "brk.b", "BRK.B", "A" * 20, "BRK-B"])
def test_usa_valid_symbols_reach_provider(client, us_stack, symbol):
    resp = _get(client, symbol, market="usa", timeframe="1m")

    assert resp.status_code == 200
    assert resp.json()["symbol"] == symbol.upper()
    us_stack.provider.candles.assert_called_once_with(symbol.upper(), "1m")


def test_usa_brk_b_keeps_dot(client, us_stack):
    """Share-class tickers (BRK.B) must survive the allowlist unchanged."""
    resp = _get(client, "BRK.B", market="usa", timeframe="1m")

    assert resp.status_code == 200
    assert resp.json()["symbol"] == "BRK.B"
    us_stack.cache.get_us_candles.assert_called_once_with("BRK.B", "1m")
    us_stack.provider.candles.assert_called_once_with("BRK.B", "1m")


# --- cold-only rate limit ---------------------------------------------------


def test_usa_cold_fetch_spends_token_then_429(client, us_stack):
    us_stack.cache.get_us_candles.return_value = None

    for _ in range(US_CHART_RATE_CAPACITY):
        assert _get(client, market="usa", timeframe="1m").status_code == 200

    blocked = _get(client, market="usa", timeframe="1m")
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == {
        "code": "rate_limited", "detail": US_CHART_RATE_DETAIL,
    }
    assert int(blocked.headers["retry-after"]) >= 1
    # The throttled request never reached the provider.
    assert us_stack.provider.candles.call_count == US_CHART_RATE_CAPACITY


def test_usa_cache_hit_does_not_spend_token(client, us_stack):
    us_stack.cache.get_us_candles.return_value = us_stack.df

    for _ in range(US_CHART_RATE_CAPACITY + 5):
        assert _get(client, market="usa", timeframe="1m").status_code == 200

    us_stack.provider.candles.assert_not_called()
    # A cold call still has its token: warm reads never spent one.
    us_stack.cache.get_us_candles.return_value = None
    assert _get(client, market="usa", timeframe="1m").status_code == 200


def test_unknown_market_400(client, us_stack):
    resp = _get(client, market="uk")
    assert resp.status_code == 400
    us_stack.registry.provider_for.assert_not_called()


# --- India is unchanged ----------------------------------------------------


@pytest.mark.parametrize("params", [{}, {"market": "india"}])
def test_india_path_unchanged_and_is_default(client, us_stack, monkeypatch, params):
    df = _us_frame(n=2)
    monkeypatch.setattr(cp_api, "_stale_first_frame", lambda *a, **k: None)
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session",
        lambda: pd.Timestamp("2026-11-17", tz="UTC"),
    )
    monkeypatch.setattr(
        cp_api, "_stored_overlays_and_lines", lambda *a, **k: ([], [])
    )
    monkeypatch.setattr(cp_api, "_stored_hits", lambda *a, **k: [])
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda *a, **k: {"support": None, "resistance": None},
    )

    resp = client.get(
        ROUTE.format(symbol="RELIANCE"), params={"timeframe": "1m", **params}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert "market" not in body
    assert "feed" not in body
    assert body["symbol"] == "RELIANCE"
    us_stack.registry.provider_for.assert_not_called()
