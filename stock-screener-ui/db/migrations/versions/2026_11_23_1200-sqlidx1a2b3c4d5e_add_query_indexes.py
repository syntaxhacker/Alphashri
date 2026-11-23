"""add_query_indexes

Small, read-path indexes found while auditing the hot SQL:

* ``news_articles``: impact-queue scan and source-scoped recent feed.
* ``news_symbol_mentions``: symbol lookup uses ``symbol_code`` alongside
  ``trading_symbol``; without this branch's index SQLite cannot use an OR plan.
* ``option_chain_snapshots``: retention deletes filter on ``ts`` only.
* ``corporate_events``: calendar page filters market + date and orders by
  date/symbol.
* ``event_anomalies``: day page filters a ts range with an optional market.

Idempotent because CI builds the schema from the models and a dev database may
already have any of these indexes.

Revision ID: sqlidx1a2b3c4d5e
Revises: os1a2b3c4d5e
Create Date: 2026-11-23 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'sqlidx1a2b3c4d5e'
down_revision = 'os3a2b3c4d5e'
branch_labels = None
depends_on = None


INDEXES = (
    ('ix_news_articles_impact_published', 'news_articles', ['impact_score', 'published_at']),
    ('ix_news_articles_source_fetched', 'news_articles', ['source', 'fetched_at']),
    ('ix_news_symbol_mentions_symbol_code', 'news_symbol_mentions', ['symbol_code']),
    ('ix_ocs_ts', 'option_chain_snapshots', ['ts']),
    ('ix_corporate_events_market_date_symbol', 'corporate_events', ['market', 'event_date', 'symbol']),
    ('ix_event_anomalies_market_ts', 'event_anomalies', ['market', 'ts']),
)


def _index_names(table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {idx['name'] for idx in inspector.get_indexes(table)}


def upgrade() -> None:
    for name, table, columns in INDEXES:
        if name not in _index_names(table):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(INDEXES):
        if name in _index_names(table):
            op.drop_index(name, table_name=table)
