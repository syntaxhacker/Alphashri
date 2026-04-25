"""update SR Breakout min_rr_ratio to 1.0

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-12

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE strategy_configs SET min_rr_ratio = 1.0 "
        "WHERE strategy_type = 'SR_BREAKOUT'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE strategy_configs SET min_rr_ratio = 2.0 "
        "WHERE strategy_type = 'SR_BREAKOUT'"
    )
