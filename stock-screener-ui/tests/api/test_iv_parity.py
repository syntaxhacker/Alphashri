"""One chain, one set of numbers across the IV consumers.

``options_iv`` is the analytics engine, ``iv_surface`` the report block, and the
frontend helper reads the same payload (its parity lives in
``NiftyIvSkew.parity.test.tsx`` with the identical chain). The fixture has an
exact 0.25-delta leg on each wing and a two-sided ATM strike so every algorithm
can be compared on a value, not on a missing-data sentinel.
"""

import pytest

import api.options_iv as iv
from api.reports_api import iv_surface

SPOT = 23_000.0

#: strike -> (ce delta, ce iv, pe delta, pe iv)
CHAIN = {
    22_700.0: (0.85, 17.0, -0.15, 13.0),
    22_800.0: (0.75, 16.0, -0.25, 14.0),
    22_900.0: (0.65, 15.0, -0.35, 15.0),
    23_000.0: (0.50, 14.0, -0.50, 16.0),
    23_100.0: (0.35, 13.0, -0.65, 17.0),
    23_200.0: (0.25, 12.0, -0.75, 18.0),
    23_300.0: (0.15, 11.0, -0.85, 19.0),
}


def _rows():
    return [
        {"strike": strike,
         "ce": {"ltp": 120, "iv": ce_iv, "delta": ce_d, "oi": 1000},
         "pe": {"ltp": 120, "iv": pe_iv, "delta": pe_d, "oi": 1000}}
        for strike, (ce_d, ce_iv, pe_d, pe_iv) in sorted(CHAIN.items())
    ]


def test_atm_iv_matches_between_engine_and_report():
    points = iv.leg_points(_rows())
    assert iv.atm_iv(points, SPOT) == pytest.approx(15.0)
    assert iv_surface.iv_summary(_rows(), SPOT)["atm"]["avg_iv"] == pytest.approx(15.0)
    # The verdicts' lighter-weight entry point must read the same block.
    block = iv_surface.atm_block(_rows(), SPOT)
    assert block["avg_iv"] == pytest.approx(15.0)
    assert (block["ce_iv"], block["pe_iv"]) == (14.0, 16.0)


def test_25d_wings_and_rr_match_between_engine_and_report():
    rows = _rows()
    points = iv.leg_points(rows)
    rr = iv.rr25(points, atm=15.0)
    surface = iv_surface.iv_summary(rows, SPOT)

    assert rr["call"] == pytest.approx(12.0)
    assert rr["put"] == pytest.approx(14.0)
    assert surface["skew"]["ce_25d_iv"] == pytest.approx(rr["call"])
    assert surface["skew"]["pe_25d_iv"] == pytest.approx(rr["put"])
    # Both publish CE − PE: negative here because puts are richer.
    assert surface["skew"]["skew_25d"] == pytest.approx(rr["rr"])
    assert rr["rr"] == pytest.approx(-2.0)


def test_report_wing_delegates_to_the_shared_helper():
    rows = _rows()
    points = iv.leg_points(rows)
    surface = iv_surface.iv_summary(rows, SPOT)

    for side, target in (("CE", 0.25), ("PE", -0.25)):
        strike, value = iv.wing_iv(
            points, side, target=abs(target),
            delta_band=iv_surface.DELTA_BAND,
        )
        key = "ce_25d_iv" if side == "CE" else "pe_25d_iv"
        assert surface["skew"][key] == pytest.approx(value)
        assert strike in CHAIN


def test_iv_upper_bound_is_100_in_every_consumer():
    assert iv.IV_MAX == iv.MAX_IV == 100.0
    assert iv_surface.IV_MAX == 100.0
    assert iv_surface.IV_MIN == 1.0

    # A dead strike's 281% print is not a 25-delta wing in either path.
    artefact = {"strike": 23_200.0, "side": "CE", "delta": 0.25,
                "iv": 281.25, "oi": 1000}
    # The wing is named (so a caller can see which strike is dead) but its IV
    # is withheld — the same behaviour the report block has always had.
    assert iv.wing_iv([artefact], "CE") == (23_200.0, None)
    assert iv.interp_iv_by_delta([artefact], 0.25, "CE") is None
    surface = iv_surface.iv_summary(
        [{"strike": 23_200.0,
          "ce": {"iv": 281.25, "delta": 0.25, "oi": 1000},
          "pe": {"iv": 13.0, "delta": -0.75, "oi": 1000}}],
        SPOT,
    )
    assert surface["skew"]["ce_25d_iv"] is None
