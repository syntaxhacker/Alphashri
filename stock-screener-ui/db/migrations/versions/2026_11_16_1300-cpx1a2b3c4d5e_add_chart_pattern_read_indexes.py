"""add_chart_pattern_read_indexes

The chart-pattern read endpoints sort a confidence-first page per timeframe and
look up the "last completed scan" stamp for a universe/timeframe. Without
composite indexes SQLite builds a temp B-tree for every sorted page (and scans
the job table for the stamp). Three covering indexes remove both costs:

- ``ix_ph_job_tf_conf``  job_id + timeframe + confidence + id
- ``ix_ph_tf_conf``      timeframe + confidence + id
- ``ix_pj_universe_tf_status_fin``  universe + timeframe + status + finished_at

All three mirror the model ``__table_args__``. The upgrade is idempotent: CI
builds the schema straight from the models (``SKIP_ALEMBIC``/``CI_MODE``) and a
database that already carries the indexes must not fail the migration.

Revision ID: cpx1a2b3c4d5e
Revises: idx1a2b3c4d5e
Create Date: 2026-11-16 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'cpx1a2b3c4d5e'
down_revision = 'idx1a2b3c4d5e'
branch_labels = None
depends_on = None

INDEXES = (
    ("ix_ph_job_tf_conf", "pattern_hits", ["job_id", "timeframe", "confidence", "id"]),
    ("ix_ph_tf_conf", "pattern_hits", ["timeframe", "confidence", "id"]),
    (
        "ix_pj_universe_tf_status_fin",
        "pattern_compute_jobs",
        ["universe", "timeframe", "status", "finished_at"],
    ),
)


def _index_names(table: str) -> set:
    insp = sa.inspect(op.get_bind())
    if table not in insp.get_table_names():
        return set()
    return {idx["name"] for idx in insp.get_indexes(table)}


def upgrade() -> None:
    for name, table, columns in INDEXES:
        if name not in _index_names(table):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in INDEXES:
        if name in _index_names(table):
            op.drop_index(name, table_name=table)
