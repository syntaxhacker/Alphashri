"""initial schema

Revision ID: e770cdca44e6
Revises:
Create Date: 2026-03-26 13:57:38.387594

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e770cdca44e6'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    def table_exists(name):
        return name in existing_tables

    def index_exists(name, table):
        return name in [idx['name'] for idx in inspector.get_indexes(table)]

    if not table_exists('instruments'):
        op.create_table('instruments',
            sa.Column('instrument_key', sa.String(length=100), nullable=False),
            sa.Column('trading_symbol', sa.String(length=50), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=True),
            sa.Column('exchange', sa.String(length=20), nullable=False),
            sa.Column('segment', sa.String(length=20), nullable=False),
            sa.Column('lot_size', sa.Integer(), nullable=True),
            sa.Column('tick_size', sa.Float(), nullable=True),
            sa.Column('expiry', sa.Date(), nullable=True),
            sa.Column('strike_price', sa.Float(), nullable=True),
            sa.Column('qty_multiplier', sa.Float(), nullable=True),
            sa.Column('isin', sa.String(length=20), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.PrimaryKeyConstraint('instrument_key')
        )
    if not index_exists('ix_instruments_trading_symbol', 'instruments'):
        op.create_index(op.f('ix_instruments_trading_symbol'), 'instruments', ['trading_symbol'], unique=False)

    if not table_exists('llm_runs'):
        op.create_table('llm_runs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('uuid', sa.String(length=36), nullable=True),
            sa.Column('model', sa.String(length=100), nullable=False),
            sa.Column('provider', sa.String(length=50), nullable=True),
            sa.Column('prompt_tokens', sa.Integer(), nullable=True),
            sa.Column('completion_tokens', sa.Integer(), nullable=True),
            sa.Column('total_tokens', sa.Integer(), nullable=True),
            sa.Column('cost_usd', sa.Float(), nullable=True),
            sa.Column('response_time_ms', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('url', sa.String(length=2048), nullable=True),
            sa.Column('headline', sa.String(length=500), nullable=True),
            sa.Column('request_json', sa.Text(), nullable=True),
            sa.Column('response_json', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_llm_runs_created_at', 'llm_runs'):
        op.create_index(op.f('ix_llm_runs_created_at'), 'llm_runs', ['created_at'], unique=False)
    if not index_exists('ix_llm_runs_model', 'llm_runs'):
        op.create_index(op.f('ix_llm_runs_model'), 'llm_runs', ['model'], unique=False)
    if not index_exists('ix_llm_runs_status', 'llm_runs'):
        op.create_index(op.f('ix_llm_runs_status'), 'llm_runs', ['status'], unique=False)
    if not index_exists('ix_llm_runs_uuid', 'llm_runs'):
        op.create_index(op.f('ix_llm_runs_uuid'), 'llm_runs', ['uuid'], unique=True)

    if not table_exists('news_articles'):
        op.create_table('news_articles',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('url', sa.String(length=2048), nullable=False),
            sa.Column('headline', sa.String(length=500), nullable=False),
            sa.Column('content', sa.Text(), nullable=True),
            sa.Column('source', sa.String(length=50), nullable=False),
            sa.Column('source_url', sa.String(length=2048), nullable=True),
            sa.Column('published_at', sa.DateTime(), nullable=True),
            sa.Column('fetched_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('sentiment', sa.String(length=20), nullable=True),
            sa.Column('impact_score', sa.Integer(), nullable=True),
            sa.Column('analysis_json', sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_news_articles_fetched_at', 'news_articles'):
        op.create_index(op.f('ix_news_articles_fetched_at'), 'news_articles', ['fetched_at'], unique=False)
    if not index_exists('ix_news_articles_published_at', 'news_articles'):
        op.create_index(op.f('ix_news_articles_published_at'), 'news_articles', ['published_at'], unique=False)
    if not index_exists('ix_news_articles_source', 'news_articles'):
        op.create_index(op.f('ix_news_articles_source'), 'news_articles', ['source'], unique=False)
    if not index_exists('ix_news_articles_url', 'news_articles'):
        op.create_index(op.f('ix_news_articles_url'), 'news_articles', ['url'], unique=True)

    if not table_exists('users'):
        op.create_table('users',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('uuid', sa.String(length=36), nullable=True),
            sa.Column('email', sa.String(), nullable=False),
            sa.Column('hashed_password', sa.String(), nullable=False),
            sa.Column('display_name', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True),
            sa.Column('is_admin', sa.Boolean(), nullable=True),
            sa.Column('initial_capital', sa.Float(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_users_email', 'users'):
        op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    if not index_exists('ix_users_id', 'users'):
        op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    if not index_exists('ix_users_uuid', 'users'):
        op.create_index(op.f('ix_users_uuid'), 'users', ['uuid'], unique=True)

    if not table_exists('strategy_configs'):
        op.create_table('strategy_configs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('uuid', sa.String(length=36), nullable=True),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('strategy_type', sa.String(), nullable=False),
            sa.Column('parent_id', sa.Integer(), nullable=True),
            sa.Column('is_template', sa.Boolean(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True),
            sa.Column('is_default', sa.Boolean(), nullable=True),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('or_minutes', sa.Integer(), nullable=True),
            sa.Column('sl_pct', sa.Float(), nullable=True),
            sa.Column('tp_pct', sa.Float(), nullable=True),
            sa.Column('min_or_range_pct', sa.Float(), nullable=True),
            sa.Column('max_or_range_pct', sa.Float(), nullable=True),
            sa.Column('max_positions', sa.Integer(), nullable=True),
            sa.Column('max_capital_per_trade_pct', sa.Float(), nullable=True),
            sa.Column('max_daily_loss_pct', sa.Float(), nullable=True),
            sa.Column('max_total_exposure_pct', sa.Float(), nullable=True),
            sa.Column('risk_per_trade_pct', sa.Float(), nullable=True),
            sa.Column('min_trade_value', sa.Float(), nullable=True),
            sa.Column('max_trade_value', sa.Float(), nullable=True),
            sa.Column('cooldown_minutes', sa.Integer(), nullable=True),
            sa.Column('max_distance_from_or_pct', sa.Float(), nullable=True),
            sa.Column('entry_threshold_pct', sa.Float(), nullable=True),
            sa.Column('enable_trailing_stop', sa.Boolean(), nullable=True),
            sa.Column('trailing_stop_pct', sa.Float(), nullable=True),
            sa.Column('trailing_activation_pct', sa.Float(), nullable=True),
            sa.Column('max_holding_days', sa.Integer(), nullable=True),
            sa.Column('cooldown_days', sa.Integer(), nullable=True),
            sa.Column('enable_filters', sa.Boolean(), nullable=True),
            sa.Column('ema_fast_period', sa.Integer(), nullable=True),
            sa.Column('ema_slow_period', sa.Integer(), nullable=True),
            sa.Column('pivot_type', sa.String(), nullable=True),
            sa.Column('breakout_buffer_pct', sa.Float(), nullable=True),
            sa.Column('brokerage_pct', sa.Float(), nullable=True),
            sa.Column('min_brokerage', sa.Float(), nullable=True),
            sa.Column('stt_pct', sa.Float(), nullable=True),
            sa.Column('exchange_pct', sa.Float(), nullable=True),
            sa.Column('sebi_pct', sa.Float(), nullable=True),
            sa.Column('stamp_pct', sa.Float(), nullable=True),
            sa.Column('gst_pct', sa.Float(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.ForeignKeyConstraint(['parent_id'], ['strategy_configs.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('name')
        )
    if not index_exists('ix_strategy_configs_uuid', 'strategy_configs'):
        op.create_index(op.f('ix_strategy_configs_uuid'), 'strategy_configs', ['uuid'], unique=True)

    if not table_exists('sessions'):
        op.create_table('sessions',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('revoked', sa.Boolean(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_sessions_user_id', 'sessions'):
        op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)

    if not table_exists('backtest_results'):
        op.create_table('backtest_results',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('uuid', sa.String(length=36), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('strategy_id', sa.String(), nullable=False),
            sa.Column('strategy_name', sa.String(), nullable=False),
            sa.Column('variation_id', sa.String(), nullable=True),
            sa.Column('parameters', sa.String(), nullable=False),
            sa.Column('symbols', sa.String(), nullable=False),
            sa.Column('total_pnl', sa.Float(), nullable=True),
            sa.Column('total_pnl_pct', sa.Float(), nullable=True),
            sa.Column('win_rate', sa.Float(), nullable=True),
            sa.Column('total_trades', sa.Integer(), nullable=True),
            sa.Column('sharpe_ratio', sa.Float(), nullable=True),
            sa.Column('max_drawdown_pct', sa.Float(), nullable=True),
            sa.Column('results_json', sa.String(), nullable=False),
            sa.Column('totals_json', sa.String(), nullable=False),
            sa.Column('chart_data_json', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_backtest_results_user_id', 'backtest_results'):
        op.create_index(op.f('ix_backtest_results_user_id'), 'backtest_results', ['user_id'], unique=False)
    if not index_exists('ix_backtest_results_uuid', 'backtest_results'):
        op.create_index(op.f('ix_backtest_results_uuid'), 'backtest_results', ['uuid'], unique=True)

    if not table_exists('bot_configs'):
        op.create_table('bot_configs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('uuid', sa.String(length=36), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('is_active', sa.Boolean(), nullable=True),
            sa.Column('max_total_positions', sa.Integer(), nullable=True),
            sa.Column('max_total_capital_pct', sa.Float(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'name', name='uq_bot_name_per_user')
        )
    if not index_exists('ix_bot_configs_user_id', 'bot_configs'):
        op.create_index(op.f('ix_bot_configs_user_id'), 'bot_configs', ['user_id'], unique=False)
    if not index_exists('ix_bot_configs_uuid', 'bot_configs'):
        op.create_index(op.f('ix_bot_configs_uuid'), 'bot_configs', ['uuid'], unique=True)

    if not table_exists('broker_connections'):
        op.create_table('broker_connections',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('broker_name', sa.String(length=50), nullable=False),
            sa.Column('access_token', sa.Text(), nullable=False),
            sa.Column('token_timestamp', sa.DateTime(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_broker_connections_broker_name', 'broker_connections'):
        op.create_index(op.f('ix_broker_connections_broker_name'), 'broker_connections', ['broker_name'], unique=False)
    if not index_exists('ix_broker_connections_user_id', 'broker_connections'):
        op.create_index(op.f('ix_broker_connections_user_id'), 'broker_connections', ['user_id'], unique=False)

    if not table_exists('news_symbol_mentions'):
        op.create_table('news_symbol_mentions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('article_id', sa.Integer(), nullable=False),
            sa.Column('symbol_code', sa.String(length=50), nullable=False),
            sa.Column('trading_symbol', sa.String(length=50), nullable=True),
            sa.Column('instrument_key', sa.String(length=100), nullable=True),
            sa.Column('company_name', sa.String(length=200), nullable=True),
            sa.Column('match_confidence', sa.Float(), nullable=True),
            sa.Column('match_method', sa.String(length=20), nullable=True),
            sa.ForeignKeyConstraint(['article_id'], ['news_articles.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('ix_news_symbol_mentions_article_id', 'news_symbol_mentions'):
        op.create_index(op.f('ix_news_symbol_mentions_article_id'), 'news_symbol_mentions', ['article_id'], unique=False)
    if not index_exists('ix_news_symbol_mentions_instrument_key', 'news_symbol_mentions'):
        op.create_index('ix_news_symbol_mentions_instrument_key', 'news_symbol_mentions', ['instrument_key'], unique=False)
    if not index_exists('ix_news_symbol_mentions_trading_symbol', 'news_symbol_mentions'):
        op.create_index('ix_news_symbol_mentions_trading_symbol', 'news_symbol_mentions', ['trading_symbol'], unique=False)

    if not table_exists('bot_strategies'):
        op.create_table('bot_strategies',
            sa.Column('bot_id', sa.Integer(), nullable=False),
            sa.Column('strategy_id', sa.Integer(), nullable=False),
            sa.Column('max_positions', sa.Integer(), nullable=True),
            sa.Column('capital_allocation_pct', sa.Float(), nullable=True),
            sa.ForeignKeyConstraint(['bot_id'], ['bot_configs.id'], ),
            sa.ForeignKeyConstraint(['strategy_id'], ['strategy_configs.id'], ),
            sa.PrimaryKeyConstraint('bot_id', 'strategy_id')
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    def table_exists(name):
        return name in existing_tables

    if table_exists('bot_strategies'):
        op.drop_table('bot_strategies')
    if table_exists('news_symbol_mentions'):
        op.drop_index('ix_news_symbol_mentions_trading_symbol', table_name='news_symbol_mentions')
        op.drop_index('ix_news_symbol_mentions_instrument_key', table_name='news_symbol_mentions')
        op.drop_index(op.f('ix_news_symbol_mentions_article_id'), table_name='news_symbol_mentions')
        op.drop_table('news_symbol_mentions')
    if table_exists('broker_connections'):
        op.drop_index(op.f('ix_broker_connections_user_id'), table_name='broker_connections')
        op.drop_index(op.f('ix_broker_connections_broker_name'), table_name='broker_connections')
        op.drop_table('broker_connections')
    if table_exists('bot_configs'):
        op.drop_index(op.f('ix_bot_configs_uuid'), table_name='bot_configs')
        op.drop_index(op.f('ix_bot_configs_user_id'), table_name='bot_configs')
        op.drop_table('bot_configs')
    if table_exists('backtest_results'):
        op.drop_index(op.f('ix_backtest_results_uuid'), table_name='backtest_results')
        op.drop_index(op.f('ix_backtest_results_user_id'), table_name='backtest_results')
        op.drop_table('backtest_results')
    if table_exists('sessions'):
        op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
        op.drop_table('sessions')
    if table_exists('strategy_configs'):
        op.drop_index(op.f('ix_strategy_configs_uuid'), table_name='strategy_configs')
        op.drop_table('strategy_configs')
    if table_exists('users'):
        op.drop_index(op.f('ix_users_uuid'), table_name='users')
        op.drop_index(op.f('ix_users_id'), table_name='users')
        op.drop_index(op.f('ix_users_email'), table_name='users')
        op.drop_table('users')
    if table_exists('news_articles'):
        op.drop_index(op.f('ix_news_articles_url'), table_name='news_articles')
        op.drop_index(op.f('ix_news_articles_source'), table_name='news_articles')
        op.drop_index(op.f('ix_news_articles_published_at'), table_name='news_articles')
        op.drop_index(op.f('ix_news_articles_fetched_at'), table_name='news_articles')
        op.drop_table('news_articles')
    if table_exists('llm_runs'):
        op.drop_index(op.f('ix_llm_runs_uuid'), table_name='llm_runs')
        op.drop_index(op.f('ix_llm_runs_status'), table_name='llm_runs')
        op.drop_index(op.f('ix_llm_runs_model'), table_name='llm_runs')
        op.drop_index(op.f('ix_llm_runs_created_at'), table_name='llm_runs')
        op.drop_table('llm_runs')
    if table_exists('instruments'):
        op.drop_index(op.f('ix_instruments_trading_symbol'), table_name='instruments')
        op.drop_table('instruments')
