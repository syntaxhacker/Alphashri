"""Tests for the greeks, panel and week-simulation layers.

Run: ``source .venv/bin/activate && python -m pytest tests/test_options_paper_sim.py -q``

The greeks tests are pure maths (no data). The panel/sim tests touch the repo's
recorded option panel and ``skip`` cleanly when it is absent, so the suite stays
green on a machine without the research data.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from options_paper import greeks as G
from options_paper import panel, sim
from options_paper.strategies import NiftyIVDelta, Position, Trade
from options_paper.tape import Tick

HAVE_PANEL = bool(panel.contract_index())


# --------------------------------------------------------------------------
# greeks — pure maths
# --------------------------------------------------------------------------
def test_black76_put_call_parity():
    f, k, t, sig, r = 23500.0, 23500.0, 14 / 365, 0.12, 0.065
    c = G.black76(f, k, t, sig, "CE", r)
    p = G.black76(f, k, t, sig, "PE", r)
    disc = __import__("math").exp(-r * t)
    assert c - p == pytest.approx(disc * (f - k), abs=1e-6)


def test_implied_vol_round_trips():
    f, k, t, sig = 23500.0, 23600.0, 21 / 365, 0.155
    price = G.black76(f, k, t, sig, "CE")
    assert G.implied_vol(price, f, k, t, "CE") == pytest.approx(sig, abs=2e-4)


def test_implied_forward_recovers_parity_forward():
    k, t, r, f = 23000.0, 10 / 365, 0.065, 23150.0
    c = G.black76(f, k, t, 0.14, "CE", r)
    p = G.black76(f, k, t, 0.14, "PE", r)
    assert G.implied_forward(k, c, p, t, r) == pytest.approx(f, abs=1e-6)


def test_implied_forward_none_without_both_legs():
    assert G.implied_forward(23000, 100.0, 0.0, 10 / 365) is None


def test_greeks_signs_and_parity():
    f, k, t, sig = 23500.0, 23500.0, 14 / 365, 0.12
    ce = G.greeks(G.black76(f, k, t, sig, "CE"), f, k, t, "CE")
    pe = G.greeks(G.black76(f, k, t, sig, "PE"), f, k, t, "PE")
    assert ce is not None and pe is not None
    assert ce.delta > 0 > pe.delta
    assert ce.gamma > 0 and pe.gamma > 0
    assert ce.vega > 0 and ce.theta < 0
    # delta_call - delta_put == e^{-rT} for a European option
    assert (ce.delta - pe.delta) == pytest.approx(1.0, abs=5e-3)


def test_implied_vol_none_on_arbitrage_print():
    # a price far below intrinsic is stale/arb -> None, never a silent number
    assert G.implied_vol(1.0, 25000.0, 23000.0, 10 / 365, "CE") is None


def test_attribute_budget_balances():
    f, k, t, sig, r = 23500.0, 23500.0, 14 / 365, 0.12, 0.065
    prem_e = G.black76(f, k, t, sig, "CE", r)
    prem_x = G.black76(f + 40, k, t - 0.5 / 365, sig + 0.01, "CE", r)
    a = G.attribute(prem_e, prem_x, 23500, 23540, sig, sig + 0.01, f, k,
                    t, t - 0.5 / 365, "CE", 30.0)
    assert a is not None
    # the four greek terms plus the residual must reconstruct the actual move
    assert a.explained + a.residual == pytest.approx(a.actual, abs=1e-9)


def test_attribute_short_flips_sign():
    f, k, t, sig = 23500.0, 23500.0, 14 / 365, 0.12
    prem_e = G.black76(f, k, t, sig, "CE")
    prem_x = G.black76(f + 50, k, t, sig, "CE")
    long_a = G.attribute(prem_e, prem_x, 23500, 23550, sig, sig, f, k, t, t, "CE", 30)
    short_a = G.attribute(prem_e, prem_x, 23500, 23550, sig, sig, f, k, t, t, "CE", 30,
                          short=True)
    assert long_a.actual == pytest.approx(-short_a.actual, abs=1e-9)


# --------------------------------------------------------------------------
# panel
# --------------------------------------------------------------------------
@pytest.mark.skipif(not HAVE_PANEL, reason="recorded option panel not present")
def test_contract_index_and_expiries():
    ci = panel.contract_index()
    assert len(ci) > 100
    assert all(isinstance(k[0], date) and isinstance(k[1], int) for k in ci)
    assert panel.expiries() == tuple(sorted(panel.expiries()))


@pytest.mark.skipif(not HAVE_PANEL, reason="recorded option panel not present")
def test_t_years_positive_and_shrinks_intraday():
    exp = date(2026, 9, 29)
    a = panel._t_years(datetime(2026, 9, 15, 9, 15), exp)
    b = panel._t_years(datetime(2026, 9, 15, 15, 15), exp)
    assert a > b > 0


@pytest.mark.skipif(not HAVE_PANEL, reason="recorded option panel not present")
def test_build_ticks_priced_day():
    d = date(2026, 9, 15)
    if not panel._contracts_on(d, panel.nearest_expiry(d)):
        pytest.skip("no contracts that day")
    ticks = panel.build_ticks(d)
    assert ticks, "expected at least some priced minutes"
    t = ticks[0]
    assert t.spot > 0 and t.ce_ltp > 0 and t.pe_ltp > 0
    assert t.atm_strike % 50 == 0
    assert t.expiry == panel.nearest_expiry(d).isoformat()


# --------------------------------------------------------------------------
# sim helpers
# --------------------------------------------------------------------------
def _mk_trade(strategy="nifty_momentum", opt="CE", direction="LONG", strike=23500.0,
              expiry="2026-09-29", entry=datetime(2026, 9, 15, 10, 0),
              exit_=datetime(2026, 9, 15, 10, 30)) -> Trade:
    return Trade(
        strategy=strategy, underlying="NIFTY", symbol=f"NIFTY26SEP{int(strike)}CE",
        opt=opt, direction=direction, lots=1, lot=65, qty=65, expiry=expiry,
        entry_time=entry.isoformat(), entry_premium=200.0, entry_spot=23500.0,
        exit_time=exit_.isoformat(), exit_premium=210.0, exit_spot=23560.0,
        exit_reason="TP", hold_min=30.0, gross_pnl=650.0, costs=120.0,
        net_pnl=530.0, points=8.15, reason="test", strike=strike)


def test_trade_greeks_returns_budget_balanced_row():
    ticks = []
    for i in range(60):
        ticks.append(__import__("options_paper.tape", fromlist=["Tick"]).Tick(
            t=datetime(2026, 9, 15, 9, 40) + timedelta(minutes=i),
            spot=23500 + i, atm_strike=23500.0, ce_ltp=200 + i, pe_ltp=190 - i,
            ce_iv=0.12, pe_iv=0.13, expiry="2026-09-29"))
    tr = _mk_trade()
    g = sim.trade_greeks(tr, ticks)
    assert set(g) >= {"entry_delta", "entry_gamma", "entry_theta", "entry_vega",
                      "delta_pnl", "gamma_pnl", "theta_pnl", "vega_pnl",
                      "residual", "attrib_actual"}
    assert g["entry_delta"] > 0          # long call
    assert g["delta_pnl"] + g["gamma_pnl"] + g["theta_pnl"] + g["vega_pnl"] \
        + g["residual"] == pytest.approx(g["attrib_actual"], abs=1e-6)


def test_trade_greeks_blank_without_ticks():
    g = sim.trade_greeks(_mk_trade(), [])
    assert g["entry_delta"] == 0.0 and g["residual"] == 0.0


def test_payoff_line_math_and_alignment():
    tr = _mk_trade(opt="CE", direction="LONG", strike=23500.0)
    tr.entry_premium = 200.0
    run = sim.DayRun(date="2026-09-15", expiry="2026-09-29", dte=14,
                     coverage_pct=100.0, spot_open=23500.0, spot_close=23550.0,
                     spot_lo=23400.0, spot_hi=23600.0, ticks=[], trades=[tr])
    pay = sim._payoff_lines([run])
    assert pay["expiries"], "expected one payoff panel"
    panel0 = pay["expiries"][0]
    line = panel0["lines"][0]
    assert len(line["pnl"]) == len(panel0["spot_grid"])
    lo, hi = panel0["spot_grid"][0], panel0["spot_grid"][-1]
    assert lo <= 23500 <= hi                 # grid spans the strike
    # at the strike a long call's expiry payoff is minus the premium, x qty
    idx = panel0["spot_grid"].index(23500)
    assert line["pnl"][idx] == pytest.approx(-200.0 * tr.qty, abs=1.0)


def test_short_straddle_payoff_max_profit_at_strike():
    tr = _mk_trade(opt="STRADDLE", direction="SHORT", strike=23500.0)
    tr.entry_premium = 500.0
    run = sim.DayRun(date="2026-09-15", expiry="2026-09-29", dte=14,
                     coverage_pct=100.0, spot_open=23500.0, spot_close=23500.0,
                     spot_lo=23400.0, spot_hi=23600.0, ticks=[], trades=[tr])
    line = sim._payoff_lines([run])["expiries"][0]["lines"][0]
    grid = sim._payoff_lines([run])["expiries"][0]["spot_grid"]
    assert line["pnl"][grid.index(23500)] == pytest.approx(500.0 * tr.qty, abs=1.0)


def test_build_screen_empty_is_safe():
    screen = sim.build_screen([], lots=1, generated_at="2026-10-18T00:00:00")
    for key in ("meta", "totals", "by_strategy", "equity", "payoff",
                "greeks_series", "attribution", "trades", "charts", "days", "caveats"):
        assert key in screen
    assert screen["totals"]["n_trades"] == 0
    assert screen["payoff"]["expiries"] == []
    # must serialise without error
    import json
    json.dumps(screen)


def test_build_screen_has_no_nan_in_json():
    import json
    tr = _mk_trade()
    ticks = []
    from options_paper.tape import Tick
    for i in range(40):
        ticks.append(Tick(t=datetime(2026, 9, 15, 9, 40) + timedelta(minutes=i),
                          spot=23500 + i, atm_strike=23500.0, ce_ltp=200 + i,
                          pe_ltp=190 - i, ce_iv=0.12, pe_iv=0.13,
                          expiry="2026-09-29"))
    tr.entry_time = ticks[20].t.isoformat()
    tr.exit_time = ticks[35].t.isoformat()
    run = sim.DayRun(date="2026-09-15", expiry="2026-09-29", dte=14,
                     coverage_pct=100.0, spot_open=23500.0, spot_close=23550.0,
                     spot_lo=23400.0, spot_hi=23600.0, ticks=ticks, trades=[tr])
    payload = json.dumps(sim.build_screen([run], lots=1))
    assert "NaN" not in payload and "Infinity" not in payload
    assert "-Infinity" not in payload


@pytest.mark.skipif(not HAVE_PANEL, reason="recorded option panel not present")
def test_window_keeps_trade_and_caps_context():
    times = [datetime(2026, 9, 15, 9, 15) + timedelta(minutes=i) for i in range(400)]
    lo, hi, i0, i1 = sim._window(times, times[200], times[210], pad=40, cap=30)
    assert lo <= i0 and i1 <= hi      # the trade is always inside the window
    assert hi - lo <= 30              # and the window is capped


def test_position_marks_at_entry_strike_not_drifting_atm():
    """Regression: a 23400PE must mark at 23400, even after the ATM moves to 23350."""
    from options_paper.tape import Tick
    ticks = [
        Tick(t=datetime(2026, 9, 21, 9, 30), spot=23402.9, atm_strike=23400,
             ce_ltp=157.05, pe_ltp=145.05, ce_iv=0.11, pe_iv=0.11,
             expiry="2026-09-29",
             chain={23400: (157.05, 145.05), 23350: (167.70, 133.15)}),
        Tick(t=datetime(2026, 9, 21, 10, 30), spot=23368.1, atm_strike=23350,
             ce_ltp=167.70, pe_ltp=133.15, ce_iv=0.11, pe_iv=0.11,
             expiry="2026-09-29",
             chain={23400: (139.85, 155.75), 23350: (167.70, 133.15)}),
    ]
    pos = Position(strategy="s", underlying="NIFTY", expiry="2026-09-29",
                   opt="PE", direction="LONG", lots=1, lot=65, qty=65,
                   entry_index=0, fill_index=0, entry_time=ticks[0].t,
                   entry_premium=145.05, entry_spot=23402.9,
                   entry_ce=157.05, entry_pe=145.05, strike=23400.0)
    # the ATM PE is 133.15 at exit, but the contract actually held is 155.75
    assert pos.premium_at(ticks[1]) == 155.75
    # and a straddle must price both legs at the entry strike
    pos.opt = "STRADDLE"
    assert pos.premium_at(ticks[1]) == 139.85 + 155.75


def _t_years_at(t: datetime, expiry="2026-09-29") -> float:
    exp = datetime.fromisoformat(expiry)
    exp = exp.replace(hour=15, minute=30)
    return max((exp - t).total_seconds() / (365 * 24 * 3600), 15 / (60 * 24 * 365))


def _chain_tick(t: datetime, spot: float, iv: float, expiry="2026-09-29") -> Tick:
    """A synthetic but internally-consistent chain (Black-76 at ``iv``)."""
    ty = _t_years_at(t, expiry)
    atm = int(round(spot / 50) * 50)
    chain = {}
    for k in range(atm - 300, atm + 301, 50):
        chain[k] = (G.black76(spot, k, ty, iv, "CE"),
                    G.black76(spot, k, ty, iv, "PE"))
    return Tick(t=t, spot=spot, atm_strike=atm, ce_ltp=chain[atm][0],
                pe_ltp=chain[atm][1], ce_iv=iv, pe_iv=iv, expiry=expiry,
                chain=chain)


def test_iv_delta_picks_a_delta_selected_strike_not_atm():
    """With cheap, flat IV and an up-move, it buys a CE with delta ~0.40, OTM."""
    t0 = datetime(2026, 9, 21, 10, 0)
    ticks = [_chain_tick(t0 + timedelta(minutes=i), 23400 + i * 1.5, 0.12)
             for i in range(40)]
    s = NiftyIVDelta(target_delta=0.40, trend_window=15, trend_min_pct=0.05,
                     cooldown_min=15, max_hold_min=400)
    trades = s.run(ticks, {})
    assert trades, "expected the IV/delta strategy to trade"
    tr = trades[0]
    assert tr.opt == "CE" and tr.direction == "LONG"
    assert tr.strike > ticks[15].spot          # OTM call, not the ATM
    # the chosen strike's delta must be close to the 0.40 target
    ty = _t_years_at(datetime.fromisoformat(tr.entry_time))
    g = G.greeks(tr.entry_premium, tr.entry_spot, tr.strike, ty, "CE")
    assert g is not None
    assert abs(abs(g.delta) - 0.40) < 0.15


def test_iv_delta_refuses_when_iv_is_rich():
    """Once enough IV history exists, rich IV must block entries."""
    t0 = datetime(2026, 9, 21, 10, 0)
    rich = [_chain_tick(t0 + timedelta(minutes=i), 23400 + i * 1.5,
                        0.10 + i * 0.0015) for i in range(80)]
    s = NiftyIVDelta(target_delta=0.40, trend_window=15, trend_min_pct=0.05,
                     iv_window=60, cooldown_min=15, max_hold_min=400)
    s.prepare(rich, {})
    assert s.entry_signal(60, rich[60], rich, {}) is None     # IV above its median

    flat = [_chain_tick(t0 + timedelta(minutes=i), 23400 + i * 1.5, 0.12)
            for i in range(80)]
    s2 = NiftyIVDelta(target_delta=0.40, trend_window=15, trend_min_pct=0.05,
                      iv_window=60, cooldown_min=15, max_hold_min=400)
    s2.prepare(flat, {})
    assert s2.entry_signal(60, flat[60], flat, {}) is not None  # cheap vol -> signals


def test_iv_delta_hold_time_uses_real_strike_marks():
    """Marks must use the chosen strike's premium (chain), not the ATM."""
    t0 = datetime(2026, 9, 21, 10, 0)
    ticks = [_chain_tick(t0 + timedelta(minutes=i), 23400 + i * 1.5, 0.12)
             for i in range(40)]
    s = NiftyIVDelta(target_delta=0.40, trend_window=15, trend_min_pct=0.05,
                     cooldown_min=15, max_hold_min=400)
    tr = s.run(ticks, {})[0]
    assert tr.strike in ticks[0].chain
    fill = next(t for t in ticks if t.t.isoformat() == tr.entry_time)
    leg = 0 if tr.opt == "CE" else 1
    assert tr.entry_premium == pytest.approx(fill.chain[int(tr.strike)][leg], abs=0.02)


def test_by_strategy_net_points_matches_trades():
    """Regression: the per-strategy table must expose net_points (template key)."""
    tr = _mk_trade()
    tr2 = _mk_trade(entry=datetime(2026, 9, 15, 11, 0),
                    exit_=datetime(2026, 9, 15, 11, 30))
    tr2.net_pnl, tr2.points = -100.0, -1.5
    run = sim.DayRun(date="2026-09-15", expiry="2026-09-29", dte=14,
                     coverage_pct=100.0, spot_open=23500.0, spot_close=23520.0,
                     spot_lo=23400.0, spot_hi=23600.0, ticks=[], trades=[tr, tr2])
    screen = sim.build_screen([run], lots=1)
    s = screen["by_strategy"][0]
    assert "net_points" in s
    assert s["net_points"] == pytest.approx(tr.points + tr2.points, abs=0.01)


def test_structure_pnl_shapes():
    grid = [23000, 23500, 24000]
    # long call K=23500, premium 100, qty 65
    long_ce = sim.structure_pnl("CE", "LONG", 23500, 100, 65, grid)
    assert long_ce[0] == pytest.approx(-100 * 65)      # OTM -> lose the premium
    assert long_ce[1] == pytest.approx(-100 * 65)      # at the strike
    assert long_ce[2] == pytest.approx((500 - 100) * 65)
    # short call mirrors it
    assert sim.structure_pnl("CE", "SHORT", 23500, 100, 65, grid) == \
        [-x for x in long_ce]
    # long straddle K=23500, combined premium 500: worst at the strike, wins at wings
    ls = sim.structure_pnl("STRADDLE", "LONG", 23500, 500, 65, grid)
    assert ls[1] == pytest.approx(-500 * 65)
    assert ls[0] == pytest.approx((500 - 500) * 65)     # 500 pt move = break even
    assert sim.structure_pnl("STRADDLE", "SHORT", 23500, 500, 65, grid) == \
        [-x for x in ls]


def test_trade_chart_includes_payoff(monkeypatch):
    """Each trade's payload carries an expiry payoff aligned to its grid."""
    tr = _mk_trade(opt="STRADDLE", direction="LONG", strike=23500.0)
    tr.entry_premium = 500.0
    # stub the data layer so the test needs no parquet
    import pandas as pd
    idx = pd.DataFrame({"open": [23500.0, 23510.0, 23520.0],
                        "high": [23510.0, 23520.0, 23530.0],
                        "low": [23490.0, 23500.0, 23510.0],
                        "close": [23500.0, 23510.0, 23520.0]},
                       index=pd.to_datetime(["2026-09-15 10:00", "2026-09-15 10:01",
                                             "2026-09-15 10:02"]).tz_localize("Asia/Kolkata"))
    monkeypatch.setattr(sim.panel, "index_day", lambda d: idx)
    monkeypatch.setattr(sim.panel, "contract_close",
                        lambda *a, **k: pd.Series(dtype=float))
    tr.entry_time = idx.index[0].isoformat()
    tr.exit_time = idx.index[2].isoformat()
    ch = sim._trade_chart(tr, __import__("datetime").date(2026, 9, 15))
    assert ch is not None
    assert len(ch["payoff"]["grid"]) == len(ch["payoff"]["pnl"]) > 0
    assert ch["payoff"]["strike"] == 23500.0


def test_choose_week_reproducible_and_bounded():
    if not sim.candidate_sessions():
        pytest.skip("no priced sessions")
    a = sim.choose_week(seed=1977)
    b = sim.choose_week(seed=1977)
    assert a == b and len(a) >= 4
    assert all(isinstance(d, date) for d in a)
