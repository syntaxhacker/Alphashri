"""add_chart_patterns

Creates the chart-pattern compute job + hit tables (CONTRACT.md §4).

Revision ID: cp1a2b3c4d5e
Revises: s3t4u5v6w7x8
Create Date: 2026-10-03 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'cp1a2b3c4d5e'
down_revision = 's3t4u5v6w7x8'
branch_labels = None
depends_on = None


JOBS_TABLE = 'pattern_compute_jobs'
HITS_TABLE = 'pattern_hits'


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def _index_exists(table: str, name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    try:
        return name in {idx['name'] for idx in insp.get_indexes(table)}
    except Exception:
        return False


def upgrade():
    if not _table_exists(JOBS_TABLE):
        op.create_table(
            JOBS_TABLE,
            sa.Column('id', sa.String(40), primary_key=True),
            sa.Column('universe', sa.String(32), nullable=False),
            sa.Column('timeframe', sa.String(8), nullable=False),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('done', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('failed', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('skipped', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('queue_position', sa.Integer(), nullable=True),
            sa.Column('data_through', sa.String(20), nullable=True),
            sa.Column('error', sa.String(500), nullable=True),
            sa.Column('requested_by', sa.Integer(), nullable=True),
            sa.Column('params_json', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column('started_at', sa.DateTime(), nullable=True),
            sa.Column('finished_at', sa.DateTime(), nullable=True),
        )
    if not _index_exists(JOBS_TABLE, 'ix_pattern_compute_jobs_status'):
        op.create_index('ix_pattern_compute_jobs_status', JOBS_TABLE, ['status'], unique=False)

    if not _table_exists(HITS_TABLE):
        op.create_table(
            HITS_TABLE,
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('uuid', sa.String(36), nullable=True),
            sa.Column('job_id', sa.String(40), nullable=False),
            sa.Column('symbol', sa.String(32), nullable=False),
            sa.Column('name', sa.String(128), nullable=True),
            sa.Column('timeframe', sa.String(8), nullable=False),
            sa.Column('pattern_id', sa.String(48), nullable=False),
            sa.Column('pattern_name', sa.String(96), nullable=False),
            sa.Column('family', sa.String(24), nullable=False),
            sa.Column('direction', sa.String(12), nullable=False),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('quality', sa.String(16), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True),
            sa.Column('start_date', sa.String(20), nullable=True),
            sa.Column('end_date', sa.String(20), nullable=True),
            sa.Column('start_price', sa.Float(), nullable=True),
            sa.Column('end_price', sa.Float(), nullable=True),
            sa.Column('breakout_level', sa.Float(), nullable=True),
            sa.Column('target', sa.Float(), nullable=True),
            sa.Column('stop', sa.Float(), nullable=True),
            sa.Column('rr', sa.Float(), nullable=True),
            sa.Column('bars_ago', sa.Integer(), nullable=True),
            sa.Column('volume_confirmed', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('payload_json', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint('uuid', name='uq_pattern_hits_uuid'),
        )

    for name, cols in (
        ('ix_pattern_hits_symbol', ['symbol']),
        ('ix_pattern_hits_job_id', ['job_id']),
        ('ix_pattern_hits_timeframe', ['timeframe']),
        ('ix_pattern_hits_pattern_id', ['pattern_id']),
        ('ix_pattern_hits_symbol_timeframe', ['symbol', 'timeframe']),
        ('ix_pattern_hits_job_status', ['job_id', 'status']),
    ):
        if not _index_exists(HITS_TABLE, name):
            op.create_index(name, HITS_TABLE, cols, unique=False)


def downgrade():
    if _table_exists(HITS_TABLE):
        for name in (
            'ix_pattern_hits_job_status',
            'ix_pattern_hits_symbol_timeframe',
            'ix_pattern_hits_pattern_id',
            'ix_pattern_hits_timeframe',
            'ix_pattern_hits_job_id',
            'ix_pattern_hits_symbol',
        ):
            if _index_exists(HITS_TABLE, name):
                op.drop_index(name, table_name=HITS_TABLE)
        op.drop_table(HITS_TABLE)
    if _table_exists(JOBS_TABLE):
        if _index_exists(JOBS_TABLE, 'ix_pattern_compute_jobs_status'):
            op.drop_index('ix_pattern_compute_jobs_status', table_name=JOBS_TABLE)
        op.drop_table(JOBS_TABLE)
