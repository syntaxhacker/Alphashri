"""Regression tests for the trades-history index and 52W range cache churn."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import inspect, text


class TestTradesHistoryIndex:
    def test_model_declares_composite_index(self):
        from db.models import Trade

        names = {idx.name for idx in Trade.__table__.indexes}
        assert "ix_trades_user_test_exit_time" in names

    def test_history_query_uses_index_without_sort(self, test_db_engine):
        """The exact history query must not add a TEMP B-TREE for ORDER BY."""
        from db.models import Trade

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with test_db_engine.begin() as conn:
            conn.execute(
                Trade.__table__.insert(),
                [
                    dict(
                        uuid=f"u{i}", user_id=1, is_test=False, symbol=f"S{i}",
                        side="BUY", quantity=1, entry_price=100,
                        entry_time=now - timedelta(days=2), exit_price=101,
                        exit_time=now - timedelta(days=1, minutes=i),
                    )
                    for i in range(5)
                ],
            )
            indexes = {idx["name"] for idx in inspect(conn).get_indexes("trades")}
            assert "ix_trades_user_test_exit_time" in indexes

            plan = conn.execute(
                text(
                    "EXPLAIN QUERY PLAN SELECT trades.* FROM trades "
                    "WHERE trades.user_id = :u AND trades.is_test = 0 "
                    "AND trades.exit_time >= :c "
                    "ORDER BY trades.exit_time DESC LIMIT 50"
                ),
                {"u": 1, "c": now - timedelta(days=7)},
            ).fetchall()
        details = [row[3] for row in plan]
        assert any("ix_trades_user_test_exit_time" in d for d in details), details
        assert not any("TEMP B-TREE" in d for d in details), details


class TestSingleSymbolLookupFromBulk:
    def test_reads_bulk_key_not_per_symbol_key(self):
        from trading.week52.ranges import get_52w_range

        bulk = {
            "RELIANCE": {"high": 100.0, "low": 90.0, "close": 95.0},
            "TCS": {"high": 200.0, "low": 190.0, "close": 195.0},
        }
        with patch("cache.redis_client.cache_get", return_value=bulk) as cache_get, patch(
            "trading.week52.ranges.SessionLocal"
        ) as session:
            assert get_52w_range("TCS") == {"high": 200.0, "low": 190.0, "close": 195.0}
        cache_get.assert_called_once_with("52w_range:all")
        session.assert_not_called()

    def test_carries_updated_at_from_bulk(self):
        from trading.week52.ranges import get_52w_range

        bulk = {"AAA": {"high": 1, "low": 1, "close": 1, "updated_at": "2026-11-01T09:00:00"}}
        with patch("cache.redis_client.cache_get", return_value=bulk), patch(
            "trading.week52.ranges.SessionLocal"
        ):
            assert get_52w_range("AAA")["updated_at"] == "2026-11-01T09:00:00"

    def test_bulk_miss_falls_back_to_db_row(self):
        from trading.week52.ranges import get_52w_range

        class _Row:
            high_52w, low_52w, close = 10.0, 4.0, 7.0

        class _Query:
            def filter(self, *a, **k):
                return self

            def first(self):
                return _Row()

        class _DB:
            def query(self, *a, **k):
                return _Query()

            def close(self):
                pass

        with patch("cache.redis_client.cache_get", return_value=None), patch(
            "trading.week52.ranges.SessionLocal", return_value=_DB()
        ):
            assert get_52w_range("AAA") == {"high": 10.0, "low": 4.0, "close": 7.0}


class TestBulkWriteAndInvalidation:
    def test_store_writes_only_bulk_key_with_ttl_and_stamps_updated_at(self, monkeypatch):
        from cache.week52 import store_52w_ranges
        from trading.week52.config import cache_ttl_sec
        from trading.week52.keys import BULK, RANGE_TTL

        monkeypatch.delenv("SCREENER_52W_CACHE_TTL", raising=False)
        assert cache_ttl_sec() == RANGE_TTL

        class _Stamp:
            def __init__(self, symbol, updated_at):
                self.symbol = symbol
                self.updated_at = updated_at

        class _Query:
            def all(self):
                return [_Stamp("AAA", datetime(2026, 11, 1)), _Stamp("BBB", None)]

        class _DB:
            def query(self, *a, **k):
                return _Query()

            def close(self):
                pass

        data = {
            "AAA": {"high": 1, "low": 1, "close": 1},
            "BBB": {"high": 2, "low": 2, "close": 2},
        }
        with patch("cache.redis_client.cache_set") as cache_set, patch(
            "db.database.SessionLocal", return_value=_DB()
        ), patch("cache.week52.shutil.rmtree"):
            payload = store_52w_ranges(data)

        assert cache_set.call_count == 1
        assert cache_set.call_args[0][0] == BULK
        assert cache_set.call_args[0][1] == payload
        assert cache_set.call_args[1]["ttl"] == RANGE_TTL
        assert set(payload) == {"AAA", "BBB"}
        assert payload["AAA"]["updated_at"] == "2026-11-01T00:00:00"
        assert "updated_at" not in payload["BBB"]

    def test_invalidation_still_clears_bulk_key(self):
        from cache.redis_client import invalidate_52w_range_cache

        with patch("cache.redis_client.cache_delete_pattern", return_value=1) as delete:
            assert invalidate_52w_range_cache() == 1
        delete.assert_called_once_with("52w_range:*")


class TestPriceAsOfFromBulk:
    def test_updated_at_from_bulk_skips_db(self):
        from api.screener_api.screener_52w import _load_range_price_as_of

        ranges = {
            "AAA": {"high": 1, "low": 1, "close": 1, "updated_at": "2026-11-01T09:00:00"},
            "BBB": {"high": 2, "low": 2, "close": 2, "updated_at": "2026-11-02T09:00:00"},
        }
        with patch("api.screener_api.screener_52w.SessionLocal") as session:
            out = _load_range_price_as_of(["AAA", "BBB"], ranges)
        assert out == {
            "AAA": "2026-11-01T09:00:00",
            "BBB": "2026-11-02T09:00:00",
        }
        session.assert_not_called()

    def test_missing_updated_at_falls_back_with_pk_filter(self):
        from api.screener_api.screener_52w import _load_range_price_as_of

        class _Query:
            def __init__(self):
                self.filtered = False

            def filter(self, *a, **k):
                self.filtered = True
                return self

            def all(self):
                assert self.filtered, "must scope the fallback by primary key, not full-scan"
                return [("BBB", datetime(2026, 11, 3))]

        query = _Query()

        class _DB:
            def query(self, *a, **k):
                return query

            def close(self):
                pass

        ranges = {
            "AAA": {"high": 1, "low": 1, "close": 1, "updated_at": "2026-11-01T09:00:00"},
            "BBB": {"high": 2, "low": 2, "close": 2},  # stale cache: no updated_at
        }
        with patch("api.screener_api.screener_52w.SessionLocal", return_value=_DB()):
            out = _load_range_price_as_of(["AAA", "BBB"], ranges)
        assert out == {
            "AAA": "2026-11-01T09:00:00",
            "BBB": "2026-11-03T00:00:00",
        }
