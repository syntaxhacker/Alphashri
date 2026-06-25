"""add_max_distance_from_r1_pct_to_strategy_configs

Revision ID: r2s3t4u5v6w7
Revises: q2r3s4t5u6v7
Create Date: 2026-06-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'r2s3t4u5v6w7'
down_revision = 'q2r3s4t5u6v7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('strategy_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('max_distance_from_r1_pct', sa.Float(), nullable=False, server_default='5.0'))


def downgrade() -> None:
    with op.batch_alter_table('strategy_configs', schema=None) as batch_op:
        batch_op.drop_column('max_distance_from_r1_pct')
