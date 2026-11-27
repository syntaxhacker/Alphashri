"""Tests for the shared TradingView frame cache (api/tv/cache.py)."""
import threading
import time
from dataclasses import FrozenInstanceError
from types import SimpleNamespace

import pandas as pd
import pytest
import requests

import api.tv.cache as tv_cache
from api.tv import status as tv_status
from api.tv.cache import FrameDescriptor, clear, invalidate, scan_frame_cached

_CLOCK = {"t": 1000.0}


class _Scanner:
    """Callable stand-in for api.tv.scan_frame with a holdable gate."""

    def __init__(self):
        self.calls = []
        self.frame = pd.DataFrame({"close": [1.0, 2.0]})
        self.boom = False
        self.gate = None

    def __call__(self, *args, **kwargs):
        if self.gate is not None:
            self.gate.wait(5)
        if self.boom:
            raise RuntimeError("TV down")
        self.calls.append(kwargs)
        return self.frame


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    """Isolate both caches and drive TTL with a controllable monotonic clock."""
    _CLOCK["t"] = 1000.0
    clear()
    tv_status._last.update(mode=None, at=None, rows=0)
    monkeypatch.setattr(tv_cache, "_monotonic", lambda: _CLOCK["t"])
    yield
    clear()
    tv_status._last.update(mode=None, at=None, rows=0)


def _scanner(monkeypatch):
    scanner = _Scanner()
    monkeypatch.setattr(tv_cache, "scan_frame", scanner)
    return scanner


def _desc(**kw):
    base = dict(market="india", columns=["name", "close"], limit=100)
    base.update(kw)
    return FrameDescriptor(**base)


# --------------------------------------------------------------------------- #
# Descriptor / key
# --------------------------------------------------------------------------- #

def test_descriptor_is_frozen_and_hashable():
    desc = _desc()
    assert hash(desc) == hash(_desc())
    with pytest.raises(FrozenInstanceError):
        desc.limit = 5


def test_dict_insertion_order_does_not_affect_key():
    first = FrameDescriptor(
        market="india", body_extra={"z": 1, "a": [1, 2]},
        filters=[{"field": "close", "operator": "in", "value": ["a", "b"]}],
    )
    reordered = FrameDescriptor(
        market="india", body_extra={"a": [1, 2], "z": 1},
        filters=[{"value": ["a", "b"], "operator": "in", "field": "close"}],
    )
    assert first.cache_key == reordered.cache_key
    assert hash(first) == hash(reordered)

    different = FrameDescriptor(
        market="india", body_extra={"a": [1, 2], "z": 2},
        filters=[{"value": ["a", "b"], "operator": "in", "field": "close"}],
    )
    assert different.cache_key != first.cache_key


def test_distinct_query_fields_produce_distinct_keys():
    base = _desc()
    variants = [
        _desc(columns=["name"]),                       # columns
        _desc(limit=50),                               # limit
        _desc(filters=[{"field": "close", "operator": "egt", "value": 10}]),
        _desc(market="america"),                       # market
        _desc(sort="close"),                           # sort
        _desc(order="asc"),                            # order
        _desc(tickers=["NSE:AAA"]),                    # tickers
        _desc(markets=["america"]),                    # markets
        _desc(body_extra={"x": 1}),                    # body extras
    ]
    keys = {base.cache_key} | {v.cache_key for v in variants}
    assert len(keys) == len(variants) + 1


def test_descriptor_reconstructs_scan_kwargs_and_reaches_upstream(monkeypatch):
    scanner = _scanner(monkeypatch)
    desc = FrameDescriptor(
        market="india", columns=["name", "close"],
        filters=[{"field": "close", "operator": "egt", "value": 10}],
        sort="close", order="asc", limit=25,
        tickers=["NSE:AAA"], markets=["india"],
        body_extra={"ignore_unknown_fields": True},
    )
    assert desc.to_scan_kwargs() == {
        "market": "india",
        "columns": ["name", "close"],
        "filters": [{"field": "close", "operator": "egt", "value": 10}],
        "sort": "close", "order": "asc", "limit": 25,
        "tickers": ["NSE:AAA"], "markets": ["india"],
        "body_extra": {"ignore_unknown_fields": True},
    }
    scan_frame_cached(desc)
    assert scanner.calls == [desc.to_scan_kwargs()]


# --------------------------------------------------------------------------- #
# Caching semantics
# --------------------------------------------------------------------------- #

def test_same_descriptor_reuses_frame_without_rescanning(monkeypatch):
    scanner = _scanner(monkeypatch)
    first = scan_frame_cached(_desc())
    second = scan_frame_cached(_desc())  # equal but distinct instance
    assert first is second
    assert len(scanner.calls) == 1


def test_eight_concurrent_calls_collapse_to_one_scan(monkeypatch):
    scanner = _scanner(monkeypatch)
    scanner.gate = threading.Event()
    desc = _desc()

    start = threading.Barrier(9)
    results, errors = [], []

    def worker():
        try:
            start.wait(5)
            results.append(scan_frame_cached(desc, ttl_seconds=60))
        except Exception as exc:  # pragma: no cover - surfaced by the assert
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    start.wait(5)
    time.sleep(0.05)  # let the seven waiters reach the singleflight event
    scanner.gate.set()
    for thread in threads:
        thread.join(5)

    assert not errors
    assert len(results) == 8
    assert all(frame is scanner.frame for frame in results)
    assert len(scanner.calls) == 1


def test_ttl_expiry_rescans(monkeypatch):
    scanner = _scanner(monkeypatch)
    desc = _desc()

    scan_frame_cached(desc, ttl_seconds=10)
    _CLOCK["t"] += 5
    scan_frame_cached(desc, ttl_seconds=10)
    assert len(scanner.calls) == 1  # still fresh

    _CLOCK["t"] += 6  # now past stored_at + 10
    scan_frame_cached(desc, ttl_seconds=10)
    assert len(scanner.calls) == 2


def test_force_bypasses_cache_and_refreshes_it(monkeypatch):
    scanner = _scanner(monkeypatch)
    desc = _desc()

    scan_frame_cached(desc, ttl_seconds=60)
    scan_frame_cached(desc, ttl_seconds=60, force=True)
    assert len(scanner.calls) == 2
    scan_frame_cached(desc, ttl_seconds=60)  # uses the forced frame
    assert len(scanner.calls) == 2


def test_failure_is_not_cached(monkeypatch):
    scanner = _scanner(monkeypatch)
    desc = _desc()

    scanner.boom = True
    with pytest.raises(RuntimeError, match="TV down"):
        scan_frame_cached(desc)
    scanner.boom = False

    frame = scan_frame_cached(desc)
    assert frame is scanner.frame
    # The failed scan never recorded a call; the retry did. A cached exception
    # would have made this second call return without scanning at all.
    assert len(scanner.calls) == 1
    assert not tv_cache._inflight  # failed slot must not poison later calls


def test_waiters_share_failure_then_callers_retry(monkeypatch):
    scanner = _scanner(monkeypatch)
    scanner.boom = True
    scanner.gate = threading.Event()
    desc = _desc()

    start = threading.Barrier(5)
    errors = []

    def worker():
        start.wait(5)
        try:
            scan_frame_cached(desc)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    start.wait(5)
    time.sleep(0.05)
    scanner.gate.set()
    for thread in threads:
        thread.join(5)

    assert len(errors) == 4
    assert all(errors[0] is err for err in errors)
    assert len(scanner.calls) == 0  # a failed scan stores nothing

    scanner.boom = False
    assert scan_frame_cached(desc) is scanner.frame
    assert len(scanner.calls) == 1


def test_invalidate_and_clear(monkeypatch):
    scanner = _scanner(monkeypatch)
    india, america = _desc(), _desc(market="america")

    scan_frame_cached(india)
    scan_frame_cached(america)
    assert len(scanner.calls) == 2

    invalidate(india)
    scan_frame_cached(india)
    scan_frame_cached(america)
    assert len(scanner.calls) == 3  # only the invalidated descriptor rescanned

    clear()
    scan_frame_cached(india)
    scan_frame_cached(america)
    assert len(scanner.calls) == 5


def test_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(tv_cache, "MAX_CACHE_ENTRIES", 2)
    scanner = _scanner(monkeypatch)
    for limit in range(4):
        scan_frame_cached(_desc(limit=limit))
    assert len(tv_cache._cache) == 2


# --------------------------------------------------------------------------- #
# Self-heal inside the singleflight (auth + delayed feed)
# --------------------------------------------------------------------------- #

def _http_error(code):
    exc = requests.HTTPError(f"HTTP {code}")
    exc.response = SimpleNamespace(status_code=code)
    return exc


def test_cache_401_refreshes_cookies_and_retries(monkeypatch):
    frame = pd.DataFrame({"close": [1.0]})
    calls, refreshes = [], []

    def scan(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise _http_error(401)
        return frame

    monkeypatch.setattr(tv_cache, "scan_frame", scan)
    monkeypatch.setattr(tv_cache, "refresh_tv_cookies", lambda: refreshes.append(True))
    monkeypatch.setattr(tv_cache, "tv_feed_status", lambda: {"mode": "streaming"})

    assert scan_frame_cached(_desc()) is frame
    assert len(calls) == 2
    assert refreshes == [True]
    assert not tv_cache._inflight


def test_cache_delayed_feed_refreshes_and_retries(monkeypatch):
    frame = pd.DataFrame({"close": [1.0]})  # no update_mode -> shared status decides
    calls, refreshes = [], []

    def scan(**kwargs):
        calls.append(kwargs)
        return frame

    monkeypatch.setattr(tv_cache, "scan_frame", scan)
    monkeypatch.setattr(tv_cache, "refresh_tv_cookies", lambda: refreshes.append(True))
    monkeypatch.setattr(tv_cache, "tv_feed_status",
                        lambda: {"mode": "delayed_streaming_900"})

    assert scan_frame_cached(_desc()) is frame
    assert len(calls) == 2
    assert refreshes == [True]


def test_cache_failed_heal_is_not_cached(monkeypatch):
    refreshes = []

    def scan(**kwargs):
        raise _http_error(403)

    monkeypatch.setattr(tv_cache, "scan_frame", scan)
    monkeypatch.setattr(tv_cache, "refresh_tv_cookies", lambda: refreshes.append(True))
    monkeypatch.setattr(tv_cache, "tv_feed_status", lambda: {"mode": "streaming"})

    with pytest.raises(requests.HTTPError):
        scan_frame_cached(_desc())
    assert refreshes == [True]
    assert not tv_cache._cache
    assert not tv_cache._inflight


def test_concurrent_callers_share_one_auth_retry(monkeypatch):
    frame = pd.DataFrame({"close": [1.0]})
    gate = threading.Event()
    calls, refreshes = [], []

    def scan(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            gate.wait(5)
            raise _http_error(401)
        return frame

    monkeypatch.setattr(tv_cache, "scan_frame", scan)
    monkeypatch.setattr(tv_cache, "refresh_tv_cookies", lambda: refreshes.append(True))
    monkeypatch.setattr(tv_cache, "tv_feed_status", lambda: {"mode": "streaming"})

    desc = _desc()
    start = threading.Barrier(5)
    results, errors = [], []

    def worker():
        try:
            start.wait(5)
            results.append(scan_frame_cached(desc))
        except Exception as exc:  # surfaced by the asserts below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    start.wait(5)
    gate.set()
    for thread in threads:
        thread.join(5)

    assert not errors
    assert len(results) == 4
    assert all(result is frame for result in results)
    assert len(calls) == 2  # one gated 401 + one shared retry
    assert refreshes == [True]
