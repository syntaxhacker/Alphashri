"""Adversarial, table-driven verification of multi-leg option structures.

The oracles here are independent of the code under test: ``_hand_intrinsic``
recomputes per-leg expiry value by hand instead of calling
``structures.intrinsic``/``payoff_at_expiry``. The fake chain provider is
in-memory only — no DB, no network, no writes to experiments/data.

Run: ``source .venv/bin/activate && python -m pytest
tests/test_options_paper_multileg_verification.py -q``
"""

from __future__ import annotations

import copy
from dataclasses import FrozenInstanceError, dataclass
from datetime import datetime, timedelta

import pytest

import config
from options_paper import structures
from options_paper.costs import (
    BROKERAGE_PCT_OF_TURNOVER,
    option_entry_cost,
    option_round_trip_cost,
)
from options_paper.multi_day_replay import build_replay
from options_paper.replay_data import ChainQuote

IST = config.IST
T0 = datetime(2026, 11, 20, 9, 15, tzinfo=IST)
EXPIRY = "2026-11-23"
LADDER = [24800.0, 24850.0, 24900.0, 24950.0, 25000.0,
          25050.0, 25100.0, 25150.0, 25200.0]


# ---------------------------------------------------------------------------
# Independent oracle (deliberately NOT structures.intrinsic / payoff_*)
# ---------------------------------------------------------------------------
def _hand_intrinsic(opt: str, strike: float, spot: float) -> float:
    s, k = float(spot), float(strike)
    if str(opt).upper() == "CE":
        return s - k if s > k else 0.0
    if str(opt).upper() == "PE":
        return k - s if k > s else 0.0
    raise AssertionError(f"unknown opt {opt!r}")


def _hand_payoff(legs, spot: float) -> float:
    total = 0.0
    for leg in legs:
        sign = 1.0 if leg.action == "BUY" else -1.0
        total += sign * (_hand_intrinsic(leg.opt, leg.strike, spot)
                         - leg.entry_premium) * leg.qty
    return total


def _hand_net_cost(legs) -> float:
    return sum((1.0 if leg.action == "BUY" else -1.0)
               * leg.entry_premium * leg.qty for leg in legs)


def _resolved(row):
    action, opt, strike, premium, lots = row
    return structures.ResolvedLeg(
        action=action, opt=opt, strike=float(strike), lots=lots,
        qty=lots, entry_premium=float(premium),
    )


# name, legs (action,opt,strike,entry premium,lots), net, side, breakevens,
# max profit, max loss, unbounded tail direction.
# Premiums are per unit and qty=lots=1 except the explicit 2-lot wings.
STRUCTURES = [
    dict(name="bull call spread", side="debit", net=5.0,
         legs=[("BUY", "CE", 100, 8.0, 1), ("SELL", "CE", 110, 3.0, 1)],
         bes=[105.0], mp=5.0, ml=-5.0, unbounded=None),
    dict(name="bear put spread", side="debit", net=5.0,
         legs=[("SELL", "PE", 100, 3.0, 1), ("BUY", "PE", 110, 8.0, 1)],
         bes=[105.0], mp=5.0, ml=-5.0, unbounded=None),
    dict(name="long straddle", side="debit", net=11.0,
         legs=[("BUY", "CE", 100, 6.0, 1), ("BUY", "PE", 100, 5.0, 1)],
         bes=[89.0, 111.0], mp=39.0, ml=-11.0, unbounded="up"),
    dict(name="short strangle", side="credit", net=-5.0,
         legs=[("SELL", "PE", 90, 2.0, 1), ("SELL", "CE", 110, 3.0, 1)],
         bes=[85.0, 115.0], mp=5.0, ml=-35.0, unbounded="down"),
    dict(name="long iron condor", side="debit", net=3.0,
         legs=[("BUY", "PE", 95, 2.0, 1), ("SELL", "PE", 90, 0.5, 1),
               ("BUY", "CE", 105, 2.0, 1), ("SELL", "CE", 110, 0.5, 1)],
         bes=[92.0, 108.0], mp=2.0, ml=-3.0, unbounded=None),
    dict(name="butterfly", side="debit", net=3.0,
         legs=[("BUY", "CE", 100, 12.0, 1), ("SELL", "CE", 110, 5.0, 2),
               ("BUY", "CE", 120, 1.0, 1)],
         bes=[103.0, 117.0], mp=7.0, ml=-3.0, unbounded=None),
    dict(name="1:2 ratio spread", side="debit", net=2.0,
         legs=[("BUY", "CE", 100, 12.0, 1), ("SELL", "CE", 110, 5.0, 2)],
         bes=[102.0, 118.0], mp=8.0, ml=-32.0, unbounded="down"),
]

# Fine enough that the 0.5-spot grid hits every integer strike kink.
BAND_LO, BAND_HI = 70.0, 150.0
PROBE_SPOTS = [70.0, 85.0, 92.0, 100.0, 105.0, 108.0, 110.0,
               117.0, 125.0, 150.0]


# ---------------------------------------------------------------------------
# 1. Payoff / debit / breakevens / bounds / immutability
# ---------------------------------------------------------------------------
def test_ratio_spread_far_breakeven_is_inside_the_reported_band():
    legs = [
        _resolved(("BUY", "CE", 100, 8.0, 1)),
        _resolved(("SELL", "CE", 110, 3.0, 2)),
    ]
    default = structures.default_spot_range(legs)
    assert 118.0 > default[-1]
    expanded = structures.adaptive_spot_range(legs)
    assert expanded[-1] >= 118.0
    breakevens = structures.breakevens(legs, expanded[0], expanded[-1])
    assert any(abs(value - 118.0) < 0.5 for value in breakevens)


@pytest.mark.parametrize("case", STRUCTURES, ids=[c["name"] for c in STRUCTURES])
def test_structure_payoff_oracle_and_breakevens(case):
    legs = [_resolved(row) for row in case["legs"]]

    assert _hand_net_cost(legs) == pytest.approx(case["net"], abs=1e-9)
    assert structures.net_entry_cost(legs) == pytest.approx(case["net"], abs=1e-9)
    assert (case["net"] < 0) == (case["side"] == "credit")

    for spot in PROBE_SPOTS:
        assert structures.payoff_at_expiry(legs, spot) == pytest.approx(
            _hand_payoff(legs, spot), abs=1e-9)
    assert structures.payoff_curve(legs, PROBE_SPOTS) == pytest.approx(
        [_hand_payoff(legs, s) for s in PROBE_SPOTS], abs=1e-9)

    bes = structures.breakevens(legs, BAND_LO, BAND_HI)
    assert bes == pytest.approx(case["bes"], abs=0.05)
    for be in bes:  # every reported root really is a root under the oracle
        assert abs(_hand_payoff(legs, be)) <= 0.1


@pytest.mark.parametrize("case", STRUCTURES, ids=[c["name"] for c in STRUCTURES])
def test_structure_max_profit_loss_and_unbounded_tails(case):
    legs = [_resolved(row) for row in case["legs"]]
    mp, ml = structures.max_profit_loss(legs, BAND_LO, BAND_HI)
    assert (mp, ml) == pytest.approx((case["mp"], case["ml"]), abs=1e-6)

    if case["unbounded"] == "up":
        # No fabricated "infinity": the finite number is the band-edge payoff
        # and the caller also gets the curve. Changing that must fail here.
        assert mp == pytest.approx(_hand_payoff(legs, BAND_HI), abs=1e-9)
    if case["unbounded"] == "down":
        assert ml == pytest.approx(_hand_payoff(legs, BAND_HI), abs=1e-9)


def test_payoff_and_resolution_do_not_mutate_inputs():
    specs = [
        {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": 1},
        {"action": "SELL", "opt": "CE", "strike": "ATM+1", "lots": 2},
    ]
    specs_before = copy.deepcopy(specs)
    ladder_before = list(LADDER)
    resolved = structures.resolve_legs(specs, 24920.0, LADDER, 75)
    assert specs == specs_before and LADDER == ladder_before

    spots = list(PROBE_SPOTS)
    legs_before = list(resolved)
    structures.payoff_curve(resolved, spots)
    structures.breakevens(resolved, BAND_LO, BAND_HI)
    structures.max_profit_loss(resolved, BAND_LO, BAND_HI)
    assert spots == PROBE_SPOTS and resolved == legs_before

    with pytest.raises(FrozenInstanceError):
        resolved[0].strike = 1.0
    with pytest.raises(FrozenInstanceError):
        structures.LegSpec("BUY", "CE", "ATM").action = "SELL"


# ---------------------------------------------------------------------------
# 2. Strike resolution
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("ref,spot,expected", [
    ("ATM", 24920, 24900),       # nearest
    ("ATM", 24925, 24900),       # exact midpoint -> lower strike
    ("ATM", 24930, 24950),
    ("ATM+2", 24920, 25000),
    ("ATM-1", 24920, 24850),
    ("ATM+0", 24920, 24900),
    ("24900", 24920, 24900),     # absolute
    (" 24950 ", 24920, 24950),
])
def test_resolve_strike_resolves_real_ladder(ref, spot, expected):
    assert structures.resolve_strike(ref, spot, LADDER) == expected


@pytest.mark.parametrize("ref,spot", [
    ("ATM+13", 24920),   # beyond MAX_STRIKE_OFFSET
    ("ATM+12", 24920),   # valid ref, off the end of this ladder
    ("ATM+99", 24920),
    ("ATM-13", 24920),
    ("ATM+2.5", 24920),
    ("ATM-0", 24920),
    ("24925", 24920),    # absolute strike not in ladder
    ("0", 24920),
    ("-100", 24920),
    ("FOO", 24920),
    ("", 24920),
])
def test_resolve_strike_rejects_unavailable_or_malformed(ref, spot):
    assert structures.resolve_strike(ref, spot, LADDER) is None


def test_partial_resolution_is_refused_not_silently_completed():
    specs = [
        {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": 1},
        {"action": "SELL", "opt": "CE", "strike": "ATM+2", "lots": 1},
    ]
    ok = structures.resolve_legs(specs, 24920, LADDER, 75)
    assert [l.strike for l in ok] == [24900.0, 25000.0]
    assert [l.qty for l in ok] == [75, 75]

    broken = specs + [{"action": "BUY", "opt": "PE", "strike": "24925",
                       "lots": 1}]
    with pytest.raises(ValueError, match="not available"):
        structures.resolve_legs(broken, 24920, LADDER, 75)
    with pytest.raises(ValueError, match="lot_size"):
        structures.resolve_legs(specs, 24920, LADDER, 0)
    with pytest.raises(ValueError, match="lot_size"):
        structures.resolve_legs(specs, 24920, LADDER, -65)


@pytest.mark.parametrize("bad,field", [
    ({"action": "HOLD", "opt": "CE", "strike": "ATM"}, "action"),
    ({"action": "BUY", "opt": "XX", "strike": "ATM"}, "opt"),
    ({"action": "BUY", "opt": "CE", "strike": ""}, "strike"),
    ({"action": "BUY", "opt": "CE", "strike": "ATM+13"}, "strike"),
    ({"action": "BUY", "opt": "CE", "strike": "ATM", "lots": True}, "lots"),
    ({"action": "BUY", "opt": "CE", "strike": "ATM", "lots": "x"}, "lots"),
])
def test_parse_leg_spec_names_the_offending_field(bad, field):
    with pytest.raises(ValueError, match=field):
        structures.parse_leg_spec(bad)


@pytest.mark.parametrize("good,expected", [(1, 1), ("2", 2), (2.0, 2)])
def test_parse_leg_spec_accepts_integral_lots(good, expected):
    assert structures.parse_leg_spec(
        {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": good}
    ).lots == expected


@pytest.mark.parametrize("bad_lots", [0, -1, -3, 1.5, 2.7])
def test_parse_leg_spec_rejects_invalid_lots(bad_lots):
    with pytest.raises(ValueError, match="lots"):
        structures.parse_leg_spec(
            {"action": "BUY", "opt": "CE", "strike": "ATM", "lots": bad_lots})


# ---------------------------------------------------------------------------
# 3. Costs — per leg, per side, STT on the sell
# ---------------------------------------------------------------------------
def _assert_side_charges(side: dict, premium_value: float, is_buy: bool):
    assert side["brokerage"] == pytest.approx(
        min(30.0, premium_value * BROKERAGE_PCT_OF_TURNOVER), abs=1e-3)
    if is_buy:
        assert side["stamp"] > 0 and side["stt"] == 0
    else:
        assert side["stt"] > 0 and side["stamp"] == 0


@pytest.mark.parametrize("qty", [100, 1000])
def test_round_trip_two_leg_charges_per_leg_per_side(qty):
    # Premiums large enough that every order hits the flat ₹30 brokerage cap.
    # Below the cap charges are linear in premium value, so a combined call
    # would coincidentally equal the per-leg sum and prove nothing.
    legs = [(40.0, 30.0), (30.0, 40.0)]
    total = 0.0
    for entry, exit_px in legs:
        rc = option_round_trip_cost(entry, exit_px, qty)
        _assert_side_charges(rc["breakdown"]["buy"], rc["buy_value"], True)
        _assert_side_charges(rc["breakdown"]["sell"], rc["sell_value"], False)
        total += rc["costs"]
    combined = option_round_trip_cost(sum(x for x, _ in legs),
                                      sum(y for _, y in legs), qty)
    # Four capped orders (one per leg per side) cost more than the two a
    # single-leg model would book.
    assert total > combined["costs"]
    assert total > 0


def test_round_trip_four_leg_charges_sum_and_short_stt_on_entry_sell():
    legs = [(2.0, 1.0, False), (0.5, 0.3, True),
            (2.0, 1.0, False), (0.5, 0.3, True)]
    total = 0.0
    for entry, exit_px, is_short in legs:
        rc = option_round_trip_cost(entry, exit_px, 500, is_short=is_short)
        _assert_side_charges(rc["breakdown"]["buy"], rc["buy_value"], True)
        _assert_side_charges(rc["breakdown"]["sell"], rc["sell_value"], False)
        total += rc["costs"]
    assert total == pytest.approx(
        sum(option_round_trip_cost(e, x, 500, is_short=s)["costs"]
            for e, x, s in legs), abs=1e-9)

    # A short leg's ENTRY is a sell: STT there, stamp on the buyback.
    short_entry = option_entry_cost(0.5, 500, is_short=True)
    long_entry = option_entry_cost(2.0, 500, is_short=False)
    assert short_entry["breakdown"]["stt"] > 0
    assert short_entry["breakdown"]["stamp"] == 0
    assert long_entry["breakdown"]["stamp"] > 0
    assert long_entry["breakdown"]["stt"] == 0
    _assert_side_charges(short_entry["breakdown"], short_entry["premium_value"], False)
    _assert_side_charges(long_entry["breakdown"], long_entry["premium_value"], True)


# ---------------------------------------------------------------------------
# In-memory chain provider / replay fixtures
# ---------------------------------------------------------------------------
class FakeChainProvider:
    source = "fake-multileg"

    def __init__(self, bars):
        self.bars = []
        for t, spot, px in bars:
            tt = t if t.tzinfo else t.replace(tzinfo=IST)
            self.bars.append({
                "t": tt.astimezone(IST),
                "spot": float(spot),
                "px": {(float(k[0]), str(k[1]).upper()):
                       (float(v[0]), bool(v[1]))
                       for k, v in (px or {}).items()},
            })

    def chain_at(self, underlying, expiry, ts):
        ts = ts if ts.tzinfo else ts.replace(tzinfo=IST)
        ts = ts.astimezone(IST)
        prior = [b for b in self.bars if b["t"] <= ts]
        if not prior:
            return None
        b = max(prior, key=lambda x: x["t"])
        return ChainQuote(
            t=b["t"], spot=b["spot"], expiry=expiry,
            ladder=tuple(sorted({k[0] for k in b["px"]})),
            premiums={k: v[0] for k, v in b["px"].items() if v[1]},
            source=self.source,
            gaps=sum(1 for v in b["px"].values() if not v[1]),
        )

    def premium_series(self, underlying, expiry, strike, opt, from_ts, to_ts):
        lo = from_ts if from_ts.tzinfo else from_ts.replace(tzinfo=IST)
        hi = to_ts if to_ts.tzinfo else to_ts.replace(tzinfo=IST)
        lo, hi = lo.astimezone(IST), hi.astimezone(IST)
        out = []
        for b in self.bars:
            if lo <= b["t"] <= hi:
                px, priced = b["px"].get(
                    (float(strike), str(opt).upper()), (0.0, False))
                out.append((b["t"], px, priced))
        return out


@dataclass(frozen=True)
class DatedLeg(structures.ResolvedLeg):
    underlying: str = "TEST"
    expiry: str = EXPIRY


REPLAY_SPEC = [
    ("BUY", "PE", 95.0), ("SELL", "PE", 90.0),
    ("BUY", "CE", 105.0), ("SELL", "CE", 110.0),
]
BASE_PX = {(95.0, "PE"): 2.0, (90.0, "PE"): 0.5,
           (105.0, "CE"): 2.0, (110.0, "CE"): 0.5}
PRICED_BASE_PX = {k: (v, True) for k, v in BASE_PX.items()}


def _replay_legs(expiries=None, qty=None, lots=1):
    out = []
    for i, (action, opt, strike) in enumerate(REPLAY_SPEC):
        out.append(DatedLeg(
            action=action, opt=opt, strike=strike, lots=lots,
            qty=(lots if qty is None else qty),
            expiry=EXPIRY if expiries is None else expiries[i],
        ))
    return out


def _bars(n, start=T0, spot0=100.0, px_fn=None):
    bars = []
    for i in range(n):
        px = {k: (v + 0.01 * i, True) for k, v in BASE_PX.items()}
        if px_fn is not None:
            px = px_fn(i, px)
        bars.append((start + timedelta(minutes=i), spot0 + 0.5 * i, px))
    return bars


# ---------------------------------------------------------------------------
# 4. Replay honesty for multi-leg structures
# ---------------------------------------------------------------------------
def test_multileg_fill_is_next_bar_not_signal_bar():
    def absurd_signal(i, px):
        return {k: (999.0, True) for k in px} if i == 0 else px

    r = build_replay(_replay_legs(), T0, T0 + timedelta(minutes=3),
                     FakeChainProvider(_bars(4, px_fn=absurd_signal)),
                     lot_size=1, costs=False)
    assert r.skipped is None
    assert r.fill_time == T0 + timedelta(minutes=1)
    assert [l["entryPremium"] for l in r.legs] == pytest.approx(
        [2.01, 0.51, 2.01, 0.51], abs=1e-9)
    assert r.frames[0]["grossPnl"] == 0.0
    assert r.frames[0]["netPnl"] == 0.0


def test_multileg_marks_every_held_strike_not_the_drifting_atm():
    bars = []
    for i, (t, spot, px) in enumerate(_bars(4)):
        px[(round(spot / 5) * 5, "CE")] = (1234.0, True)  # tempting substitution
        bars.append((t, spot, px))
    r = build_replay(_replay_legs(), T0, T0 + timedelta(minutes=3),
                     FakeChainProvider(bars), lot_size=1, costs=False)
    marks = r.frames[-1]["marks"]
    assert set(marks) == {"95-PE", "90-PE", "105-CE", "110-CE"}
    assert marks["95-PE"] == pytest.approx(2.03, abs=1e-9)
    assert marks["90-PE"] == pytest.approx(0.53, abs=1e-9)
    assert marks["105-CE"] == pytest.approx(2.03, abs=1e-9)
    assert marks["110-CE"] == pytest.approx(0.53, abs=1e-9)
    assert 1234.0 not in marks.values()


def test_gap_in_one_leg_unprices_frame_but_carries_that_legs_last_premium():
    def gap_110_ce(i, px):
        if i == 2:
            px[(110.0, "CE")] = (0.0, False)
        return px

    r = build_replay(_replay_legs(), T0, T0 + timedelta(minutes=4),
                     FakeChainProvider(_bars(5, px_fn=gap_110_ce)),
                     lot_size=1, costs=False)
    assert r.skipped is None
    gap = r.frames[2]
    assert gap["priced"] is False
    assert gap["marks"]["110-CE"] == pytest.approx(0.51, abs=1e-9)  # last print
    assert gap["marks"]["105-CE"] == pytest.approx(2.02, abs=1e-9)  # still live
    assert r.coverage["gaps"] >= 1
    assert datetime.fromisoformat(gap["t"]) in [
        datetime.fromisoformat(x) for x in r.coverage["gapList"]]


def test_multileg_mixed_expiries_are_refused():
    legs = _replay_legs(expiries=[EXPIRY, EXPIRY, "2026-11-30", EXPIRY])
    r = build_replay(legs, T0, T0 + timedelta(minutes=3),
                     FakeChainProvider(_bars(4)), lot_size=1)
    assert r.skipped == "mixed expiries"
    assert r.frames == []


def test_multileg_frames_deterministic_across_two_runs():
    kwargs = dict(entry_ts=T0, end_ts=T0 + timedelta(minutes=4),
                  lot_size=25, costs=True)
    legs = _replay_legs()
    a = build_replay(legs, provider=FakeChainProvider(_bars(5)), **kwargs).as_dict()
    b = build_replay(legs, provider=FakeChainProvider(_bars(5)), **kwargs).as_dict()
    assert a == b


def test_multileg_no_weekend_bars_are_invented():
    fri = datetime(2026, 11, 20, 9, 15, tzinfo=IST)
    mon = fri + timedelta(days=3)
    # A naive calendar grid (Fri/Sat/Sun/Mon). Like the real providers, the
    # fake emits only session bars; replay must not interpolate the weekend.
    candidates = [fri + timedelta(days=d, minutes=m)
                  for d in range(4) for m in range(3)]
    session_bars = [(t, 100.0, PRICED_BASE_PX)
                    for t in candidates if t.weekday() < 5]
    r = build_replay(_replay_legs(), fri, mon + timedelta(minutes=2),
                     FakeChainProvider(session_bars), lot_size=1, costs=False)
    assert r.skipped is None
    dates = {datetime.fromisoformat(f["t"]).date() for f in r.frames}
    assert dates == {fri.date(), mon.date()}
    assert all(datetime.fromisoformat(f["t"]).weekday() < 5 for f in r.frames)


@pytest.mark.parametrize("bad_key", list(BASE_PX))
def test_multileg_zero_premium_leg_refuses_entry(bad_key):
    def dead_fill(i, px):
        if i == 1:  # the fill bar
            px[bad_key] = (0.0, True)   # flagged priced, but zero premium
        return px

    r = build_replay(_replay_legs(), T0, T0 + timedelta(minutes=3),
                     FakeChainProvider(_bars(4, px_fn=dead_fill)), lot_size=1)
    assert r.skipped == "leg unpriced at entry"


def test_multileg_very_small_positive_premium_is_accepted():
    def tiny(i, px):
        return {k: (0.05 + 0.01 * i, True) for k in px}

    r = build_replay(_replay_legs(), T0, T0 + timedelta(minutes=3),
                     FakeChainProvider(_bars(4, px_fn=tiny)),
                     lot_size=1, costs=True)
    assert r.skipped is None
    assert [l["entryPremium"] for l in r.legs] == pytest.approx([0.06] * 4,
                                                                abs=1e-9)
    assert r.costs_total > 0


def test_multileg_qty_from_lots_times_lot_size_and_explicit_qty_wins():
    kwargs = dict(entry_ts=T0, end_ts=T0 + timedelta(minutes=3),
                  provider=FakeChainProvider(_bars(4)), lot_size=50,
                  costs=False)
    implicit = build_replay(_replay_legs(lots=2, qty=0), **kwargs)
    assert [l["qty"] for l in implicit.legs] == [100] * 4
    explicit = build_replay(_replay_legs(lots=2, qty=175), **kwargs)
    assert [l["qty"] for l in explicit.legs] == [175] * 4


def test_four_leg_entry_costs_are_charged_per_leg_in_replay():
    r = build_replay(_replay_legs(), T0, T0 + timedelta(minutes=3),
                     FakeChainProvider(_bars(4)), lot_size=100, costs=True)
    assert r.skipped is None
    expected = sum(option_entry_cost(l["entryPremium"], l["qty"],
                                     is_short=(l["action"] == "SELL"))["costs"]
                   for l in r.legs)
    assert r.costs_total == pytest.approx(expected, abs=0.01)
    last = r.frames[-1]
    assert last["netPnl"] == pytest.approx(last["grossPnl"] - expected, abs=0.01)
