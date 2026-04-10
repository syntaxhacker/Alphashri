"""add min_rr_ratio to strategy_configs

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('strategy_configs', sa.Column('min_rr_ratio', sa.Float(), server_default=sa.text('2.0'), nullable=False))


def downgrade() -> None:
    op.drop_column('strategy_configs', 'min_rr_ratio')
