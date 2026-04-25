"""add enable_shorts and eod_exit_time to strategy_configs

Revision ID: a1b2c3d4e5f6
Revises: 4dcdafa117f2
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '4dcdafa117f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('strategy_configs', sa.Column('enable_shorts', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('strategy_configs', sa.Column('eod_exit_hour', sa.Integer(), server_default=sa.text('14'), nullable=False))
    op.add_column('strategy_configs', sa.Column('eod_exit_minute', sa.Integer(), server_default=sa.text('45'), nullable=False))


def downgrade() -> None:
    op.drop_column('strategy_configs', 'eod_exit_minute')
    op.drop_column('strategy_configs', 'eod_exit_hour')
    op.drop_column('strategy_configs', 'enable_shorts')
