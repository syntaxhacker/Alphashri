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
