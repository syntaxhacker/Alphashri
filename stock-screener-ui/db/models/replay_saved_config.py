from sqlalchemy import Column, JSON, UniqueConstraint

from .base import Base, UserOwnedConfigMixin


class ReplaySavedConfig(UserOwnedConfigMixin, Base):
    __tablename__ = "replay_saved_configs"

    # id, user_id, name, description, created_at, updated_at from UserOwnedConfigMixin (DRY fix for ~5-line similar struct with Screener)
    config = Column(JSON, nullable=False)

    __table_args__ = (
        UniqueConstraint('user_id', 'name', name='uq_user_replay_config'),
    )

    def to_dict(self):
        base = self._base_to_dict()
        base["config"] = self.config
        return base
