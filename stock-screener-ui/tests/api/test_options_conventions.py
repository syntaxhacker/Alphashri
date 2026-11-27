"""Every option consumer reads its constants from :mod:`api.options_conventions`.

The audit found duplicated literals (60 vs 100 for IV, 1% vs 0.25% for near
bands, two copies of the GEX gates). These checks pin that there is one owner
and that the two *deliberate* differences are preserved, not silently unified.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import api.options_analytics as oa
import api.options_iv as iv
import api.options_levels as levels
import api.reports_api.iv_surface as surface
import api.reports_api.nifty as nifty
import api.reports_api.options_recorder as recorder
import api.reports_api.options_report as report
import api.reports_api.options_walls as walls
import scripts.market.options_analytics_probe as probe
import scripts.market.options_calibration as calib
from api import options_conventions as conv

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_GEX_OWNER = REPO_ROOT / "src/config/reportAnalytics.ts"
TS_GEX_CONSUMER = REPO_ROOT / "src/pages/report/NiftyGexProfile.tsx"


def test_iv_max_is_shared_by_analytics_and_scripts():
    assert conv.IV_MAX == 100.0
    assert iv.IV_MAX is conv.IV_MAX
    assert iv.MAX_IV is conv.IV_MAX          # historical public alias
    assert probe.IV_MAX is conv.IV_MAX
    assert calib.IV_MAX is conv.IV_MAX


def test_surface_shares_the_upper_bound_but_keeps_its_floor():
    assert conv.SURFACE_IV_MAX == 100.0
    assert surface.IV_MAX is conv.SURFACE_IV_MAX
    assert surface.IV_MIN is conv.SURFACE_IV_MIN == 1.0
    assert conv.IV_MIN == 0.0               # analytics lower bound, different idea
    assert surface.IV_MAX == conv.IV_MAX    # shared 100-point upper bound
    assert surface.IV_MIN != conv.IV_MIN    # deliberate floor difference


def test_delta_convention_is_shared():
    assert conv.DELTA_TARGET == 0.25
    assert conv.DELTA_BAND == (0.15, 0.35)
    assert surface.SKEW_DELTA is conv.DELTA_TARGET
    assert (surface.DELTA_MIN, surface.DELTA_MAX) == conv.DELTA_BAND


def test_gex_gates_are_one_set_of_values():
    for name in ("GEX_LEVEL_MIN_SHARE", "GEX_LEVEL_MAX_DIST_PCT",
                 "GEX_FLIP_MAX_DIST_PCT"):
        canonical = getattr(conv, name)
        assert getattr(levels, name) is canonical
        assert getattr(nifty, name) is canonical
    assert conv.GEX_LEVEL_MIN_SHARE == 0.10
    assert conv.GEX_LEVEL_MAX_DIST_PCT == conv.GEX_FLIP_MAX_DIST_PCT == 0.05


def _ts_gex_gate(name: str) -> float:
    source = TS_GEX_OWNER.read_text(encoding="utf-8")
    match = re.search(rf"^export const {name} = ([0-9]*\.?[0-9]+);", source,
                      re.MULTILINE)
    assert match, f"{name} must be a one-line `export const ... = <number>;` in {TS_GEX_OWNER}"
    return float(match.group(1))


def test_frontend_gex_gates_match_the_python_owner():
    assert _ts_gex_gate("GEX_LEVEL_MIN_SHARE") == conv.GEX_LEVEL_MIN_SHARE
    assert _ts_gex_gate("GEX_LEVEL_MAX_DIST_PCT") == conv.GEX_LEVEL_MAX_DIST_PCT

    consumer = TS_GEX_CONSUMER.read_text(encoding="utf-8")
    assert "@/config/reportAnalytics" in consumer
    for name in ("GEX_LEVEL_MIN_SHARE", "GEX_LEVEL_MAX_DIST_PCT"):
        assert f"export const {name}" not in consumer  # no second definition


def test_thin_chain_gates_are_owned():
    for name in ("THIN_MIN_TOTAL_OI", "THIN_MIN_ROWS", "THIN_MAX_SINGLE_SHARE"):
        assert getattr(levels, name) is getattr(conv, name)
    assert (conv.THIN_MIN_TOTAL_OI, conv.THIN_MIN_ROWS,
            conv.THIN_MAX_SINGLE_SHARE) == (50_000, 5, 0.4)


def test_near_bands_are_deliberately_different():
    # 1% for the walls_near panels, 0.25% for the wall-erosion pin/break detector.
    assert conv.NEAR_BAND_PCT == 0.01
    assert conv.WALLS_NEAR_PCT == 0.0025
    assert conv.NEAR_BAND_PCT != conv.WALLS_NEAR_PCT
    assert levels.WALL_NEAR_DIST_PCT is conv.NEAR_BAND_PCT
    assert report._NEAR_BAND_PCT is conv.NEAR_BAND_PCT
    assert recorder.NEAR_BAND_PCT is conv.NEAR_BAND_PCT
    assert walls.NEAR_PCT is conv.WALLS_NEAR_PCT


def test_near_atm_gamma_band_is_owned_by_conventions():
    assert conv.NEAR_ATM_BAND_PCT == 0.05

    # gamma_coverage's default is the shared object, not a restated literal.
    default = inspect.signature(iv.gamma_coverage).parameters["band_pct"].default
    assert default is conv.NEAR_ATM_BAND_PCT

    # The analytics consumer imports and passes the same object. Same value as
    # the GEX level-distance gate, but a different constant with a different
    # meaning — assert names, never identity between the two 0.05 floats.
    assert oa.NEAR_ATM_BAND_PCT is conv.NEAR_ATM_BAND_PCT
    source = inspect.getsource(oa)
    assert "gamma_coverage(" in source
    assert "NEAR_ATM_BAND_PCT" in source
    assert conv.GEX_LEVEL_MAX_DIST_PCT == conv.NEAR_ATM_BAND_PCT


def test_lot_default_is_owned_and_unchanged():
    assert conv.DEFAULT_LOT_SIZE == 65
    assert (inspect.signature(levels.compute_gex).parameters["lot_size"].default
            is conv.DEFAULT_LOT_SIZE)
    assert (inspect.signature(nifty.compute_gex).parameters["lot_size"].default
            is conv.DEFAULT_LOT_SIZE)


def test_dte_floor_is_documented():
    assert conv.DTE_FLOOR_DAYS == 1


def test_analytics_coverage_floors_are_the_shared_objects():
    assert conv.IV_COVERAGE_FLOOR == 0.60
    assert conv.GAMMA_COVERAGE_FLOOR == 0.5
    assert oa.IV_COVERAGE_FLOOR is conv.IV_COVERAGE_FLOOR
    assert oa.GAMMA_COVERAGE_FLOOR is conv.GAMMA_COVERAGE_FLOOR


def test_analytics_expiry_limits_are_the_shared_objects():
    assert conv.ANALYTICS_DEFAULT_EXPIRIES == 3
    assert conv.ANALYTICS_MAX_EXPIRIES == 6

    query = inspect.signature(oa.get_options_analytics).parameters["expiries"].default
    assert query.default is conv.ANALYTICS_DEFAULT_EXPIRIES
    assert any(getattr(m, "le", None) is conv.ANALYTICS_MAX_EXPIRIES
               for m in query.metadata)


def test_analytics_keeps_no_local_literals_for_those_meanings():
    source = inspect.getsource(oa)
    assert "0.60" not in source
    assert "= 0.5" not in source
    assert "IV_COVERAGE_FLOOR = " not in source
    assert "GAMMA_COVERAGE_FLOOR = " not in source

    route = inspect.getsource(oa.get_options_analytics)
    assert "Query(3," not in route
    assert "le=6" not in route
    assert "ANALYTICS_DEFAULT_EXPIRIES" in route
    assert "ANALYTICS_MAX_EXPIRIES" in route
