"""add_custom_watchlist_to_strategy_configs

Revision ID: q2r3s4t5u6v7
Revises: p2q3r4s5t6u7
Create Date: 2026-06-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'q2r3s4t5u6v7'
down_revision = 'p2q3r4s5t6u7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('strategy_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('custom_watchlist', sa.String(2000), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('strategy_configs', schema=None) as batch_op:
        batch_op.drop_column('custom_watchlist')
