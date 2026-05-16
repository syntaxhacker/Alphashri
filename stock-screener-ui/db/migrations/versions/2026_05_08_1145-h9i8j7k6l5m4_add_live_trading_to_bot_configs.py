"""add_live_trading_to_bot_configs

Revision ID: h9i8j7k6l5m4
Revises: c8fe5a34f1b5
Create Date: 2026-05-08 11:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h9i8j7k6l5m4'
down_revision: Union[str, None] = 'c8fe5a34f1b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bot_configs', sa.Column('live_trading', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    op.drop_column('bot_configs', 'live_trading')
