"""
52w_high liquidity floor tests.

Names with negligible turnover (e.g. SHIVAUM's 52-share days) must be
dropped right after TV enrichment — before any per-symbol Upstox fetch.
"""

import sys
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.screener_api.screener_models import (
    min_52w_turnover_cr,
    min_52w_volume_m,
)
from api.screener_api.screener_scan import _passes_profile_filters


def _row(volume_m=0.0, turnover_cr=0.0):
    return {'symbol': 'X', 'volume_m': volume_m, 'turnover_cr': turnover_cr, 'to_52w_high': 1.0}


class TestLiquidityFloorDefaults:
    def test_defaults(self, monkeypatch):
        monkeypatch.delenv('SCREENER_52W_MIN_VOLUME_M', raising=False)
        monkeypatch.delenv('SCREENER_52W_MIN_TURNOVER_CR', raising=False)
        assert min_52w_volume_m() == 0.0
        assert min_52w_turnover_cr() == 0.5

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv('SCREENER_52W_MIN_TURNOVER_CR', '0')
        assert min_52w_turnover_cr() == 0.0


class Test52wHighFilter:
    def test_shivaum_like_row_dropped(self):
        # 52 shares @ ~551 = ~0.003 Cr turnover
        assert _passes_profile_filters('52w_high', _row(volume_m=0.0, turnover_cr=0.003), {}) is False

    def test_galaxysurf_like_row_kept(self):
        # 17.5K shares @ ~2600 = ~4.6 Cr turnover
        assert _passes_profile_filters('52w_high', _row(volume_m=0.02, turnover_cr=4.6), {}) is True

    def test_floor_disabled_via_env(self, monkeypatch):
        monkeypatch.setenv('SCREENER_52W_MIN_TURNOVER_CR', '0')
        assert _passes_profile_filters('52w_high', _row(volume_m=0.0, turnover_cr=0.003), {}) is True

    def test_explicit_filter_wins(self):
        assert _passes_profile_filters(
            '52w_high', _row(volume_m=0.0, turnover_cr=0.003),
            {'min_turnover_cr': 0.001},
        ) is True
