"""add_options_paper_positions

First-class storage for multi-leg option paper structures placed from the
options dock. ``option_paper_legs`` cascades with its parent position; the headless
``options_paper`` runner keeps its own JSONL ledger and is untouched.

The upgrade is idempotent: CI builds the schema straight from the models
(``CI_MODE``/``SKIP_ALEMBIC``), so a database that already carries these tables
must not fail the migration. Index names mirror the models' ``__table_args__``
(and their ``index=True`` columns) and the read paths (user/status, chain by
underlying+expiry, legs by position).

Revision ID: os2a2b3c4d5e
Revises: os1a2b3c4d5e
Create Date: 2026-11-22 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'os2a2b3c4d5e'
down_revision = 'os1a2b3c4d5e'
branch_labels = None
depends_on = None

POSITIONS = 'option_paper_positions'
LEGS = 'option_paper_legs'

POSITION_INDEXES = (
    ('ix_option_paper_positions_user_id', ['user_id']),
    ('ix_option_paper_positions_status', ['status']),
    ('ix_opp_user_status', ['user_id', 'status']),
    ('ix_opp_underlying_expiry', ['underlying', 'expiry']),
)
LEG_INDEXES = (
    ('ix_option_paper_legs_position_id', ['position_id']),
)


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names(table: str) -> set:
    return {idx['name'] for idx in sa.inspect(op.get_bind()).get_indexes(table)}


def _ensure_indexes(table: str, indexes) -> None:
    present = _index_names(table)
    for name, columns in indexes:
        if name not in present:
            op.create_index(name, table, columns)


def upgrade() -> None:
    existing = _tables()

    if POSITIONS not in existing:
        op.create_table(
            POSITIONS,
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('uuid', sa.String(36), nullable=False, unique=True),
            sa.Column('user_id', sa.Integer(),
                      sa.ForeignKey('users.id'), nullable=False),
            sa.Column('source', sa.String(16), nullable=False,
                      server_default='live'),
            sa.Column('status', sa.String(12), nullable=False,
                      server_default='open'),
            sa.Column('underlying', sa.String(30), nullable=False),
            sa.Column('expiry', sa.String(10), nullable=False),
            sa.Column('name', sa.String(120), nullable=True),
            sa.Column('entry_ts', sa.DateTime(timezone=True), nullable=False),
            sa.Column('entry_spot', sa.Float(), nullable=False),
            sa.Column('lots', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('net_debit', sa.Float(), nullable=False,
                      server_default='0'),
            sa.Column('costs_est', sa.Float(), nullable=False,
                      server_default='0'),
            sa.Column('max_profit', sa.Float(), nullable=True),
            sa.Column('max_loss', sa.Float(), nullable=True),
            sa.Column('breakevens', sa.Text(), nullable=False,
                      server_default='[]'),
            sa.Column('realized_pnl', sa.Float(), nullable=False,
                      server_default='0'),
            sa.Column('close_reason', sa.String(40), nullable=True),
            sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('notes', sa.String(500), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=True),
        )

    if LEGS not in existing:
        op.create_table(
            LEGS,
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('position_id', sa.Integer(),
                      sa.ForeignKey('option_paper_positions.id',
                                    ondelete='CASCADE'), nullable=False),
            sa.Column('action', sa.String(4), nullable=False),
            sa.Column('opt_type', sa.String(2), nullable=False),
            sa.Column('strike', sa.Float(), nullable=False),
            sa.Column('lots', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('qty', sa.Integer(), nullable=False),
            sa.Column('instrument_key', sa.String(40), nullable=True),
            sa.Column('entry_premium', sa.Float(), nullable=False),
            sa.Column('mark_premium', sa.Float(), nullable=True),
            sa.Column('mark_ts', sa.DateTime(timezone=True), nullable=True),
            sa.Column('exit_premium', sa.Float(), nullable=True),
            sa.UniqueConstraint(
                'position_id', 'action', 'opt_type', 'strike',
                name='uq_option_paper_leg_identity',
            ),
        )

    _ensure_indexes(POSITIONS, POSITION_INDEXES)
    _ensure_indexes(LEGS, LEG_INDEXES)


def downgrade() -> None:
    existing = _tables()
    if LEGS in existing:
        op.drop_table(LEGS)
    if POSITIONS in existing:
        op.drop_table(POSITIONS)
