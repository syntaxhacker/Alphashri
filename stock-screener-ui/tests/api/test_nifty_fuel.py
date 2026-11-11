"""Fuel-model regressions — the 2026-10-22 alert pair.

11:13  CALL UNWIND −162.5K, CE premium +5.90, spot at the DAY HIGH 22,779.
       The alert said "BUY CE 22,700 · ENTRY 179.25"; the option actually
       traded at 220.30 (+23%). The market topped 22,780.35 two minutes later.
11:44  PUT UNWIND −94.9K, PE premium +6.85, spot CLOSED BELOW the 22,697
       pivot. The market fell another 60 points.

Same 2×2 cell (unwind + premium up = writers covering); opposite trades. The
difference is the STRUCTURE: at 11:13 no level had been closed, at 11:44 the
underlying had closed below 22,697.
"""

import pytest

from api.reports_api.nifty_bursts import derive_oi_signal
from api.reports_api.nifty_fuel import (
    FUEL_FRESH_BUYERS,
    FUEL_WRITERS_COVERING,
    basis_text,
    covering_direction,
    fuel_state,
    plan_allowed,
    structure_evidence,
)

STRIKES = [
    {"strike": 22_700.0, "ce": {"ltp": 220.30, "oi": 7_448_935},
     "pe": {"ltp": 151.85, "oi": 8_340_605}},
]


def test_fuel_state_is_the_2x2():
    assert fuel_state(True, 5.9) == FUEL_FRESH_BUYERS
    assert fuel_state(True, -2.1) == "fresh_sellers"
    assert fuel_state(False, 6.85) == FUEL_WRITERS_COVERING
    assert fuel_state(False, -2.1) == "longs_liquidating"
    # An unknown premium direction is unknown — never "fresh".
    assert fuel_state(False, None) is None


def test_covering_direction_is_side_aware():
    assert covering_direction("put") == "down"
    assert covering_direction("call") == "up"


def test_covering_without_a_structure_break_has_no_plan():
    burst = {
        "id": "2026-10-22T11:13:00+05:30-call", "side": "call",
        "t": "2026-10-22T11:13:00+05:30", "delta": -162_500,
        "baseline": 20_000, "score": 8.1, "severity": "critical",
        "cumDoi": -1_861_275, "spot": 22_779.6, "tickVol": 49_583_495,
        "flow": "covering", "premChg": 5.90,
        "fuel_state": FUEL_WRITERS_COVERING, "structure": None,
    }
    assert derive_oi_signal(burst, STRIKES, 22_779.6) is None
    assert plan_allowed(FUEL_WRITERS_COVERING, None, "call") is False


def test_covering_with_a_structure_break_in_the_same_direction_keeps_the_plan():
    burst = {
        "id": "2026-10-22T11:44:00+05:30-put", "side": "put",
        "t": "2026-10-22T11:44:00+05:30", "delta": -94_900,
        "baseline": 20_000, "score": 4.7, "severity": "alert",
        "cumDoi": -886_535, "spot": 22_687.95, "tickVol": 68_325_660,
        "flow": "covering", "premChg": 6.85,
        "fuel_state": FUEL_WRITERS_COVERING,
        "structure": {"level": 22_697.0, "direction": "down", "kind": "pivot"},
        "invalidation": 22_697.0,
    }
    assert plan_allowed(FUEL_WRITERS_COVERING, burst["structure"], "put") is True
    sig = derive_oi_signal(burst, STRIKES, 22_687.95)
    assert sig is not None
    assert sig["entry"] > 0
    assert sig["sl"] < sig["entry"] < sig["target"]


def test_fresh_money_always_carries_a_plan():
    burst = {
        "id": "2026-10-22T11:44:00+05:30-call", "side": "call",
        "t": "2026-10-22T11:44:00+05:30", "delta": 186_355,
        "baseline": 20_000, "score": 9.3, "severity": "critical",
        "cumDoi": 1_204_400, "spot": 22_640.0, "tickVol": 40_000_000,
        "flow": "buyers", "premChg": 5.2,
        "fuel_state": FUEL_FRESH_BUYERS, "structure": None,
    }
    assert plan_allowed(FUEL_FRESH_BUYERS, None, "call") is True
    assert derive_oi_signal(burst, STRIKES, 22_640.0) is not None


def test_structure_evidence_needs_a_close_not_a_tick():
    rows = [
        {"t": "2026-10-22T11:40:00+05:30", "spot": 22_700.0},
        {"t": "2026-10-22T11:41:00+05:30", "spot": 22_690.0},
        {"t": "2026-10-22T11:42:00+05:30", "spot": 22_683.15},
    ]
    ev = structure_evidence(rows, "2026-10-22T11:42:00+05:30")
    assert ev is not None
    assert ev["direction"] == "down"
    assert ev["level"] == 22_690.0
    assert ev["kind"] == "day_low"
    # Before the break, nothing was closed beyond a level.
    assert structure_evidence(rows, "2026-10-22T11:40:00+05:30") is None


def test_basis_text_states_what_where_and_the_guard():
    no_break = basis_text(FUEL_WRITERS_COVERING, "call", None, 22_779.6)
    assert "WRITERS COVERING" in no_break
    assert "no level closed" in no_break
    broke = basis_text(FUEL_WRITERS_COVERING, "put",
                       {"level": 22_697.0, "direction": "down", "kind": "pivot"},
                       22_687.95)
    assert "WRITERS COVERING" in broke
    assert "22,697" in broke
    assert "structure broken" in broke


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
