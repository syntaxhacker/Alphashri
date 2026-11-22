"""Offline tests for the agri DB maintenance CLI — temp SQLite DBs only.

The real cache is never opened or modified by these tests. No network, no
server, no writes outside ``tmp_path``.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.agri import store  # noqa: E402
from scripts.market import agri_db_maintenance as maint  # noqa: E402

pytestmark = pytest.mark.unit


def _make_db(path: Path, *, rows: int = 2, statuses: tuple[str, ...] = ("complete", "partial")) -> Path:
    conn = store.open_writer(path)
    try:
        for i in range(rows):
            conn.execute(
                "INSERT INTO agri_mandi_prices "
                "(date, state, district, market, commodity, commodity_key, variety, grade, modal_price) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    f"2026-11-{20 + i:02d}", "Maharashtra", "Pune", "Pune APMC",
                    "Onion", "onion", "Common", "FAQ", 1000.0 + i,
                ),
            )
        for i, status in enumerate(statuses):
            conn.execute(
                "INSERT INTO agri_ingest_partitions (source, arrival_date, status) VALUES (?,?,?)",
                ("agmarknet_daily", f"2026-11-{20 + i:02d}", status),
            )
        conn.commit()
    finally:
        conn.close()
    return path


class TestCheck:
    def test_reports_integrity_sizes_counts_and_indexes(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")

        result = maint.run_check(db)

        assert result.read_only is True
        assert result.quick_check_run is True
        assert (result.integrity, result.integrity_ok) == ("ok", True)
        assert result.journal_mode == "wal"
        assert result.sizes.page_size == 4096
        assert result.sizes.page_count > 0
        assert result.sizes.logical_bytes == result.sizes.page_size * result.sizes.page_count
        assert result.sizes.main_bytes > 0
        assert result.sizes.wal_bytes >= 0 and result.sizes.shm_bytes >= 0
        assert result.rows == {store.TABLE: 2, store.LEDGER_TABLE: 2}
        assert result.partitions == (
            {"status": "complete", "count": 1},
            {"status": "partial", "count": 1},
        )
        assert result.distinct_dates == 2
        assert (result.first_date, result.last_date) == ("2026-11-20", "2026-11-21")
        assert result.commodity_keys == 1

        by_name = {index.name: index for index in result.indexes}
        assert by_name["idx_agri_key_date"].columns == ("commodity_key", "date")
        assert by_name["idx_agri_geo"].columns == ("state", "district", "market")
        assert by_name[store.GEO_INDEX_NAME].origin == "c"
        assert {item.redundant for item in result.redundant} == {
            "idx_agri_state", "idx_agri_commodity_key",
        }
        assert all(item.kind == "leading-column prefix" for item in result.redundant)
        assert {item.covered_by for item in result.redundant} == {
            "idx_agri_geo", "idx_agri_key_date",
        }

        payload = result.as_dict()
        assert payload["mode"] == "check"
        assert payload["redundant_indexes"], "redundancy must be machine-readable too"

    def test_no_mutation_in_check_mode(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")
        before = hashlib.sha256(db.read_bytes()).hexdigest()
        mtime = db.stat().st_mtime_ns

        maint.run_check(db)
        maint.run_check(db, quick_check=False)

        assert hashlib.sha256(db.read_bytes()).hexdigest() == before
        assert db.stat().st_mtime_ns == mtime
        assert not Path(str(db) + "-journal").exists()
        assert maint.run_check(db, quick_check=False).rows[store.TABLE] == 2


class TestRedundancy:
    def test_duplicate_and_leading_prefix_detection(self, tmp_path, monkeypatch):
        db = tmp_path / "indexes.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            "CREATE TABLE t(a TEXT, b TEXT, c TEXT);"
            "CREATE INDEX idx_b ON t(b);"
            "CREATE INDEX idx_b_dup ON t(b);"
            "CREATE INDEX idx_b_c ON t(b, c);"
            "CREATE UNIQUE INDEX idx_u_a ON t(a);"
            "CREATE INDEX idx_a_x ON t(a);"
            "CREATE INDEX idx_p1 ON t(c) WHERE b IS NOT NULL;"
            "CREATE INDEX idx_p2 ON t(c) WHERE b IS NOT NULL;"
            "CREATE INDEX idx_p3 ON t(c) WHERE a IS NOT NULL;"
        )
        conn.commit()
        conn.close()
        monkeypatch.setattr(maint, "PRICE_TABLE", "t")
        monkeypatch.setattr(maint, "LEDGER_TABLE", "not_a_table")

        reader = maint.open_read_only(db)
        try:
            indexes = maint.read_indexes(reader)
        finally:
            reader.close()
        found = {
            (item.redundant, item.covered_by, item.kind)
            for item in maint.find_redundant_indexes(indexes)
        }

        assert ("idx_b_dup", "idx_b", "duplicate") in found
        assert ("idx_b", "idx_b_c", "leading-column prefix") in found
        assert ("idx_p2", "idx_p1", "duplicate") in found
        # UNIQUE indexes enforce a constraint and are never suggested for drop;
        # a non-unique index sharing their leading column is kept conservatively.
        assert not any(item[0] in {"idx_u_a", "idx_a_x", "idx_p3"} for item in found)


class TestVacuum:
    def test_refuses_without_confirmation(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")
        before = db.read_bytes()

        with pytest.raises(maint.RefusalError, match="requires --yes"):
            maint.run_vacuum(db, confirm=False)

        assert db.read_bytes() == before

    def test_refuses_when_writer_active(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")
        writer = sqlite3.connect(db)
        writer.execute("PRAGMA busy_timeout=0")
        writer.execute("BEGIN IMMEDIATE")
        writer.execute(
            "INSERT INTO agri_mandi_prices(date, commodity, commodity_key) "
            "VALUES('2026-11-22','Onion','onion')"
        )
        try:
            with pytest.raises(maint.RefusalError, match="in use"):
                maint.run_vacuum(db, confirm=True)
        finally:
            writer.rollback()
            writer.close()

        assert maint.run_check(db, quick_check=False).rows[store.TABLE] == 2

    def test_refuses_when_in_use_probe_reports_reader(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")

        with pytest.raises(maint.RefusalError, match="in use"):
            maint.run_vacuum(
                db, confirm=True, in_use_probe=lambda _: "active WAL reader"
            )

    def test_refuses_when_free_space_insufficient(self, tmp_path, monkeypatch):
        db = _make_db(tmp_path / "agri_prices.db")
        monkeypatch.setattr(maint.shutil, "disk_usage", lambda _: SimpleNamespace(free=1))

        with pytest.raises(maint.RefusalError, match="insufficient free space"):
            maint.run_vacuum(db, confirm=True)

        assert maint.run_check(db, quick_check=False).rows[store.TABLE] == 2

    def test_runs_offline_with_confirmation_and_keeps_rows(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")
        before = maint.run_check(db, quick_check=False).rows

        result = maint.run_vacuum(db, confirm=True)

        assert result.after_bytes > 0
        assert result.reclaimed_bytes >= 0
        assert result.freelist_before >= 0
        assert result.required_space_bytes > result.before_bytes
        assert maint.run_check(db, quick_check=False).rows == before

    @pytest.mark.skipif(os.name != "posix", reason="POSIX record locks")
    def test_shm_reader_lock_from_other_process_is_detected(self, tmp_path):
        shm = tmp_path / "agri.db-shm"
        shm.write_bytes(b"\x00" * 256)
        script = (
            "import fcntl, os, sys\n"
            "fd = os.open(sys.argv[1], os.O_RDWR)\n"
            "fcntl.lockf(fd, fcntl.LOCK_EX, 1, 123, os.SEEK_SET)\n"
            "sys.stdout.write('locked\\n'); sys.stdout.flush()\n"
            "sys.stdin.readline()\n"
        )
        proc = subprocess.Popen(
            [sys.executable, "-c", script, str(shm)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            assert proc.stdout.readline().strip() == "locked"
            assert maint._shm_lock_held(shm) == "WAL reader slot 1"
        finally:
            proc.stdin.write("\n")
            proc.stdin.flush()
            proc.wait(timeout=10)


class TestOptimize:
    def test_optimize_runs_checkpoint_without_changing_rows(self, tmp_path):
        db = _make_db(tmp_path / "agri_prices.db")
        before = maint.run_check(db, quick_check=False).rows

        result = maint.run_optimize(db)

        assert result.journal_mode == "wal"
        assert result.checkpoint_mode == "PASSIVE"
        assert len(result.checkpoint) == 3
        assert all(isinstance(value, int) for value in result.checkpoint)
        assert set(result.tables_read) == {store.TABLE, store.LEDGER_TABLE}
        assert maint.run_check(db, quick_check=False).rows == before


class TestCli:
    def test_default_check_json_is_read_only(self, tmp_path, monkeypatch, capsys):
        db = _make_db(tmp_path / "agri_prices.db")
        monkeypatch.setattr(maint, "ALLOWED_DB_PATHS", (db,))

        assert maint.main(["--db", str(db), "--json", "--no-quick-check"]) == 0

        payload = json.loads(capsys.readouterr().out)
        assert payload["mode"] == "check"
        assert payload["read_only"] is True
        assert payload["quick_check_run"] is False
        assert payload["integrity"] == "not run"

    def test_rejects_unknown_db_path(self, tmp_path, capsys):
        other = tmp_path / "not_agri.db"

        assert maint.main(["--db", str(other)]) == 2

        stderr = capsys.readouterr().err
        assert "refusing unknown DB path" in stderr
        assert str(other) not in stderr
        assert not other.exists()

    def test_vacuum_requires_yes_flag(self, tmp_path, monkeypatch, capsys):
        db = _make_db(tmp_path / "agri_prices.db")
        monkeypatch.setattr(maint, "ALLOWED_DB_PATHS", (db,))

        assert maint.main(["--db", str(db), "--vacuum"]) == 2

        assert "requires --yes" in capsys.readouterr().err

    def test_errors_are_redacted(self, tmp_path, monkeypatch, capsys):
        db = _make_db(tmp_path / "agri_prices.db")
        monkeypatch.setattr(maint, "ALLOWED_DB_PATHS", (db,))

        def boom(*_args, **_kwargs):
            raise sqlite3.OperationalError(f"unable to open database file: {db}")

        monkeypatch.setattr(maint, "run_check", boom)
        assert maint.main(["--db", str(db), "--no-quick-check"]) == 2

        stderr = capsys.readouterr().err
        assert "<db>" in stderr
        assert str(db) not in stderr
