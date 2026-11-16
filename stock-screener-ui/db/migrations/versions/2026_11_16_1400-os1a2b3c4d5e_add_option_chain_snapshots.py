"""add_option_chain_snapshots

Append-only option-chain quotes keyed on (underlying, expiry, strike, side,
minute), the raw series for IV rank / term / surface history. This lane only
creates the store; the poller that writes into it lands separately.

The upgrade is idempotent: CI builds the schema straight from the models
(``CI_MODE`` / ``SKIP_ALEMBIC``), so a database that already carries the table
must not fail the migration. The three indexes mirror the model's
``__table_args__`` and match the read paths (time series, term history, session
filter).

Revision ID: os1a2b3c4d5e
Revises: cpx1a2b3c4d5e
Create Date: 2026-11-16 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'os1a2b3c4d5e'
down_revision = 'cpx1a2b3c4d5e'
branch_labels = None
depends_on = None

TABLE = 'option_chain_snapshots'
INDEXES = (
    ('ix_ocs_underlying_ts', ['underlying', 'ts']),
    ('ix_ocs_underlying_expiry_ts', ['underlying', 'expiry', 'ts']),
    ('ix_ocs_underlying_session_date', ['underlying', 'session_date']),
)


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names() -> set:
    return {idx['name'] for idx in sa.inspect(op.get_bind()).get_indexes(TABLE)}


def upgrade() -> None:
    if TABLE not in _tables():
        op.create_table(
            TABLE,
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('ts', sa.DateTime(timezone=True), nullable=False),
            sa.Column('underlying', sa.String(20), nullable=False),
            sa.Column('expiry', sa.String(10), nullable=False),
            sa.Column('strike', sa.Float(), nullable=False),
            sa.Column('side', sa.String(2), nullable=False),
            sa.Column('ltp', sa.Float(), nullable=True),
            sa.Column('iv', sa.Float(), nullable=True),
            sa.Column('delta', sa.Float(), nullable=True),
            sa.Column('gamma', sa.Float(), nullable=True),
            sa.Column('theta', sa.Float(), nullable=True),
            sa.Column('vega', sa.Float(), nullable=True),
            sa.Column('oi', sa.Float(), nullable=True),
            sa.Column('volume', sa.Float(), nullable=True),
            sa.Column('spot', sa.Float(), nullable=True),
            sa.Column('session_date', sa.String(10), nullable=False),
            sa.Column('quotes_live', sa.Boolean(), nullable=False,
                      server_default=sa.false()),
            sa.Column('iv_source', sa.String(20), nullable=False,
                      server_default='upstox'),
            sa.UniqueConstraint(
                'underlying', 'expiry', 'strike', 'side', 'ts',
                name='uq_option_chain_snapshot',
            ),
        )
    present = _index_names()
    for name, columns in INDEXES:
        if name not in present:
            op.create_index(name, TABLE, columns)


def downgrade() -> None:
    if TABLE in _tables():
        op.drop_table(TABLE)
