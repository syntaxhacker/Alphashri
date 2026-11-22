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


_LEGACY_SCHEMA = f"""
CREATE TABLE {store.TABLE} (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    date           DATE NOT NULL,
    state          TEXT NOT NULL DEFAULT '',
    district       TEXT NOT NULL DEFAULT '',
    market         TEXT NOT NULL DEFAULT '',
    commodity      TEXT NOT NULL,
    commodity_key  TEXT NOT NULL,
    variety        TEXT NOT NULL DEFAULT '',
    grade          TEXT NOT NULL DEFAULT '',
    min_price      FLOAT NULL,
    max_price      FLOAT NULL,
    modal_price    FLOAT NULL,
    arrivals_qtl   FLOAT NULL,
    price_unit     TEXT NOT NULL DEFAULT '',
    source         TEXT NOT NULL DEFAULT '',
    UNIQUE(date, state, district, market, commodity, variety, grade)
);
"""


def test_additive_migration_keeps_existing_rows(tmp_path: Path):
    path = tmp_path / "legacy.db"
    legacy = sqlite3.connect(path)
    legacy.executescript(_LEGACY_SCHEMA)
    legacy.execute(
        f"INSERT INTO {store.TABLE} (date, state, district, market, commodity, "
        "commodity_key, variety, grade, modal_price, arrivals_qtl) "
        "VALUES ('2026-05-31', 'Punjab', 'Bathinda', 'Bathinda APMC', "
        "'Wheat', 'wheat', 'FAQ', 'FAQ', 2400, 90)"
    )
    legacy.commit()
    legacy.close()

    conn = store.open_writer(path)
    try:
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({store.TABLE})")}
        assert {
            "source_commodity", "product_form", "price_unit", "arrival_units",
            "price_source", "arrivals_source", "ingested_at",
        } <= columns
        assert store.count_rows(conn) == 1
        assert store.fetch_rows(conn)[0]["modal_price"] == 2400
        ledger = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert store.LEDGER_TABLE in ledger
    finally:
        conn.close()


def test_writer_enables_wal_and_busy_timeout(tmp_path: Path):
    conn = store.open_writer(tmp_path / "wal.db")
    try:
        assert str(conn.execute("PRAGMA journal_mode").fetchone()[0]).lower() == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] >= 5000
    finally:
        conn.close()


def test_daily_null_arrivals_do_not_overwrite_ckan_history(db_conn):
    store.upsert_rows(db_conn, [{
        **_row(),
        "source": "agmarknet_ckan",
        "source_commodity": "Onion",
        "arrivals_qtl": 100.0,
        "arrival_units": "Metric Tonnes",
        "price_source": "agmarknet_ckan",
        "arrivals_source": "ckan",
        "ingested_at": "2026-05-31T10:00:00+05:30",
    }])
    store.upsert_rows(db_conn, [{
        **_row(modal=130.0),
        "source": "agmarknet_daily",
        "source_commodity": "Onion",
        "arrivals_qtl": None,
        "arrival_units": "",
        "price_source": "agmarknet_daily",
        "arrivals_source": "none",
        "ingested_at": "2026-06-01T10:00:00+05:30",
    }])

    row = store.fetch_rows(db_conn)[0]
    assert row["modal_price"] == 130.0
    assert row["arrivals_qtl"] == 100.0
    assert row["arrival_units"] == "Metric Tonnes"
    assert row["arrivals_source"] == "ckan"
    assert row["price_source"] == "agmarknet_daily"
    assert row["source"] == "agmarknet_daily"
    assert row["source_commodity"] == "Onion"
    assert row["ingested_at"] == "2026-06-01T10:00:00+05:30"


def test_commodity_keys_filter_and_latest_date_per_key(db_conn):
    store.upsert_rows(db_conn, [
        _row("2026-05-30"),
        _row("2026-05-31"),
        {**_row("2026-05-29"), "commodity": "Potato", "commodity_key": "potato",
         "market": "Pune APMC", "variety": "Local"},
    ])

    assert len(store.fetch_rows(db_conn, commodity_keys=["onion"])) == 2
    assert len(store.fetch_rows(db_conn, commodity_keys=["potato"])) == 1
    assert store.latest_date(db_conn, commodity_keys=["potato"]) == "2026-05-29"
    assert store.latest_date_per_key(
        db_conn, ["onion", "potato", "wheat"],
    ) == {"onion": "2026-05-31", "potato": "2026-05-29", "wheat": None}
    assert store.latest_date_per_key(
        db_conn, ["onion", "potato"], districts=["Pune"],
    ) == {"onion": "2026-05-31", "potato": "2026-05-29"}
    assert store.latest_date_per_key(
        db_conn, ["onion", "potato"], states=["Karnataka"],
    ) == {"onion": None, "potato": None}


def test_partition_ledger_only_complete_is_terminal(db_conn):
    store.upsert_partition(
        db_conn, source="agmarknet_daily", arrival_date="2026-11-21",
        status="partial", expected_total=15843, fetched_rows=3942, pages=4,
        api_updated_at="2026-11-22 05:12:00", run_id="r1",
        started_at="2026-11-22T08:00:00+05:30",
        finished_at="2026-11-22T08:01:00+05:30", error="rows_seen 3942 != api total 15843",
    )
    row = store.get_partition(db_conn, "agmarknet_daily", "2026-11-21")
    assert row["status"] == "partial"
    assert row["expected_total"] == 15843
    assert row["fetched_rows"] == 3942
    assert store.get_partition(db_conn, "agmarknet_daily", "2026-11-20") is None

    store.upsert_partition(
        db_conn, source="agmarknet_daily", arrival_date="2026-11-21",
        status="complete", expected_total=15843, fetched_rows=15843, pages=16,
        run_id="r2",
    )
    assert store.get_partition(db_conn, "agmarknet_daily", "2026-11-21")["status"] == "complete"
    assert len(store.fetch_partitions(db_conn, statuses=["complete"])) == 1
    assert store.fetch_partitions(db_conn, statuses=["partial"]) == []

    with pytest.raises(ValueError):
        store.upsert_partition(
            db_conn, source="agmarknet_daily", arrival_date="2026-11-22",
            status="finished",
        )


def test_open_reader_migrates_legacy_columns(tmp_path):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.execute(
        f"CREATE TABLE {store.TABLE} ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, date DATE NOT NULL, "
        "state TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '', "
        "market TEXT NOT NULL DEFAULT '', commodity TEXT NOT NULL, "
        "commodity_key TEXT NOT NULL, variety TEXT NOT NULL DEFAULT '', "
        "grade TEXT NOT NULL DEFAULT '', min_price FLOAT, max_price FLOAT, "
        "modal_price FLOAT, arrivals_qtl FLOAT, "
        "price_unit TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', "
        "UNIQUE(date, state, district, market, commodity, variety, grade))"
    )
    conn.commit()
    conn.close()
    store._MIGRATED_PATHS.clear()

    reader = store.open_reader(path)
    assert reader is not None
    columns = {row[1] for row in reader.execute(f"PRAGMA table_info({store.TABLE})")}
    assert {"source_commodity", "product_form", "arrival_units", "price_source"} <= columns
    reader.close()
