"""price_surge_events.created_at index is declared on the model."""

import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.models.price_surge import PriceSurgeEvent


def test_created_at_index_is_declared_on_the_model():
    names = {idx.name for idx in PriceSurgeEvent.__table__.indexes}
    assert "ix_price_surge_events_created_at" in names


def test_created_at_index_is_created_with_the_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'surge.db'}")
    try:
        PriceSurgeEvent.__table__.create(bind=engine)
        indexes = {idx["name"] for idx in inspect(engine).get_indexes("price_surge_events")}
        assert "ix_price_surge_events_created_at" in indexes
    finally:
        engine.dispose()
