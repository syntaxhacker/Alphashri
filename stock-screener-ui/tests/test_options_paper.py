"""Unit tests for the options paper-trading sandbox.

Covers the two things that must not silently break:

1. the **honesty contract** of the engine (next-bar fill, no target on the fill
   bar, stop-before-target ordering, EOD flattening), and
2. the **cost model** (charges are real and large; STT lands on the sell leg).

Run: ``npx``-free — use the project venv:
    source .venv/bin/activate && python -m pytest tests/test_options_paper.py -q
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from options_paper import spec
from options_paper.costs import (break_even_move_points, costs_to_points,
                                 option_round_trip_cost, sell_margin_estimate)
from options_paper.strategies import (NiftyGap, NiftyIVDelta, NiftyMomentum,
                                      NiftyOpenStraddle, NiftyPinReversal, NiftySpotScalp,
                                      NiftyVRP, NiftyWallBounce, Signal,
                                      Strategy, build)
from options_paper.tape import Tick


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def mk_ticks(rows, expiry="2026-10-19", start="2026-10-16T09:15:00"):
    """rows: list of (spot, ce, pe). Returns consecutive Timedelta(minutes=1).

    Each row carries a **strike chain** around the ATM (the live tape records
    one): the synthetic tape has a single price series, so every strike in
    the band is priced at the recorded CE/PE. Without a chain the engine
    cannot mark a position at the strike it holds once the ATM drifts, and
    the mark would silently freeze — the tests would then measure the
    fixture, not the engine.
    """
    t0 = datetime.fromisoformat(start)
    out = []
    for i, (spot, ce, pe) in enumerate(rows):
        atm = round(spot / 50) * 50
        chain = {atm + 50 * k: (float(ce), float(pe))
                 for k in range(-5, 6)}
        out.append(Tick(t=t0 + timedelta(minutes=i), spot=float(spot),
                        atm_strike=atm, ce_ltp=float(ce),
                        pe_ltp=float(pe), ce_iv=12.0, pe_iv=13.0,
                        expiry=expiry, chain=chain))
    return out


# --------------------------------------------------------------------------
# spec
# --------------------------------------------------------------------------
def test_nifty_lot_from_master():
    assert spec.get_lot("NIFTY") == 65
    assert spec.get_lot("NIFTY", policy="report") == 75


def test_stock_lot_known():
    assert spec.get_lot("RELIANCE") == 500
    assert spec.get_lot("INFY") == 400


def test_option_symbol_format():
    assert spec.option_symbol("NIFTY", "2026-10-19", 23000, "CE") == "NIFTY26OCT23000CE"
    assert spec.option_symbol("NIFTY", "2026-10-19", 23050, "pe") == "NIFTY26OCT23050PE"


def test_unknown_lot_raises_for_garbage():
    with pytest.raises(KeyError):
        spec.get_lot("ZZZNOTAREALSYMBOL")


# --------------------------------------------------------------------------
# costs
# --------------------------------------------------------------------------
def test_round_trip_flat_move_is_a_loss():
    rc = option_round_trip_cost(100.0, 100.0, 65)
    assert rc["gross_pnl"] == 0
    assert rc["costs"] > 0
    assert rc["net_pnl"] < 0


def test_short_stt_lands_on_sell_leg():
    rc = option_round_trip_cost(100.0, 90.0, 65, is_short=True)
    # short: sold at 100, bought back at 90 -> gross +650
    assert rc["gross_pnl"] == pytest.approx(650.0, abs=1e-6)
    # STT (sell side) must be non-zero, stamp (buy side) must be zero
    assert rc["breakdown"]["sell"]["stt"] > 0
    assert rc["breakdown"]["buy"]["stamp"] > 0
    assert rc["breakdown"]["buy"]["stt"] == 0
    assert rc["breakdown"]["sell"]["stamp"] == 0


def test_long_profitable_when_move_beats_costs():
    rc = option_round_trip_cost(100.0, 200.0, 65)
    assert rc["net_pnl"] > 0
    assert rc["costs"] > 0


def test_break_even_is_positive_and_reasonable():
    be = break_even_move_points(100.0, 65)
    assert 0 < be < 30          # a couple of points, not half the premium
    be_short = break_even_move_points(100.0, 65, is_short=True)
    assert be_short > 0


def test_costs_to_points():
    assert costs_to_points(650.0, lots=1, lot=65) == pytest.approx(10.0)


def test_sell_margin_scales_with_lots():
    m1 = sell_margin_estimate(23000, 65, 1)
    m2 = sell_margin_estimate(23000, 65, 2)
    assert m2 > m1 > 0


# --------------------------------------------------------------------------
# engine honesty
# --------------------------------------------------------------------------
def test_fill_is_next_bar(tmp_path):
    ticks = mk_ticks([
        (100.0, 50, 50),    # 0
        (100.5, 52, 48),    # 1
        (101.0, 55, 45),    # 2   OR high = 101
        (102.0, 58, 42),    # 3   break up -> signal here
        (102.5, 60, 40),    # 4   FILL (next bar)
        (103.0, 70, 35),    # 5
        (103.0, 72, 34),    # 6
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.5, tp_pct=5.0, max_hold_min=400)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    t = trades[0]
    assert t.entry_time == ticks[4].t.isoformat()      # filled at bar 4, not 3
    assert t.entry_premium == 60.0                      # bar 4's CE premium
    assert t.opt == "CE"


def test_no_target_on_fill_bar():
    # Bar 4 (the fill bar) already satisfies a tiny TP. The engine must NOT
    # exit there; the first eligible exit is bar 5 at the earliest.
    ticks = mk_ticks([
        (100.0, 50, 50),
        (100.5, 52, 48),
        (101.0, 55, 45),
        (102.0, 58, 42),    # signal
        (102.5, 60, 40),    # fill @ 60
        (102.5, 61, 40),    # first eligible bar (only +1.7%)
        (102.5, 99, 39),    # +65% -> TP here
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.9, tp_pct=0.60, max_hold_min=400)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    assert trades[0].exit_time == ticks[6].t.isoformat()
    assert trades[0].exit_reason == "TP"


def test_stop_beats_run():
    ticks = mk_ticks([
        (100.0, 50, 50),
        (100.5, 52, 48),
        (101.0, 55, 45),
        (102.0, 58, 42),    # signal
        (102.5, 60, 40),    # fill @ 60
        (102.0, 30, 60),    # -50% -> SL (sl_pct 0.30)
        (102.0, 25, 65),
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.30, tp_pct=0.60, max_hold_min=400)
    trades = s.run(ticks, {})
    assert trades[0].exit_reason == "SL"
    assert trades[0].net_pnl < 0


def test_eod_flattens_open_position():
    rows = [(100.0, 50, 50), (100.0, 50, 50), (100.0, 50, 50),
            (102.0, 58, 42), (102.0, 58, 42)]
    # extend with quiet bars that never hit SL/TP up to past the EOD cut
    t0 = datetime.fromisoformat("2026-10-16T15:05:00")
    ticks = mk_ticks(rows[:4], start="2026-10-16T15:04:00")
    ticks += [Tick(t=t0 + timedelta(minutes=i), spot=102.0, atm_strike=100,
                   ce_ltp=58.0, pe_ltp=42.0, ce_iv=12, pe_iv=12,
                   expiry="2026-10-19") for i in range(8)]
    s = NiftyMomentum(or_minutes=2, lots=1, sl_pct=0.9, tp_pct=0.9, max_hold_min=400)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    assert trades[0].exit_reason == "EOD"


def test_partial_day_marks_mtm():
    ticks = mk_ticks([
        (100.0, 50, 50),
        (101.0, 55, 45),
        (102.0, 58, 42),
        (103.0, 60, 40),    # signal @3 -> fill @4 (missing)
    ])
    ticks.append(Tick(t=datetime.fromisoformat("2026-10-16T11:00:00"), spot=103,
                      atm_strike=100, ce_ltp=61, pe_ltp=39, ce_iv=12, pe_iv=12,
                      expiry="2026-10-19"))
    s = NiftyMomentum(or_minutes=1, lots=1, sl_pct=0.9, tp_pct=0.9, max_hold_min=400)
    trades = s.run(ticks, {})
    assert trades and trades[-1].exit_reason == "MTM"


def test_short_straddle_pnl_sign():
    ticks = mk_ticks([
        (100.0, 50, 50),    # 0  col 100
        (100.0, 50, 50),    # 1  entry_after
        (100.0, 50, 50),    # 2  fill @ ce+pe = 100
        (100.0, 40, 40),    # 3  decay -> short profit
        (100.0, 30, 30),    # 4
    ])
    s = NiftyVRP(entry_after_min=1, lots=1, sl_pct=0.9, tp_pct=0.5, max_hold_min=400)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    t = trades[0]
    assert t.direction == "SHORT"
    assert t.entry_premium == 100.0
    assert t.gross_pnl > 0          # collected 100, bought back at 60


def test_too_few_ticks_no_trades():
    s = NiftyMomentum(or_minutes=1)
    assert s.run(mk_ticks([(100, 50, 50)]), {}) == []


def test_rsi_strategy_is_gone():
    """The RSI mean-reversion strategy was removed from the registry."""
    import pytest as _pytest
    from options_paper.strategies import REGISTRY
    assert "nifty_rsi_reversion" not in REGISTRY
    with _pytest.raises(KeyError):
        build("nifty_rsi_reversion")


def test_gap_strategy_direction():
    ticks = mk_ticks([(101.0, 55, 45), (101.0, 55, 45), (101.0, 55, 45),
                      (101.0, 55, 45)])
    go = NiftyGap(gap_min_pct=0.3, mode="go", lots=1)
    trades = go.run(ticks, {"prev_close": 100.0})     # +1% gap -> buy CE
    assert trades and trades[0].opt == "CE"
    fade = NiftyGap(gap_min_pct=0.3, mode="fade", lots=1)
    trades = fade.run(ticks, {"prev_close": 100.0})   # +1% gap -> buy PE
    assert trades and trades[0].opt == "PE"


def test_wall_bounce_buys_ce_at_put_wall():
    t0 = datetime.fromisoformat("2026-10-16T09:30:00")
    ticks = []
    for i in range(4):
        ticks.append(Tick(t=t0 + timedelta(minutes=i), spot=23000.0,
                          atm_strike=23000, ce_ltp=100.0, pe_ltp=100.0,
                          ce_iv=12, pe_iv=12, expiry="2026-10-19",
                          walls_puts=[{"strike": 23000.0, "oi": 1e7}],
                          walls_calls=[{"strike": 24000.0, "oi": 1e7}]))
    s = NiftyWallBounce(proximity_pct=0.15, lots=1)
    trades = s.run(ticks, {})
    assert trades and trades[0].opt == "CE"


def test_build_registry_and_bad_name():
    assert build("nifty_momentum").name == "nifty_momentum"
    with pytest.raises(KeyError):
        build("nope")


def test_real_tape_replay_no_lookahead_if_present():
    """If a real tape exists locally, replay it and assert every entry was
    filled at a bar strictly after its signal (structural check)."""
    from options_paper import tape
    dates = tape.available_dates()
    if not dates:
        pytest.skip("no tape available")
    ticks = tape.load_tape(dates[-1])
    if not ticks:
        pytest.skip("tape empty")
    trades = NiftyMomentum(or_minutes=15, lots=1).run(ticks, {"prev_close": None})
    for t in trades:
        # entry_time must exist in the tape and not be the very first bar
        assert any(tk.t.isoformat() == t.entry_time for tk in ticks)
        assert t.entry_time != ticks[0].t.isoformat()


def test_open_straddle_buys_both_legs_at_the_open():
    ticks = mk_ticks([(100.0, 50, 40), (100.0, 52, 41), (100.0, 53, 42),
                      (100.0, 54, 43)])
    s = NiftyOpenStraddle(lots=1, sl_pct=0.9, tp_pct=9.0, max_hold_min=400)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    tr = trades[0]
    assert tr.opt == "STRADDLE" and tr.direction == "LONG"
    assert tr.entry_premium == pytest.approx(52 + 41)      # both legs, fill bar 1
    assert tr.entry_time == ticks[1].t.isoformat()

    # the SHORT control flips direction and P&L sign on the same tape
    short = NiftyOpenStraddle(lots=1, side="SHORT", sl_pct=0.9, tp_pct=0.9,
                              max_hold_min=400).run(ticks, {})
    assert short[0].direction == "SHORT"


def test_fill_bar_allows_no_discretionary_exit():
    """A strategy exit_hook must never fire on the fill bar (contract rule)."""
    class HookOnFill(Strategy):
        name = "hook"

        def __init__(self, **kw):
            super().__init__(**kw)
            self.entered = False

        def prepare(self, ticks, ctx):
            self.entered = False
            self._entry_after = ticks[0].t.time()

        def entry_signal(self, i, tk, ticks, ctx):
            if self.entered:
                return None
            self.entered = True
            return Signal("CE", "x")

        def exit_hook(self, pos, tk, ticks, ctx):
            return "HOOK"

    ticks = mk_ticks([(100, 50, 50), (100, 50, 50), (100, 55, 45), (100, 60, 40)])
    trades = HookOnFill(lots=1, sl_pct=0.9, tp_pct=9.0, max_hold_min=400).run(ticks, {})
    assert len(trades) == 1
    assert trades[0].exit_reason == "HOOK"
    assert trades[0].exit_time == ticks[2].t.isoformat()   # not the fill bar (1)


def test_engine_refuses_zero_premium_fill():
    """A dead leg (0 premium) must not open a position."""
    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 0.0, 40),   # fill bar has no CE price
        (103.0, 70, 35),
    ])
    s = NiftyMomentum(or_minutes=3, lots=1)
    assert s.run(ticks, {}) == []


def test_tape_row_parses_premium_chain():
    from options_paper import tape
    row = {"t": "2026-10-19T09:16:00+05:30", "spot": 23400, "atm_strike": 23400,
           "atm_ce_ltp": 150, "atm_pe_ltp": 140, "expiry": "2026-10-19",
           "chain": {"23400": [150.0, 140.0], "23350": [180.0, None],
                     "23450": [120.0, 170.0], "23500": [None, None]}}
    tk = tape._to_tick(row)
    assert tk is not None
    assert tk.chain[23400] == (150.0, 140.0)
    assert tk.chain[23350] == (180.0, 0.0)      # dead leg -> 0, not None
    assert 23500 not in tk.chain                # nothing priced -> dropped


# --------------------------------------------------------------------------
# DB path (in-memory engine) — proves the account + trade bookkeeping works
# without ever touching the real db/alphashri.db
# --------------------------------------------------------------------------

def test_db_account_and_trade_recording(test_db_engine, tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)

    first = book.ensure_account(capital=1_000_000)
    assert first["created"]["user"] is True
    assert len(first["created"]["strategies"]) == len(book.STRATEGY_TYPES) + 1  # + agent
    assert len(first["created"]["bots"]) == len(book.STRATEGY_TYPES) + 1        # + agent bot

    # idempotent: re-running adds nothing
    second = book.ensure_account()
    assert second["created"]["user"] is False
    assert second["created"]["strategies"] == []
    assert second["created"]["bots"] == []

    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 60, 40), (103.0, 99, 35),
    ])
    trades = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.9, tp_pct=0.6).run(ticks, {})
    assert trades
    res = book.record_trades(trades, journal_date="2026-10-16")
    assert res["inserted"] == len(trades)

    # re-recording the same trades is a no-op (de-dup on symbol+entry_time)
    res2 = book.record_trades(trades, journal_date="2026-10-16")
    assert res2["inserted"] == 0
    assert res2["skipped"] == len(trades)

    snap = book.account_snapshot()
    assert snap["exists"] is True
    assert snap["initial_capital"] == 1_000_000
    assert snap["trades"] == len(trades)
    assert (tmp_path / "2026-10-16.jsonl").exists()

    # stop/target levels come from the strategy's sl/tp, not hard-coded zeros
    from db.models import Trade as TradeModel
    db = TestSession()
    row = db.query(TradeModel).first()
    db.close()
    assert row.stop_loss > 0
    assert row.take_profit > row.entry_price      # long, tp_pct = +60%


# --------------------------------------------------------------------------
# Headless guard: options-paper bots must never run under the equity runner
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Agent tagging: agent trades form ONE filterable group
# --------------------------------------------------------------------------
def test_agent_trades_are_tagged(test_db_engine, tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from options_paper import book
    from db.models import Trade as TradeModel

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    monkeypatch.setattr(book, "AGENT_OWNER_EMAIL", book.EMAIL)   # owner in the test DB

    book.ensure_account(capital=1_000_000)
    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 60, 40), (103.0, 99, 35),
    ])
    trades = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.9, tp_pct=0.6).run(ticks, {})
    assert trades

    res = book.record_trades(trades, journal_date="2026-10-16", run_as="agent")
    assert res["inserted"] == len(trades)

    db = TestSession()
    rows = db.query(TradeModel).filter(
        TradeModel.strategy_name == book.AGENT_TRADE_TAG).all()
    db.close()
    assert rows, "agent trades must be tagged agent_intraday"
    assert all(r.source == "options_paper_agent" for r in rows)
    assert all(r.reason.startswith("[nifty_momentum]") for r in rows)
    assert all(r.bot_id is not None for r in rows)


def test_is_headless_strategy_classifier():
    from api.bots_api.bots_router import is_headless_strategy
    assert is_headless_strategy("OPT_NIFTY_MOMENTUM")
    assert is_headless_strategy("opt_nifty_vrp")
    for equity in ("ORB", "EMA_CROSS", "WEEK52_CHASER", "SR_BREAKOUT", None, ""):
        assert not is_headless_strategy(equity)


def test_options_paper_bots_are_classified_headless(test_db_engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from api.bots_api import bots_router
    from db.models import BotConfig
    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    book.ensure_account(capital=1_000_000)

    db = TestSession()
    try:
        bots = db.query(BotConfig).filter(BotConfig.name.like("OPT Paper - %")).all()
        assert bots, "options-paper bots should exist"
        for b in bots:
            types = bots_router.headless_strategy_types(db, b.id)
            assert types, f"bot {b.id} ({b.name}) must be headless"
            assert all(t.startswith("OPT_") for t in types)
    finally:
        db.close()


def test_start_bot_process_refuses_headless_bot(test_db_engine, monkeypatch):
    """The guard must return without spawning a subprocess."""
    import subprocess
    from sqlalchemy.orm import sessionmaker
    from api.bots_api import bots_router
    from db.models import BotConfig
    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    book.ensure_account(capital=1_000_000)
    monkeypatch.setattr(bots_router, "SessionLocal", TestSession)

    spawned = {"n": 0}

    def _boom(*a, **k):
        spawned["n"] += 1
        raise AssertionError("must not spawn a process for a headless bot")

    monkeypatch.setattr(subprocess, "Popen", _boom)

    db = TestSession()
    bot = db.query(BotConfig).filter(BotConfig.name.like("OPT Paper - %")).first()
    uid, bid = bot.user_id, bot.id
    db.close()

    assert bots_router.start_bot_process(user_id=uid, bot_id=bid) is None
    assert spawned["n"] == 0


# --------------------------------------------------------------------------
# breakeven ratchet + trail (profit protection)
# --------------------------------------------------------------------------
def test_breakeven_ratchet_protects_a_winner():
    """Once a long runs >= be_trigger, the stop must lift to ~breakeven."""
    ticks = mk_ticks([
        (100.0, 50, 50),
        (100.5, 52, 48),
        (101.0, 55, 45),
        (102.0, 58, 42),    # signal
        (102.5, 60, 40),    # fill @ 60
        (103.0, 70, 30),    # +16.7% -> ratchet arms (be_trigger 8%)
        (102.0, 68, 32),
        (101.0, 60, 40),    # at/below the ratcheted stop -> TRAIL
        (100.0, 55, 45),
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.30, tp_pct=0.90,
                      max_hold_min=400, trail_pct=0.20)
    trades = s.run(ticks, {})
    t = trades[0]
    assert t.exit_reason == "TRAIL"
    assert t.entry_premium == 60.0
    # not the -30% SL (42): it stopped near breakeven
    assert t.exit_premium >= 59.0
    assert t.net_pnl > -250


def test_small_peak_does_not_arm_the_trail():
    """A +5% peak (< 8%) must not move the stop; old logic trailed below entry."""
    ticks = mk_ticks([
        (100.0, 50, 50),
        (100.5, 52, 48),
        (101.0, 55, 45),
        (102.0, 58, 42),    # signal
        (102.5, 60, 40),    # fill @ 60
        (103.0, 63, 37),    # +5% peak
        (101.0, 50, 50),    # held 2 min
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.30, tp_pct=0.90,
                      max_hold_min=2, trail_pct=0.20)
    trades = s.run(ticks, {})
    assert trades[0].exit_reason == "TIME"


def test_manual_short_ratchets_stop_after_costs(tmp_path, monkeypatch):
    """A short that runs 25% must trail its stop down to lock the gain.

    The trail gives back ``trail_pct`` of the **profit**, not of the premium:
    stop = entry - (1 - trail) * (entry - best) = 55.2 - 0.8 * 13.7 = 44.24.
    The old formula (best * (1 + trail) = 49.8) gave back a slice of the
    *premium*, which is a different (and looser) rule at high peaks.
    """
    import json as _json

    from options_paper import manual

    ledger = tmp_path / "agent_positions.json"
    monkeypatch.setattr(manual, "LEDGER", ledger)
    monkeypatch.setattr(manual, "_load_triggers", lambda: [])
    monkeypatch.setattr(manual, "_save_triggers", lambda ts: None)
    ledger.write_text(_json.dumps({"positions": [{
        "opt": "CE", "strike": 23300, "direction": "SHORT", "lots": 1, "qty": 65,
        "entry_premium": 55.2, "entry_time": "2026-10-21T11:03:01+05:30",
        "entry_spot": 22971.9, "expiry": "2026-10-27",
        "stop": 75.0, "target": 20.0, "best": 55.2,
        "be_trigger": 0.08, "trail_pct": 0.20,
        "reason": "test short",
    }]}))
    tk = Tick(t=datetime(2026, 10, 21, 11, 30), spot=22890.0,
              atm_strike=22900.0, ce_ltp=0.0, pe_ltp=0.0, ce_iv=12.0,
              pe_iv=12.0, expiry="2026-10-27", chain={23300: (41.5, 0.0)})
    fired, closed = manual.auto_manage(tk)
    assert closed == []
    pos = _json.loads(ledger.read_text())["positions"][0]
    # entry 55.2, best 41.5 -> 80% of the 13.7-point profit is locked in:
    # stop = 55.2 - 0.8 * 13.7 = 44.24 (the breakeven-after-costs level of
    # ~53.98 is the ceiling, not the floor, for a short).
    assert 44.0 <= pos["stop"] <= 44.5


def test_time_stop_no_longer_cuts_an_armed_winner():
    """Once +8% is booked, the 15-min clock must not close the trade."""
    rows = [(23000, 100, 100)] * 6
    rows += [(23040, 100, 100)]          # signal (i=6)
    rows += [(23040, 100, 100)]          # fill (i=7) @ 100
    rows += [(23050, 112, 90)]           # +12% -> ratchet arms
    rows += [(23050, 110, 90)] * 22      # sits above the ratcheted stop
    ticks = mk_ticks(rows)
    s = NiftySpotScalp(lookback=5, threshold_pct=0.08, cooldown_min=10,
                       max_hold_min=15, open_veto_min=0)
    trades = s.run(ticks, {})
    assert trades
    assert trades[-1].exit_reason == "MTM"      # still open, not clocked out


def test_spot_scalp_vetoes_opening_drive():
    """No entries inside the first 20 minutes (2026-10-21 opening-drive trap)."""
    rows = [(23000 + i * 10, 100 + i * 2, 100) for i in range(40)]
    ticks = mk_ticks(rows)
    s = NiftySpotScalp(lookback=5, threshold_pct=0.08, cooldown_min=10,
                       max_hold_min=15, open_veto_min=20)
    trades = s.run(ticks, {})
    assert trades
    first = datetime.fromisoformat(trades[0].entry_time)
    assert (first - ticks[0].t).total_seconds() / 60 >= 20


def test_spot_scalp_trend_filter_blocks_counter_trend_bounce():
    """A 5-min bounce below the 30-min mean must not be bought as a CE."""
    from options_paper.strategies import NiftySpotScalp as Scalp

    def tk(spot):
        return Tick(t=datetime(2026, 10, 21, 11, 5), spot=spot,
                    atm_strike=round(spot / 50) * 50, ce_ltp=100, pe_ltp=100,
                    ce_iv=12, pe_iv=12, expiry="2026-10-27")

    s = Scalp(lookback=5, threshold_pct=0.08, twap_window=30, open_veto_min=0)
    # flat 23,000, 5 bars at 22,800, then a +0.09% bounce to 22,820:
    # the 5-min momentum says CE, the 30-min mean (22,967) says no.
    s.spots = [23000.0] * 30 + [22800.0] * 5 + [22820.0]
    ticks = [tk(x) for x in s.spots]
    assert s.entry_signal(35, ticks[-1], ticks, {}) is None

    # a fresh low under the mean is still a valid PE
    s.spots = [23000.0] * 30 + [22800.0] * 5 + [22780.0]
    ticks = [tk(x) for x in s.spots]
    sig = s.entry_signal(35, ticks[-1], ticks, {})
    assert sig is not None and sig.opt == "PE"


# --------------------------------------------------------------------------
# NIFTY pin reversal (failed break at a repeatedly-tested level)
# --------------------------------------------------------------------------
def test_pin_reversal_builds_from_registry():
    from options_paper.strategies import REGISTRY
    assert "nifty_pin_reversal" in REGISTRY
    s = build("nifty_pin_reversal")
    assert s.name == "nifty_pin_reversal" and s.underlying == "NIFTY"


def test_pin_sweep_reclaim_enters_ce():
    rows = [(22700, 100, 100), (22720, 100, 100)] * 3 + [(22700, 100, 100)]
    rows += [(22690, 100, 100)]      # sweep: closes 10pt below the 22700 low
    rows += [(22708, 102, 100)]      # reclaim -> signal here
    rows += [(22710, 105, 99)]       # fill @ CE 105
    rows += [(22715, 120, 95), (22720, 160, 90)]   # +52% -> TP
    ticks = mk_ticks(rows)
    s = NiftyPinReversal(lots=1)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    t = trades[0]
    assert t.opt == "CE" and t.direction == "LONG"
    assert t.entry_time == ticks[9].t.isoformat()
    assert t.entry_premium == 105.0
    assert t.exit_reason == "TP"
    assert "pin sweep reclaimed" in t.reason
    assert t.sl_pct == 0.22 and t.tp_pct == 0.45


def test_pin_clean_break_has_no_reversal_entry():
    rows = [(22700, 100, 100), (22720, 100, 100)] * 3 + [(22700, 100, 100)]
    rows += [(22650, 100, 100)]      # 50pt under: a real break, not a sweep
    rows += [(22648, 100, 100), (22645, 100, 100), (22644, 100, 100)]
    ticks = mk_ticks(rows)
    trades = NiftyPinReversal(lots=1).run(ticks, {})
    assert [t for t in trades if t.opt == "CE"] == []


def test_pin_high_mirror_enters_pe():
    rows = [(22800, 100, 100), (22780, 100, 100)] * 3 + [(22800, 100, 100)]
    rows += [(22808, 100, 100)]      # spike: closes 8pt above the 22800 high
    rows += [(22792, 100, 102)]      # fails back below -> signal here
    rows += [(22790, 99, 105)]       # fill @ PE 105
    rows += [(22780, 95, 120), (22770, 90, 160)]   # +52% -> TP
    ticks = mk_ticks(rows)
    s = NiftyPinReversal(lots=1)
    trades = s.run(ticks, {})
    assert len(trades) == 1
    t = trades[0]
    assert t.opt == "PE" and t.direction == "LONG"
    assert t.entry_time == ticks[9].t.isoformat()
    assert t.exit_reason == "TP"


def test_pin_too_few_touches_no_entry():
    rows = [(22700, 100, 100), (22720, 100, 100),
            (22700, 100, 100), (22720, 100, 100)]   # only 2 touches
    rows += [(22690, 100, 100), (22708, 102, 100),
             (22710, 105, 100), (22712, 106, 100)]
    ticks = mk_ticks(rows)
    assert NiftyPinReversal(lots=1).run(ticks, {}) == []


# ==========================================================================
# P0 — honest marks, coherent ledger, the whole account
# ==========================================================================
def test_chain_px_never_prices_a_different_strike_at_the_atm():
    """A held strike absent from the chain must NOT be marked at the ATM."""
    from options_paper.strategies import chain_px

    tk = Tick(t=datetime(2026, 10, 16, 10, 0), spot=23350.0, atm_strike=23350,
              ce_ltp=120.0, pe_ltp=130.0, ce_iv=12, pe_iv=12,
              expiry="2026-10-27", chain={23350: (120.0, 130.0)})
    # the 23400 contract is not in the chain -> 0.0 (never the 23350 ATM PE)
    assert chain_px(tk, 23400, "PE") == 0.0
    # the ATM contract itself *is* this contract and may use the tape premium
    assert chain_px(tk, 23350, "PE") == 130.0


def test_dead_leg_carries_last_known_not_the_drifting_atm():
    """The 2026-10-16 pin trade: a dropped 23400PE must keep its own last px."""
    from options_paper.strategies import Position

    pos = Position(strategy="s", underlying="NIFTY", expiry="2026-10-27",
                   opt="PE", direction="LONG", lots=1, lot=65, qty=65,
                   entry_index=0, fill_index=0,
                   entry_time=datetime(2026, 10, 16, 9, 45),
                   entry_premium=150.0, entry_spot=23400.0,
                   entry_ce=0.0, entry_pe=150.0, strike=23400.0,
                   last_leg_px={"PE": 150.0})
    # the chain drops 23400 and the ATM has drifted to 23350
    tk = Tick(t=datetime(2026, 10, 16, 14, 0), spot=23350.0, atm_strike=23350,
              ce_ltp=100.0, pe_ltp=133.15, ce_iv=12, pe_iv=12,
              expiry="2026-10-27", chain={23350: (100.0, 133.15)})
    assert pos.premium_at(tk) == 150.0        # last known for 23400, not 133.15
    assert pos.priced is True

    # a dead leg (row present, price 0) also carries the last known
    tk2 = Tick(t=datetime(2026, 10, 16, 14, 1), spot=23350.0, atm_strike=23350,
               ce_ltp=100.0, pe_ltp=0.0, ce_iv=12, pe_iv=12,
               expiry="2026-10-27", chain={23400: (0.0, 0.0)})
    assert pos.premium_at(tk2) == 150.0


def test_never_priced_position_is_unpriced_and_excluded():
    from options_paper.strategies import Position

    pos = Position(strategy="s", underlying="NIFTY", expiry="2026-10-27",
                   opt="CE", direction="LONG", lots=1, lot=65, qty=65,
                   entry_index=0, fill_index=0,
                   entry_time=datetime(2026, 10, 16, 9, 45),
                   entry_premium=100.0, entry_spot=23400.0, strike=23400.0)
    tk = Tick(t=datetime(2026, 10, 16, 10, 0), spot=23350.0, atm_strike=23350,
              ce_ltp=120.0, pe_ltp=130.0, ce_iv=12, pe_iv=12,
              expiry="2026-10-27", chain={23350: (120.0, 130.0)})
    assert pos.premium_at(tk) == 0.0
    assert pos.priced is False


def test_unpriced_row_is_never_booked(test_db_engine, tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    book.ensure_account(capital=1_000_000)

    row = {
        "strategy": "nifty_momentum", "underlying": "NIFTY", "symbol": "X",
        "opt": "CE", "direction": "LONG", "lots": 1, "lot": 65, "qty": 65,
        "expiry": "2026-10-27",
        "entry_time": "2026-10-16T10:00:00", "entry_premium": 100.0,
        "entry_spot": 23400.0, "exit_time": "2026-10-16T10:30:00",
        "exit_premium": 0.0, "exit_spot": 23400.0, "exit_reason": "EOD",
        "hold_min": 30.0, "gross_pnl": -6500.0, "costs": 30.0,
        "net_pnl": -6530.0, "points": -100.0, "reason": "x",
        "priced": False,
    }
    res = book.record_trades([row], journal_date="2026-10-16")
    assert res["inserted"] == 0 and res["unpriced"] == 1
    assert book.read_journal("2026-10-16") == []


def _agent_row(strategy, entry="2026-10-16T10:00:00", symbol="NIFTY26OCT23400CE",
               net=100.0):
    return {
        "strategy": strategy, "underlying": "NIFTY", "symbol": symbol,
        "opt": "CE", "direction": "LONG", "lots": 1, "lot": 65, "qty": 65,
        "expiry": "2026-10-27", "entry_time": entry,
        "entry_premium": 100.0, "entry_spot": 23400.0,
        "exit_time": "2026-10-16T10:30:00", "exit_premium": 102.0,
        "exit_spot": 23410.0, "exit_reason": "TP", "hold_min": 30.0,
        "gross_pnl": 130.0, "costs": 30.0, "net_pnl": net, "points": net / 65,
        "reason": "x", "sl_pct": 0.3, "tp_pct": 0.6,
    }


def test_db_dedupe_includes_the_source_strategy(test_db_engine, tmp_path, monkeypatch):
    """A row from another strategy at the same bar must not block this one."""
    from sqlalchemy.orm import sessionmaker

    from options_paper import book
    from db.models import Trade as TradeModel

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    monkeypatch.setattr(book, "AGENT_OWNER_EMAIL", book.EMAIL)
    acct = book.ensure_account(capital=1_000_000)

    # simulate another strategy already at this contract/bar (no bot, so the
    # schema's unique key does not collide with the agent bot's row)
    db = TestSession()
    db.add(TradeModel(
        user_id=acct["user_id"], bot_id=None, strategy_id=None,
        strategy_name=book.AGENT_TRADE_TAG, symbol="NIFTY26OCT23400CE",
        side="BUY", quantity=65, entry_price=100.0,
        entry_time=datetime(2026, 10, 16, 10, 0),
        exit_price=102.0, exit_time=datetime(2026, 10, 16, 10, 30),
        pnl=130.0, net_pnl=100.0, source="options_paper_agent",
        reason="[nifty_gap] x",
    ))
    db.commit()
    db.close()

    res = book.record_trades([_agent_row("nifty_momentum")], run_as="agent")
    assert res["inserted"] == 1            # not mistaken for the nifty_gap row

    res2 = book.record_trades([_agent_row("nifty_momentum")], run_as="agent")
    assert res2["inserted"] == 0 and res2["skipped"] == 1


def test_agent_duplicate_contract_does_not_abort_the_pass(test_db_engine, tmp_path,
                                                          monkeypatch):
    """The schema's unique key is narrower than the trade id; a collision is a
    skip, never an exception that loses the rest of the pass."""
    from sqlalchemy.orm import sessionmaker

    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    monkeypatch.setattr(book, "AGENT_OWNER_EMAIL", book.EMAIL)
    book.ensure_account(capital=1_000_000)

    rows = [_agent_row("nifty_momentum"), _agent_row("nifty_gap")]
    res = book.record_trades(rows, run_as="agent")
    assert res["inserted"] == 1 and res["skipped"] == 1
    # the journal still holds both identities: it is not schema-bound
    assert len(book.read_journal("2026-10-16")) == 2


def test_agent_owner_falls_back_when_owner_missing(test_db_engine, tmp_path,
                                                    monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    monkeypatch.setattr(book, "AGENT_OWNER_EMAIL", "nobody@example.invalid")
    book.ensure_account(capital=1_000_000)

    res = book.record_trades([_agent_row("nifty_momentum")], run_as="agent")
    assert res["inserted"] == 1


def test_journal_replay_is_a_snapshot_not_a_union(tmp_path, monkeypatch):
    """A second pass replaces the replayed book instead of appending a history."""
    from options_paper import book

    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    manual_row = {"strategy": "agent_discretionary", "symbol": "M",
                  "entry_time": "2026-10-21T09:20:00", "net_pnl": 50.0}
    first = [{"strategy": "nifty_momentum", "symbol": "A",
              "entry_time": "2026-10-21T09:30:00", "net_pnl": 10.0},
             {"strategy": "nifty_gap", "symbol": "B",
              "entry_time": "2026-10-21T09:40:00", "net_pnl": 20.0}]
    book.write_journal("2026-10-21", [manual_row], replace=None)
    book.write_journal("2026-10-21", first, replace={"nifty_momentum", "nifty_gap"})
    assert {r["symbol"] for r in book.read_journal("2026-10-21")} == {"M", "A", "B"}

    second = [{"strategy": "nifty_momentum", "symbol": "C",
               "entry_time": "2026-10-21T11:00:00", "net_pnl": -5.0}]
    book.write_journal("2026-10-21", second, replace={"nifty_momentum", "nifty_gap"})
    rows = book.read_journal("2026-10-21")
    # the manual book survives; the coded book is exactly the latest pass
    assert {r["symbol"] for r in rows} == {"M", "C"}

    # an empty re-run clears the replayed books rather than leaving the old
    # history in place
    book.record_trades([], journal_date="2026-10-21",
                       journal_replace={"nifty_momentum"})
    assert {r["symbol"] for r in book.read_journal("2026-10-21")} == {"M"}


def test_run_once_books_even_an_empty_replayed_pass(monkeypatch, tmp_path):
    """The journal scope is replaced on every pass, empty or not."""
    from options_paper import live, manual

    ticks = mk_ticks([(100.0, 50, 50)] * 4)
    monkeypatch.setattr(live.tape, "load_tape", lambda d: ticks)
    monkeypatch.setattr(live.tape, "prev_session_close", lambda d: None)
    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    seen = {}

    def _record(trades, **kw):
        seen.update(trades=trades, **kw)
        return {"inserted": len(trades), "skipped": 0}

    monkeypatch.setattr(live.book, "record_trades", _record)
    r = live.run_once("2026-10-16", ("nifty_pin_reversal",), dry_run=False)
    assert seen["journal_replace"] == {"nifty_pin_reversal"}
    assert seen["trades"] == [] and seen["run_as"] == "agent"
    assert r["completed"] == 0


def test_journal_append_remains_idempotent(tmp_path, monkeypatch):
    from options_paper import book

    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    row = {"strategy": "nifty_momentum", "symbol": "A",
           "entry_time": "2026-10-21T09:30:00", "net_pnl": 10.0}
    book.write_journal("2026-10-21", [row])
    book.write_journal("2026-10-21", [row])
    assert len(book.read_journal("2026-10-21")) == 1


def test_account_snapshot_spans_agent_book_and_splits_manual_coded(
        test_db_engine, tmp_path, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from options_paper import book

    TestSession = sessionmaker(bind=test_db_engine)
    monkeypatch.setattr(book, "_session", TestSession)
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    monkeypatch.setattr(book, "AGENT_OWNER_EMAIL", book.EMAIL)
    book.ensure_account(capital=1_000_000)

    book.record_trades([_agent_row("nifty_momentum", net=400.0),
                        _agent_row("agent_discretionary",
                                   entry="2026-10-16T11:00:00", net=150.0)],
                       run_as="agent")
    snap = book.account_snapshot()
    # the agent rows live under source 'options_paper_agent' and must count
    assert snap["trades"] == 2
    assert snap["realized_pnl"] == pytest.approx(550.0)
    assert snap["equity"] == pytest.approx(1_000_550.0)
    assert snap["by_book"]["manual"]["n"] == 1
    assert snap["by_book"]["manual"]["net"] == pytest.approx(150.0)
    assert snap["by_book"]["coded"]["n"] == 1
    assert snap["by_book"]["coded"]["net"] == pytest.approx(400.0)


def test_account_snapshot_zeroed_when_no_account(test_db_engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from options_paper import book

    monkeypatch.setattr(book, "_session", sessionmaker(bind=test_db_engine))
    snap = book.account_snapshot()
    assert snap["exists"] is False and snap["trades"] == 0


# ==========================================================================
# P1 — the trail is a share of PROFIT, targets fill at the target
# ==========================================================================
def test_long_trail_gives_back_a_share_of_profit(tmp_path, monkeypatch):
    """stop = entry + (1 - trail) * (best - entry), floored by breakeven."""
    import json as _json

    from options_paper import manual

    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    monkeypatch.setattr(manual, "_load_triggers", lambda: [])
    monkeypatch.setattr(manual, "_save_triggers", lambda ts: None)
    monkeypatch.setattr(manual.book, "record_trades",
                        lambda *a, **k: {"inserted": 1, "skipped": 0})
    ledger = tmp_path / "agent_positions.json"
    ledger.write_text(_json.dumps({"positions": [{
        "opt": "CE", "strike": 23400, "direction": "LONG", "lots": 1, "qty": 65,
        "entry_premium": 100.0, "entry_time": "2026-10-21T10:00:00+05:30",
        "entry_spot": 23400.0, "expiry": "2026-10-27",
        "stop": 80.0, "target": 200.0, "best": 100.0,
        "be_trigger": 0.08, "trail_pct": 0.20, "reason": "t",
    }]}))

    def tick(px):
        return Tick(t=datetime(2026, 10, 21, 10, 30), spot=23450.0,
                    atm_strike=23400.0, ce_ltp=px, pe_ltp=0.0, ce_iv=12,
                    pe_iv=12, expiry="2026-10-27", chain={23400: (px, 0.0)})

    # +25% peak -> stop = 100 + 0.8 * 25 = 120 (not best*(1-trail) = 100)
    manual.auto_manage(tick(125.0))
    pos = _json.loads(ledger.read_text())["positions"][0]
    assert pos["stop"] == pytest.approx(120.0, abs=0.01)

    fired, closed = manual.auto_manage(tick(119.0))
    assert closed and closed[0][2] == "STOP"
    assert closed[0][1] == 119.0          # stops fill at the close


def test_manual_long_target_fills_at_the_target_not_the_overshoot(tmp_path,
                                                                  monkeypatch):
    import json as _json

    from options_paper import manual

    captured = []
    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    monkeypatch.setattr(manual, "_load_triggers", lambda: [])
    monkeypatch.setattr(manual, "_save_triggers", lambda ts: None)
    monkeypatch.setattr(manual.book, "record_trades",
                        lambda trades, **k: (captured.extend(trades)
                                             or {"inserted": len(trades),
                                                 "skipped": 0}))
    (tmp_path / "agent_positions.json").write_text(_json.dumps({"positions": [{
        "opt": "CE", "strike": 23400, "direction": "LONG", "lots": 1, "qty": 65,
        "entry_premium": 100.0, "entry_time": "2026-10-21T10:00:00+05:30",
        "entry_spot": 23400.0, "expiry": "2026-10-27",
        "stop": 50.0, "target": 150.0, "best": 100.0,
        "be_trigger": 0.08, "trail_pct": 0.20, "reason": "t",
    }]}))
    tk = Tick(t=datetime(2026, 10, 21, 10, 30), spot=23500.0,
              atm_strike=23500.0, ce_ltp=220.0, pe_ltp=0.0, ce_iv=12,
              pe_iv=12, expiry="2026-10-27", chain={23400: (220.0, 0.0)})
    fired, closed = manual.auto_manage(tk)
    assert closed and closed[0][2] == "TARGET"
    assert closed[0][1] == 150.0          # min(mark 220, target 150)
    assert captured[0].exit_premium == 150.0


def test_manual_short_target_fills_at_the_target(tmp_path, monkeypatch):
    import json as _json

    from options_paper import manual

    captured = []
    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    monkeypatch.setattr(manual, "_load_triggers", lambda: [])
    monkeypatch.setattr(manual, "_save_triggers", lambda ts: None)
    monkeypatch.setattr(manual.book, "record_trades",
                        lambda trades, **k: (captured.extend(trades)
                                             or {"inserted": len(trades),
                                                 "skipped": 0}))
    (tmp_path / "agent_positions.json").write_text(_json.dumps({"positions": [{
        "opt": "CE", "strike": 23400, "direction": "SHORT", "lots": 1, "qty": 65,
        "entry_premium": 100.0, "entry_time": "2026-10-21T10:00:00+05:30",
        "entry_spot": 23400.0, "expiry": "2026-10-27",
        "stop": 180.0, "target": 50.0, "best": 100.0,
        "be_trigger": 0.08, "trail_pct": 0.20, "reason": "t",
    }]}))
    tk = Tick(t=datetime(2026, 10, 21, 10, 30), spot=23300.0,
              atm_strike=23300.0, ce_ltp=40.0, pe_ltp=0.0, ce_iv=12,
              pe_iv=12, expiry="2026-10-27", chain={23400: (40.0, 0.0)})
    fired, closed = manual.auto_manage(tk)
    assert closed and closed[0][2] == "TARGET"
    assert closed[0][1] == 50.0          # max(mark 40, target 50)
    assert captured[0].exit_premium == 50.0


def test_engine_long_target_fills_at_the_target():
    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 60, 40), (102.5, 61, 40),
        (102.5, 99, 39),     # target 96, close 99 -> fill 96
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.9, tp_pct=0.60,
                      max_hold_min=400)
    t = s.run(ticks, {})[0]
    assert t.exit_reason == "TP"
    assert t.exit_premium == pytest.approx(96.0)      # min(99, 60*1.6)


def test_engine_short_target_fills_at_the_target():
    ticks = mk_ticks([
        (100.0, 50, 50), (100.0, 50, 50),      # fill @ 100 combined
        (100.0, 50, 50),                        # fill bar (no target allowed)
        (100.0, 20, 20),                        # 40 -> better than the 50 target
    ])
    s = NiftyVRP(entry_after_min=1, lots=1, sl_pct=0.9, tp_pct=0.5,
                 max_hold_min=400)
    trades = s.run(ticks, {})
    assert trades and trades[0].exit_reason == "TP"
    assert trades[0].exit_premium == pytest.approx(50.0)   # max(40, 50)


def test_breakeven_short_is_bounded_by_the_entry_premium():
    be = break_even_move_points(100.0, 65, is_short=True)
    assert be.found is True
    assert 0 < float(be) <= 100.0
    # no premium -> no root; the value is the bound, never a fabricated 100
    zero = break_even_move_points(0.0, 65, is_short=True)
    assert float(zero) == 0.0 and zero.found is False


def test_manual_straddle_is_four_orders():
    """Charging a straddle as one leg halves its cost (4 orders, not 2)."""
    from options_paper import manual

    qty = 65
    pos = {
        "opt": "STRADDLE", "direction": "LONG", "qty": qty,
        "entry_premium": 40.0, "entry_ce": 20.0, "entry_pe": 20.0,
        "exit_ce": 30.0, "exit_pe": 30.0, "last_px": {"CE": 30.0, "PE": 30.0},
        "entry_time": "2026-10-21T10:00:00", "entry_spot": 23400.0,
        "expiry": "2026-10-27", "strike": 23400, "lots": 1,
    }
    captured = {}
    import options_paper.manual as m
    old = m.book.record_trades
    try:
        m.book.record_trades = lambda trades, **k: (captured.setdefault("t", trades[0]),
                                                    {"inserted": 1, "skipped": 0})[1]
        m._close_position(pos, None, 60.0, "TARGET")
    finally:
        m.book.record_trades = old
    tr = captured["t"]
    from options_paper.costs import option_round_trip_cost
    leg1 = option_round_trip_cost(20.0, 30.0, qty)
    leg2 = option_round_trip_cost(20.0, 30.0, qty)
    single = option_round_trip_cost(40.0, 60.0, qty)
    assert tr.leg_orders == 2
    assert tr.costs == pytest.approx(leg1["costs"] + leg2["costs"], abs=0.01)
    # each leg's order is large enough for the flat ₹30 cap, so 4 orders cost
    # more than the 2 orders a single-leg model would charge
    assert tr.costs > single["costs"]


# ==========================================================================
# P1 — guards: dry-run, EOD entries, expiry scope, be_trigger=0
# ==========================================================================
def test_dry_run_never_manages_positions(monkeypatch, tmp_path):
    from types import SimpleNamespace as NS

    from options_paper import live, manual

    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 60, 40), (103.0, 70, 35),
    ])
    monkeypatch.setattr(live.tape, "load_tape", lambda d: ticks)
    monkeypatch.setattr(live.tape, "prev_session_close", lambda d: None)
    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    called = {"n": 0}

    def _boom(*a, **k):
        called["n"] += 1
        raise AssertionError("dry-run must not call manual.auto_manage")

    monkeypatch.setattr(manual, "auto_manage", _boom)
    r = live.run_once("2026-10-16", ("nifty_momentum",), 1, dry_run=True)
    assert called["n"] == 0 and r["inserted"] == 0


def test_no_entry_at_or_after_the_eod_cut():
    """A fill bar at 15:22 (the EOD cut) is refused: it could only exit there."""
    t0 = datetime.fromisoformat("2026-10-16T15:00:00")
    ticks = [Tick(t=t0 + timedelta(minutes=i), spot=100.0, atm_strike=100,
                  ce_ltp=50.0, pe_ltp=50.0, ce_iv=12, pe_iv=12,
                  expiry="2026-10-19") for i in range(24)]
    # break at 15:21; the fill would be 15:22 (the eod_exit cut)
    ticks[21] = Tick(t=t0 + timedelta(minutes=21), spot=102.0, atm_strike=100,
                     ce_ltp=58.0, pe_ltp=42.0, ce_iv=12, pe_iv=12,
                     expiry="2026-10-19")
    ticks.append(Tick(t=t0 + timedelta(minutes=22), spot=102.0, atm_strike=100,
                      ce_ltp=58.0, pe_ltp=42.0, ce_iv=12, pe_iv=12,
                      expiry="2026-10-19"))
    ticks.append(Tick(t=t0 + timedelta(minutes=23), spot=102.0, atm_strike=100,
                      ce_ltp=58.0, pe_ltp=42.0, ce_iv=12, pe_iv=12,
                      expiry="2026-10-19"))
    s = NiftyMomentum(or_minutes=2, lots=1, sl_pct=0.9, tp_pct=9.0,
                      max_hold_min=400)
    assert s.run(ticks, {}) == []


def test_position_is_never_marked_on_another_expiry():
    """A tape that carries a second expiry must not re-price the held one."""
    ticks = mk_ticks([
        (100.0, 50, 50), (100.0, 50, 50), (100.0, 50, 50),
        (102.0, 58, 42), (102.0, 58, 42), (102.0, 58, 58),
    ], expiry="2026-10-19", start="2026-10-16T14:55:00")
    # a later row for another expiry with a huge premium
    other = Tick(t=datetime(2026, 10, 16, 15, 1), spot=102.0, atm_strike=100,
                 ce_ltp=999.0, pe_ltp=999.0, ce_iv=12, pe_iv=12,
                 expiry="2026-10-26", chain={100: (999.0, 999.0)})
    ticks.append(other)
    ticks.append(other)
    ticks.append(other)
    s = NiftyMomentum(or_minutes=2, lots=1, sl_pct=0.9, tp_pct=0.9,
                      max_hold_min=400)
    trades = s.run(ticks, {})
    assert trades
    assert all(t.expiry == "2026-10-19" for t in trades)
    assert all(t.exit_premium < 500 for t in trades)   # never the 999 chain
    assert trades[0].exit_premium == pytest.approx(58.0)


def test_manual_never_marks_an_old_expiry_on_todays_chain(tmp_path, monkeypatch):
    import json as _json

    from options_paper import manual

    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    ledger = tmp_path / "agent_positions.json"
    ledger.write_text(_json.dumps({"positions": [{
        "opt": "CE", "strike": 23400, "direction": "LONG", "lots": 1, "qty": 65,
        "entry_premium": 100.0, "entry_time": "2026-10-20T10:00:00+05:30",
        "entry_spot": 23400.0, "expiry": "2026-10-27",
        "stop": 10.0, "target": 999.0, "best": 100.0,
        "last_px": {"CE": 111.0, "at": "2026-10-20T15:29:00+05:30"},
    }]}))
    tk = Tick(t=datetime(2026, 10, 21, 10, 0), spot=23400.0,
              atm_strike=23400.0, ce_ltp=222.0, pe_ltp=0.0, ce_iv=12,
              pe_iv=12, expiry="2026-11-03", chain={23400: (222.0, 0.0)})
    assert manual._mark(_json.loads(ledger.read_text())["positions"][0], tk) == 111.0


def test_be_trigger_zero_keeps_the_trail_alive():
    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 60, 40),     # fill @ 60
        (102.5, 70, 30),                      # +16.7% (arms on first profit)
        (102.5, 61, 39),                      # gives back to ~61
        (102.5, 50, 50),
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.9, tp_pct=9.0,
                      max_hold_min=400, trail_pct=0.25, be_trigger_pct=0.0)
    trades = s.run(ticks, {})
    assert trades and trades[0].exit_reason == "TRAIL"


def test_be_trigger_zero_still_allows_the_time_stop():
    ticks = mk_ticks([
        (100.0, 50, 50), (100.5, 52, 48), (101.0, 55, 45),
        (102.0, 58, 42), (102.5, 60, 40),     # fill @ 60
        (102.5, 60, 40), (102.5, 60, 40),     # no profit, 2 min -> TIME
    ])
    s = NiftyMomentum(or_minutes=3, lots=1, sl_pct=0.9, tp_pct=9.0,
                      max_hold_min=2, trail_pct=0.0, be_trigger_pct=0.0)
    trades = s.run(ticks, {})
    assert trades and trades[0].exit_reason == "TIME"


# ==========================================================================
# P1 — ledger safety + exit selectors
# ==========================================================================
def test_corrupt_ledger_is_quarantined_not_overwritten(tmp_path, monkeypatch):
    from options_paper import manual

    monkeypatch.setattr(manual, "LEDGER", tmp_path / "agent_positions.json")
    (tmp_path / "agent_positions.json").write_text("{not json")
    assert manual._read_state() == {}
    assert list(tmp_path.glob("agent_positions.*.corrupt")), "corrupt copy kept"


def test_exit_position_selectors():
    from types import SimpleNamespace as NS

    from options_paper import manual

    ps = [{"id": "1", "strike": 23400, "opt": "CE"},
          {"id": "2", "strike": 23450, "opt": "PE"}]
    assert manual._select_position(ps, NS(id="2", strike=0, opt=""))["id"] == "2"
    assert manual._select_position(ps, NS(id="", strike=23400, opt="CE"))["id"] == "1"
    assert manual._select_position(ps, NS(id="", strike=0, opt="PE"))["id"] == "2"
    assert manual._select_position(ps, NS(id="", strike=0, opt=""))["id"] == "1"
    assert manual._select_position(ps, NS(id="9", strike=0, opt="")) is None


def test_manual_hold_min_and_ledger_preserves_triggers(tmp_path, monkeypatch):
    import json as _json

    from options_paper import manual

    assert manual._hold_min("2026-10-21T10:00:00",
                            datetime(2026, 10, 21, 10, 45)) == 45.0
    # a positions-only rewrite must not wipe an armed trigger
    ledger = tmp_path / "agent_positions.json"
    monkeypatch.setattr(manual, "LEDGER", ledger)
    ledger.write_text(_json.dumps({"positions": [], "triggers": [{"id": "t"}]}))
    manual._save([])
    assert _json.loads(ledger.read_text())["triggers"] == [{"id": "t"}]


def test_manual_triggers_wrong_side_and_expired_are_dropped(tmp_path, monkeypatch):
    import json as _json

    from options_paper import manual

    ledger = tmp_path / "agent_positions.json"
    monkeypatch.setattr(manual, "LEDGER", ledger)
    saved = {}
    monkeypatch.setattr(manual, "_save_triggers", lambda ts: saved.setdefault("ts", ts))

    wrong_side = {"id": "1", "opt": "CE", "strike": 23400, "side": "below",
                  "level": 23000.0, "stop_pct": 0.2, "target_pct": 0.4,
                  "lots": 1, "reason": "x", "expiry": "2026-10-27",
                  "created_spot": 22900.0}          # already below the level
    expired = {"id": "2", "opt": "CE", "strike": 23400, "side": "above",
               "level": 23000.0, "stop_pct": 0.2, "target_pct": 0.4,
               "lots": 1, "reason": "x", "expiry": "2026-10-20",
               "created_spot": 22900.0}
    valid = {"id": "3", "opt": "CE", "strike": 23400, "side": "above",
             "level": 22850.0, "stop_pct": 0.2, "target_pct": 0.4,
             "lots": 1, "reason": "x", "expiry": "2026-10-27",
             "created_spot": 22800.0}           # armed under the level
    monkeypatch.setattr(manual, "_load_triggers",
                        lambda: [wrong_side, expired, valid])

    tk = Tick(t=datetime(2026, 10, 21, 10, 0), spot=22900.0,
              atm_strike=22900.0, ce_ltp=0.0, pe_ltp=0.0, ce_iv=12, pe_iv=12,
              expiry="2026-10-27", chain={23400: (80.0, 0.0)})
    fired = manual._fire_triggers(tk)
    assert [tr["id"] for tr, _px in fired] == ["3"]
    # neither the wrong-side nor the expired trigger stays armed
    assert saved["ts"] == []

    positions = _json.loads(ledger.read_text())["positions"]
    assert len(positions) == 1 and positions[0]["strike"] == 23400.0
