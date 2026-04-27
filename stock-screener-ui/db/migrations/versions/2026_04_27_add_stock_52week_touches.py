"""add stock_52week_touches table for tracking 52w high touch history

Revision ID: m3n4o5p6q7r8
Revises: k1l2m3n4o5p6
Create Date: 2026-04-27
"""
from typing import Union, Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'm3n4o5p6q7r8'
down_revision: Union[str, Sequence[str], None] = 'k1l2m3n4o5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'stock_52week_touches',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('uuid', sa.String(length=36), nullable=True),
        sa.Column('symbol', sa.String(length=32), nullable=False, index=True),
        sa.Column('touched_date', sa.DateTime(), nullable=False, index=True),
        sa.Column('touched_price', sa.Float(), nullable=False),
        sa.Column('is_high', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('is_current_52w_high', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('symbol', 'touched_date', name='uq_symbol_touched_date'),
    )
    op.create_index('ix_stock_52week_touches_symbol_touched_date',
                     'stock_52week_touches', ['symbol', 'touched_date'], unique=True)


def downgrade() -> None:
    op.drop_table('stock_52week_touches')
