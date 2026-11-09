"""No-lookahead simulator: fill timing, exit priority, marks, ledger shape."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from options_paper.structure_engine import ExecSpec, run_specs
from options_paper.structures import LegSpec
from options_paper.tape import Tick

IST = ZoneInfo("Asia/Kolkata")
EXPIRY = "2026-11-12"


def tick(hhmm: str, spot: float, chain: dict | None = None,
         atm: float = 24900.0) -> Tick:
    hh, mm = (int(x) for x in hhmm.split(":"))
    chain = chain or {}
    ce, pe = chain.get(int(atm), (0.0, 0.0))
    return Tick(
        t=datetime(2026, 11, 9, hh, mm, tzinfo=IST),
        spot=spot,
        atm_strike=atm,
        ce_ltp=ce,
        pe_ltp=pe,
        ce_iv=0.15,
        pe_iv=0.15,
        expiry=EXPIRY,
        chain=chain,
    )


def spec(legs: list[LegSpec], sid: str = "s1", **kw) -> ExecSpec:
    return ExecSpec(id=sid, name=kw.pop("name", sid.upper()), legs=legs, **kw)


def buy_ce(**kw) -> ExecSpec:
    return spec([LegSpec("BUY", "CE", "ATM")], **kw)


# --------------------------------------------------------------------------
# No lookahead
# --------------------------------------------------------------------------
def test_entry_fills_on_the_next_bar_not_the_signal_bar():
    ticks = [
        tick("09:30", 24900, {24900: (999.0, 999.0)}),
        tick("09:35", 24900, {24900: (50.0, 40.0)}),   # signal bar price must be ignored
        tick("09:36", 24901, {24900: (100.0, 90.0)}),  # fill
        tick("09:37", 24901, {24900: (100.0, 90.0)}),
    ]
    result = run_specs([buy_ce(entry_time="09:35")], ticks, lot_size=65,
                       costs=False)[0]

    assert result.skipped is None
    assert len(result.open) == 1
    assert result.open[0]["entryTime"] == ticks[2].t.isoformat()
    assert result.open[0]["entrySpot"] == pytest.approx(24901)
    assert result.open[0]["entryPremium"] == pytest.approx(100)
    assert result.legs[0]["entryPremium"] == pytest.approx(100)


def test_ticks_are_sorted_and_minutes_deduped_to_the_latest_row():
    early = tick("09:35", 24900, {24900: (50.0, 40.0)})
    first = tick("09:36", 24900, {24900: (100.0, 90.0)})
    latest = Tick(
        t=datetime(2026, 11, 9, 9, 36, 40, tzinfo=IST),
        spot=24900, atm_strike=24900, ce_ltp=120.0, pe_ltp=100.0,
        ce_iv=0.15, pe_iv=0.15, expiry=EXPIRY,
        chain={24900: (120.0, 100.0)},
    )
    # Deliberately out of order: the latest row of 09:36 must win.
    result = run_specs([buy_ce(entry_time="09:35")],
                       [latest, first, early], 65, costs=False)[0]
    assert len(result.equity) == 2
    assert result.equity[0]["t"] == early.t.isoformat()
    assert result.open[0]["entryTime"] == latest.t.isoformat()
    assert result.open[0]["entryPremium"] == pytest.approx(120)


def test_no_fill_bar_is_skipped_without_raising():
    ticks = [tick("09:35", 24900, {24900: (100.0, 90.0)})]
    result = run_specs([buy_ce(entry_time="16:00")], ticks, 65)[0]
    assert result.skipped == "no fill bar"
    assert result.trades == []
    assert len(result.equity) == len(ticks)


def test_missing_strike_is_skipped():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
    ]
    s = spec([LegSpec("BUY", "CE", "ATM+3")])
    assert run_specs([s], ticks, 65)[0].skipped == "strike unavailable"


def test_unpriced_entry_leg_is_skipped():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (0.0, 90.0)}),
    ]
    result = run_specs([buy_ce()], ticks, 65)[0]
    assert result.skipped == "leg unpriced at entry"
    assert result.trades == []


# --------------------------------------------------------------------------
# Exit priority
# --------------------------------------------------------------------------
def test_target_is_not_taken_on_the_fill_bar():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),   # fill
        tick("09:37", 24900, {24900: (170.0, 160.0)}),  # +70% -> target
    ]
    result = run_specs([buy_ce(tp_pct=60)], ticks, 65, costs=False)[0]
    trade = result.trades[0]
    assert trade["exitTime"] == ticks[2].t.isoformat()
    assert trade["exitTime"] != ticks[1].t.isoformat()
    assert trade["exitReason"] == "TARGET"


def test_stop_is_checked_before_trail_and_target():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24900, {24900: (60.0, 50.0)}),    # -40%: stop and trail both qualify
    ]
    result = run_specs([buy_ce(sl_pct=30, tp_pct=60, trail_pct=5)],
                       ticks, 65, costs=False)[0]
    assert result.trades[0]["exitReason"] == "STOP"


def test_target_books_the_target_not_the_overshoot():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24900, {24900: (250.0, 240.0)}),  # +150% vs a 60% target
    ]
    result = run_specs([buy_ce(tp_pct=60)], ticks, 65, costs=False)[0]
    trade = result.trades[0]
    risk_basis = 100 * 65
    assert trade["grossPnl"] == pytest.approx(0.60 * risk_basis)
    assert trade["grossPnl"] < (250 - 100) * 65


def test_eod_flatten_wins_over_the_hold_clock():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("15:10", 24900, {24900: (100.0, 90.0)}),
    ]
    result = run_specs([buy_ce(max_hold_min=60, eod_exit="15:10")],
                       ticks, 65, costs=False)[0]
    assert result.trades[0]["exitReason"] == "EOD"
    assert result.trades[0]["exitTime"] == ticks[2].t.isoformat()


def test_max_hold_exits_on_the_clock():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:41", 24900, {24900: (100.0, 90.0)}),
        tick("10:30", 24900, {24900: (100.0, 90.0)}),
    ]
    result = run_specs([buy_ce(max_hold_min=5)], ticks, 65, costs=False)[0]
    trade = result.trades[0]
    assert trade["exitReason"] == "MAX_HOLD"
    assert trade["exitTime"] == ticks[2].t.isoformat()
    assert trade["holdMin"] == pytest.approx(5.0)


# --------------------------------------------------------------------------
# Marks
# --------------------------------------------------------------------------
def test_dead_leg_carries_its_last_price_and_never_uses_the_new_atm():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 25005, {}, atm=25000.0),
        tick("09:38", 25010, {25000: (60.0, 50.0)}, atm=25000.0),
    ]
    result = run_specs([buy_ce(max_hold_min=1000)], ticks, 65, costs=False)[0]
    mark = result.open[0]
    assert mark["priced"] is True
    assert mark["legs"][0]["mark"] == pytest.approx(100.0)
    assert mark["markTime"] == ticks[-1].t.isoformat()
    assert mark["grossPnl"] == pytest.approx(0.0)


def test_open_position_is_marked_at_the_as_of_tick():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24910, {24900: (115.0, 80.0)}),
        tick("09:38", 24920, {24900: (130.0, 70.0)}),
    ]
    result = run_specs([buy_ce()], ticks, 65, costs=False)[0]
    assert result.trades == []
    assert len(result.open) == 1
    mark = result.open[0]
    assert mark["markTime"] == ticks[-1].t.isoformat()
    assert mark["markPremium"] == pytest.approx(130.0)
    assert mark["grossPnl"] == pytest.approx(30 * 65)
    assert result.realized == 0
    assert result.unrealized == pytest.approx(30 * 65)
    assert result.total == pytest.approx(30 * 65)
    assert result.equity[-1]["pnl"] == pytest.approx(30 * 65)


# --------------------------------------------------------------------------
# Costs, ledger, multi-spec
# --------------------------------------------------------------------------
def test_costs_reduce_net_pnl_but_not_gross():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24900, {24900: (130.0, 120.0)}),
        tick("09:38", 24900, {24900: (170.0, 160.0)}),
    ]
    free = run_specs([buy_ce()], ticks, 65, costs=False)[0].trades[0]
    charged = run_specs([buy_ce()], ticks, 65, costs=True)[0].trades[0]
    assert charged["grossPnl"] == pytest.approx(free["grossPnl"])
    assert charged["costs"] > 0
    assert free["costs"] == 0
    assert charged["netPnl"] == pytest.approx(charged["grossPnl"] - charged["costs"])
    assert charged["netPnl"] < free["netPnl"]


def test_equity_ends_at_realized_after_exit():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24900, {24900: (170.0, 160.0)}),
        tick("09:38", 24900, {24900: (120.0, 110.0)}),
        tick("09:40", 24900, {24900: (100.0, 90.0)}),
    ]
    result = run_specs([buy_ce(tp_pct=60)], ticks, 65, costs=True)[0]
    assert len(result.equity) == len(ticks)
    assert result.equity[-1]["pnl"] == pytest.approx(result.realized)
    assert result.total == pytest.approx(result.realized)


def test_credit_structure_has_negative_debit_and_margin():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24900, {24900: (100.0, 90.0)}),
    ]
    s = spec([LegSpec("SELL", "CE", "ATM"), LegSpec("SELL", "PE", "ATM")],
             max_hold_min=1000)
    result = run_specs([s], ticks, 65, costs=False)[0]
    assert result.net_debit == pytest.approx(-190 * 65)
    assert result.margin_est > 0
    assert result.legs == [
        {"action": "SELL", "opt": "CE", "strike": 24900.0,
         "lots": 1, "qty": 65, "entryPremium": 100.0},
        {"action": "SELL", "opt": "PE", "strike": 24900.0,
         "lots": 1, "qty": 65, "entryPremium": 90.0},
    ]


def test_specs_run_independently_and_keep_input_order():
    ticks = [
        tick("09:35", 24900, {24900: (100.0, 90.0)}),
        tick("09:36", 24900, {24900: (100.0, 90.0)}),
        tick("09:37", 24900, {24900: (100.0, 90.0)}),
    ]
    results = run_specs(
        [buy_ce(sid="a"), spec([LegSpec("BUY", "PE", "ATM")], sid="b")],
        ticks, 65, costs=False,
    )
    assert [r.id for r in results] == ["a", "b"]
    assert [r.legs[0]["opt"] for r in results] == ["CE", "PE"]


def test_as_dict_has_exactly_the_contract_keys():
    ticks = [tick("09:35", 24900, {24900: (100.0, 90.0)}),
             tick("09:36", 24900, {24900: (100.0, 90.0)})]
    payload = run_specs([buy_ce()], ticks, 65)[0].as_dict()
    assert set(payload) == {
        "id", "name", "legs", "netDebit", "maxProfit", "maxLoss",
        "breakevens", "marginEst", "trades", "open", "realized",
        "unrealized", "total", "stats", "equity", "payoff", "skipped",
    }
    assert set(payload["stats"]) == {
        "trades", "winRate", "profitFactor", "avgHoldMin", "maxDrawdown",
    }
    assert set(payload["payoff"]) == {"spots", "expiry"}
    assert len(payload["payoff"]["spots"]) == len(payload["payoff"]["expiry"])


def test_empty_ticks_return_a_skipped_result_not_an_exception():
    result = run_specs([buy_ce()], [], 65)[0]
    assert result.skipped == "no ticks"
    assert result.stats["trades"] == 0
    assert result.equity == []
