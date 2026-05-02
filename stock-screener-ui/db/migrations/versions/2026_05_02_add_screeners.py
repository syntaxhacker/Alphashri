"""add screeners table

Revision ID: j9c0d1e2f3a4
Revises: h8b9c0d1e2f3
Create Date: 2026-05-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j9c0d1e2f3a4'
down_revision: Union[str, Sequence[str], None] = '1daf41c247a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'screeners',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('indicators', sa.JSON(), nullable=True),
        sa.Column('columns', sa.JSON(), nullable=True),
        sa.Column('filters', sa.JSON(), nullable=True),
        sa.Column('default_sort', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_screeners_user_id', 'screeners', ['user_id'])
    op.create_unique_constraint('uq_user_screener', 'screeners', ['user_id', 'name'])


def downgrade() -> None:
    op.drop_constraint('uq_user_screener', 'screeners', type_='unique')
    op.drop_index('ix_screeners_user_id', table_name='screeners')
    op.drop_table('screeners')