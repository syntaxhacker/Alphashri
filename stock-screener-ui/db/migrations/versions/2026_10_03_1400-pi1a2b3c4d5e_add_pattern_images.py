"""add_pattern_images

Creates the ``pattern_images`` table (one admin-uploaded reference image per
chart-pattern id).

Revision ID: pi1a2b3c4d5e
Revises: cons1a2b3c4d5e
Create Date: 2026-10-03 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'pi1a2b3c4d5e'
down_revision = 'cons1a2b3c4d5e'
branch_labels = None
depends_on = None


TABLE = 'pattern_images'


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def upgrade():
    if not _table_exists(TABLE):
        op.create_table(
            TABLE,
            sa.Column('pattern_id', sa.String(48), primary_key=True),
            sa.Column('filename', sa.String(255), nullable=False),
            sa.Column('content_type', sa.String(64), nullable=False),
            sa.Column('size', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_by', sa.Integer(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )


def downgrade():
    if _table_exists(TABLE):
        op.drop_table(TABLE)
