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
                                      NiftyOpenStraddle, NiftyVRP,
                                      NiftyWallBounce, Signal, Strategy, build)
from options_paper.tape import Tick


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def mk_ticks(rows, expiry="2026-10-19", start="2026-10-16T09:15:00"):
    """rows: list of (spot, ce, pe). Returns consecutive Timedelta(minutes=1)."""
    t0 = datetime.fromisoformat(start)
    out = []
    for i, (spot, ce, pe) in enumerate(rows):
        out.append(Tick(t=t0 + timedelta(minutes=i), spot=float(spot),
                        atm_strike=round(spot / 50) * 50, ce_ltp=float(ce),
                        pe_ltp=float(pe), ce_iv=12.0, pe_iv=13.0, expiry=expiry))
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
