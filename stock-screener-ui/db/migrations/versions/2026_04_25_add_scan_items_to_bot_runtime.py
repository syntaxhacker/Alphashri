"""add scan_items to bot_runtime_states

Revision ID: i9c0d1e2f3g4
Revises: 2026_04_24_multi_screener_profiles
Create Date: 2026-04-25
"""
from typing import Union, Sequence, Optional

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i9c0d1e2f3g4'
down_revision: Union[str, Sequence[str], None] = 'h8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bot_runtime_states', sa.Column('scan_items', sa.String(length=50000), nullable=True, server_default=''))


def downgrade() -> None:
    op.drop_column('bot_runtime_states', 'scan_items')
