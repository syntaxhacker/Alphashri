from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest

from api.agri import store


def _row(day: str = "2026-05-31", *, variety: str = "No 1", modal: float = 100.0) -> dict[str, Any]:
    return {
        "date": day, "state": "Maharashtra", "district": "Pune", "market": "Pune APMC",
        "commodity": "Onion", "commodity_key": "onion", "variety": variety, "grade": "FAQ",
        "min_price": 90.0, "max_price": 110.0, "modal_price": modal,
        "arrivals_qtl": 100.0, "price_unit": "Rs./Quintal", "source": "test",
    }


def test_upsert_is_idempotent_and_updates_existing_values(db_conn):
    assert store.upsert_rows(db_conn, [_row()]) == 1
    assert store.upsert_rows(db_conn, [_row(modal=130.0)]) == 1
    assert store.count_rows(db_conn) == 1
    assert store.fetch_rows(db_conn)[0]["modal_price"] == 130.0


def test_unique_key_includes_variety(db_conn):
    store.upsert_rows(db_conn, [_row(), _row(variety="No 2")])
    assert store.count_rows(db_conn) == 2


def test_fetch_rows_filters_and_date_bounds(db_conn):
    store.upsert_rows(db_conn, [
        _row("2026-05-30"), _row("2026-05-31"),
        {**_row("2026-05-31"), "state": "Karnataka", "market": "Bengaluru APMC"},
    ])
    assert len(store.fetch_rows(db_conn, on_date="2026-05-31")) == 2
    assert len(store.fetch_rows(db_conn, states=["Karnataka"])) == 1
    assert len(store.fetch_rows(db_conn, markets=["Pune APMC"])) == 2
    assert len(store.fetch_rows(db_conn, from_date="2026-05-31")) == 2
    assert len(store.fetch_rows(db_conn, to_date="2026-05-30")) == 1
    assert len(store.fetch_rows(db_conn, limit=1)) == 1
    assert store.latest_date(db_conn, markets=["Bengaluru APMC"]) == "2026-05-31"


def test_anchor_dates_are_nearest_at_or_before(db_conn):
    store.upsert_rows(db_conn, [_row("2026-05-24"), _row("2026-05-31")])
    anchors = store.anchor_dates(
        db_conn, {"onion": ("Onion",)}, "2026-05-31", (7, 30, 182),
    )
    assert anchors["onion"][7] == "2026-05-24"
    assert anchors["onion"][30] is None
    assert anchors["onion"][182] is None


def test_reader_is_read_only_and_missing_db_is_reported(temp_db: Path, tmp_path: Path):
    conn = store.open_reader(temp_db)
    assert conn is not None
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute(f"INSERT INTO {store.TABLE} (date, commodity, commodity_key) VALUES ('2026-01-01', 'X', 'x')")
    finally:
        conn.close()
    assert store.open_reader(tmp_path / "absent.db") is None


def test_schema_and_indexes_exist(db_conn):
    names = {row[0] for row in db_conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','index')")}
    assert store.TABLE in names
    assert {"idx_agri_date", "idx_agri_commodity_key", "idx_agri_state"} <= names


def test_fetch_geography_builds_compact_cascade(db_conn):
    store.upsert_rows(db_conn, [
        _row(),
        {**_row(), "state": "Karnataka", "district": "Bengaluru", "market": "Bengaluru APMC"},
        {**_row(variety="No 2"), "state": "Karnataka", "district": "Bengaluru", "market": "Bengaluru APMC"},
    ])
    geography = store.fetch_geography(db_conn)
    assert geography["state_districts"] == {
        "Karnataka": ["Bengaluru"], "Maharashtra": ["Pune"],
    }
    assert geography["district_markets"] == {
        "Karnataka||Bengaluru": ["Bengaluru APMC"],
        "Maharashtra||Pune": ["Pune APMC"],
    }


def test_options_and_geography_use_separate_identity_caches(db_conn, monkeypatch):
    identity = store.cache_identity(db_conn)
    options_sentinel = {"as_of": "sentinel", "states": ["X"]}
    geography_sentinel = {"state_districts": {"X": ["Y"]}}
    monkeypatch.setattr(store, "_OPTIONS_CACHE", {identity: options_sentinel})
    monkeypatch.setattr(store, "_GEOGRAPHY_CACHE", {identity: geography_sentinel})
    assert store.fetch_options(db_conn) == options_sentinel
    assert store.fetch_geography(db_conn) == geography_sentinel


def test_cache_identity_changes_after_a_write(db_conn, tmp_path):
    before = store.cache_identity(db_conn)
    assert before is not None
    assert Path(before[0]) == tmp_path / "store.db"
    store.upsert_rows(db_conn, [_row()])
    after = store.cache_identity(db_conn)
    assert after is not None
    assert after[0] == before[0]
    assert after != before
