"""The two report helpers are thin views over ``api.options_levels``.

``tests/api/test_options_levels.py`` pins the shared formulas against the old
NIFTY GEX implementation. These checks pin the *report wrappers* themselves:
same numbers on one fixed chain, with only the report-specific row shape
(``{strike, oi, distance}`` instead of ``{strike, side, strength, oi}``).
"""

import pytest

import api.options_levels as levels
from api.reports_api import nifty, options_report

SPOT = 1400.0

_NIFTY_ROWS = [
    {"strike": 1380.0, "ce": {"oi": 100, "gamma": 0.001},
     "pe": {"oi": 800, "gamma": 0.001}},
    {"strike": 1400.0, "ce": {"oi": 900, "gamma": 0.001},
     "pe": {"oi": 1200, "gamma": 0.001}},
    {"strike": 1420.0, "ce": {"oi": 500, "gamma": 0.001},
     "pe": {"oi": 200, "gamma": 0.001}},
    {"strike": 1440.0, "ce": {"oi": 300, "gamma": 0.001},
     "pe": {"oi": 50, "gamma": 0.001}},
]
# options_report receives already-shaped legs; the OI/gamma keys are identical.
_REPORT_STRIKES = [
    {"strike": r["strike"], "ce": dict(r["ce"]), "pe": dict(r["pe"])}
    for r in _NIFTY_ROWS
]


def _wall_view(walls: list[dict]) -> list[dict]:
    return [{"strike": w["strike"], "oi": w["oi"]} for w in walls]


def test_nifty_gex_wrapper_matches_shared():
    assert nifty.compute_gex(_NIFTY_ROWS, SPOT) == levels.compute_gex(
        levels.normalize_strikes(_NIFTY_ROWS), SPOT
    )


def test_nifty_max_pain_wrapper_matches_shared():
    pain = levels.compute_max_pain(levels.normalize_strikes(_NIFTY_ROWS))
    assert pain is not None
    assert nifty.compute_max_pain(_NIFTY_ROWS) == pain


def test_options_report_max_pain_wrapper_matches_shared():
    pain = levels.compute_max_pain(levels.normalize_strikes(_REPORT_STRIKES))
    assert pain is not None
    assert options_report.compute_max_pain(_REPORT_STRIKES) == pain


@pytest.mark.parametrize("side", ["ce", "pe"])
@pytest.mark.parametrize("kind", ["top", "near"])
def test_nifty_wall_wrappers_match_shared(side, kind):
    strikes = levels.normalize_strikes(_NIFTY_ROWS)
    if kind == "top":
        shared = levels.top_walls(strikes, side, spot=SPOT)
        report = nifty.top_walls(_NIFTY_ROWS, side, spot=SPOT)
    else:
        shared = levels.near_walls(
            strikes, side, spot=SPOT, max_dist=nifty.WALL_NEAR_DIST_PTS
        )
        report = nifty.near_walls(_NIFTY_ROWS, side, spot=SPOT)
    assert _wall_view(report) == _wall_view(shared)
    assert all(set(w) == {"strike", "oi", "distance"} for w in report)


@pytest.mark.parametrize("side", ["ce", "pe"])
@pytest.mark.parametrize("kind", ["top", "near"])
def test_options_report_wall_wrappers_match_shared(side, kind):
    strikes = levels.normalize_strikes(_REPORT_STRIKES)
    band = max(abs(SPOT) * options_report._NEAR_BAND_PCT, 1e-9)
    if kind == "top":
        shared = levels.top_walls(strikes, side, spot=SPOT)
        report = options_report.top_walls(_REPORT_STRIKES, side, SPOT)
    else:
        shared = levels.near_walls(strikes, side, spot=SPOT, max_dist=band)
        report = options_report.near_walls(_REPORT_STRIKES, side, SPOT)
    assert _wall_view(report) == _wall_view(shared)
    assert all(set(w) == {"strike", "oi", "distance"} for w in report)
