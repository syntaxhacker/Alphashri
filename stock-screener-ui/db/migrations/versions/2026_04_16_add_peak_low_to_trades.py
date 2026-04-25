"""add peak_price and low_price columns to trades table

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trades', sa.Column('peak_price', sa.Float(), nullable=True, server_default='0'))
    op.add_column('trades', sa.Column('low_price', sa.Float(), nullable=True, server_default='0'))


def downgrade() -> None:
    op.drop_column('trades', 'low_price')
    op.drop_column('trades', 'peak_price')
