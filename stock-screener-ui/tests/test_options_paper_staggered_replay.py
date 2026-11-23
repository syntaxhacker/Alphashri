"""Staggered per-leg entries for the multi-day option replay (domain tests).

Each leg may carry its own ``entry_time``. The replay must mark that leg from
its OWN fill onward, never from the structure's first bar: early frames carry
no P&L and no entry costs for a leg that has not joined yet. Everything here
is in-memory — no DB, no network, no writes to experiments/data.

Run: ``source .venv/bin/activate && python -m pytest
tests/test_options_paper_staggered_replay.py -q``
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import pytest

import config
from options_paper import structures
from options_paper.costs import option_entry_cost
from options_paper.multi_day_replay import build_replay
from options_paper.replay_data import ChainQuote

IST = config.IST
BASE = datetime(2026, 11, 20, 9, 15, tzinfo=IST)  # Friday
M1 = timedelta(minutes=1)
D2 = BASE + timedelta(days=1)
D3 = BASE + timedelta(days=2)
EXPIRY = "2026-11-23"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TimedLeg(structures.ResolvedLeg):
    """Duck-typed ResolvedLeg with contract identity and an optional entry."""

    underlying: str = "IRFC"
    expiry: str = EXPIRY
    entry_time: Optional[datetime] = None


def tleg(action="BUY", opt="CE", strike=100.0, entry_time=None, qty=1,
         lots=1, premium=0.0):
    return TimedLeg(action=action, opt=opt, strike=float(strike), lots=lots,
                    qty=qty, entry_premium=float(premium),
                    entry_time=entry_time)


def mk_bars(rows):
    out = []
    for t, spot, px in rows:
        tt = t if t.tzinfo else t.replace(tzinfo=IST)
        out.append((tt.astimezone(IST), float(spot),
                    {(float(k[0]), str(k[1]).upper()):
                     (float(v[0]), bool(v[1])) for k, v in px.items()}))
    return out


def two_day_bars():
    """6 bars: leg A fills on day 1, leg B fills on day 2."""
    return mk_bars([
        (BASE,       100.0, {(100.0, "CE"): (9.0, True), (110.0, "CE"): (2.0, True)}),
        (BASE + M1,  100.0, {(100.0, "CE"): (10.0, True), (110.0, "CE"): (2.0, True)}),
        (BASE + 2*M1, 101.0, {(100.0, "CE"): (12.0, True), (110.0, "CE"): (2.0, True)}),
        (D2,         105.0, {(100.0, "CE"): (15.0, True), (110.0, "CE"): (3.0, True)}),
        (D2 + M1,    105.0, {(100.0, "CE"): (16.0, True), (110.0, "CE"): (3.0, True)}),
        (D2 + 2*M1,  106.0, {(100.0, "CE"): (17.0, True), (110.0, "CE"): (2.0, True)}),
    ])


def three_day_bars():
    """9 bars: three legs, one entering on each of three days."""
    rows = []
    for t, spot, a, b, c in [
        (BASE,       100.0, 9.0,  2.0, 1.0),
        (BASE + M1,  100.0, 10.0, 2.0, 1.0),
        (BASE + 2*M1, 101.0, 12.0, 2.0, 1.0),
        (D2,         105.0, 15.0, 3.0, 1.0),
        (D2 + M1,    105.0, 16.0, 3.0, 1.0),
        (D2 + 2*M1,  106.0, 17.0, 2.0, 1.0),
        (D3,         108.0, 18.0, 2.0, 1.0),
        (D3 + M1,    108.0, 19.0, 2.0, 2.0),
        (D3 + 2*M1,  109.0, 20.0, 1.0, 1.0),
    ]:
        rows.append((t, spot, {(100.0, "CE"): (a, True),
                               (110.0, "CE"): (b, True),
                               (120.0, "CE"): (c, True)}))
    return mk_bars(rows)


def with_gap(bars, index, key, px=0.0, priced=False):
    out = []
    for i, (t, spot, premiums) in enumerate(bars):
        pxmap = dict(premiums)
        if i == index:
            pxmap[key] = (px, priced)
        out.append((t, spot, pxmap))
    return out


class FakeProvider:
    source = "staggered-fake"

    def __init__(self, bars, series_start=None):
        self.bars = bars
        self.series_start = series_start or {}

    def chain_at(self, underlying, expiry, ts):
        prior = [b for b in self.bars if b[0] <= ts]
        if not prior:
            return None
        b = max(prior, key=lambda x: x[0])
        return ChainQuote(
            t=b[0], spot=b[1], expiry=expiry,
            ladder=tuple(sorted({k[0] for k in b[2]})),
            premiums={k: v[0] for k, v in b[2].items() if v[1]},
            source=self.source,
            gaps=sum(1 for v in b[2].values() if not v[1]),
        )

    def premium_series(self, underlying, expiry, strike, opt, from_ts, to_ts):
        lo = self.series_start.get((float(strike), str(opt).upper()))
        rows = []
        for t, _spot, px in self.bars:
            if not (from_ts <= t <= to_ts):
                continue
            if lo is not None and t < lo:
                continue
            value = px.get((float(strike), str(opt).upper()), (0.0, False))
            rows.append((t, value[0], value[1]))
        return rows


def replay(legs, bars, *, end=None, costs=False, provider=None, **kwargs):
    return build_replay(
        legs=legs, entry_ts=BASE, end_ts=end or (bars[-1][0] + M1),
        provider=provider or FakeProvider(bars), lot_size=1, costs=costs,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# 1. Two legs, one day apart — the core contract
# ---------------------------------------------------------------------------
def test_two_legs_one_day_apart_own_fill_and_active_map():
    legs = [tleg(entry_time=BASE),                         # BUY 100 CE, day 1
            tleg(action="SELL", strike=110.0, entry_time=D2)]  # day 2
    r = replay(legs, two_day_bars())

    assert r.skipped is None
    assert [l["entryPremium"] for l in r.legs] == pytest.approx([10.0, 3.0])
    assert r.fill_time == BASE + M1                 # earliest fill
    assert datetime.fromisoformat(r.frames[0]["t"]) == BASE

    # active is keyed exactly like marks, and flips at each leg's own fill
    for frame in r.frames:
        assert set(frame["active"]) == set(frame["marks"]) == {"100-CE", "110-CE"}
    active = [f["active"]["110-CE"] for f in r.frames]
    assert active == [False, False, False, False, True, True]


def test_two_legs_pnl_is_zero_until_each_legs_own_fill():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    r = replay(legs, two_day_bars())
    gross = [f["grossPnl"] for f in r.frames]

    # day 1: only leg A can contribute. day 2 signal bar still excludes leg B.
    assert gross[:4] == pytest.approx([0.0, 0.0, 2.0, 5.0])
    assert gross[4] == pytest.approx(6.0)   # B fills flat; A keeps running
    assert gross[5] == pytest.approx(8.0)   # A +7, B +1
    assert [f["netPnl"] for f in r.frames] == pytest.approx(gross)


def test_no_lookahead_later_leg_absent_from_early_frames():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    r = replay(legs, two_day_bars())

    # A naive "all legs marked from frame 0" implementation would add B's
    # (2-3) = +1 at the third frame, giving 3.0 instead of 2.0.
    assert r.frames[2]["grossPnl"] == pytest.approx(2.0)
    assert r.frames[3]["grossPnl"] == pytest.approx(5.0)
    assert r.frames[3]["active"]["110-CE"] is False
    assert r.frames[4]["grossPnl"] == pytest.approx(6.0)
    assert r.frames[4]["active"]["110-CE"] is True


# ---------------------------------------------------------------------------
# 2. Three legs over three days
# ---------------------------------------------------------------------------
def test_three_legs_over_three_days_each_joins_on_its_own_bar():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2),
            tleg(action="SELL", strike=120.0, entry_time=D3)]
    r = replay(legs, three_day_bars())

    assert r.skipped is None
    assert [l["entryPremium"] for l in r.legs] == pytest.approx([10.0, 3.0, 2.0])
    assert r.fill_time == BASE + M1
    active_b = [f["active"]["110-CE"] for f in r.frames]
    active_c = [f["active"]["120-CE"] for f in r.frames]
    assert active_b == [False, False, False, False, True, True, True, True, True]
    assert active_c == [False] * 7 + [True, True]
    gross = [f["grossPnl"] for f in r.frames]
    assert gross[:7] == pytest.approx([0.0, 0.0, 2.0, 5.0, 6.0, 8.0, 9.0])
    assert gross[7] == pytest.approx(10.0)   # C joins flat
    assert gross[8] == pytest.approx(13.0)   # A +10, B +2, C +1


# ---------------------------------------------------------------------------
# 3. Same-day later leg, late marks, naive timestamps
# ---------------------------------------------------------------------------
def test_same_day_later_leg_is_priced_only_after_its_fill():
    bars = mk_bars([
        (BASE,       100.0, {(100.0, "CE"): (9.0, True), (110.0, "CE"): (2.0, True)}),
        (BASE + M1,  100.0, {(100.0, "CE"): (10.0, True), (110.0, "CE"): (2.0, True)}),
        (BASE + 2*M1, 101.0, {(100.0, "CE"): (11.0, True), (110.0, "CE"): (2.0, True)}),
        (BASE + 3*M1, 101.0, {(100.0, "CE"): (12.0, True), (110.0, "CE"): (3.0, True)}),
        (BASE + 4*M1, 102.0, {(100.0, "CE"): (13.0, True), (110.0, "CE"): (2.0, True)}),
    ])
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=BASE + 2*M1)]
    r = replay(legs, bars)

    assert r.skipped is None
    assert [l["entryPremium"] for l in r.legs] == pytest.approx([10.0, 3.0])
    assert [f["active"]["110-CE"] for f in r.frames] == [
        False, False, False, True, True]
    assert [f["grossPnl"] for f in r.frames] == pytest.approx(
        [0.0, 0.0, 1.0, 2.0, 4.0])


def test_late_leg_with_no_early_marks_does_not_unprice_early_frames():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    provider = FakeProvider(
        two_day_bars(), series_start={(110.0, "CE"): D2})
    r = replay(legs, two_day_bars(), provider=provider)

    assert r.skipped is None
    assert all(f["priced"] is True for f in r.frames[:5])
    assert [f["grossPnl"] for f in r.frames] == pytest.approx(
        [0.0, 0.0, 2.0, 5.0, 6.0, 8.0])


def test_naive_entry_time_is_interpreted_as_ist():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2.replace(tzinfo=None))]
    aware = replay(legs, two_day_bars())

    assert aware.skipped is None
    assert [l["entryPremium"] for l in aware.legs] == pytest.approx([10.0, 3.0])
    assert [f["grossPnl"] for f in aware.frames] == pytest.approx(
        [0.0, 0.0, 2.0, 5.0, 6.0, 8.0])


# ---------------------------------------------------------------------------
# 4. Costs: incurred at each leg's own fill, independent of final marks
# ---------------------------------------------------------------------------
def test_costs_incur_at_each_legs_own_fill():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    r = replay(legs, two_day_bars(), costs=True)

    a = option_entry_cost(10.0, 1, is_short=False)["costs"]
    b = option_entry_cost(3.0, 1, is_short=True)["costs"]
    assert r.costs_total == pytest.approx(a + b, abs=0.01)

    gross = [f["grossPnl"] for f in r.frames]
    net = [f["netPnl"] for f in r.frames]
    assert net[0] == pytest.approx(0.0)      # before A fills: no cost
    assert net[1] == pytest.approx(-a, abs=0.01)       # A's fill
    assert net[2] == pytest.approx(2.0 - a, abs=0.01)  # B still not joined
    assert net[3] == pytest.approx(5.0 - a, abs=0.01)
    assert net[4] == pytest.approx(6.0 - a - b, abs=0.01)
    assert net[5] == pytest.approx(gross[5] - a - b, abs=0.01)


def test_costs_do_not_depend_on_a_future_mark():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    bars = two_day_bars()
    changed = with_gap(bars, 5, (100.0, "CE"), px=400.0, priced=True)
    changed = with_gap(changed, 5, (110.0, "CE"), px=400.0, priced=True)

    early = replay(legs, bars, costs=True)
    late = replay(legs, changed, costs=True)
    assert early.costs_total == pytest.approx(late.costs_total, abs=1e-9)
    assert early.frames[0]["netPnl"] == pytest.approx(
        late.frames[0]["netPnl"], abs=1e-9)
    assert early.frames[2]["netPnl"] == pytest.approx(
        late.frames[2]["netPnl"], abs=1e-9)
    assert late.frames[-1]["grossPnl"] != early.frames[-1]["grossPnl"]


def test_preset_entry_premium_never_overrides_recorded_fill():
    legs = [tleg(entry_time=BASE, premium=77.0),
            tleg(action="SELL", strike=110.0, entry_time=D2, premium=99.0)]
    r = replay(legs, two_day_bars())

    assert r.skipped is None
    assert [l["entryPremium"] for l in r.legs] == pytest.approx([10.0, 3.0])


# ---------------------------------------------------------------------------
# 5. Gaps, payoff, determinism, refusals, backward compatibility
# ---------------------------------------------------------------------------
def test_gap_in_active_leg_unprices_frame_but_carries_last_premium():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    bars = with_gap(two_day_bars(), 5, (100.0, "CE"))
    r = replay(legs, bars)

    gap = r.frames[5]
    assert gap["priced"] is False
    assert gap["marks"]["100-CE"] == pytest.approx(16.0)  # last print, day 2 fill
    assert gap["marks"]["110-CE"] == pytest.approx(2.0)   # still live
    assert gap["active"] == {"100-CE": True, "110-CE": True}
    assert gap["grossPnl"] == pytest.approx(7.0)          # carried premium used
    assert r.coverage["gaps"] >= 1
    assert datetime.fromisoformat(gap["t"]) in [
        datetime.fromisoformat(x) for x in r.coverage["gapList"]]


def test_payoff_uses_all_legs_with_their_final_entry_premiums():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    r = replay(legs, two_day_bars())

    assert r.net_debit == pytest.approx(7.0)
    assert r.max_profit == pytest.approx(3.0)
    assert r.max_loss == pytest.approx(-7.0)
    assert r.breakevens == pytest.approx([107.0], abs=0.05)
    # Payoff is the *final* two-leg structure, even though the path was staggered.
    final_legs = [structures.ResolvedLeg(
        action=l["action"], opt=l["opt"], strike=l["strike"],
        lots=l["lots"], qty=l["qty"], entry_premium=l["entryPremium"],
    ) for l in r.legs]
    assert structures.payoff_at_expiry(final_legs, 105.0) == pytest.approx(-2.0)
    assert r.payoff["expiry"] == pytest.approx(
        structures.payoff_curve(final_legs, r.payoff["spots"]))


def test_staggered_output_is_deterministic():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    a = replay(legs, two_day_bars(), costs=True).as_dict()
    b = replay(legs, two_day_bars(), costs=True).as_dict()
    assert a == b


def test_leg_after_last_bar_is_refused_with_leg_specific_reason():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D3 + timedelta(days=9))]
    r = replay(legs, two_day_bars())

    assert isinstance(r.frames, list) and r.frames == []
    assert r.skipped == "no fill bar for leg 110-CE"


def test_leg_unpriced_at_its_own_fill_is_refused_with_leg_specific_reason():
    legs = [tleg(entry_time=BASE),
            tleg(action="SELL", strike=110.0, entry_time=D2)]
    bars = with_gap(two_day_bars(), 4, (110.0, "CE"))  # B's fill bar
    r = replay(legs, bars)

    assert r.skipped == "leg unpriced at entry 110-CE"
    assert r.frames == []


def test_legs_without_entry_time_still_share_one_fill():
    """Backward compatibility: no ``entry_time`` means the old single entry."""
    legs = [tleg(), tleg(action="SELL", strike=110.0)]
    r = replay(legs, two_day_bars(), costs=True)

    assert r.skipped is None
    assert r.fill_time == BASE + M1
    assert [l["entryPremium"] for l in r.legs] == pytest.approx([10.0, 2.0])
    assert all(f["active"] == {"100-CE": False, "110-CE": False}
               for f in r.frames[:1])
    assert all(f["active"] == {"100-CE": True, "110-CE": True}
               for f in r.frames[1:])
    expected = sum(option_entry_cost(l["entryPremium"], l["qty"],
                                     is_short=(l["action"] == "SELL"))["costs"]
                   for l in r.legs)
    assert r.costs_total == pytest.approx(expected, abs=0.01)
    assert r.frames[-1]["netPnl"] == pytest.approx(
        r.frames[-1]["grossPnl"] - expected, abs=0.01)
