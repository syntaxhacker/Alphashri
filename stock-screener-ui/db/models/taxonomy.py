"""Curated themes taxonomy: Theme + ThemeConstituent.

A stock can belong to multiple curated themes (Defence, Railways,
Wires & Cables, ...). The group-performance endpoint ranks/filters by
theme using these tables.
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .base import Base, TimestampMixin


class Theme(TimestampMixin, Base):
    """A curated stock theme (e.g. Defence, Railways)."""
    __tablename__ = "themes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    slug = Column(String(80), unique=True, index=True, nullable=False)
    name = Column(String(120), nullable=False)
    category = Column(String(60), nullable=True)
    description = Column(Text, nullable=False, default="", server_default="")
    source = Column(String(120), nullable=False, default="curated", server_default="curated")
    version = Column(Integer, nullable=False, default=1, server_default="1")
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    # created_at / updated_at from TimestampMixin (server defaults + onupdate)

    constituents = relationship(
        "ThemeConstituent",
        back_populates="theme",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self):
        return f"<Theme(slug='{self.slug}', name='{self.name}')>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "slug": self.slug,
            "name": self.name,
            "category": self.category,
            "description": self.description or "",
            "source": self.source,
            "version": self.version,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ThemeConstituent(Base):
    """One stock's membership in a theme (many-to-many link)."""
    __tablename__ = "theme_constituents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    theme_id = Column(Integer, ForeignKey("themes.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol = Column(String(32), index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    theme = relationship("Theme", back_populates="constituents")

    __table_args__ = (
        UniqueConstraint("theme_id", "symbol", name="uq_theme_symbol"),
    )

    def __repr__(self):
        return f"<ThemeConstituent(theme_id={self.theme_id}, symbol='{self.symbol}')>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "theme_id": self.theme_id,
            "symbol": self.symbol,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
