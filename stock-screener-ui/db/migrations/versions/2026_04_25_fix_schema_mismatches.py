"""fix schema mismatches in market_holidays and strategy_configs

Revision ID: j0d1e2f3g4h5
Revises: i9c0d1e2f3g4
Create Date: 2026-04-25
"""
from typing import Union, Sequence, Optional

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'j0d1e2f3g4h5'
down_revision: Union[str, Sequence[str], None] = 'i9c0d1e2f3g4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # market_holidays: created_at nullable, date index unique
    with op.batch_alter_table('market_holidays', schema=None) as batch_op:
        batch_op.alter_column('created_at',
                              existing_type=sa.DateTime(),
                              nullable=True)
        batch_op.drop_index('ix_market_holidays_date')
        batch_op.create_index('ix_market_holidays_date', ['date'], unique=True)

    # strategy_configs: make columns nullable and fix type
    with op.batch_alter_table('strategy_configs', schema=None) as batch_op:
        batch_op.alter_column('enable_shorts',
                              existing_type=sa.Boolean(),
                              nullable=True)
        batch_op.alter_column('eod_exit_hour',
                              existing_type=sa.Integer(),
                              nullable=True)
        batch_op.alter_column('eod_exit_minute',
                              existing_type=sa.Integer(),
                              nullable=True)
        batch_op.alter_column('min_rr_ratio',
                              existing_type=sa.Float(),
                              nullable=True)
        batch_op.alter_column('screener_profiles',
                              existing_type=sa.Text(),
                              type_=sa.String(length=500),
                              existing_nullable=True)


def downgrade() -> None:
    # Reverse strategy_configs changes
    with op.batch_alter_table('strategy_configs', schema=None) as batch_op:
        batch_op.alter_column('screener_profiles',
                              existing_type=sa.String(length=500),
                              type_=sa.Text(),
                              existing_nullable=True)
        batch_op.alter_column('min_rr_ratio',
                              existing_type=sa.Float(),
                              nullable=False)
        batch_op.alter_column('eod_exit_minute',
                              existing_type=sa.Integer(),
                              nullable=False)
        batch_op.alter_column('eod_exit_hour',
                              existing_type=sa.Integer(),
                              nullable=False)
        batch_op.alter_column('enable_shorts',
                              existing_type=sa.Boolean(),
                              nullable=False)

    # Reverse market_holidays changes
    with op.batch_alter_table('market_holidays', schema=None) as batch_op:
        batch_op.drop_index('ix_market_holidays_date')
        batch_op.create_index('ix_market_holidays_date', ['date'], unique=False)
        batch_op.alter_column('created_at',
                              existing_type=sa.DateTime(),
                              nullable=False)
