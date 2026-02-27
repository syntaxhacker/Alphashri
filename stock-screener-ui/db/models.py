"""
Database models for Alphashri
"""

from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    """User model for authentication and user-specific data."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)

    # Paper trading settings per user
    initial_capital = Column(Float, default=1000000.0)  # 10 Lakhs default

    # Relationship to sessions
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', display_name='{self.display_name}')>"


class UserSession(Base):
    """Session model for JWT token management."""
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)  # JWT jti (unique token identifier)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False)

    # Relationship to user
    user = relationship("User", back_populates="sessions")

    def __repr__(self):
        return f"<UserSession(id='{self.id}', user_id={self.user_id}, expires_at='{self.expires_at}')>"


class StrategyConfig(Base):
    """Strategy configuration parameters for paper trading."""
    __tablename__ = "strategy_configs"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)  # e.g., "orb_default"
    strategy_type = Column(String, nullable=False)  # e.g., "ORB"
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)

    # ORB Strategy Parameters
    or_minutes = Column(Integer, default=45)  # Opening range duration in minutes
    sl_pct = Column(Float, default=0.4)  # Stop loss percentage
    tp_pct = Column(Float, default=1.2)  # Take profit percentage
    min_or_range_pct = Column(Float, default=0.5)  # Minimum OR range % for valid signal
    max_or_range_pct = Column(Float, default=3.0)  # Maximum OR range % for valid signal

    # Risk Management Parameters
    max_positions = Column(Integer, default=5)  # Max concurrent positions
    max_capital_per_trade_pct = Column(Float, default=0.10)  # 10% of capital per trade
    max_daily_loss_pct = Column(Float, default=0.02)  # 2% daily loss limit
    max_total_exposure_pct = Column(Float, default=0.50)  # 50% total capital usage
    risk_per_trade_pct = Column(Float, default=0.01)  # 1% risk per trade
    min_trade_value = Column(Float, default=5000)  # Minimum trade value
    max_trade_value = Column(Float, default=100000)  # Maximum trade value

    # Trading Runner Parameters
    cooldown_minutes = Column(Integer, default=30)  # Cooldown after position closes
    max_distance_from_or_pct = Column(Float, default=1.5)  # Max distance from OR levels

    # Cost Parameters (brokerage, taxes)
    brokerage_pct = Column(Float, default=0.0003)  # 0.03%
    min_brokerage = Column(Float, default=20)
    stt_pct = Column(Float, default=0.00025)  # 0.025% (sell side)
    exchange_pct = Column(Float, default=0.0000297)
    sebi_pct = Column(Float, default=0.000001)
    stamp_pct = Column(Float, default=0.00003)  # 0.003% (buy side)
    gst_pct = Column(Float, default=0.18)

    # Metadata
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<StrategyConfig(id={self.id}, name='{self.name}', type='{self.strategy_type}')>"

    def to_dict(self) -> dict:
        """Convert config to dictionary for easy access."""
        return {
            # Identity
            "id": self.id,
            "name": self.name,
            "strategy_type": self.strategy_type,
            "is_active": self.is_active,
            "is_default": self.is_default,
            # ORB Parameters
            "or_minutes": self.or_minutes,
            "sl_pct": self.sl_pct,
            "tp_pct": self.tp_pct,
            "min_or_range_pct": self.min_or_range_pct,
            "max_or_range_pct": self.max_or_range_pct,
            # Risk Parameters
            "max_positions": self.max_positions,
            "max_capital_per_trade_pct": self.max_capital_per_trade_pct,
            "max_daily_loss_pct": self.max_daily_loss_pct,
            "max_total_exposure_pct": self.max_total_exposure_pct,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "min_trade_value": self.min_trade_value,
            "max_trade_value": self.max_trade_value,
            # Runner Parameters
            "cooldown_minutes": self.cooldown_minutes,
            "max_distance_from_or_pct": self.max_distance_from_or_pct,
            # Cost Parameters
            "brokerage_pct": self.brokerage_pct,
            "min_brokerage": self.min_brokerage,
            "stt_pct": self.stt_pct,
            "exchange_pct": self.exchange_pct,
            "sebi_pct": self.sebi_pct,
            "stamp_pct": self.stamp_pct,
            "gst_pct": self.gst_pct,
            # Metadata
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
