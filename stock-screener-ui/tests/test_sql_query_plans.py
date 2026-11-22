"""Query-plan guards for the small read-path indexes added in sqlidx1a2b3c4d5e.

Each query mirrors a real caller. The point is not a synthetic benchmark: it is
to catch a future model migration that drops or reshapes an index and silently
turns a bounded page into a table scan.
"""
from __future__ import annotations

from sqlalchemy import inspect, text

QUERIES = (
    (
        "news impact queue",
        "SELECT id FROM news_articles WHERE impact_score IS NULL "
        "ORDER BY published_at DESC LIMIT 50",
        "ix_news_articles_impact_published",
    ),
    (
        "source-scoped recent feed",
        "SELECT id FROM news_articles WHERE source='x' "
        "AND fetched_at >= '2026-01-01' ORDER BY fetched_at DESC LIMIT 50",
        "ix_news_articles_source_fetched",
    ),
    (
        "option snapshot retention",
        "SELECT id FROM option_chain_snapshots WHERE ts < '2026-01-01'",
        "ix_ocs_ts",
    ),
    (
        "corporate calendar page",
        "SELECT id FROM corporate_events WHERE market='us' "
        "AND event_date >= '2026-01-01' ORDER BY event_date, symbol LIMIT 100",
        "ix_corporate_events_market_date_symbol",
    ),
    (
        "anomaly day page",
        "SELECT id FROM event_anomalies WHERE market='us' "
        "AND ts >= '2026-01-01' AND ts < '2026-01-02' ORDER BY ts",
        "ix_event_anomalies_market_ts",
    ),
)


def _plan(conn, query: str) -> str:
    return " | ".join(str(row[3]) for row in conn.execute(text("EXPLAIN QUERY PLAN " + query)))


def test_new_query_indexes_exist(test_db_engine):
    with test_db_engine.connect() as conn:
        # Explicit tables keep the assertion readable and independent of order.
        assert "ix_news_articles_impact_published" in {
            idx["name"] for idx in inspect(conn).get_indexes("news_articles")
        }
        assert "ix_news_articles_source_fetched" in {
            idx["name"] for idx in inspect(conn).get_indexes("news_articles")
        }
        assert "ix_news_symbol_mentions_symbol_code" in {
            idx["name"] for idx in inspect(conn).get_indexes("news_symbol_mentions")
        }
        assert "ix_ocs_ts" in {
            idx["name"] for idx in inspect(conn).get_indexes("option_chain_snapshots")
        }
        assert "ix_corporate_events_market_date_symbol" in {
            idx["name"] for idx in inspect(conn).get_indexes("corporate_events")
        }
        assert "ix_event_anomalies_market_ts" in {
            idx["name"] for idx in inspect(conn).get_indexes("event_anomalies")
        }


def test_read_paths_use_the_new_indexes(test_db_engine):
    with test_db_engine.connect() as conn:
        for label, query, index_name in QUERIES:
            plan = _plan(conn, query)
            assert index_name in plan, f"{label}: expected {index_name}, got {plan}"
            assert "SCAN " not in plan.upper(), f"{label}: full scan, got {plan}"


def test_symbol_or_lookup_uses_both_mention_indexes(test_db_engine):
    query = (
        "SELECT article_id FROM news_symbol_mentions "
        "WHERE trading_symbol='X' OR symbol_code='X' "
        "ORDER BY article_id DESC LIMIT 10"
    )
    with test_db_engine.connect() as conn:
        plan = _plan(conn, query)
    assert "MULTI-INDEX OR" in plan, plan
    assert "ix_news_symbol_mentions_trading_symbol" in plan, plan
    assert "ix_news_symbol_mentions_symbol_code" in plan, plan
