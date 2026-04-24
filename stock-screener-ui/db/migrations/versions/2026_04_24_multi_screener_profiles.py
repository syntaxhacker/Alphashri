"""Add screener_profiles to strategy_configs

Revision ID: 2026_04_24_multi_screener_profiles
Revises: 2026_04_20_snapshot_to_db
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
import json


# Revision identifiers
revision = '2026_04_24_multi_screener_profiles'
down_revision = '2026_04_20_snapshot_to_db'
branch_labels = None
depends_on = None


def upgrade():
    """Add screener_profiles column to strategy_configs table."""
    # Add column as Text to store JSON array of profile names
    op.add_column(
        'strategy_configs',
        sa.Column('screener_profiles', sa.Text(), nullable=True)
    )
    
    # Set default empty array for existing rows
    op.execute(
        "UPDATE strategy_configs SET screener_profiles = '[]'"
    )


def downgrade():
    """Remove screener_profiles column from strategy_configs table."""
    op.drop_column('strategy_configs', 'screener_profiles')
