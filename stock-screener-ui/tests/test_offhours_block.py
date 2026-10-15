"""Off-hours circuit-breaker tests for the India board Fyers data path.

No network, no real client, no real sleeps: every transport is either
monkeypatched or injected, and all market-time values are fixed ``datetime``
objects so the suite is deterministic regardless of when it runs.

The suite is intentionally time-independent: an autouse fixture pins
``FYERS_OFFHOURS_BLOCK=1`` (and re-arms ``fyers_pacer`` via ``reset_state``)
so the block is exercised even when the market happens to be open.
"""
from __future__ import annotations

import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "india_board" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import fyers_data  # noqa: E402
import fyers_pacer  # noqa: E402
import scan_data  # noqa: E402

IST = fyers_pacer.IST

MON = "2026-09-28"  # Monday
SAT = "2026-10-03"
SUN = "2026-10-04"


@pytest.fixture(autouse=True)
def _offhours_on(monkeypatch):
    """Arm the off-hours gate for every test in this module."""
    monkeypatch.setenv("FYERS_OFFHOURS_BLOCK", "1")
    fyers_pacer.reset_state()
    yield
    fyers_pacer.reset_state()


def _at(day: str, hour: int, minute: int) -> datetime:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour, minute, tzinfo=IST)


def _no_http(monkeypatch) -> list:
    """Patch the transport with a spy that fails if it is ever called."""
    calls: list = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url))
        raise AssertionError("HTTP must not be attempted off-hours")

    monkeypatch.setattr(fyers_pacer.requests, "request", fake_request)
    return calls


# ---------------------------------------------------------------------------
# (a) offhours_blocked / is_market_open
# ---------------------------------------------------------------------------
class TestOffhoursBlocked:
    def test_true_after_close_and_before_open(self):
        assert fyers_pacer.offhours_blocked(_at(MON, 16, 0)) is True
        assert fyers_pacer.offhours_blocked(_at(MON, 8, 0)) is True

    def test_true_on_weekend(self):
        assert fyers_pacer.offhours_blocked(_at(SAT, 11, 0)) is True
        assert fyers_pacer.offhours_blocked(_at(SUN, 11, 0)) is True

    def test_false_during_session(self):
        assert fyers_pacer.offhours_blocked(_at(MON, 10, 0)) is False
        assert fyers_pacer.offhours_blocked(_at(MON, 15, 29)) is False

    def test_env_disable(self, monkeypatch):
        monkeypatch.setenv("FYERS_OFFHOURS_BLOCK", "0")
        assert fyers_pacer.offhours_blocked(_at(MON, 16, 0)) is False

    def test_is_market_open_bounds(self):
        assert fyers_pacer.is_market_open(_at(MON, 9, 15)) is True
        assert fyers_pacer.is_market_open(_at(MON, 15, 30)) is True
        assert fyers_pacer.is_market_open(_at(MON, 9, 14)) is False
        assert fyers_pacer.is_market_open(_at(MON, 15, 31)) is False


# ---------------------------------------------------------------------------
# (b) acquire / paced_request raise before any HTTP; allow_offhours exempts
# ---------------------------------------------------------------------------
class TestEnforcement:
    def test_acquire_raises_before_http(self, monkeypatch):
        calls = _no_http(monkeypatch)
        with pytest.raises(fyers_pacer.FyersOffHoursBlocked):
            fyers_pacer.acquire()
        assert calls == []

    def test_paced_request_raises_before_http(self, monkeypatch):
        calls = _no_http(monkeypatch)
        with pytest.raises(fyers_pacer.FyersOffHoursBlocked):
            fyers_pacer.paced_request("GET", "http://fyers.test/x")
        assert calls == []

    def test_allow_offhours_permits_call(self, monkeypatch):
        class _Resp:
            status_code = 200
            text = '{"s":"ok","d":{"x":1}}'
            headers: dict = {}
            content = b'{"s":"ok","d":{"x":1}}'

            def raise_for_status(self):
                pass

        calls: list = []

        def fake_request(method, url, **kwargs):
            calls.append((method, url))
            return _Resp()

        monkeypatch.setattr(fyers_pacer.requests, "request", fake_request)

        with fyers_pacer.allow_offhours("test"):
            out = fyers_pacer.paced_request("GET", "http://fyers.test/x")
            assert out.json() == {"s": "ok", "d": {"x": 1}}
            fyers_pacer.acquire()  # must not raise while exempt

        assert len(calls) == 1

    def test_nested_allow_offhours(self):
        with fyers_pacer.allow_offhours("outer"):
            assert fyers_pacer.is_offhours_exempt() is True
            with fyers_pacer.allow_offhours("inner"):
                assert fyers_pacer.is_offhours_exempt() is True
                fyers_pacer.acquire()
            assert fyers_pacer.is_offhours_exempt() is True
        assert fyers_pacer.is_offhours_exempt() is False

    def test_exemption_does_not_leak_to_thread(self):
        seen: dict = {}

        def worker():
            seen["exempt"] = fyers_pacer.is_offhours_exempt()
            seen["blocked"] = fyers_pacer.offhours_blocked()

        with fyers_pacer.allow_offhours("main-thread"):
            t = threading.Thread(target=worker)
            t.start()
            t.join()

        assert seen == {"exempt": False, "blocked": True}

    def test_blocked_calls_counter_and_reset(self):
        assert fyers_pacer.blocked_calls() == 0
        for _ in range(3):
            with pytest.raises(fyers_pacer.FyersOffHoursBlocked):
                fyers_pacer.acquire()
        assert fyers_pacer.blocked_calls() == 3
        fyers_pacer.reset_state()
        assert fyers_pacer.blocked_calls() == 0

    def test_env_disable_allows_acquire(self, monkeypatch):
        monkeypatch.setenv("FYERS_OFFHOURS_BLOCK", "0")
        fyers_pacer.acquire()  # must not raise


# ---------------------------------------------------------------------------
# (c) scan_data.cached_scan(trigger=False) never starts a scan
# ---------------------------------------------------------------------------
def _stale_scan_payload() -> dict:
    return {
        "generated_at": "2026-09-28T10:00:00+05:30",
        "expiry": None,
        "sections": {
            "rows": [{"ticker": "A"}, {"ticker": "B"}],
            "breadth": {"unavailable": True},
        },
        "status": {},
    }


class TestCachedScan:
    def _isolate(self, monkeypatch):
        calls: list = []
        monkeypatch.setattr(
            scan_data, "_start_background", lambda *a, **k: calls.append(1)
        )
        monkeypatch.setattr(scan_data, "_WORKER", None)
        monkeypatch.setattr(
            scan_data, "_CACHE",
            {"payload": _stale_scan_payload(), "ts": time.time() - 10_000},
        )
        return calls

    def test_trigger_false_never_starts_scan(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        out = scan_data.cached_scan(trigger=False)
        assert out["sections"]["rows"] == [{"ticker": "A"}, {"ticker": "B"}]
        assert calls == []

    def test_build_scan_still_triggers(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        scan_data.build_scan()
        assert calls == [1]


# ---------------------------------------------------------------------------
# (d) fyers_data closed-market snapshot / symbol behaviour
# ---------------------------------------------------------------------------
def _synth_chain(ticker: str) -> dict:
    return {
        "ticker": ticker,
        "spot": 100.0,
        "strikes": [{"strike": 100.0, "ce_oi": 10.0, "pe_oi": 20.0}],
        "expiries": ["30-09-2026"],
        "call_oi": 10.0,
        "put_oi": 20.0,
        "as_of": "2026-09-28",
    }


class TestSnapshotClosed:
    def _isolate(self, monkeypatch) -> list:
        calls: list = []
        monkeypatch.setattr(fyers_data, "is_market_open", lambda now=None: False)
        monkeypatch.setattr(fyers_data, "_tape_sections", lambda: {})
        monkeypatch.setattr(fyers_data, "_quote_spot", lambda *a, **k: (100.0, 0.5))
        monkeypatch.setattr(fyers_data, "_CACHE", {})
        monkeypatch.setattr(fyers_data, "_closed_snapshot_day", None)

        def fake_get_chain(t, *a, **k):
            calls.append(t)
            return _synth_chain(t)

        monkeypatch.setattr(fyers_data, "get_chain", fake_get_chain)
        return calls

    def test_cache_present_zero_fetch(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        fyers_data._CACHE["snapshot"] = (
            time.time() - 99_999,
            {"generated_at": "2026-09-28T10:00:00+05:30",
             "sections": {"indices": [], "leaders": [{"ticker": "X"}]}},
        )
        out = fyers_data.build_snapshot()
        assert calls == []
        assert out["data_status"] == "market_closed"

    def test_no_cache_rebuilds_once_then_serves_cache(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        rebuilds = {"n": 0}
        real = fyers_data._rebuild_snapshot

        def counting():
            rebuilds["n"] += 1
            return real()

        monkeypatch.setattr(fyers_data, "_rebuild_snapshot", counting)

        first = fyers_data.build_snapshot()
        first_n = len(calls)
        assert first_n > 0
        assert first["data_status"] == "market_closed"

        second = fyers_data.build_snapshot()
        assert len(calls) == first_n, "second closed call must fetch nothing"
        assert rebuilds["n"] == 1, "exactly one rebuild while closed"
        assert second["data_status"] == "market_closed"

    def test_failed_closed_rebuild_not_retried_same_day(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        rebuilds = {"n": 0}

        def empty_rebuild():
            rebuilds["n"] += 1
            return {"generated_at": None,
                    "sections": {"indices": [], "leaders": []}}

        monkeypatch.setattr(fyers_data, "_rebuild_snapshot", empty_rebuild)

        first = fyers_data.build_snapshot()
        second = fyers_data.build_snapshot()
        assert rebuilds["n"] == 1
        assert calls == []
        assert first["data_status"] == second["data_status"] == "market_closed"


class TestSymbolClosed:
    def _isolate(self, monkeypatch) -> list:
        calls: list = []
        monkeypatch.setattr(fyers_data, "is_market_open", lambda now=None: False)
        monkeypatch.setattr(fyers_data, "_CACHE", {})
        monkeypatch.setattr(fyers_data, "_closed_symbol_attempts", set())

        def fake_get_chain(t, *a, **k):
            calls.append(t)
            return _synth_chain(t)

        monkeypatch.setattr(fyers_data, "get_chain", fake_get_chain)
        return calls

    def test_cache_hit_zero_fetch(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        fyers_data._CACHE["symbol:RELIANCE"] = (
            time.time() - 99_999,
            {"ticker": "RELIANCE", "spot": 1.0},
        )
        out = fyers_data.build_symbol("RELIANCE")
        assert calls == []
        assert out["data_status"] == "market_closed"

    def test_miss_fetches_once_then_caches(self, monkeypatch):
        calls = self._isolate(monkeypatch)
        first = fyers_data.build_symbol("RELIANCE")
        assert len(calls) == 1
        assert first["data_status"] == "market_closed"

        second = fyers_data.build_symbol("RELIANCE")
        assert len(calls) == 1, "cached closed drill-down must not refetch"
        assert second["data_status"] == "market_closed"

    def test_failed_fetch_is_not_retried_same_day(self, monkeypatch):
        monkeypatch.setattr(fyers_data, "is_market_open", lambda now=None: False)
        monkeypatch.setattr(fyers_data, "_CACHE", {})
        monkeypatch.setattr(fyers_data, "_closed_symbol_attempts", set())
        calls: list = []

        def boom(t, *a, **k):
            calls.append(t)
            raise RuntimeError("no data")

        monkeypatch.setattr(fyers_data, "get_chain", boom)

        with pytest.raises(RuntimeError):
            fyers_data.build_symbol("RELIANCE")
        with pytest.raises(RuntimeError):
            fyers_data.build_symbol("RELIANCE")
        assert len(calls) == 1, "a failed closed fetch must not loop"


# ---------------------------------------------------------------------------
# (e) throttled breadth fallback
# ---------------------------------------------------------------------------
class TestBreadthTtl:
    def test_default_ttl_constant(self):
        assert scan_data.BREADTH_TTL == 300.0

    def _isolate(self, monkeypatch, ttl: str = "300"):
        monkeypatch.setenv("BREADTH_TTL", ttl)
        monkeypatch.setattr(scan_data, "_BREADTH_CACHE", {"payload": None, "ts": 0.0})
        calls: list = []

        def quote_fn(symbols):
            calls.append(list(symbols))
            return {
                s: {"ltp": 1.0, "ch": 0.1, "chp": 0.5, "volume": None, "oi": None}
                for s in symbols
            }

        return calls, quote_fn

    def test_two_calls_within_ttl_one_fetch(self, monkeypatch):
        calls, quote_fn = self._isolate(monkeypatch)
        with fyers_pacer.allow_offhours("breadth-test"):
            first = scan_data.cached_breadth(["A", "B"], quote_fn=quote_fn)
            second = scan_data.cached_breadth(["A", "B"], quote_fn=quote_fn)
        assert len(calls) == 1
        assert first is second
        assert first["advancers"] == 2

    def test_offhours_without_exemption_skips_fetch(self, monkeypatch):
        calls, quote_fn = self._isolate(monkeypatch)
        out = scan_data.cached_breadth(["A"], quote_fn=quote_fn)  # not exempt
        assert calls == []
        assert out == {"unavailable": True}


# ---------------------------------------------------------------------------
# Clear diagnostic: a refused closed-market call must say so, not surface as an
# opaque Fyers "-99 Bad request" (the SDK swallows the transport refusal).
# ---------------------------------------------------------------------------


def test_get_chain_raises_clear_offhours_error(monkeypatch):
    import fyers_data

    monkeypatch.setattr(fyers_pacer, "_OFFHOURS_ENFORCED", True)  # arm as in prod
    monkeypatch.setattr(fyers_pacer, "offhours_blocked", lambda now=None: True)
    monkeypatch.setattr(fyers_pacer, "is_offhours_exempt", lambda: False)
    try:
        fyers_data.get_chain("NIFTY")
    except fyers_pacer.FyersOffHoursBlocked as exc:
        assert "outside market hours" in str(exc) or "market closed" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected FyersOffHoursBlocked")


def test_get_chain_is_allowed_inside_exemption(monkeypatch):
    """Inside allow_offhours the guard must not fire (the SDK fake proves it)."""
    import fyers_data

    calls = []

    class _Fake:
        def optionchain(self, data=None):
            calls.append(data)
            return {"s": "ok", "data": {"optionsChain": [
                {"strike_price": -1, "ltp": 100.0, "option_type": ""},
                {"strike_price": 100, "option_type": "CE", "oi": 1, "volume": 2, "ltp": 3},
            ], "expiryData": []}}

    monkeypatch.setattr(fyers_data, "_get_client", lambda force_refresh=False: _Fake())
    monkeypatch.setattr(fyers_pacer, "_OFFHOURS_ENFORCED", True)
    monkeypatch.setattr(fyers_pacer, "offhours_blocked", lambda now=None: True)
    with fyers_pacer.allow_offhours("test"):
        out = fyers_data.get_chain("NIFTY")
    assert calls and out["spot"] == 100.0
