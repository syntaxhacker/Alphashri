"""add_user_saved_configs

P1 of saved user configs: one opaque JSON payload per (user, scope, name).

``name = ''`` is the reserved *default slot* — the row a screen restores on
load. Named presets are future rows in the same table, which is why ``name``
is part of the unique key and why it is an empty string rather than NULL
(SQL treats NULLs as distinct, so a nullable ``name`` would permit two
defaults per scope).

The upgrade is idempotent: CI builds the schema straight from the models
(``CI_MODE`` / ``SKIP_ALEMBIC``), and a database that already has the table
must not fail the migration.

Revision ID: uc1a2b3c4d5e
Revises: ev1a2b3c4d5e
Create Date: 2026-11-15 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'uc1a2b3c4d5e'
down_revision = 'ev1a2b3c4d5e'
branch_labels = None
depends_on = None


def _tables() -> set:
    insp = sa.inspect(op.get_bind())
    return set(insp.get_table_names())


def upgrade():
    if 'user_saved_configs' in _tables():
        return

    op.create_table(
        'user_saved_configs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('scope', sa.String(64), nullable=False),
        sa.Column('name', sa.String(100), nullable=False, server_default=''),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'scope', 'name', name='uq_user_saved_config'),
    )
    op.create_index('ix_user_saved_configs_user_id', 'user_saved_configs', ['user_id'])
    op.create_index('ix_user_saved_configs_scope', 'user_saved_configs', ['scope'])
    op.create_index('ix_user_saved_configs_user_scope', 'user_saved_configs',
                    ['user_id', 'scope'])


def downgrade():
    if 'user_saved_configs' in _tables():
        op.drop_table('user_saved_configs')
