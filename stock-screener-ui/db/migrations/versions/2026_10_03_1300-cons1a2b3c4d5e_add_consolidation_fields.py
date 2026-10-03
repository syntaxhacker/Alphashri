"""add_consolidation_fields

Adds consolidation-base metrics (``base_days`` / ``range_pct`` / ``range_pos``)
to ``pattern_hits`` (CONTRACT.md §4; detector ``consolidation``).

Revision ID: cons1a2b3c4d5e
Revises: cp1a2b3c4d5e
Create Date: 2026-10-03 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'cons1a2b3c4d5e'
down_revision = 'cp1a2b3c4d5e'
branch_labels = None
depends_on = None


HITS_TABLE = 'pattern_hits'

# name -> column type
NEW_COLUMNS = (
    ('base_days', sa.Integer()),
    ('range_pct', sa.Float()),
    ('range_pos', sa.Float()),
)


def _column_names(table: str) -> set:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return set()
    return {col['name'] for col in insp.get_columns(table)}


def upgrade():
    existing = _column_names(HITS_TABLE)
    for name, col_type in NEW_COLUMNS:
        if name not in existing:
            op.add_column(HITS_TABLE, sa.Column(name, col_type, nullable=True))


def downgrade():
    existing = _column_names(HITS_TABLE)
    for name, _col_type in NEW_COLUMNS:
        if name in existing:
            op.drop_column(HITS_TABLE, name)
