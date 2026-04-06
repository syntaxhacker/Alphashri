import json
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Integer, String, Text, DateTime, Date, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .base import Base


class BrokerConnection(Base):
    """Broker connection tokens for OAuth integrations.

    Stores broker access tokens for trading APIs.
    user_id=NULL indicates a shared token for all users.
    """
    __tablename__ = "broker_connections"

    id = Column(Integer, primary_key=True)
    broker_name = Column(String(50), nullable=False, index=True)
    access_token = Column(Text, nullable=False)
    token_timestamp = Column(DateTime, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="broker_connections")

    __table_args__ = (
        UniqueConstraint('broker_name', 'user_id', name='uq_broker_name_user'),
    )

    def __repr__(self):
        return f"<BrokerConnection(id={self.id}, broker='{self.broker_name}', user_id={self.user_id})>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "broker_name": self.broker_name,
            "access_token": self.access_token,
            "token_timestamp": self.token_timestamp.isoformat() if self.token_timestamp else None,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Instrument(Base):
    """NSE instrument data for symbol search and trading."""
    __tablename__ = "instruments"

    instrument_key = Column(String(100), primary_key=True)
    trading_symbol = Column(String(50), nullable=False, index=True)
    name = Column(String(200), nullable=True)
    exchange = Column(String(20), nullable=False)
    segment = Column(String(20), nullable=False)
    lot_size = Column(Integer, default=1)
    tick_size = Column(Float, default=0.05)
    expiry = Column(Date, nullable=True)
    strike_price = Column(Float, nullable=True)
    qty_multiplier = Column(Float, nullable=True)
    isin = Column(String(20), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<Instrument({self.trading_symbol})>"

    def to_dict(self) -> dict:
        return {
            "instrument_key": self.instrument_key,
            "trading_symbol": self.trading_symbol,
            "name": self.name,
            "exchange": self.exchange,
            "segment": self.segment,
            "lot_size": self.lot_size,
            "tick_size": self.tick_size,
            "expiry": self.expiry.isoformat() if self.expiry else None,
            "strike_price": self.strike_price,
            "qty_multiplier": self.qty_multiplier,
            "isin": self.isin,
        }


def get_shared_broker_token(broker_name: str) -> Optional[dict]:
    """Returns token data for shared (user_id=NULL) broker connection."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        connection = db.query(BrokerConnection).filter(
            BrokerConnection.broker_name == broker_name,
            BrokerConnection.user_id.is_(None)
        ).first()
        return connection.to_dict() if connection else None
    finally:
        db.close()


def save_broker_token(broker_name: str, access_token: str, user_id: Optional[int] = None) -> BrokerConnection:
    """Save or update a broker token. Returns the BrokerConnection instance."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        connection = db.query(BrokerConnection).filter(
            BrokerConnection.broker_name == broker_name,
            BrokerConnection.user_id == user_id
        ).first()
        if connection:
            connection.access_token = access_token
            connection.token_timestamp = datetime.utcnow()
        else:
            connection = BrokerConnection(
                broker_name=broker_name,
                access_token=access_token,
                token_timestamp=datetime.utcnow(),
                user_id=user_id
            )
            db.add(connection)
        db.commit()
        db.refresh(connection)
        return connection
    finally:
        db.close()


def delete_broker_token(broker_name: str, user_id: Optional[int] = None) -> bool:
    """Delete a broker token. Returns True if deleted, False if not found."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        connection = db.query(BrokerConnection).filter(
            BrokerConnection.broker_name == broker_name,
            BrokerConnection.user_id == user_id
        ).first()
        if connection:
            db.delete(connection)
            db.commit()
            return True
        return False
    finally:
        db.close()
