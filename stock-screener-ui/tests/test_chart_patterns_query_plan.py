"""Index coverage for the chart-pattern read paths (SQLite query plans).

The confidence-first page sorts per timeframe and the matrix cache key needs the
latest completed scan stamp. Without covering indexes SQLite builds a temp
B-tree for every sorted page and scans the job table for the stamp; the model
indexes (mirrored by alembic) must remove both.
"""
from __future__ import annotations

from sqlalchemy import inspect, text

_HIT_QUERIES = (
    # job-scoped page (results with an explicit job id)
    "SELECT id FROM pattern_hits WHERE job_id='j' AND timeframe='1D' "
    "ORDER BY confidence DESC NULLS LAST, id DESC LIMIT 100",
    # timeframe-scoped page (the /matrix per-timeframe read)
    "SELECT id FROM pattern_hits WHERE timeframe='1D' "
    "ORDER BY confidence DESC NULLS LAST, id DESC LIMIT 100",
)

_STAMP_QUERY = (
    "SELECT max(finished_at) FROM pattern_compute_jobs "
    "WHERE status='completed' AND universe='nifty500' AND timeframe='1D'"
)


def test_read_indexes_exist(test_db_engine):
    with test_db_engine.connect() as conn:
        hit_indexes = {idx["name"] for idx in inspect(conn).get_indexes("pattern_hits")}
        job_indexes = {idx["name"] for idx in inspect(conn).get_indexes("pattern_compute_jobs")}
    assert {"ix_ph_job_tf_conf", "ix_ph_tf_conf"} <= hit_indexes
    assert "ix_pj_universe_tf_status_fin" in job_indexes


def test_sorted_pages_have_no_temp_btree(test_db_engine):
    with test_db_engine.connect() as conn:
        for query in _HIT_QUERIES:
            plan = " | ".join(
                str(row[3]) for row in conn.execute(text("EXPLAIN QUERY PLAN " + query))
            )
            assert "TEMP B-TREE" not in plan.upper(), query
            assert "USING COVERING INDEX" in plan.upper(), query


def test_scan_stamp_lookup_uses_covering_index(test_db_engine):
    with test_db_engine.connect() as conn:
        plan = " | ".join(
            str(row[3]) for row in conn.execute(text("EXPLAIN QUERY PLAN " + _STAMP_QUERY))
        )
    assert "ix_pj_universe_tf_status_fin" in plan
    assert "TEMP B-TREE" not in plan.upper()
