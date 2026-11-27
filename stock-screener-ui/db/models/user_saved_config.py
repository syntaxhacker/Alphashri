from sqlalchemy import (
    Column, Integer, String, JSON, ForeignKey, UniqueConstraint, Index,
)

from .base import Base, UserOwnedConfigMixin


class UserSavedConfig(UserOwnedConfigMixin, Base):
    """One saved UI payload per (user, scope, name).

    ``name = ''`` is the reserved default slot; named presets are the same table.
    """

    __tablename__ = "user_saved_configs"

    # Redeclared from the mixin so the row dies with the account.
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    scope = Column(String(64), nullable=False, index=True)
    config = Column(JSON, nullable=False)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    # Redeclared to carry the server-side default: an insert that omits `name`
    # must still land in the default slot rather than violate NOT NULL.
    name = Column(String(100), nullable=False, server_default="")

    __table_args__ = (
        # UNIQUE must include name: empty string, not NULL, so SQL (where NULLs
        # are distinct) cannot admit two default rows per scope.
        UniqueConstraint("user_id", "scope", "name", name="uq_user_saved_config"),
        Index("ix_user_saved_configs_user_scope", "user_id", "scope"),
    )
