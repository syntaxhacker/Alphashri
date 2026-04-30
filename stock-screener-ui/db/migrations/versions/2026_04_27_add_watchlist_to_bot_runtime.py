"""add watchlist to bot_runtime_states

Revision ID: k1l2m3n4o5p6
Revises: j0d1e2f3g4h5
Create Date: 2026-04-27
"""
from typing import Union, Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'k1l2m3n4o5p6'
down_revision: Union[str, Sequence[str], None] = 'j0d1e2f3g4h5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'bot_runtime_states',
        sa.Column('watchlist', sa.String(length=50000), nullable=True, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('bot_runtime_states', 'watchlist')
