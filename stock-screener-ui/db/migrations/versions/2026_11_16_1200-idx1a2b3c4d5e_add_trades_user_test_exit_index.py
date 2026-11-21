"""add_trades_user_test_exit_index

The trades-history query filters ``user_id``/``is_test`` then range-scans
``exit_time`` in DESC order with a LIMIT. A plain composite index lets SQLite
walk it backwards (no TEMP B-TREE) and gives Postgres the same ordered scan.
Kept dialect-neutral: no partial index, no explicit DESC (SQLite ignores it).

Revision ID: idx1a2b3c4d5e
Revises: uc1a2b3c4d5e
Create Date: 2026-11-16 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'idx1a2b3c4d5e'
down_revision = 'uc1a2b3c4d5e'
branch_labels = None
depends_on = None

INDEX_NAME = 'ix_trades_user_test_exit_time'


def _index_exists() -> bool:
    insp = sa.inspect(op.get_bind())
    return any(idx['name'] == INDEX_NAME for idx in insp.get_indexes('trades'))


def upgrade() -> None:
    # CI builds the schema from the models (SKIP_ALEMBIC); a DB that already has
    # the index must not fail the migration.
    if not _index_exists():
        op.create_index(INDEX_NAME, 'trades', ['user_id', 'is_test', 'exit_time'], unique=False)


def downgrade() -> None:
    if _index_exists():
        op.drop_index(INDEX_NAME, table_name='trades')
