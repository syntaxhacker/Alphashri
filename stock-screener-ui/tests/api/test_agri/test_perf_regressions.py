"""Structural guards for the agri read path's repeated-work hot spots.

These assert work shape (queries, row visits, call count), not wall-clock time,
so they stay stable on a loaded machine but fail if a full scan or a per-key
filtering loop is reintroduced.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from api.agri import aggregate, registry, router as router_module, store


@pytest.fixture(autouse=True)
def clear_caches():
    router_module._PRICES_CACHE.clear()
    store._OPTIONS_CACHE.clear()
    store._GEOGRAPHY_CACHE.clear()
    store._META_CACHE.clear()
    yield
    router_module._PRICES_CACHE.clear()
    store._OPTIONS_CACHE.clear()
    store._GEOGRAPHY_CACHE.clear()
    store._META_CACHE.clear()


class _CountingDict(dict):
    def __init__(self, *args: Any, counts: dict[str, int], **kwargs: Any) -> None:
        self.counts = counts
        super().__init__(*args, **kwargs)

    def get(self, key: Any, default: Any = None) -> Any:
        label = str(key)
        self.counts[label] = self.counts.get(label, 0) + 1
        return super().get(key, default)


class _CountingSeries:
    """Sequence that records how many points a consumer actually reads."""

    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data
        self.reads = 0

    def __len__(self) -> int:
        return len(self.data)

    def __getitem__(self, index: int) -> dict[str, Any]:
        self.reads += 1
        return self.data[index]


def test_prices_does_not_fetch_filter_options(agri_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    calls: list[Any] = []
    real = store.fetch_options

    def counting(*args: Any, **kwargs: Any):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(router_module.store, "fetch_options", counting)
    assert agri_client.get("/api/agri/prices?commodity=onion").json()["ok"] is True
    assert calls == []
    agri_client.get("/api/agri/filters")
    assert len(calls) == 1


def test_filters_scans_geography_once(agri_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    statements: list[str] = []
    real_open = router_module.store.open_reader

    def tracing(path: Any = None):
        conn = real_open(path)
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(router_module.store, "open_reader", tracing)
    assert agri_client.get("/api/agri/filters").json()["ok"] is True
    geo_queries = [sql for sql in statements if "SELECT state, district, market" in sql]
    assert len(geo_queries) == 1
    assert not any("DISTINCT" in sql for sql in geo_queries)


def test_latest_date_per_key_seeks_instead_of_group_scan(db_conn, monkeypatch: pytest.MonkeyPatch):
    statements: list[str] = []
    db_conn.set_trace_callback(statements.append)
    result = store.latest_date_per_key(db_conn, ["onion", "potato"])
    db_conn.set_trace_callback(None)
    assert result == {"onion": None, "potato": None}
    assert len(statements) == 2
    # sqlite3's trace callback expands '?' into literals, so match the shape.
    assert all(
        "MAX(date)" in sql and "commodity_key =" in sql and "GROUP BY" not in sql
        for sql in statements
    )


def test_snapshot_is_built_with_one_call_and_one_row_bucket(
    agri_client: TestClient, monkeypatch: pytest.MonkeyPatch,
):
    calls: list[Any] = []
    real = aggregate.latest_snapshot

    def counting(*args: Any, **kwargs: Any):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(router_module.aggregate, "latest_snapshot", counting)
    assert agri_client.get("/api/agri/prices?commodity=onion").json()["ok"] is True
    assert len(calls) == 1

    counts: dict[str, int] = defaultdict(int)
    keys = list(registry.valid_keys())[:3]
    rows = [
        _CountingDict(
            {"date": "2026-05-31", "commodity_key": key, "modal_price": 100.0,
             "min_price": 90.0, "max_price": 110.0, "market": "Pune APMC"},
            counts=counts,
        )
        for key in keys
    ]
    aggregate.latest_snapshot(rows, keys=keys)
    assert counts["commodity_key"] == len(rows)


def test_changes_from_daily_visits_each_point_once():
    # Every point is on the anchor date, so the old four independent reversed
    # scans read the whole series four times; one pointer reads it once.
    data = [{"date": "2026-05-31", "modal": 100.0} for _ in range(100)]
    series = _CountingSeries(data)
    changes = aggregate.changes_from_daily(series, "2026-05-31")
    assert changes == {"chg_1w_pct": None, "chg_1m_pct": None, "chg_6m_pct": None}
    assert series.reads <= len(data) + 16


def test_aggregate_daily_reads_each_field_once_per_row():
    counts = {name: 0 for name in ("date", "modal_price", "min_price", "max_price", "arrivals_qtl", "market")}
    rows: Iterator[dict[str, Any]] = (
        _CountingDict({
            "date": "2026-05-31", "modal_price": 100.0, "min_price": 90.0,
            "max_price": 110.0, "arrivals_qtl": 10.0, "market": "Pune APMC",
        }, counts=counts)
        for _ in range(50)
    )
    assert len(list(aggregate.aggregate_daily(rows))) == 1
    # date once for bucketing + five fields once each; the old five-pass
    # version read ``market`` twice and every other field once.
    assert sum(counts.values()) <= 6 * 50
