from sqlalchemy import Column, JSON, UniqueConstraint, Boolean

from .base import Base, UserOwnedConfigMixin


class Screener(UserOwnedConfigMixin, Base):
    __tablename__ = "screeners"

    # id, user_id, name, description, created_at, updated_at from UserOwnedConfigMixin (DRY fix for ~5-line similar struct with ReplaySavedConfig)
    indicators = Column(JSON, nullable=True)
    columns = Column(JSON, nullable=True)
    filters = Column(JSON, nullable=True)
    default_sort = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True)

    __table_args__ = (
        UniqueConstraint('user_id', 'name', name='uq_user_screener'),
    )

    def to_dict(self):
        base = self._base_to_dict()
        base.update({
            "indicators": self.indicators or [],
            "columns": self.columns or [],
            "filters": self.filters or {},
            "default_sort": self.default_sort or {},
            "is_active": self.is_active,
        })
        return base