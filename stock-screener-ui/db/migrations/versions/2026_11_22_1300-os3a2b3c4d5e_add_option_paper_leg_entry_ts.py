"""add_option_paper_leg_entry_ts

A leg added to an existing multi-leg structure (same day or a later session)
carries its own entry timestamp and premium. Legacy legs keep ``entry_ts`` NULL,
which means "inherited from the parent position's entry_ts".

The upgrade is idempotent: CI builds the schema straight from the models
(``CI_MODE``/``SKIP_ALEMBIC``), so a database that already has the column must
not fail the migration.

Revision ID: os3a2b3c4d5e
Revises: os2a2b3c4d5e
Create Date: 2026-11-22 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'os3a2b3c4d5e'
down_revision = 'os2a2b3c4d5e'
branch_labels = None
depends_on = None

TABLE = 'option_paper_legs'
COLUMN = 'entry_ts'


def _inspector():
    return sa.inspect(op.get_bind())


def _has_column() -> bool:
    inspector = _inspector()
    if TABLE not in inspector.get_table_names():
        return False
    return any(col['name'] == COLUMN for col in inspector.get_columns(TABLE))


def upgrade() -> None:
    if not _has_column():
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)
