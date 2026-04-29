"""add uuid unique constraint to stock_52week_touches

Revision ID: 1daf41c247a5
Revises: m3n4o5p6q7r8
Create Date: 2026-04-28 17:58:53.931674

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1daf41c247a5'
down_revision: Union[str, Sequence[str], None] = 'm3n4o5p6q7r8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add unique constraint on uuid column."""
    with op.batch_alter_table('stock_52week_touches', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_stock_52week_touches_uuid', ['uuid'])


def downgrade() -> None:
    """Remove unique constraint on uuid column."""
    with op.batch_alter_table('stock_52week_touches', schema=None) as batch_op:
        batch_op.drop_constraint('uq_stock_52week_touches_uuid', type_='unique')
