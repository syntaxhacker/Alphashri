"""Unit tests for the Alpaca US-stock candle provider (httpx fully mocked)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import httpx
import pandas as pd
import pytest

import market_data.providers.alpaca as alpaca_mod
from market_data.providers.alpaca import (
    BARS_URL,
    AlpacaAuthError,
    AlpacaProvider,
    AlpacaProviderError,
    AlpacaRateLimitError,
    ProviderNoData,
    range_bounds,
)
from market_data.providers.base import MarketDataProvider, OHLCV

KEY = "test-key-id"
SECRET = "test-secret-key"


def bar(minute: int, close: float, volume: int = 100) -> dict:
    return {
        "t": f"2026-11-17T14:{minute:02d}:00Z",
        "o": close - 1.0,
        "h": close + 1.0,
        "l": close - 2.0,
        "c": close,
        "v": volume,
        "n": 2,
    }


def page(*bars: dict, token: str | None = None) -> dict:
    return {"bars": {"AAPL": list(bars)}, "next_page_token": token}


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch):
    for name in (
        "ALPACA_API_KEY", "ALPACA_API_SECRET", "APCA_API_KEY_ID",
        "APCA_API_SECRET_KEY", "ALPACA_FEED",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ALPACA_API_KEY", KEY)
    monkeypatch.setenv("ALPACA_API_SECRET", SECRET)
    yield


@pytest.fixture
def http(monkeypatch: pytest.MonkeyPatch):
    """Patch the httpx client constructor; return (client, constructor)."""
    client = MagicMock()
    constructor = MagicMock(return_value=client)
    monkeypatch.setattr(alpaca_mod.httpx, "Client", constructor)
    return client, constructor


def response(payload: dict, status: int = 200) -> MagicMock:
    result = MagicMock()
    result.status_code = status
    result.json.return_value = payload
    return result


def test_matches_provider_protocol(http) -> None:
    provider = AlpacaProvider()
    assert AlpacaProvider.configured() is True
    assert isinstance(provider, MarketDataProvider)
    assert provider.market == "usa"
    assert provider.quote("AAPL") is None


def test_request_headers_and_params(http) -> None:
    client, _ = http
    client.get.return_value = response(page(bar(30, 101.0)))

    frame = AlpacaProvider().candles(
        "AAPL", "1m", start="2026-11-17T00:00:00Z", end="2026-11-17T23:59:00Z"
    )

    client.get.assert_called_once()
    args, kwargs = client.get.call_args
    assert args == (BARS_URL,)
    assert kwargs["headers"] == {
        "APCA-API-KEY-ID": KEY,
        "APCA-API-SECRET-KEY": SECRET,
    }
    params = kwargs["params"]
    assert params["symbols"] == "AAPL"
    assert params["timeframe"] == "1Min"
    assert params["start"] == "2026-11-17T00:00:00Z"
    assert params["end"] == "2026-11-17T23:59:00Z"
    assert params["feed"] == "iex"
    assert params["limit"] == 10000
    assert "page_token" not in params

    assert list(frame.columns) == list(OHLCV)
    assert frame.index.tz is not None
    assert str(frame.index.tz) == "UTC"
    assert frame.iloc[0]["close"] == 101.0
    assert frame.iloc[0]["open"] == 100.0
    assert frame.iloc[0]["high"] == 102.0
    assert frame.iloc[0]["low"] == 99.0
    assert frame.iloc[0]["volume"] == 100


@pytest.mark.parametrize(
    ("requested", "expected"),
    [
        ("1m", "1Min"), ("5m", "5Min"), ("15m", "15Min"),
        ("1h", "1Hour"), ("1D", "1Day"),
    ],
)
def test_timeframe_mapping(http, requested: str, expected: str) -> None:
    client, _ = http
    client.get.return_value = response(page(bar(30, 101.0)))
    AlpacaProvider().candles("AAPL", requested)
    assert client.get.call_args.kwargs["params"]["timeframe"] == expected


def test_unsupported_timeframe_raises_no_data(http) -> None:
    client, _ = http
    with pytest.raises(ProviderNoData, match="unsupported Alpaca timeframe"):
        AlpacaProvider().candles("AAPL", "2m")
    client.get.assert_not_called()


def test_pagination_merges_deduplicates_and_sorts(http) -> None:
    client, _ = http
    client.get.side_effect = [
        response(page(bar(31, 102.0), bar(30, 101.0), token="page-2")),
        response(page(bar(30, 101.5), bar(29, 100.0))),
    ]

    frame = AlpacaProvider().candles("AAPL", "1m")

    assert client.get.call_count == 2
    assert "page_token" not in client.get.call_args_list[0].kwargs["params"]
    assert client.get.call_args_list[1].kwargs["params"]["page_token"] == "page-2"
    assert list(frame.index.strftime("%H:%M")) == ["14:29", "14:30", "14:31"]
    assert frame.iloc[1]["close"] == 101.5  # duplicate minute keeps the last page


def test_empty_bars_raise_provider_no_data(http) -> None:
    client, _ = http
    client.get.return_value = response({"bars": {}, "next_page_token": None})
    with pytest.raises(ProviderNoData):
        AlpacaProvider().candles("AAPL", "1m")


def test_iex_is_default_and_sip_is_opt_in(http, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = http
    client.get.return_value = response(page(bar(30, 101.0)))

    iex = AlpacaProvider()
    assert iex.feed == "iex"
    assert iex.delay_label == "live (IEX)"
    assert iex.feed_label == "alpaca-iex"
    iex.candles("AAPL", "1m")
    assert client.get.call_args.kwargs["params"]["feed"] == "iex"

    monkeypatch.setenv("ALPACA_FEED", "sip")
    sip = AlpacaProvider()
    assert sip.feed == "sip"
    assert sip.delay_label == "15 min delayed (SIP)"
    assert sip.feed_label == "alpaca-sip"
    sip.candles("AAPL", "1m")
    assert client.get.call_args.kwargs["params"]["feed"] == "sip"


def test_missing_credentials_make_provider_unavailable(
    http, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, constructor = http
    for name in (
        "ALPACA_API_KEY", "ALPACA_API_SECRET", "APCA_API_KEY_ID",
        "APCA_API_SECRET_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    provider = AlpacaProvider()
    assert AlpacaProvider.configured() is False
    assert provider.is_available() is False
    assert provider.available is False
    constructor.assert_not_called()
    with pytest.raises(AlpacaAuthError, match="not configured"):
        provider.candles("AAPL", "1m")


def test_symbol_mapping_uses_shared_map(http) -> None:
    client, _ = http
    client.get.return_value = response({"bars": {"BRK-B": [bar(30, 101.0)]}})

    frame = AlpacaProvider().candles("BRK.B", "1m")

    assert client.get.call_args.kwargs["params"]["symbols"] == "BRK-B"
    assert not frame.empty
    client.get.reset_mock()
    client.get.return_value = response(page(bar(30, 101.0)))
    AlpacaProvider().candles("NASDAQ:aapl", "1m")
    assert client.get.call_args.kwargs["params"]["symbols"] == "AAPL"


def test_shared_symbol_map_is_called(http, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = http
    client.get.return_value = response(page(bar(30, 101.0)))
    seen: list[str] = []

    def fake_map(raw: str) -> str:
        seen.append(raw)
        return "MAPPED"

    monkeypatch.setattr(alpaca_mod, "normalize_us_symbol", fake_map)
    AlpacaProvider().candles("BRK.B", "1m")
    assert seen == ["BRK.B"]
    assert client.get.call_args.kwargs["params"]["symbols"] == "MAPPED"


@pytest.mark.parametrize(
    ("status", "error", "kind"),
    [
        (401, AlpacaAuthError, "auth"),
        (403, AlpacaAuthError, "auth"),
        (429, AlpacaRateLimitError, "rate_limit"),
    ],
)
def test_http_auth_and_rate_limit_are_typed_errors(
    http, status: int, error, kind: str
) -> None:
    client, _ = http
    client.get.return_value = response({"message": "denied"}, status=status)

    with pytest.raises(error) as caught:
        AlpacaProvider().candles("AAPL", "1m")
    assert client.get.call_count == 1  # never paginate into an error response
    # Route discriminator + legacy ProviderNoData compatibility.
    assert caught.value.kind == kind
    assert isinstance(caught.value, ProviderNoData)


def test_auth_error_kind_and_no_data_compatibility(http) -> None:
    """Missing credentials are an auth failure but still a ProviderNoData."""
    provider = AlpacaProvider(api_key="", api_secret="")
    with pytest.raises(AlpacaAuthError) as caught:
        provider.candles("AAPL", "1m")
    assert caught.value.kind == "auth"
    assert isinstance(caught.value, ProviderNoData)


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("12", 12),          # safe numeric hint is preserved
        ("abc", 60),         # non-numeric upstream text is dropped
        ("-5", 60),          # non-positive hint falls back
        ("99999", 300),      # absurd hint is capped
        (None, 60),          # no header -> default
    ],
)
def test_rate_limit_retry_after_is_sanitized(http, header, expected) -> None:
    client, _ = http
    resp = response({"message": "slow down"}, status=429)
    resp.headers = {} if header is None else {"Retry-After": header}
    client.get.return_value = resp

    with pytest.raises(AlpacaRateLimitError) as caught:
        AlpacaProvider().candles("AAPL", "1m")
    assert caught.value.retry_after == expected


def test_server_error_is_typed_error(http) -> None:
    client, _ = http
    client.get.return_value = response({"message": "boom"}, status=500)
    with pytest.raises(AlpacaProviderError, match="HTTP 500"):
        AlpacaProvider().candles("AAPL", "1m")


def test_network_error_is_typed_error(http) -> None:
    client, _ = http
    client.get.side_effect = httpx.ConnectError("no route")
    with pytest.raises(AlpacaProviderError, match="ConnectError"):
        AlpacaProvider().candles("AAPL", "1m")


def test_non_json_response_is_typed_error(http) -> None:
    client, _ = http
    broken = MagicMock()
    broken.status_code = 200
    broken.json.side_effect = ValueError("not json")
    client.get.return_value = broken
    with pytest.raises(AlpacaProviderError, match="non-JSON"):
        AlpacaProvider().candles("AAPL", "1m")


def test_range_bounds_are_utc_and_handle_max() -> None:
    now = datetime(2026, 11, 17, 18, 0, tzinfo=timezone.utc)
    start, end = range_bounds("5d", now=now)
    assert end == "2026-11-17T18:00:00Z"
    assert start == "2026-11-12T18:00:00Z"

    start, end = range_bounds("max", now=now)
    assert start == alpaca_mod.ALPACA_EPOCH_1M
    assert end.endswith("Z")

    start, end = range_bounds(None, start="2026-01-01T00:00:00Z", end="2026-01-02", now=now)
    assert start == "2026-01-01T00:00:00Z"
    assert end == "2026-01-02T00:00:00Z"


def test_default_range_depends_on_timeframe(http) -> None:
    client, _ = http
    client.get.return_value = response(page(bar(30, 101.0)))
    AlpacaProvider().candles("AAPL", "1D")
    params = client.get.call_args.kwargs["params"]
    start = pd.Timestamp(params["start"])
    end = pd.Timestamp(params["end"])
    assert (end - start).days == 365  # 1Day defaults to a 1y window
