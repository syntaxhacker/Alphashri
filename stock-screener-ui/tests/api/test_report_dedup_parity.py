"""Dedup parity: one wall projection + one put/call ratio across the reports.

Guards the findings fixed in the report-dedup pass:

* :func:`api.reports_api._walls.as_report_walls` is the single wall projection
  used by both the Nifty and generic options reports;
* :func:`api.options_math.put_call` is the single PCR definition — the reports
  only own their presentation (rounding / sentinel), so the numbers stay
  comparable across the chain, dashboard and report payloads;
* the live report supplies its own chain as a one-point IV term map, so
  ``iv_surface.term`` is populated without a new upstream call.
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock

import pytest

import api.options_levels as levels
from api import options_positioning
from api.options_math import put_call
from api.reports_api import nifty, options_report
from api.reports_api import chain10s
from api.reports_api._walls import as_report_walls

SPOT = 1400.0

_CHAIN = [
    {"strike": 1380.0, "ce": {"oi": 100, "volume": 10, "gamma": 0.001},
     "pe": {"oi": 800, "volume": 5, "gamma": 0.001}},
    {"strike": 1400.0, "ce": {"oi": 900, "volume": 20, "gamma": 0.001},
     "pe": {"oi": 1200, "volume": 10, "gamma": 0.001}},
    {"strike": 1420.0, "ce": {"oi": 500, "volume": 30, "gamma": 0.001},
     "pe": {"oi": 200, "volume": 15, "gamma": 0.001}},
]


def _full_rows(base: float = 23500.0, n: int = 21) -> list[dict]:
    """Parsed-chain shape (greeks + prev_oi) accepted by ``_compute_live``."""
    rows = []
    for i in range(n):
        strike = float(base - (n // 2) * 50 + i * 50)
        ce_oi, pe_oi = 10_000 + i, 8_000 + i
        rows.append({
            "strike": strike,
            "ce": {"ltp": 10.0 + i, "oi": ce_oi, "prev_oi": ce_oi - 500,
                   "volume": 100, "delta": 0.4, "gamma": 0.002,
                   "iv": 12.0, "oi_change": 500,
                   "sentiment": {"type": "Neutral"}},
            "pe": {"ltp": 20.0 + i, "oi": pe_oi, "prev_oi": pe_oi - 400,
                   "volume": 90, "delta": -0.4, "gamma": 0.002,
                   "iv": 13.0, "oi_change": 400,
                   "sentiment": {"type": "Neutral"}},
        })
    return rows



def test_both_report_wall_helpers_are_the_shared_projection():
    assert nifty._as_report_walls is as_report_walls
    assert options_report._as_report_walls is as_report_walls


def test_as_report_walls_shape_and_distance():
    walls = levels.top_walls(levels.normalize_strikes(_CHAIN), "ce", spot=SPOT)
    assert as_report_walls(walls, SPOT) == [
        {"strike": w["strike"], "oi": w["oi"],
         "distance": round(w["strike"] - SPOT, 2)}
        for w in walls
    ]
    # No usable spot -> no distance key (both reports' historical behaviour).
    assert all(set(w) == {"strike", "oi"} for w in as_report_walls(walls, None))
    assert all(set(w) == {"strike", "oi"} for w in as_report_walls(walls, 0))


@pytest.mark.parametrize("side", ["ce", "pe"])
def test_nifty_and_options_report_top_walls_are_identical(side):
    # Same ranking (no band) -> both reports publish the identical row list.
    assert nifty.top_walls(_CHAIN, side, spot=SPOT) == \
        options_report.top_walls(_CHAIN, side, SPOT)


@pytest.mark.parametrize("side", ["ce", "pe"])
def test_near_walls_use_the_shared_projection_with_each_reports_own_band(side):
    # The near bands differ by design (NIFTY fixed points vs the generic
    # symbol-relative %), but both reports must project the shared ranked rows
    # through the same helper — never a second, drifting row shape.
    nifty_band = nifty.WALL_NEAR_DIST_PTS
    report_band = max(abs(SPOT) * options_report._NEAR_BAND_PCT, 1e-9)
    norm = levels.normalize_strikes(_CHAIN)

    assert nifty.near_walls(_CHAIN, side, spot=SPOT) == as_report_walls(
        levels.near_walls(norm, side, spot=SPOT, max_dist=nifty_band), SPOT)
    assert options_report.near_walls(_CHAIN, side, SPOT) == as_report_walls(
        levels.near_walls(norm, side, spot=SPOT, max_dist=report_band), SPOT)



@pytest.mark.parametrize(
    "ce,pe,expected",
    [
        (100.0, 150.0, 1.5),      # exact
        (3.0, 10.0, 10 / 3),      # raw, NOT rounded to 3.33
        (0.0, 10.0, None),        # zero call base is unknown, not 0.00
        (None, 10.0, None),
        (10.0, None, None),
        (-1.0, 10.0, None),
        (float("nan"), 10.0, None),
    ],
)
def test_put_call_is_raw_and_unrounded(ce, pe, expected):
    got = put_call(ce, pe)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)


def test_all_consumers_share_the_put_call_definition():
    assert nifty.put_call is put_call
    assert options_report.put_call is put_call
    assert options_positioning._put_call is put_call


def test_nifty_pcr_is_the_shared_ratio_rounded_at_presentation():
    for pe, ce in [(150.0, 100.0), (10.0, 3.0), (0.0, 100.0), (10.0, 0.0)]:
        raw = put_call(ce, pe)
        assert nifty.compute_pcr(pe, ce) == (
            round(raw, 2) if raw is not None else None
        )


def test_positioning_pcr_is_the_raw_shared_ratio():
    rows = [
        {"strike": 100.0,
         "ce": {"market_data": {"oi": 100, "volume": 10}},
         "pe": {"market_data": {"oi": 150, "volume": 20}}},
        {"strike": 101.0,
         "ce": {"market_data": {"oi": 100, "volume": 10}},
         "pe": {"market_data": {"oi": 50, "volume": 15}}},
    ]
    block = options_positioning.positioning_block(rows, SPOT)
    assert block["pcr"] == put_call(200, 200)      # 1.0
    assert block["pcrVolume"] == put_call(20, 35)  # raw 1.75
    zero = [{"strike": 100.0,
             "ce": {"market_data": {"oi": 0, "volume": 0}},
             "pe": {"market_data": {"oi": 10, "volume": 7}}}]
    empty = options_positioning.positioning_block(zero, SPOT)
    assert empty["pcr"] is None
    assert empty["pcrVolume"] is None


def test_options_report_pcr_vol_keeps_its_zero_sentinel():
    strikes = [{"strike": 100.0,
                "ce": {"oi": 1, "volume": 0},
                "pe": {"oi": 1, "volume": 7}}]
    # 0 call volume -> shared helper returns None -> report keeps its 0.0.
    assert options_report.compute_pcr_vol(strikes) == 0.0
    strikes[0]["ce"]["volume"] = 4
    assert options_report.compute_pcr_vol(strikes) == round(put_call(4, 7), 2)



def test_self_iv_expiries_builds_a_one_point_map():
    rows = [{"strike": 1.0}]
    assert nifty._self_iv_expiries("2026-11-19", rows) == {"2026-11-19": rows}
    assert nifty._self_iv_expiries(None, rows) == {}
    assert nifty._self_iv_expiries("  ", rows) == {}


async def test_compute_live_supplies_own_chain_when_no_map_given(monkeypatch):
    """No caller map -> the cached chain is forwarded as a one-point term map."""
    rows = _full_rows()
    monkeypatch.setattr(chain10s, "LAST_FULL", {
        "ts": time.time(), "spot": 23500.0,
        "expiry": "2026-11-19", "rows": rows,
    })
    seen: dict = {}

    async def fake_attach(report, chain_rows, spot, for_date, expiries=None):
        seen["expiries"] = expiries

    monkeypatch.setattr(nifty, "_attach_verdicts", fake_attach)
    monkeypatch.setattr(nifty, "get_pivots_block", AsyncMock(return_value=None))

    await nifty._compute_live(None, with_candles=False)

    assert seen["expiries"] == {"2026-11-19": rows}
