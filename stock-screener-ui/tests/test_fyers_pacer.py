"""Offline tests for the India board Fyers pacer + upgraded data layer (W1a).

No network, no real Fyers client, no real sleeps. The pacer's ``time.monotonic``
/ ``time.sleep`` are replaced with a virtual clock so token-bucket behaviour is
asserted deterministically on the *number of sleeps* and the *virtual elapsed*
time (never wall-clock).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "india_board" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import fyers_data  # noqa: E402
import fyers_pacer  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class _Clock:
    """Virtual monotonic clock whose ``sleep`` advances it."""

    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += seconds


class _Resp:
    """Minimal stand-in for ``requests.Response``."""

    def __init__(self, status_code, text, headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}
        self.content = text.encode()

    def raise_for_status(self):
        import requests

        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


@pytest.fixture(autouse=True)
def _pacer_reset():
    """Isolate pacer module state between tests."""
    fyers_pacer.reset_state()
    yield
    fyers_pacer.reset_state()


def _install_clock(monkeypatch) -> _Clock:
    clock = _Clock()
    monkeypatch.setattr(time, "monotonic", clock.monotonic)
    monkeypatch.setattr(time, "sleep", clock.sleep)
    return clock


def _patch_requests(monkeypatch, responses):
    """Patch ``fyers_pacer.requests.request``; returns the call log."""
    calls: list[tuple[str, str]] = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url))
        idx = min(len(calls) - 1, len(responses) - 1)
        item = responses[idx]
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(fyers_pacer.requests, "request", fake_request)
    return calls


# ---------------------------------------------------------------------------
# Token bucket
# ---------------------------------------------------------------------------
class TestTokenBucket:
    def test_burst_respects_per_second_window(self, monkeypatch):
        monkeypatch.setattr(fyers_pacer, "_PER_SEC_MAX", 8)
        monkeypatch.setattr(fyers_pacer, "_PER_MIN_MAX", 180)
        fyers_pacer.reset_state()
        clock = _install_clock(monkeypatch)

        for _ in range(10):
            fyers_pacer.acquire()

        # 8 immediate + 2 paced at 1/8s each.
        assert clock.sleeps == [pytest.approx(0.125), pytest.approx(0.125)]
        assert clock.t == pytest.approx(0.25)
        assert fyers_pacer.requests_today() == 10

    def test_minute_window_paces_sustained_burst(self, monkeypatch):
        monkeypatch.setattr(fyers_pacer, "_PER_SEC_MAX", 10 ** 6)
        monkeypatch.setattr(fyers_pacer, "_PER_MIN_MAX", 180)
        fyers_pacer.reset_state()
        clock = _install_clock(monkeypatch)

        for _ in range(200):
            fyers_pacer.acquire()

        # 180 immediate; the remaining 20 drain the minute bucket at 3/s.
        assert len(clock.sleeps) == 20
        assert clock.t == pytest.approx(20 * (60.0 / 180.0))

    def test_daily_cap_raises(self, monkeypatch):
        monkeypatch.setattr(fyers_pacer, "_PER_SEC_MAX", 1000)
        monkeypatch.setattr(fyers_pacer, "_PER_MIN_MAX", 1000)
        monkeypatch.setattr(fyers_pacer, "_DAILY_CAP", 3)
        fyers_pacer.reset_state()

        for _ in range(3):
            fyers_pacer.acquire()
        assert fyers_pacer.requests_today() == 3

        with pytest.raises(fyers_pacer.FyersDailyCapExceeded):
            fyers_pacer.acquire()


# ---------------------------------------------------------------------------
# 429 / retry handling
# ---------------------------------------------------------------------------
class TestRetries:
    def test_honours_retry_after_seconds(self, monkeypatch):
        clock = _install_clock(monkeypatch)
        responses = [
            _Resp(429, '{"s":"error","code":429}', {"Retry-After": "2"}),
            _Resp(200, '{"s":"ok","d":{"x":1}}'),
        ]
        calls = _patch_requests(monkeypatch, responses)

        out = fyers_pacer.paced_request("GET", "http://x", headers={})

        assert out.json() == {"s": "ok", "d": {"x": 1}}
        assert clock.sleeps == [2.0]
        assert len(calls) == 2

    def test_honours_retry_after_ms(self, monkeypatch):
        clock = _install_clock(monkeypatch)
        responses = [
            _Resp(429, '{"s":"error","code":429}', {"X-Retry-After-Ms": "1500"}),
            _Resp(200, '{"s":"ok"}'),
        ]
        _patch_requests(monkeypatch, responses)

        fyers_pacer.paced_request("GET", "http://x", headers={})

        assert clock.sleeps == [1.5]

    def test_exponential_backoff_without_header(self, monkeypatch):
        clock = _install_clock(monkeypatch)
        monkeypatch.setattr(fyers_pacer.random, "random", lambda: 0.0)
        calls = _patch_requests(monkeypatch, [_Resp(429, '{"s":"error","code":429}')])

        with pytest.raises(fyers_pacer.FyersRateLimitError):
            fyers_pacer.paced_request("GET", "http://x", max_retries=3)

        assert clock.sleeps == [1.0, 2.0, 4.0]
        assert len(calls) == 4  # initial + 3 retries

    def test_concatenated_429_then_200_is_retried(self, monkeypatch):
        clock = _install_clock(monkeypatch)
        quirk = (
            '{"s":"error","code":429,"message":"Too many requests"}'
            '{"s":"ok","d":{"x":1}}'
        )
        responses = [_Resp(200, quirk), _Resp(200, '{"s":"ok","d":{"x":1}}')]
        calls = _patch_requests(monkeypatch, responses)

        out = fyers_pacer.paced_request("GET", "http://x", headers={})

        assert out.json() == {"s": "ok", "d": {"x": 1}}
        assert len(calls) == 2, "the leading 429 object must force a retry"
        assert len(clock.sleeps) == 1  # one backoff (default no Retry-After)

    def test_auth_401_raises_without_retry(self, monkeypatch):
        _install_clock(monkeypatch)
        calls = _patch_requests(monkeypatch, [_Resp(401, '{"s":"error","code":401}')])

        with pytest.raises(fyers_pacer.FyersAuthError):
            fyers_pacer.paced_request("GET", "http://x", headers={})

        assert len(calls) == 1, "a dead token must never be retried"


# ---------------------------------------------------------------------------
# Concatenated-payload parsing
# ---------------------------------------------------------------------------
class TestParseJsonMulti:
    def test_quirk_returns_last_object(self):
        text = (
            '{"s":"error","code":429,"message":"Too many requests"}'
            '{"s":"ok","data":{"strike":100}}'
        )
        assert fyers_pacer.parse_json_multi(text) == {
            "s": "ok",
            "data": {"strike": 100},
        }

    def test_leading_429_detected(self):
        text = '{"s":"error","code":429,"message":"rate limit"}{"s":"ok"}'
        assert fyers_pacer.leading_is_429(text) is True
        assert fyers_pacer.leading_is_429('{"s":"ok"}') is False
        assert fyers_pacer.leading_is_429("not json at all") is False

    def test_plain_and_empty(self):
        assert fyers_pacer.parse_json_multi('{"a":1}') == {"a": 1}
        with pytest.raises(ValueError):
            fyers_pacer.parse_json_multi("")


# ---------------------------------------------------------------------------
# get_chain — frozen interface
# ---------------------------------------------------------------------------
def _chain_response():
    return {
        "s": "ok",
        "data": {
            "optionsChain": [
                {"strike_price": -1, "ltp": 23140.0},
                {
                    "strike_price": 23000,
                    "option_type": "CE",
                    "oi": 1000,
                    "oich": 50,
                    "volume": 10,
                    "ltp": 100.0,
                    "bid": 99.5,
                    "ask": 100.5,
                    "prev_oi": 950,
                    "oichp": 5.2,
                    "iv": 0.18,
                    "delta": 0.6,
                    "gamma": 0.001,
                    "theta": -5.0,
                    "vega": 10.0,
                },
                {
                    "strike_price": 23000,
                    "option_type": "PE",
                    "oi": 1200,
                    "oich": -30,
                    "volume": 12,
                    "ltp": 90.0,
                },
            ],
            "expiryData": [
                {"date": "30-09-2026", "expiry": 1790000000, "expiry_flag": "W"},
                {"date": "07-10-2026", "expiry": 1790600000, "expiry_flag": "0"},
            ],
            "callOi": 1000,
            "putOi": 1200,
            "indiavixData": {"iv": 13.5},
        },
    }


class _FakeChainClient:
    def __init__(self, response):
        self.response = response
        self.calls: list[dict] = []

    def optionchain(self, data):
        self.calls.append(dict(data))
        return self.response


def _install_fake_client(monkeypatch, client):
    def fake_get_client(force_refresh=False):
        return client

    monkeypatch.setattr(fyers_data, "_get_client", fake_get_client)


class TestGetChain:
    def test_payload_keys_for_expiry_greeks_strikecount(self, monkeypatch):
        client = _FakeChainClient(_chain_response())
        _install_fake_client(monkeypatch, client)

        fyers_data.get_chain(
            "NIFTY", expiry_epoch=1790000000, greeks=True, strikecount=50
        )

        payload = client.calls[0]
        assert payload["symbol"] == "NSE:NIFTY50-INDEX"
        assert payload["timestamp"] == 1790000000
        assert payload["greeks"] == 1
        assert payload["strikecount"] == 50

    def test_default_payload_omits_timestamp_and_greeks(self, monkeypatch):
        client = _FakeChainClient(_chain_response())
        _install_fake_client(monkeypatch, client)

        fyers_data.get_chain("RELIANCE")

        payload = client.calls[0]
        assert "timestamp" not in payload
        assert "greeks" not in payload
        assert payload["strikecount"] == 50  # Fyers max default

    def test_selected_expiry_and_return_keys(self, monkeypatch):
        client = _FakeChainClient(_chain_response())
        _install_fake_client(monkeypatch, client)

        chain = fyers_data.get_chain("NIFTY", expiry_epoch="1790000000", greeks=True)

        assert chain["ticker"] == "NIFTY"
        assert chain["spot"] == 23140.0
        assert chain["expiry"] == "30-09-2026"
        assert chain["expiry_flag"] == "W"
        assert chain["indiavix"] == 13.5
        assert chain["expiries"] == ["30-09-2026", "07-10-2026"]
        for key in ("strikes", "call_oi", "put_oi", "as_of"):
            assert key in chain

    def test_missing_greeks_are_none_not_zero(self, monkeypatch):
        client = _FakeChainClient(_chain_response())
        _install_fake_client(monkeypatch, client)

        chain = fyers_data.get_chain("NIFTY", greeks=True)
        row = chain["strikes"][0]

        # CE leg carries greeks; PE leg has none -> None (never 0).
        assert row["ce_iv"] == 0.18
        assert row["ce_gamma"] == 0.001
        assert row["ce_delta"] == 0.6
        assert row["pe_iv"] is None
        assert row["pe_delta"] is None
        assert row["pe_gamma"] is None
        assert row["pe_theta"] is None

    def test_strike_row_fields_present(self, monkeypatch):
        client = _FakeChainClient(_chain_response())
        _install_fake_client(monkeypatch, client)

        row = fyers_data.get_chain("NIFTY", greeks=True)["strikes"][0]

        for key in (
            "strike", "ce_oi", "pe_oi", "ce_oich", "pe_oich", "ce_vol",
            "pe_vol", "ce_ltp", "pe_ltp", "ce_bid", "ce_ask", "pe_bid",
            "pe_ask", "ce_prev_oi", "pe_prev_oi", "ce_oichp", "pe_oichp",
        ):
            assert key in row
        assert row["ce_bid"] == 99.5
        assert row["ce_ask"] == 100.5
        assert row["ce_prev_oi"] == 950
        assert row["ce_oichp"] == 5.2


# ---------------------------------------------------------------------------
# list_expiries
# ---------------------------------------------------------------------------
class TestListExpiries:
    def test_returns_structured_expiries_and_caches(self, monkeypatch):
        client = _FakeChainClient(_chain_response())
        _install_fake_client(monkeypatch, client)
        fyers_data._EXPIRIES_CACHE.clear()

        first = fyers_data.list_expiries("NIFTY")
        second = fyers_data.list_expiries("NIFTY")

        assert first == [
            {"date": "30-09-2026", "expiry": 1790000000, "expiry_flag": "W"},
            {"date": "07-10-2026", "expiry": 1790600000, "expiry_flag": "M"},
        ]
        assert second == first
        assert client.calls[0]["strikecount"] == 1
        assert len(client.calls) == 1, "second call must be served from cache"


# ---------------------------------------------------------------------------
# get_quotes
# ---------------------------------------------------------------------------
class _FakeQuotesClient:
    def __init__(self):
        self.batches: list[list[str]] = []

    def quotes(self, data):
        syms = [s for s in str(data.get("symbols", "")).split(",") if s]
        self.batches.append(syms)
        return {
            "s": "ok",
            "d": [
                {
                    "n": s,
                    "v": {"lp": 1.5, "ch": 0.1, "chp": 0.5, "volume": 100, "oi": 200},
                }
                for s in syms
            ],
        }


class TestGetQuotes:
    def test_splits_more_than_50_symbols(self, monkeypatch):
        client = _FakeQuotesClient()
        _install_fake_client(monkeypatch, client)

        symbols = [f"NSE:S{i}-EQ" for i in range(120)]
        out = fyers_data.get_quotes(symbols)

        assert [len(b) for b in client.batches] == [50, 50, 20]
        assert out["NSE:S0-EQ"] == {
            "ltp": 1.5,
            "ch": 0.1,
            "chp": 0.5,
            "volume": 100,
            "oi": 200,
        }
        assert len(out) == 120

    def test_missing_quote_fields_are_none(self, monkeypatch):
        class PartialClient:
            def quotes(self, data):
                return {"s": "ok", "d": [{"n": "NSE:SBIN-EQ", "v": {"lp": 800.0}}]}

        _install_fake_client(monkeypatch, PartialClient())
        out = fyers_data.get_quotes(["NSE:SBIN-EQ"])

        assert out["NSE:SBIN-EQ"] == {
            "ltp": 800.0,
            "ch": None,
            "chp": None,
            "volume": None,
            "oi": None,
        }

    def test_empty_input(self):
        assert fyers_data.get_quotes([]) == {}


# ---------------------------------------------------------------------------
# get_history
# ---------------------------------------------------------------------------
class TestGetHistory:
    def test_wraps_params_and_returns_candles(self, monkeypatch):
        captured: dict = {}

        class HistoryClient:
            def history(self, data):
                captured.update(data)
                return {"s": "ok", "candles": [[1, 2, 3, 4, 5, 6, 7]]}

        _install_fake_client(monkeypatch, HistoryClient())
        candles = fyers_data.get_history(
            "RELIANCE", "5", "2026-09-01", "2026-09-28", oi_flag=True
        )

        assert captured["symbol"] == "NSE:RELIANCE-EQ"
        assert captured["resolution"] == "5"
        assert captured["date_format"] == 1
        assert captured["cont_flag"] == 1
        assert captured["oi_flag"] == 1
        assert captured["range_from"] == "2026-09-01"
        assert captured["range_to"] == "2026-09-28"
        assert candles == [[1, 2, 3, 4, 5, 6, 7]]

    def test_oi_flag_omitted_by_default(self, monkeypatch):
        captured: dict = {}

        class HistoryClient:
            def history(self, data):
                captured.update(data)
                return {"s": "ok", "candles": []}

        _install_fake_client(monkeypatch, HistoryClient())
        fyers_data.get_history("NSE:SBIN-EQ", "1D", "2026-09-01", "2026-09-28")

        assert "oi_flag" not in captured


# ---------------------------------------------------------------------------
# Token re-resolution (no 401 loop)
# ---------------------------------------------------------------------------
class TestReauth:
    def test_401_invalidates_and_retries_once(self, monkeypatch):
        calls: list[int] = []
        good = {"s": "ok", "data": _chain_response()["data"]}

        class Client:
            def optionchain(self, data):
                calls.append(1)
                if len(calls) == 1:
                    return {"s": "error", "code": 401, "message": "token expired"}
                return good

        seen: list[bool] = []

        def fake_get_client(force_refresh=False):
            seen.append(bool(force_refresh))
            return Client()

        monkeypatch.setattr(fyers_data, "_get_client", fake_get_client)

        chain = fyers_data.get_chain("NIFTY")

        assert chain["spot"] == 23140.0
        assert len(calls) == 2, "one reauth retry after the 401"
        assert seen[0] is False and seen[1] is True
