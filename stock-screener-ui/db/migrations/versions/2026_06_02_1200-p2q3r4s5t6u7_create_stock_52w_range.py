"""create_stock_52w_range

Revision ID: p2q3r4s5t6u7
Revises: o1p2q3r4s5t6
Create Date: 2026-06-02 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'p2q3r4s5t6u7'
down_revision = 'o1p2q3r4s5t6'
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def upgrade():
    if not _table_exists('stock_52w_range'):
        op.create_table(
            'stock_52w_range',
            sa.Column('symbol', sa.String(32), primary_key=True),
            sa.Column('high_52w', sa.Float(), nullable=False),
            sa.Column('low_52w', sa.Float(), nullable=False),
            sa.Column('close', sa.Float(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {idx['name'] for idx in insp.get_indexes('stock_52w_range')}
    if 'ix_stock_52w_range_symbol' not in existing:
        op.create_index('ix_stock_52w_range_symbol', 'stock_52w_range', ['symbol'], unique=False)


def downgrade():
    if _table_exists('stock_52w_range'):
        bind = op.get_bind()
        insp = sa.inspect(bind)
        existing = {idx['name'] for idx in insp.get_indexes('stock_52w_range')}
        if 'ix_stock_52w_range_symbol' in existing:
            op.drop_index('ix_stock_52w_range_symbol', table_name='stock_52w_range')
        op.drop_table('stock_52w_range')