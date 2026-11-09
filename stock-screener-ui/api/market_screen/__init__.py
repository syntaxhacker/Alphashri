"""Market screen — GET /api/market/snapshot backed by a single TV scan.

Routes live in :mod:`api.market_screen.router` (mounted at ``/api/market``);
snapshot assembly lives in :mod:`api.market_screen.snapshot`.
"""

from .router import router
from .snapshot import build_snapshot

__all__ = ["router", "build_snapshot"]
