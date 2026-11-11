"""add_corporate_events

Event Radar Wave 2B: the corporate-event calendar (``corporate_events``) and the
intraday tripwire rows (``event_anomalies``).

Both tables are guards rather than facts:

* the calendar row is repairable (a better source overwrites it), so every
  column is nullable except the identity ones (``symbol``, ``title``,
  ``event_date``, ``source``, ``external_id``);
* the anomaly row is keyed by (symbol, ts) so a rescan rewrites a bar instead of
  duplicating it, and carries ``notified`` as a send-once latch.

The upgrade is idempotent: CI builds the schema straight from the models
(``CI_MODE``/``SKIP_ALEMBIC``), and a database that already has the tables must
not fail the migration.

Revision ID: ev1a2b3c4d5e
Revises: tf2a2b3c4d5e
Create Date: 2026-10-29 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'ev1a2b3c4d5e'
down_revision = 'tf2a2b3c4d5e'
branch_labels = None
depends_on = None


def _tables() -> set:
    insp = sa.inspect(op.get_bind())
    return set(insp.get_table_names())


def upgrade():
    existing = _tables()

    if 'corporate_events' not in existing:
        op.create_table(
            'corporate_events',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('symbol', sa.String(20), nullable=False),
            sa.Column('market', sa.String(10), nullable=True),
            sa.Column('exchange', sa.String(20), nullable=True),
            sa.Column('name', sa.String(200), nullable=True),
            sa.Column('event_type', sa.String(40), nullable=True),
            sa.Column('title', sa.String(500), nullable=False),
            sa.Column('event_date', sa.Date(), nullable=False),
            sa.Column('announced_at', sa.Date(), nullable=True),
            sa.Column('source', sa.String(20), nullable=False),
            sa.Column('source_url', sa.String(1000), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True),
            sa.Column('recurring', sa.Boolean(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('external_id', sa.String(200), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=True),
            sa.UniqueConstraint('external_id',
                                name='uq_corporate_event_external_id'),
            sa.UniqueConstraint('symbol', 'event_date', 'event_type', 'source',
                                name='uq_corporate_event_natural'),
        )
        op.create_index('ix_corporate_events_symbol', 'corporate_events', ['symbol'])
        op.create_index('ix_corporate_events_market', 'corporate_events', ['market'])
        op.create_index('ix_corporate_events_event_type', 'corporate_events',
                        ['event_type'])
        op.create_index('ix_corporate_events_event_date', 'corporate_events',
                        ['event_date'])

    if 'event_anomalies' not in existing:
        op.create_table(
            'event_anomalies',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('symbol', sa.String(20), nullable=False),
            sa.Column('market', sa.String(10), nullable=True),
            sa.Column('ts', sa.DateTime(timezone=True), nullable=False),
            sa.Column('price', sa.Float(), nullable=True),
            sa.Column('ret_pct', sa.Float(), nullable=True),
            sa.Column('ret_sigma', sa.Float(), nullable=True),
            sa.Column('vol_ratio', sa.Float(), nullable=True),
            sa.Column('has_known_event', sa.Boolean(), nullable=True),
            sa.Column('suspected', sa.String(200), nullable=True),
            sa.Column('notified', sa.Boolean(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=True),
            sa.UniqueConstraint('symbol', 'ts', name='uq_event_anomaly_symbol_ts'),
        )
        op.create_index('ix_event_anomalies_symbol', 'event_anomalies', ['symbol'])
        op.create_index('ix_event_anomalies_ts', 'event_anomalies', ['ts'])


def downgrade():
    existing = _tables()
    if 'event_anomalies' in existing:
        op.drop_table('event_anomalies')
    if 'corporate_events' in existing:
        op.drop_table('corporate_events')
