"""Pure structure maths: resolution, payoff, break-evens."""

from __future__ import annotations

import math

import pytest

from options_paper.structures import (
    LegSpec,
    ResolvedLeg,
    breakevens,
    default_spot_range,
    intrinsic,
    leg_sign,
    max_profit_loss,
    net_entry_cost,
    parse_leg_spec,
    payoff_at_expiry,
    payoff_curve,
    resolve_legs,
    resolve_strike,
)

L50 = [24800.0, 24850.0, 24900.0, 24950.0, 25000.0]
L2_5 = [120.0, 122.5, 125.0, 127.5, 130.0]


def leg(action: str, opt: str, strike: float, entry: float,
        lots: int = 1, qty: int = 65) -> ResolvedLeg:
    return ResolvedLeg(action, opt, strike, lots, qty, entry)


# --------------------------------------------------------------------------
# Strike resolution
# --------------------------------------------------------------------------
def test_atm_is_nearest_and_ties_go_lower():
    assert resolve_strike("ATM", 24920, L50) == 24900.0
    # 24925 is equidistant from 24900 and 24950 -> the lower contract.
    assert resolve_strike("ATM", 24925, L50) == 24900.0
    assert resolve_strike("ATM", 24980, L50) == 25000.0


def test_atm_offsets_walk_the_ladder_not_a_fixed_step():
    assert resolve_strike("ATM+2", 24920, L50) == 25000.0
    assert resolve_strike("ATM-1", 24920, L50) == 24850.0
    # A 2.5-point stock ladder must step 2.5, not 50.
    assert resolve_strike("ATM", 124.0, L2_5) == 125.0
    assert resolve_strike("ATM-1", 124.0, L2_5) == 122.5
    assert resolve_strike("ATM+2", 124.0, L2_5) == 130.0


def test_offset_beyond_the_ladder_is_none():
    assert resolve_strike("ATM+9", 24920, L50) is None
    assert resolve_strike("ATM-9", 24920, L50) is None
    assert resolve_strike("ATM+13", 24920, L50) is None


def test_absolute_strike_must_exist_in_the_ladder():
    assert resolve_strike("24900", 24920, L50) == 24900.0
    assert resolve_strike("24925", 24920, L50) is None
    assert resolve_strike("131", 124.0, L2_5) is None


def test_empty_ladder_and_garbage_refs_are_none():
    assert resolve_strike("ATM", 24920, []) is None
    assert resolve_strike("FOO", 24920, L50) is None
    assert resolve_strike("ATM+", 24920, L50) is None


def test_parse_leg_spec_validates_and_rejects():
    spec = parse_leg_spec({"action": "buy", "opt": "ce", "strike": "ATM+1"})
    assert spec == LegSpec("BUY", "CE", "ATM+1", 1)
    assert parse_leg_spec({"action": "SELL", "opt": "PE", "strike": 24900,
                           "lots": 2}).lots == 2

    for bad in (
        {"action": "HOLD", "opt": "CE", "strike": "ATM"},
        {"action": "BUY", "opt": "XX", "strike": "ATM"},
        {"action": "BUY", "opt": "CE", "strike": ""},
        {"action": "BUY", "opt": "CE", "strike": "ATM+13"},
        {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": 0},
        {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": "x"},
    ):
        with pytest.raises(ValueError):
            parse_leg_spec(bad)


def test_resolve_legs_sets_qty_and_raises_on_missing_strike():
    legs = resolve_legs(
        [LegSpec("BUY", "CE", "ATM"), LegSpec("SELL", "CE", "ATM+1", 2)],
        spot=24920, ladder=L50, lot_size=65,
    )
    assert [l.strike for l in legs] == [24900.0, 24950.0]
    assert [l.qty for l in legs] == [65, 130]
    assert all(l.entry_premium == 0.0 for l in legs)

    with pytest.raises(ValueError):
        resolve_legs([LegSpec("BUY", "CE", "ATM+9")], 24920, L50, 65)


def test_leg_sign_only_accepts_buy_and_sell():
    assert leg_sign("BUY") == 1
    assert leg_sign("sell") == -1
    with pytest.raises(ValueError):
        leg_sign("HOLD")


# --------------------------------------------------------------------------
# Payoff
# --------------------------------------------------------------------------
def test_intrinsic_call_and_put():
    assert intrinsic("CE", 24900, 25100) == 200
    assert intrinsic("CE", 24900, 24800) == 0
    assert intrinsic("PE", 24900, 24750) == 150
    assert intrinsic("PE", 24900, 25100) == 0


def test_long_call_payoff():
    legs = [leg("BUY", "CE", 24900, 100.0)]
    assert payoff_at_expiry(legs, 25100) == pytest.approx((200 - 100) * 65)
    assert payoff_at_expiry(legs, 24800) == pytest.approx(-100 * 65)


def test_bull_call_spread_payoff_is_capped():
    legs = [leg("BUY", "CE", 24900, 100.0), leg("SELL", "CE", 25000, 50.0)]
    assert net_entry_cost(legs) == pytest.approx(50 * 65)       # a debit
    assert payoff_at_expiry(legs, 25200) == pytest.approx((300 - 100) * 65
                                                          - (200 - 50) * 65)
    assert payoff_at_expiry(legs, 25500) == pytest.approx(100 * 65 - 50 * 65)
    assert payoff_at_expiry(legs, 24900) == pytest.approx(-50 * 65)


def test_iron_condor_payoff_at_the_body_and_beyond_the_wing():
    legs = [
        leg("BUY", "PE", 24800, 20.0),
        leg("SELL", "PE", 24900, 40.0),
        leg("SELL", "CE", 25100, 45.0),
        leg("BUY", "CE", 25200, 25.0),
    ]
    # Inside the body everything expires worthless -> keep the credit.
    assert payoff_at_expiry(legs, 25000) == pytest.approx(40 * 65)   # net credit
    # Below the put wing the loss is capped at (width - credit).
    assert payoff_at_expiry(legs, 24700) == pytest.approx(-(100 - 40) * 65)
    assert payoff_at_expiry(legs, 25400) == pytest.approx(-(100 - 40) * 65)


def test_net_entry_cost_credit_is_negative():
    legs = [leg("SELL", "CE", 24900, 100.0), leg("SELL", "PE", 24900, 90.0)]
    assert net_entry_cost(legs) == pytest.approx(-190 * 65)


def test_payoff_curve_matches_spot_list():
    legs = [leg("BUY", "CE", 24900, 100.0)]
    spots = [24800, 24900, 25000, 25100]
    curve = payoff_curve(legs, spots)
    assert len(curve) == len(spots)
    assert curve == [pytest.approx(v) for v in
                     [-6500, -6500, (100 - 100) * 65, (200 - 100) * 65]]


# --------------------------------------------------------------------------
# Break-evens, range, max profit/loss
# --------------------------------------------------------------------------
def test_straddle_has_two_breakevens():
    legs = [leg("BUY", "CE", 25000, 100.0), leg("BUY", "PE", 25000, 100.0)]
    bes = breakevens(legs, 24000, 26000)
    assert len(bes) == 2
    assert bes[0] == pytest.approx(24800, abs=0.01)
    assert bes[1] == pytest.approx(25200, abs=0.01)


def test_breakevens_empty_for_no_legs_or_bad_range():
    assert breakevens([], 24000, 26000) == []
    assert breakevens([leg("BUY", "CE", 24900, 100.0)], 25000, 24000) == []


def test_default_spot_range_is_empty_without_legs_and_brackets_the_strikes():
    assert default_spot_range([]) == []
    spots = default_spot_range([leg("BUY", "CE", 24900, 100.0)])
    assert len(spots) == 161
    assert spots[0] < 24900 < spots[-1]
    assert spots[0] > 0


def test_max_profit_loss_signs_for_a_long_call():
    legs = [leg("BUY", "CE", 24900, 100.0)]
    max_profit, max_loss = max_profit_loss(legs)
    assert max_profit > 0
    assert max_loss == pytest.approx(-100 * 65)
    # The sampled maximum is the edge of the band, never infinity.
    assert math.isfinite(max_profit)
    assert max_profit_loss([]) == (0.0, 0.0)
