"""add_themes_taxonomy

Creates the ``themes`` + ``theme_constituents`` tables for the curated
stock-themes taxonomy (Defence, Railways, Wires & Cables, ...).

Revision ID: th1a2b3c4d5e
Revises: pi1a2b3c4d5e
Create Date: 2026-10-07 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'th1a2b3c4d5e'
down_revision = 'pi1a2b3c4d5e'
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def _index_names(table: str) -> set:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {idx['name'] for idx in insp.get_indexes(table)}


def upgrade():
    if not _table_exists('themes'):
        op.create_table(
            'themes',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('slug', sa.String(80), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('category', sa.String(60), nullable=True),
            sa.Column('description', sa.Text(), nullable=False, server_default=''),
            sa.Column('source', sa.String(120), nullable=False, server_default='curated'),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
    if 'ix_themes_slug' not in _index_names('themes'):
        op.create_index('ix_themes_slug', 'themes', ['slug'], unique=True)

    if not _table_exists('theme_constituents'):
        op.create_table(
            'theme_constituents',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('theme_id', sa.Integer(), sa.ForeignKey('themes.id', ondelete='CASCADE'), nullable=False),
            sa.Column('symbol', sa.String(32), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint('theme_id', 'symbol', name='uq_theme_symbol'),
        )
    existing = _index_names('theme_constituents')
    if 'ix_theme_constituents_theme_id' not in existing:
        op.create_index('ix_theme_constituents_theme_id', 'theme_constituents', ['theme_id'], unique=False)
    if 'ix_theme_constituents_symbol' not in existing:
        op.create_index('ix_theme_constituents_symbol', 'theme_constituents', ['symbol'], unique=False)


def downgrade():
    if _table_exists('theme_constituents'):
        existing = _index_names('theme_constituents')
        if 'ix_theme_constituents_symbol' in existing:
            op.drop_index('ix_theme_constituents_symbol', table_name='theme_constituents')
        if 'ix_theme_constituents_theme_id' in existing:
            op.drop_index('ix_theme_constituents_theme_id', table_name='theme_constituents')
        op.drop_table('theme_constituents')
    if _table_exists('themes'):
        if 'ix_themes_slug' in _index_names('themes'):
            op.drop_index('ix_themes_slug', table_name='themes')
        op.drop_table('themes')
