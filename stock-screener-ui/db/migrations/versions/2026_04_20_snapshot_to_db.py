"""snapshot to db migration: runtime state tables + position columns

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h8b9c0d1e2f3'
down_revision: Union[str, Sequence[str], None] = 'g7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bot_runtime_states',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('bot_id', sa.Integer(), sa.ForeignKey('bot_configs.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('cash', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('daily_pnl', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('daily_trades', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('realized_pnl', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('day_start', sa.String(10), nullable=False, server_default=''),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_bot_runtime_states_bot_id', 'bot_runtime_states', ['bot_id'], unique=True)
    op.create_index('ix_bot_runtime_states_user_id', 'bot_runtime_states', ['user_id'])

    op.create_table(
        'strategy_runtime_states',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('bot_id', sa.Integer(), sa.ForeignKey('bot_configs.id'), nullable=False),
        sa.Column('strategy_id', sa.Integer(), sa.ForeignKey('strategy_configs.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('signals_generated', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('trades_executed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_scan_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('capital_used', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('available_capital', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('positions_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('realized_pnl', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('bot_id', 'strategy_id', name='uq_bot_strategy_runtime'),
    )
    op.create_index('ix_strategy_runtime_states_bot_id', 'strategy_runtime_states', ['bot_id'])
    op.create_index('ix_strategy_runtime_states_strategy_id', 'strategy_runtime_states', ['strategy_id'])

    op.add_column('positions', sa.Column('strategy_type', sa.String(20), nullable=True, server_default=''))
    op.add_column('positions', sa.Column('peak_price', sa.Float(), nullable=True, server_default='0.0'))
    op.add_column('positions', sa.Column('low_price', sa.Float(), nullable=True, server_default='0.0'))
    op.add_column('positions', sa.Column('metadata_json', sa.String(2000), nullable=True))


def downgrade() -> None:
    op.drop_column('positions', 'metadata_json')
    op.drop_column('positions', 'low_price')
    op.drop_column('positions', 'peak_price')
    op.drop_column('positions', 'strategy_type')
    op.drop_table('strategy_runtime_states')
    op.drop_table('bot_runtime_states')
