"""add_trade_unique_constraint

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-07-06 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 's3t4u5v6w7x8'
down_revision = 'r2s3t4u5v6w7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dedup: keep the earliest trade for each (bot_id, strategy_id, symbol, entry_time)
    op.execute("""
        DELETE FROM trades WHERE id NOT IN (
            SELECT MIN(id) FROM trades
            GROUP BY bot_id, strategy_id, symbol, entry_time
        )
    """)
    with op.batch_alter_table('trades', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_trade_bot_strategy_symbol_entry', ['bot_id', 'strategy_id', 'symbol', 'entry_time'])


def downgrade() -> None:
    with op.batch_alter_table('trades', schema=None) as batch_op:
        batch_op.drop_constraint('uq_trade_bot_strategy_symbol_entry', type_='unique')
