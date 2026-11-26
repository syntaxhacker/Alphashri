"""Structural regressions for the audited non-agri DB read paths.

Assertions are about plans, selected columns and emitted values only — no
wall-clock budget lives here. Timing is reported separately by the read-only
``scripts/perf/db_query_bench.py --report`` harness.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

SEGMENT_INDEX = "ix_instruments_segment"
COVERING_INDEX = "ix_instruments_segment_symbol_key"
REPLAY_INDEX = "ix_replay_saved_configs_user_updated"


def _insert_instruments(conn) -> None:
    from db.models.broker import Instrument

    conn.execute(
        Instrument.__table__.insert(),
        [
            dict(
                instrument_key="NSE_EQ|K1", trading_symbol="AAA", name="Alpha",
                exchange="NSE", segment="NSE_EQ", isin="INE001A01001",
            ),
            dict(
                instrument_key="NSE_EQ|K2", trading_symbol="BBB", name="Beta",
                exchange="NSE", segment="NSE_EQ", isin="INE002A01002",
            ),
            dict(
                instrument_key="NSE_FO|K3", trading_symbol="CCC", name="Gamma",
                exchange="NSE", segment="NSE_FO", isin="INE003A01003",
            ),
        ],
    )


def _plan(conn, sql: str) -> list[str]:
    return [row[3] for row in conn.execute(text("EXPLAIN QUERY PLAN " + sql)).fetchall()]


class TestInstrumentIndexes:
    def test_model_declares_segment_and_covering_indexes(self):
        from db.models.broker import Instrument

        names = {idx.name for idx in Instrument.__table__.indexes}
        assert SEGMENT_INDEX in names
        assert COVERING_INDEX in names

    def test_movers_key_lookup_uses_covering_index(self, test_db_engine):
        with test_db_engine.begin() as conn:
            _insert_instruments(conn)
            details = _plan(
                conn,
                "SELECT trading_symbol, instrument_key FROM instruments "
                "WHERE segment = 'NSE_EQ' AND trading_symbol IN ('AAA','BBB')",
            )
        assert any(COVERING_INDEX in d for d in details), details
        assert any("COVERING INDEX" in d for d in details), details
        assert not any("SCAN" in d for d in details), details

    def test_segment_count_uses_index(self, test_db_engine):
        with test_db_engine.begin() as conn:
            _insert_instruments(conn)
            details = _plan(
                conn, "SELECT COUNT(*) FROM instruments WHERE segment = 'NSE_EQ'"
            )
        assert any(SEGMENT_INDEX in d or COVERING_INDEX in d for d in details), details
        assert not any("SCAN" in d for d in details), details

    def test_movers_payload_unchanged(self, test_db_engine, monkeypatch):
        with test_db_engine.begin() as conn:
            _insert_instruments(conn)
        monkeypatch.setattr("db.database.SessionLocal", sessionmaker(bind=test_db_engine))

        from api.reports_api.movers import _resolve_instrument_keys

        assert _resolve_instrument_keys(["AAA", "BBB"]) == {
            "AAA": "NSE_EQ|K1",
            "BBB": "NSE_EQ|K2",
        }


class TestSymbolsProjection:
    def _load(self, test_db_engine, monkeypatch):
        import api.symbols as symbols

        with test_db_engine.begin() as conn:
            _insert_instruments(conn)
        monkeypatch.setattr(symbols, "SessionLocal", sessionmaker(bind=test_db_engine))
        monkeypatch.setattr(symbols, "_instruments_loaded", False)
        monkeypatch.setattr(symbols, "_instruments_cache", [])
        loaded = symbols._load_instruments()
        return symbols, loaded

    def test_cache_holds_only_search_columns(self, test_db_engine, monkeypatch):
        _symbols, loaded = self._load(test_db_engine, monkeypatch)
        assert loaded
        assert {tuple(sorted(row)) for row in loaded} == {
            ("isin", "name", "segment", "trading_symbol")
        }

    def test_api_payload_unchanged_after_projection(self, test_db_engine, monkeypatch):
        symbols, loaded = self._load(test_db_engine, monkeypatch)
        assert {row["trading_symbol"] for row in loaded} == {"AAA", "BBB"}

        out = asyncio.run(
            symbols.search_symbols(q="AA", limit=10, source="local", fno=False)
        )
        assert out == {
            "results": [{"symbol": "AAA", "name": "Alpha", "isin": "INE001A01001"}],
            "query": "AA",
            "total": 1,
            "source": "local",
        }


class TestLiveStreamSymbolProjection:
    def test_position_query_selects_only_symbol(self, monkeypatch):
        import api.paper.live_stream as live
        from db.models import Position

        seen: list[tuple] = []

        class _Query:
            def filter(self, *args, **kwargs):
                return self

            def all(self):
                return []

        class _DB:
            def query(self, *columns):
                seen.append(columns)
                return _Query()

            def close(self):
                pass

        class _Trader:
            def get_positions(self):
                return []

        monkeypatch.setattr("db.database.SessionLocal", lambda: _DB())
        monkeypatch.setattr(
            "trading.paper_trader.get_paper_trader", lambda uid: _Trader()
        )
        monkeypatch.setattr("pathlib.Path.exists", lambda self: False)

        assert live._get_instrument_keys(1) == ([], {})
        assert seen, "positions read did not happen"
        assert len(seen[0]) == 1, seen[0]
        assert seen[0][0] is Position.symbol, seen[0]

    def test_emitted_symbol_set_unchanged(self, test_db_engine, monkeypatch):
        from db.models import Instrument, Position

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with test_db_engine.begin() as conn:
            conn.execute(
                Position.__table__.insert(),
                [
                    dict(
                        uuid=f"p{i}", user_id=uid, bot_id=1, strategy_name="s",
                        symbol=sym, side="BUY", quantity=1, entry_price=100.0,
                        entry_time=now, is_test=False,
                    )
                    for i, (uid, sym) in enumerate(
                        [(7, "AAA"), (7, "BBB"), (7, ""), (8, "ZZZ")]
                    )
                ],
            )
            _insert_instruments(conn)
        monkeypatch.setattr("db.database.SessionLocal", sessionmaker(bind=test_db_engine))
        monkeypatch.setattr("pathlib.Path.exists", lambda self: False)

        from api.paper.live_stream import _get_instrument_keys

        keys, mapping = _get_instrument_keys(7)
        assert mapping == {"AAA": "NSE_EQ|K1", "BBB": "NSE_EQ|K2"}
        assert sorted(keys) == sorted(["NSE_EQ|K1", "NSE_EQ|K2"])


class TestReplayConfigIndex:
    def test_model_declares_composite_index(self):
        from db.models.replay_saved_config import ReplaySavedConfig

        names = {idx.name for idx in ReplaySavedConfig.__table__.indexes}
        assert REPLAY_INDEX in names

    def test_config_list_query_has_no_temp_sort(self, test_db_engine):
        from db.models.replay_saved_config import ReplaySavedConfig

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with test_db_engine.begin() as conn:
            conn.execute(
                ReplaySavedConfig.__table__.insert(),
                [
                    dict(
                        user_id=1, name=f"c{i}", config={}, created_at=now,
                        updated_at=now.replace(minute=i),
                    )
                    for i in range(3)
                ],
            )
            details = _plan(
                conn,
                "SELECT * FROM replay_saved_configs WHERE user_id = 1 "
                "ORDER BY updated_at DESC",
            )
        assert any(REPLAY_INDEX in d for d in details), details
        assert not any("TEMP B-TREE" in d for d in details), details
