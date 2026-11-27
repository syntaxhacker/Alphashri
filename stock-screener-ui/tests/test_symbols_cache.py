"""TTL, single-flight and LRU behaviour of the TV symbol search cache."""

import threading

import pytest

import api.symbols as symbols

_CLOCK = {"t": 1000.0}

RESULTS = [
    {"symbol": "RELIANCE", "name": "Reliance Industries", "isin": ""},
    {"symbol": "REL", "name": "Reliance Capital", "isin": ""},
]


class _Scanner:
    """Stand-in for api.symbols._scan_tv with a holdable gate."""

    def __init__(self, results=None):
        self.calls = []
        self.results = [] if results is None else results
        self.boom = False
        self.gate = None
        self.entered = threading.Event()

    def __call__(self, q, limit=10, market="india"):
        self.calls.append((q, limit, market))
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(5)
        if self.boom:
            raise RuntimeError("TV down")
        return [dict(r) for r in self.results]


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    symbols.clear_tv_search_cache()
    _CLOCK["t"] = 1000.0
    monkeypatch.setattr(symbols, "_tv_search_monotonic", lambda: _CLOCK["t"])
    yield
    symbols.clear_tv_search_cache()


def _scanner(monkeypatch, results=None):
    scanner = _Scanner(results)
    monkeypatch.setattr(symbols, "_scan_tv", scanner)
    return scanner


def test_repeated_query_scans_once_and_hands_out_copies(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)
    first = symbols._search_tv("reliance", 10)
    first[0]["symbol"] = "MUTATED"
    first.append({"symbol": "EXTRA"})

    second = symbols._search_tv("reliance", 10)

    assert scanner.calls == [("reliance", 10, "india")]
    assert second == RESULTS
    assert first is not second


def test_key_normalizes_query_case_and_whitespace(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)

    symbols._search_tv("  RELIANCE  ", 10)
    symbols._search_tv("reliance", 10)

    assert len(scanner.calls) == 1


def test_distinct_market_and_limit_scan_again(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)

    symbols._search_tv("reliance", 10)
    symbols._search_tv("reliance", 20)
    symbols._search_tv("reliance", 10, market="usa")

    assert scanner.calls == [
        ("reliance", 10, "india"),
        ("reliance", 20, "india"),
        ("reliance", 10, "usa"),
    ]


def test_result_shape_and_order_survive_the_cache(monkeypatch):
    ordered = [
        {"symbol": "ZZ", "name": "Zee", "isin": ""},
        {"symbol": "AA", "name": "Alpha", "isin": ""},
    ]
    scanner = _scanner(monkeypatch, ordered)

    first = symbols._search_tv("z", 2)
    cached = symbols._search_tv("z", 2)

    assert first == ordered
    assert cached == ordered
    assert all(set(row) == {"symbol", "name", "isin"} for row in cached)


def test_empty_query_never_scans_or_caches(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)

    assert symbols._search_tv("") == []
    assert symbols._search_tv("   ") == []

    assert scanner.calls == []
    assert len(symbols._tv_search_cache) == 0


def test_ttl_expiry_rescans(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)

    symbols._search_tv("reliance", 10)
    _CLOCK["t"] += 30
    symbols._search_tv("reliance", 10)
    assert len(scanner.calls) == 1

    _CLOCK["t"] += 31
    symbols._search_tv("reliance", 10)
    assert len(scanner.calls) == 2


def test_concurrent_identical_calls_share_one_scan(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)
    scanner.gate = threading.Event()
    ready = threading.Barrier(9)
    returned, errors = [], []

    def worker():
        try:
            ready.wait(5)
            returned.append(symbols._search_tv("reliance", 10))
        except Exception as exc:  # surfaced by the assertions below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    ready.wait(5)
    assert scanner.entered.wait(5)
    assert returned == []  # waiters are held by the singleflight, not rescanning

    scanner.gate.set()
    for thread in threads:
        thread.join(5)

    assert not errors
    assert len(returned) == 8
    assert all(rows == RESULTS for rows in returned)
    assert len(scanner.calls) == 1
    assert not symbols._tv_search_inflight


def test_failed_scan_is_retried_not_cached(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)

    scanner.boom = True
    assert symbols._search_tv("reliance", 10) == []
    assert scanner.calls == [("reliance", 10, "india")]

    scanner.boom = False
    assert symbols._search_tv("reliance", 10) == RESULTS
    assert len(scanner.calls) == 2
    assert not symbols._tv_search_inflight


def test_waiters_share_failure_then_callers_retry(monkeypatch):
    scanner = _scanner(monkeypatch, RESULTS)
    scanner.boom = True
    scanner.gate = threading.Event()
    ready = threading.Barrier(5)
    claimed = threading.Barrier(5)
    returned, errors = [], []

    original_claim = symbols._claim_tv_search

    def tracking_claim(key):
        outcome = original_claim(key)
        # Hold every caller at the claim point so none can start a fresh scan
        # after the failed flight is dropped (failures are deliberately uncached).
        claimed.wait(5)
        return outcome

    monkeypatch.setattr(symbols, "_claim_tv_search", tracking_claim)

    def worker():
        try:
            ready.wait(5)
            returned.append(symbols._search_tv("reliance", 10))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    ready.wait(5)
    claimed.wait(5)
    assert scanner.entered.wait(5)

    scanner.gate.set()
    for thread in threads:
        thread.join(5)

    assert not errors
    assert returned == [[], [], [], []]
    assert len(scanner.calls) == 1
    assert not symbols._tv_search_inflight

    monkeypatch.setattr(symbols, "_claim_tv_search", original_claim)
    scanner.boom = False
    assert symbols._search_tv("reliance", 10) == RESULTS
    assert len(scanner.calls) == 2


def test_tv_source_endpoint_reuses_the_cached_scan(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.symbols import router as symbols_router

    app = FastAPI()
    app.include_router(symbols_router)
    client = TestClient(app)
    scanner = _scanner(monkeypatch, RESULTS)

    first = client.get("/api/symbols/search?q=RELIANCE&source=tv")
    second = client.get("/api/symbols/search?q=reliance&source=tv")

    assert first.status_code == second.status_code == 200
    assert first.json() == {
        "results": RESULTS,
        "query": "RELIANCE",
        "total": 2,
        "source": "tv",
    }
    assert second.json() == {**first.json(), "query": "reliance"}
    assert len(scanner.calls) == 1


def test_bounded_lru_evicts_least_recently_used(monkeypatch):
    monkeypatch.setattr(symbols, "_TV_SEARCH_MAX_ENTRIES", 2)
    scanner = _scanner(monkeypatch, RESULTS)

    symbols._search_tv("aaa")
    symbols._search_tv("bbb")
    symbols._search_tv("aaa")  # aaa becomes most recently used
    symbols._search_tv("ccc")  # evicts bbb

    assert {key.query for key in symbols._tv_search_cache} == {"aaa", "ccc"}
    assert len(symbols._tv_search_cache) == 2

    symbols._search_tv("bbb")  # evicted key must rescan
    assert [call[0] for call in scanner.calls] == ["aaa", "bbb", "ccc", "bbb"]
