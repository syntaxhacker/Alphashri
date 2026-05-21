"""add_min_breakout_pct_to_strategy_configs

Revision ID: m1n2o3p4q5r6
Revises: h9i8j7k6l5m4
Create Date: 2026-05-21 11:45:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'm1n2o3p4q5r6'
down_revision = 'h9i8j7k6l5m4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('strategy_configs', sa.Column('min_breakout_pct', sa.Float(), server_default='0.5'))


def downgrade():
    op.drop_column('strategy_configs', 'min_breakout_pct')
