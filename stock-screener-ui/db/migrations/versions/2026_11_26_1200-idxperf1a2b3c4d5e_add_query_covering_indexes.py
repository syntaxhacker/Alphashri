"""add_query_covering_indexes

Read-path indexes measured on an in-memory synthetic dataset:

* ``instruments``: the symbol-cache warm-up counts/filters on ``segment``, and
  the movers quote resolver selects ``trading_symbol`` + ``instrument_key``
  after filtering on ``segment``. The 3-column index makes that lookup covering.
* ``replay_saved_configs``: the saved-config list filters on ``user_id`` and
  orders by ``updated_at``; a user_id-only index leaves a temp B-tree sort.

Idempotent: CI builds the schema from the models, and a dev database may
already carry any of these indexes.

Revision ID: idxperf1a2b3c4d5e
Revises: sqlidx1a2b3c4d5e
Create Date: 2026-11-26 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'idxperf1a2b3c4d5e'
down_revision = 'sqlidx1a2b3c4d5e'
branch_labels = None
depends_on = None


INDEXES = (
    ('ix_instruments_segment', 'instruments', ['segment']),
    (
        'ix_instruments_segment_symbol_key',
        'instruments',
        ['segment', 'trading_symbol', 'instrument_key'],
    ),
    (
        'ix_replay_saved_configs_user_updated',
        'replay_saved_configs',
        ['user_id', 'updated_at'],
    ),
)


def _index_names(table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {idx['name'] for idx in inspector.get_indexes(table)}


def upgrade() -> None:
    for name, table, columns in INDEXES:
        if name not in _index_names(table):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(INDEXES):
        if name in _index_names(table):
            op.drop_index(name, table_name=table)
