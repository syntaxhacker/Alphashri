"""Parity guards for shared scan caps and the 52W cache namespace.

The value assertions pin the pre-refactor numbers; the identity assertions
require each consumer to bind the canonical constant instead of restating an
equal literal.
"""
from pathlib import Path

import api.paper.endpoints as paper_endpoints
import api.rotation as rotation
import api.sector as sector
from api.market_screen import snapshot
from api.screener_api import dashboard
from api.tv.columns import FRAME_LIMIT
from chart_patterns.watch import _near52w_cache_key
from trading.week52 import keys


class TestScanCaps:
    def test_tv_frame_limits_are_pinned(self):
        assert FRAME_LIMIT == {"india": 4000, "usa": 4000, "global": 12000}
        assert FRAME_LIMIT["india"] == FRAME_LIMIT["usa"] == 4000
        assert FRAME_LIMIT["global"] == 12000

    def test_market_screen_cap_binds_canonical_4000(self):
        assert snapshot.MAX_LIMIT == 4000
        assert snapshot.MAX_LIMIT is FRAME_LIMIT["india"]

    def test_dashboard_input_cap_binds_canonical_4000(self):
        assert dashboard.TV_LIMIT == 4000
        assert dashboard.TV_LIMIT is FRAME_LIMIT["india"]

    def test_rotation_frame_limit_binds_sector_shared_3000(self):
        assert sector.SHARED_FRAME_LIMIT == 3000
        assert rotation.FRAME_LIMIT == 3000
        assert rotation.FRAME_LIMIT is sector.SHARED_FRAME_LIMIT

    def test_theme_fetch_limit_stays_at_3000(self):
        assert sector.THEME_FETCH_LIMIT == 3000


class Test52wCacheNamespace:
    def test_paper_cache_dir_binds_canonical_relative_path(self):
        root = Path(paper_endpoints.__file__).resolve().parents[2]
        assert keys.PAPER_52W_CACHE_DIR == "experiments/data/52w_cache"
        assert paper_endpoints.CACHE_52W_DIR == root / keys.PAPER_52W_CACHE_DIR
        assert str(paper_endpoints.CACHE_52W_DIR).endswith("experiments/data/52w_cache")

    def test_paper_file_ttl_binds_canonical_variant(self):
        assert getattr(keys, "PAPER_52W_FILE_TTL_MINUTES", None) == 5
        assert paper_endpoints._52W_TTL_MINUTES == 5
        assert keys.RANGE_TTL == 86400

    def test_near52w_key_format_unchanged(self):
        assert _near52w_cache_key("all", "1d") == "near_52w__all__1d"
        assert _near52w_cache_key("nifty 500/eq", "1h") == "near_52w__nifty500eq__1h"
