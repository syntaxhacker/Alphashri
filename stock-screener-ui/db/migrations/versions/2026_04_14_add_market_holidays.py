"""create market_holidays table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

holiday_type_enum = sa.Enum('trading', 'clearing', name='holiday_type')


def upgrade() -> None:
    holiday_type_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        'market_holidays',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('date', sa.Date(), nullable=False, index=True),
        sa.Column('description', sa.String(200), nullable=False),
        sa.Column('type', holiday_type_enum, nullable=False, server_default='trading'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('date', name='uq_market_holiday_date'),
    )


def downgrade() -> None:
    op.drop_table('market_holidays')
    holiday_type_enum.drop(op.get_bind(), checkfirst=True)
