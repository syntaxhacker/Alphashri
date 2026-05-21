"""add_blind_52w_params_to_strategy_configs

Revision ID: n1o2p3q4r5s6
Revises: m1n2o3p4q5r6
Create Date: 2026-05-21 18:40:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'n1o2p3q4r5s6'
down_revision = 'm1n2o3p4q5r6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('strategy_configs', sa.Column('near_high_threshold_pct', sa.Float(), server_default='3.0'))
    op.add_column('strategy_configs', sa.Column('min_days_since_52w_high', sa.Integer(), server_default='20'))


def downgrade():
    op.drop_column('strategy_configs', 'min_days_since_52w_high')
    op.drop_column('strategy_configs', 'near_high_threshold_pct')
