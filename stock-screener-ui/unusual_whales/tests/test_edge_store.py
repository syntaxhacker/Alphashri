"""Tests for the edge SQLite store (temp DB only — never the real edge.db)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import edge_store as E  # noqa: E402


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("UW_EDGE_DB", str(tmp_path / "edge.db"))
    E._reset()
    assert E.init()
    yield E
    E._reset()


BAR = {"ticker": "nvda", "ts": "2026-09-29T14:30:00Z", "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 5000}
BAR2 = {"ticker": "NVDA", "ts": "2026-09-29T14:31:00Z", "o": 100.5, "h": 102, "l": 100.4, "c": 101.5, "v": 4000}
DAILY = {"ticker": "NVDA", "ts": "2026-09-29T00:00:00Z", "o": 99, "h": 102, "l": 98, "c": 101, "v": 1_000_000}

OUT = {
    "alert_id": "flow:abc",
    "horizon": "5m",
    "entry_ts": "2026-09-29T14:30:00Z",
    "entry_px": 100.5,
    "exit_ts": "2026-09-29T14:35:00Z",
    "exit_px": 101.5,
    "ret": 0.995,
    "mfe": 1.5,
    "mae": -0.1,
    "dir": 1,
    "baseline_ret": 0.05,
    "excess": 0.945,
    "resolved_at": "2026-09-29T15:00:00Z",
}


def test_put_and_get_bars(store):
    assert store.put_bars([BAR, BAR2, DAILY]) == 3
    rows = store.get_bars("nvda")
    assert [r["ts"] for r in rows] == ["2026-09-29T00:00:00Z", "2026-09-29T14:30:00Z", "2026-09-29T14:31:00Z"]
    # symbol is normalised to upper-case on write
    assert store.get_bars("NVDA")[1]["c"] == 100.5


def test_put_bars_replace_and_range(store):
    store.put_bars([BAR])
    store.put_bars([dict(BAR, c=100.9)])
    rows = store.get_bars("NVDA", since="2026-09-29T14:30:00Z", until="2026-09-29T14:30:00Z")
    assert len(rows) == 1 and rows[0]["c"] == 100.9


def test_bars_span_daily_vs_intraday(store):
    store.put_bars([BAR, BAR2, DAILY])
    assert store.bars_span("NVDA", daily=False)["n"] == 2
    assert store.bars_span("NVDA", daily=True)["n"] == 1
    assert store.bars_span("ZZZZ") is None


def test_outcomes_round_trip_and_resolved_ids(store):
    assert store.upsert_outcomes([OUT]) == 1
    assert store.upsert_outcomes([dict(OUT, ret=2.0)]) == 1  # replace on PK
    assert store.get_resolved_ids() == {("flow:abc", "5m")}
    outs = store.get_outcomes()
    assert len(outs) == 1 and outs[0]["ret"] == 2.0
    counts = store.outcome_counts()
    assert counts["total"] == 1 and counts["alerts"] == 1 and counts["horizons"]["5m"] == 1


def test_stats_query_and_min_n(store):
    store.save_stats([
        {"scope": "kind", "bucket": "flow", "horizon": "5m", "n": 30, "win_rate": 0.6,
         "avg_ret": 0.4, "avg_excess": 0.2, "tstat": 2.1},
        {"scope": "kind", "bucket": "unusual", "horizon": "5m", "n": 4, "win_rate": 0.5,
         "avg_ret": 0.1, "avg_excess": -0.1, "tstat": -0.5},
    ])
    assert len(store.query_stats(scope="kind")) == 2
    assert len(store.query_stats(scope="kind", horizon="5m")) == 2
    only = store.query_stats(min_n=15)
    assert len(only) == 1 and only[0]["bucket"] == "flow"
    # re-saving the same key replaces, not duplicates
    assert store.save_stats([{"scope": "kind", "bucket": "flow", "horizon": "5m", "n": 31}]) == 1
    assert len(store.query_stats(scope="kind", horizon="5m")) == 2


def test_clear_stats(store):
    store.save_stats([{"scope": "kind", "bucket": "flow", "horizon": "5m", "n": 1}])
    assert store.clear_stats() == 1
    assert store.query_stats() == []


def test_ignores_garbage(store):
    assert store.put_bars([None, {}, {"ticker": "X"}]) == 0
    assert store.upsert_outcomes([None, {"alert_id": "x"}]) == 0
    assert store.get_bars("") == []
    assert store.get_resolved_ids() == set()
