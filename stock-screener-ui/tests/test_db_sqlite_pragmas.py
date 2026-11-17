"""SQLite pragmas applied by db.database (WAL + reader-friendly settings)."""

import sys
from pathlib import Path

import pytest
from sqlalchemy import event

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import database as db_database


@pytest.fixture
def file_engine(tmp_path):
    engine = db_database._build_engine(f"sqlite:///{tmp_path / 'pragma.db'}")
    yield engine
    engine.dispose()


class TestPragmaSet:
    def test_every_connection_gets_wal_and_timeouts(self, file_engine):
        with file_engine.connect() as conn:
            assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
            assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
            # NORMAL == 1
            assert conn.exec_driver_sql("PRAGMA synchronous").scalar() == 1
            assert conn.exec_driver_sql("PRAGMA cache_size").scalar() == -65536

    def test_pragmas_survive_a_second_connection(self, file_engine):
        with file_engine.connect() as first:
            first.exec_driver_sql("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            first.commit()
        with file_engine.connect() as second:
            assert second.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
            assert second.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000

    def test_wal_files_created_next_to_db(self, tmp_path):
        path = tmp_path / "wal.db"
        engine = db_database._build_engine(f"sqlite:///{path}")
        try:
            with engine.connect() as conn:
                conn.exec_driver_sql("CREATE TABLE t (id INTEGER PRIMARY KEY)")
                conn.exec_driver_sql("INSERT INTO t (id) VALUES (1)")
                conn.commit()
                assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
            assert (tmp_path / "wal.db-wal").exists()
        finally:
            engine.dispose()

    def test_wal_survives_reopen_of_existing_file(self, tmp_path):
        path = tmp_path / "reopen.db"
        first = db_database._build_engine(f"sqlite:///{path}")
        with first.connect() as conn:
            conn.exec_driver_sql("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            conn.commit()
        first.dispose()

        second = db_database._build_engine(f"sqlite:///{path}")
        try:
            with second.connect() as conn:
                assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        finally:
            second.dispose()


class TestNonSqlite:
    def test_postgres_url_gets_no_sqlite_pragmas(self):
        # create_engine resolves the driver but does not connect, so this is offline.
        engine = db_database._build_engine(
            "postgresql+psycopg2://u:p@localhost:5432/alphashri"
        )
        try:
            assert engine.dialect.name == "postgresql"
            assert not event.contains(engine, "connect", db_database.apply_sqlite_pragmas)
            assert "connect_args" not in getattr(engine.dialect, "_connect_args", {})
            assert engine.pool._pre_ping is True
            assert engine.pool._recycle == 300
        finally:
            engine.dispose()

    def test_sqlite_url_detection(self):
        assert db_database._is_sqlite_url("sqlite:///tmp/x.db")
        assert db_database._is_sqlite_url("sqlite+pysqlite:///:memory:")
        assert not db_database._is_sqlite_url("postgresql://u:p@h/db")
        assert not db_database._is_sqlite_url("mysql+pymysql://u:p@h/db")


class TestPragmaStatements:
    def test_handler_issues_all_four_pragmas(self):
        executed = []

        class FakeCursor:
            def execute(self, sql):
                executed.append(sql)

            def fetchall(self):
                return []

            def close(self):
                executed.append("close")

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

        db_database.apply_sqlite_pragmas(FakeConnection(), None)

        assert executed == [
            "PRAGMA journal_mode=WAL",
            "PRAGMA busy_timeout=5000",
            "PRAGMA synchronous=NORMAL",
            "PRAGMA cache_size=-65536",
            "close",
        ]


class TestLiveEngine:
    def test_app_engine_is_sqlite_and_pragma_attached(self):
        if not db_database.SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
            pytest.skip("configured DB is not SQLite")
        assert event.contains(
            db_database.engine, "connect", db_database.apply_sqlite_pragmas
        )


class TestBackupCompatibility:
    def test_sqlite_backup_api_copies_a_live_wal_database(self, tmp_path):
        import sqlite3

        from scripts.backup_db import _snapshot

        source = tmp_path / "live.db"
        engine = db_database._build_engine(f"sqlite:///{source}")
        try:
            # Keep the writer connection open so the -wal file exists at copy
            # time, which is the state the API is in when the backup task runs.
            with engine.connect() as conn:
                conn.exec_driver_sql("CREATE TABLE t (id INTEGER PRIMARY KEY)")
                conn.exec_driver_sql("INSERT INTO t (id) VALUES (42)")
                conn.commit()
                assert (tmp_path / "live.db-wal").exists()

                dest = tmp_path / "copy.db"
                _snapshot(source, dest)

                copied = sqlite3.connect(str(dest))
                try:
                    assert copied.execute("SELECT id FROM t").fetchall() == [(42,)]
                    assert copied.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                finally:
                    copied.close()
        finally:
            engine.dispose()
