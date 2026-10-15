"""Tests for the alert SQLite store (uses a temp DB, never the real one)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import alert_store as S  # noqa: E402


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("UW_ALERTS_DB", str(tmp_path / "alerts.db"))
    S._reset()
    yield S
    S._reset()


ROW = {
    "id": "flow:abc",
    "kind": "flow",
    "ticker": "nvda",
    "asset_class": "stock",
    "type": "call",
    "strike": 200,
    "expiry": "2026-10-16",
    "premium": 1250000,
    "size": 5,
    "volume": 10,
    "oi": 3,
    "vol_oi": 1.2,
    "sweep": True,
    "side": "bullish",
    "rule": "RepeatedHits",
    "created_at": "2026-09-28T14:00:00Z",
}


def test_upsert_is_idempotent_and_queryable(store):
    assert store.upsert([ROW], "live") == 1
    assert store.upsert([ROW], "live") == 0  # same id -> ignored
    q = store.query(ticker="nvda")
    assert q["total"] == 1
    assert q["rows"][0]["ticker"] == "NVDA"
    assert q["rows"][0]["sweep"] == 1


def test_query_filters(store):
    store.upsert([ROW], "live")
    store.upsert([dict(ROW, id="oi:1", kind="oi", ticker="SPX", asset_class="index", rule="OI critical")], "oi")
    assert store.query(kind="oi")["total"] == 1
    assert store.query(asset_class="index")["total"] == 1
    assert store.query(q="repeated")["total"] == 1  # rule LIKE, case-insensitive
    assert store.query(q="nope")["total"] == 0


def test_stats(store):
    store.upsert([ROW, dict(ROW, id="flow:2", ticker="SPY", asset_class="etf")], "live")
    st = store.stats()
    assert st["total"] == 2
    assert st["by_kind"].get("flow") == 2
    assert st["by_class"].get("etf") == 1
    assert st["tickers"] == 2


def test_ignores_garbage_rows(store):
    assert store.upsert([None, {}, {"no_id": 1}], "live") == 0
    assert store.stats()["total"] == 0


def test_prune_keeps_recent(store):
    store.upsert([ROW], "live")
    assert store.prune(30) == 0  # just inserted -> not old enough to delete
    assert store.stats()["total"] == 1
