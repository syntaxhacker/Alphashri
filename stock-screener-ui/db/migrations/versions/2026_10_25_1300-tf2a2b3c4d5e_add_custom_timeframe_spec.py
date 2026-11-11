"""add_custom_timeframe_spec

Revision ID: tf2a2b3c4d5e
Revises: tf1a2b3c4d5e
Create Date: 2026-10-25 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'tf2a2b3c4d5e'
down_revision = 'tf1a2b3c4d5e'
branch_labels = None
depends_on = None


_COLUMNS = (
    ('label', sa.String(16)),
    ('minutes', sa.Integer()),
    ('native', sa.Boolean()),
    ('source_tf', sa.String(8)),
    ('max_lookback_days', sa.Integer()),
    ('min_bars', sa.Integer()),
)


def _column_names(table: str) -> set:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return set()
    return {col['name'] for col in insp.get_columns(table)}


def upgrade():
    existing = _column_names('pattern_timeframe_config')
    if not existing:
        return
    with op.batch_alter_table('pattern_timeframe_config') as batch:
        for name, column_type in _COLUMNS:
            if name in existing:
                continue
            batch.add_column(sa.Column(name, column_type, nullable=True))


def downgrade():
    existing = _column_names('pattern_timeframe_config')
    if not existing:
        return
    with op.batch_alter_table('pattern_timeframe_config') as batch:
        for name, _column_type in reversed(_COLUMNS):
            if name in existing:
                batch.drop_column(name)
