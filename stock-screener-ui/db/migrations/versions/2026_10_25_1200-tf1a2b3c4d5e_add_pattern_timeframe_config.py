"""add_pattern_timeframe_config

Creates the ``pattern_timeframe_config`` table for admin-controlled pattern
timeframe visibility and ordering.

Revision ID: tf1a2b3c4d5e
Revises: th1a2b3c4d5e
Create Date: 2026-10-25 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'tf1a2b3c4d5e'
down_revision = 'th1a2b3c4d5e'
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def _index_names(table: str) -> set:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {idx['name'] for idx in insp.get_indexes(table)}


def upgrade():
    if not _table_exists('pattern_timeframe_config'):
        op.create_table(
            'pattern_timeframe_config',
            sa.Column('id', sa.String(8), primary_key=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        )
    if 'ix_pattern_timeframe_config_sort_order' not in _index_names('pattern_timeframe_config'):
        op.create_index(
            'ix_pattern_timeframe_config_sort_order',
            'pattern_timeframe_config',
            ['sort_order'],
            unique=False,
        )


def downgrade():
    if _table_exists('pattern_timeframe_config'):
        if 'ix_pattern_timeframe_config_sort_order' in _index_names('pattern_timeframe_config'):
            op.drop_index(
                'ix_pattern_timeframe_config_sort_order',
                table_name='pattern_timeframe_config',
            )
        op.drop_table('pattern_timeframe_config')
