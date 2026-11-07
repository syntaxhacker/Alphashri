"""Tests for scripts/eval_unwind_pnl.py — pure helpers only, no network/tapes.

Fixtures build tape rows with a per-strike ``chain`` (``{strike: [ce, pe]}``),
mirroring the real tape shape. The rolling ``atm_*_ltp`` snapshot is
deliberately present in the drift fixture to prove it is ignored.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from eval_unwind_pnl import (  # noqa: E402
    apply_cost,
    dedupe_events,
    event_bearish,
    event_to_action,
    find_bar_at_or_after,
    hold_minutes,
    last_bar_exit,
    next_bar_entry,
    stop_target_exit,
    summarize,
)

from datetime import datetime  # noqa: E402


def _crow(t: str, atm_strike: float, quotes: dict,
          atm_ce: float | None = None) -> dict:
    """One tape row: ``quotes`` maps strike -> (ce, pe); None = dead leg."""
    return {
        "t": t,
        "atm_strike": float(atm_strike),
        "atm_ce_ltp": atm_ce,  # rolling snapshot — helpers must ignore it
        "chain": {str(s): [ce, pe, None, None, None, None]
                  for s, (ce, pe) in quotes.items()},
    }


# --- event -> action mapping -------------------------------------------

def test_put_unwind_buys_ce():
    assert event_to_action({"side": "put", "delta": -9_000_000}) == "CE"


def test_call_unwind_buys_pe():
    assert event_to_action({"side": "call", "delta": -5_000_000}) == "PE"


def test_builds_and_zero_delta_are_skipped():
    assert event_to_action({"side": "put", "delta": 9_000_000}) is None
    assert event_to_action({"side": "call", "delta": 3_000_000}) is None
    assert event_to_action({"side": "put", "delta": 0}) is None


def test_unknown_side_or_bad_delta_skipped():
    assert event_to_action({"side": "coil", "delta": -1}) is None
    assert event_to_action({"side": "put", "delta": None}) is None
    assert event_to_action({}) is None


# --- direction comes from the burst flow, not a fixed side rule ------------

def test_put_liquidation_is_bearish_and_buys_the_pe():
    event = {"side": "put", "delta": -9_000_000, "flow": "liquidation",
             "bearish": True}
    assert event_bearish(event) is True
    assert event_to_action(event) == "PE"


def test_put_squeeze_is_a_breakdown_and_buys_the_pe():
    event = {"side": "put", "delta": -9_000_000, "flow": "covering",
             "bearish": False, "type": "squeeze"}
    # A squeeze is momentum: a put squeeze is spot breaking BELOW the put
    # wall, so the follow-through trade is the PE (not the legacy CE).
    assert event_bearish(event) is False
    assert event_to_action({"side": "put", "delta": -9_000_000,
                            "type": "squeeze"}) == "PE"


def test_put_covering_is_bullish_and_buys_the_ce():
    event = {"side": "put", "delta": -9_000_000, "flow": "covering"}
    assert event_bearish(event) is False
    assert event_to_action(event) == "CE"
    assert event_to_action({"side": "call", "delta": -1, "bearish": False}) == "CE"


def test_call_unwind_with_liquidation_is_bearish_and_buys_the_pe():
    event = {"side": "call", "delta": -5_000_000, "flow": "liquidation"}
    assert event_bearish(event) is True
    assert event_to_action(event) == "PE"


def test_unclassified_unwind_keeps_the_legacy_reading():
    assert event_bearish({"side": "put", "delta": -1}) is None
    assert event_to_action({"side": "put", "delta": -1}) == "CE"
    assert event_to_action({"side": "call", "delta": -1}) == "PE"
    assert event_bearish(None) is None


# --- next-bar entry (no lookahead, same strike) -------------------------

def test_entry_is_next_bar_same_strike_premium():
    rows = [_crow("2026-10-21T15:03:00+05:30", 22700, {22700: (100.0, 170.0)}),
            _crow("2026-10-21T15:04:00+05:30", 22700, {22700: (105.0, 168.0)}),
            _crow("2026-10-21T15:05:00+05:30", 22700, {22700: (110.0, 165.0)})]
    assert next_bar_entry(rows, 0, 22700, "CE") == (1, 105.0)


def test_entry_skips_bars_missing_the_strike():
    rows = [_crow("2026-10-21T15:03:00+05:30", 22700, {22700: (100.0, 170.0)}),
            _crow("2026-10-21T15:04:00+05:30", 22750, {22750: (90.0, 200.0)}),
            _crow("2026-10-21T15:05:00+05:30", 22750,
                  {22700: (110.0, 165.0), 22750: (88.0, 205.0)})]
    assert next_bar_entry(rows, 0, 22700, "CE") == (2, 110.0)


def test_entry_none_when_strike_never_quoted():
    rows = [_crow("2026-10-21T15:03:00+05:30", 22700, {22700: (100.0, 170.0)}),
            _crow("2026-10-21T15:04:00+05:30", 22750, {22750: (90.0, 200.0)})]
    assert next_bar_entry(rows, 0, 22700, "CE") is None


def test_entry_uses_pe_leg_for_call_unwind():
    rows = [_crow("2026-10-21T15:03:00+05:30", 22700, {22700: (100.0, 200.0)}),
            _crow("2026-10-21T15:04:00+05:30", 22700, {22700: (102.0, 190.0)})]
    assert next_bar_entry(rows, 0, 22700, "PE") == (1, 190.0)


def test_chainless_rows_have_no_entry():
    rows = [{"t": "2026-10-21T15:03:00+05:30", "atm_ce_ltp": 100.0},
            {"t": "2026-10-21T15:04:00+05:30", "atm_ce_ltp": 105.0}]
    assert next_bar_entry(rows, 0, 22700, "CE") is None


# --- ATM-drift regression -------------------------------------------------

def _drift_rows() -> list[dict]:
    """ATM rolls 22700 -> 22750 while the fixed 22700 CE keeps rising.

    The rolling ATM CE *falls* (180 -> 160) because it is a different,
    further-OTM contract — the artifact that made 15:04 look like -₹1,662.
    """
    return [
        _crow("2026-10-21T15:04:00+05:30", 22700,
              {22700: (180.0, 170.0)}, atm_ce=180.0),   # event bar
        _crow("2026-10-21T15:05:00+05:30", 22700,
              {22700: (181.0, 169.0)}, atm_ce=181.0),   # entry bar
        _crow("2026-10-21T15:15:00+05:30", 22750,
              {22700: (195.0, 150.0), 22750: (90.0, 260.0)},
              atm_ce=160.0),                            # ATM rolled
    ]


def test_pnl_follows_fixed_strike_not_atm():
    rows = _drift_rows()
    entry = next_bar_entry(rows, 0, 22700, "CE")
    assert entry == (1, 181.0)
    eod = last_bar_exit(rows, 1, 22700, "CE")
    assert eod == (2, 195.0)  # the 22700 CE, not the 160.0 ATM print
    assert apply_cost(181.0, 195.0)["net"] > 0


def test_naive_atm_exit_would_show_a_loss():
    # Documents the artifact: same entry, rolling-ATM exit prints a loss.
    assert apply_cost(181.0, 160.0)["net"] < 0


# --- stop / target --------------------------------------------------------

def test_target_hit_first():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:05:00+05:30", 22700, {22700: (110.0, 0.0)}),
            _crow("2026-10-21T15:06:00+05:30", 22700, {22700: (130.0, 0.0)}),
            _crow("2026-10-21T15:07:00+05:30", 22700, {22700: (80.0, 0.0)})]
    assert stop_target_exit(rows, 0, 100.0, 22700, "CE") == (2, 130.0, "target")


def test_stop_hit_first():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:05:00+05:30", 22700, {22700: (90.0, 0.0)}),
            _crow("2026-10-21T15:06:00+05:30", 22700, {22700: (84.0, 0.0)}),
            _crow("2026-10-21T15:07:00+05:30", 22700, {22700: (130.0, 0.0)})]
    assert stop_target_exit(rows, 0, 100.0, 22700, "CE") == (2, 84.0, "stop")


def test_missing_strike_bar_cannot_trigger_touch():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:05:00+05:30", 22750, {22750: (5.0, 400.0)}),
            _crow("2026-10-21T15:06:00+05:30", 22750,
                  {22700: (130.0, 0.0), 22750: (6.0, 390.0)})]
    # The 5.0 print belongs to 22750, not the tracked strike — no stop.
    assert stop_target_exit(rows, 0, 100.0, 22700, "CE") == (2, 130.0, "target")


def test_no_touch_falls_back_to_eod():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:05:00+05:30", 22700, {22700: (105.0, 0.0)}),
            _crow("2026-10-21T15:30:00+05:30", 22750,
                  {22700: (110.0, 0.0), 22750: (90.0, 0.0)})]
    assert stop_target_exit(rows, 0, 100.0, 22700, "CE") == (2, 110.0, "eod_fallback")


# --- horizon / eod exits --------------------------------------------------

def test_horizon_picks_bar_at_15m():
    rows = [_crow(f"2026-10-21T15:{m:02d}:00+05:30", 22700,
                  {22700: (100.0 + m, 0.0)}) for m in range(4, 30)]
    when = datetime.fromisoformat("2026-10-21T15:19:00+05:30")
    j, px = find_bar_at_or_after(rows, 0, when, 22700, "CE")
    assert rows[j]["t"].startswith("2026-10-21T15:19") and px == 119.0


def test_horizon_past_close_falls_back_to_last_quote():
    rows = [_crow("2026-10-21T15:28:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:29:00+05:30", 22700, {22700: (101.0, 0.0)})]
    when = datetime.fromisoformat("2026-10-21T16:00:00+05:30")
    assert find_bar_at_or_after(rows, 0, when, 22700, "CE") == (1, 101.0)


def test_horizon_bar_missing_strike_uses_last_known():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:19:00+05:30", 22750, {22750: (90.0, 0.0)}),
            _crow("2026-10-21T15:20:00+05:30", 22750,
                  {22700: (108.0, 0.0), 22750: (91.0, 0.0)})]
    when = datetime.fromisoformat("2026-10-21T15:19:00+05:30")
    # The 15:19 bar has no 22,700 print, so the exit is the first bar at/after
    # the horizon that DOES quote the tracked strike — never the 22,750 print.
    assert find_bar_at_or_after(rows, 0, when, 22700, "CE") == (2, 108.0)


def test_horizon_dead_leg_is_unpriced_not_the_entry_print():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:19:00+05:30", 22750, {22750: (90.0, 0.0)}),
            _crow("2026-10-21T15:25:00+05:30", 22750, {22750: (92.0, 0.0)})]
    when = datetime.fromisoformat("2026-10-21T15:19:00+05:30")
    # The leg never printed after the fill: no honest exit price exists, so the
    # helper returns None rather than inventing a flat trade at 100.0.
    assert find_bar_at_or_after(rows, 0, when, 22700, "CE") is None
    assert stop_target_exit(rows, 0, 100.0, 22700, "CE") == (None, 0.0, "unpriced")


def test_eod_is_last_quote_of_tracked_strike():
    rows = [_crow("2026-10-21T15:28:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:29:00+05:30", 22750, {22750: (90.0, 0.0)}),
            _crow("2026-10-21T15:30:00+05:30", 22750,
                  {22700: (102.0, 0.0), 22750: (91.0, 0.0)})]
    assert last_bar_exit(rows, 0, 22700, "CE") == (2, 102.0)


def test_hold_minutes():
    rows = [_crow("2026-10-21T15:04:00+05:30", 22700, {22700: (100.0, 0.0)}),
            _crow("2026-10-21T15:19:00+05:30", 22700, {22700: (110.0, 0.0)})]
    assert hold_minutes(rows, 0, 1) == 15.0


# --- costs -----------------------------------------------------------------

def test_long_costs_net_below_gross():
    r = apply_cost(100.0, 125.0, qty=65)
    assert r["gross"] == round((125.0 - 100.0) * 65, 2)
    assert r["costs"] > 0
    assert r["net"] == round(r["gross"] - r["costs"], 2)


def test_stop_loss_is_negative_net_of_costs():
    r = apply_cost(100.0, 85.0, qty=65)
    assert r["net"] < 0


# --- dedupe / summarize -----------------------------------------------------

def test_dedupe_keeps_first_within_5m():
    evs = [{"t": "2026-10-21T15:04:00+05:30"},
           {"t": "2026-10-21T15:06:00+05:30"},  # 2m later -> dropped
           {"t": "2026-10-21T15:10:00+05:30"}]  # 6m later -> kept
    kept = dedupe_events(evs)
    assert [e["t"][11:16] for e in kept] == ["15:04", "15:10"]


def test_dedupe_is_per_side():
    evs = [
        {"t": "2026-10-21T15:04:00+05:30", "side": "put"},
        {"t": "2026-10-21T15:05:00+05:30", "side": "call"},  # other side: kept
        {"t": "2026-10-21T15:06:00+05:30", "side": "put"},   # same side: dropped
        {"t": "2026-10-21T15:10:00+05:30", "side": "put"},   # 6m: kept
    ]
    kept = dedupe_events(evs)
    assert [(e["t"][11:16], e["side"]) for e in kept] == [
        ("15:04", "put"), ("15:05", "call"), ("15:10", "put")]


def test_dedupe_drops_unparseable_timestamps():
    assert dedupe_events([{"t": "bad"}, {"t": None}]) == []


def test_summarize_math():
    s = summarize([{"net": 100.0}, {"net": -50.0}, {"net": 200.0}])
    assert s == {"n": 3, "win_rate": 66.7, "total": 250.0,
                 "avg": 83.33, "best": 200.0, "worst": -50.0,
                 "unpriced": 0}


def test_summarize_counts_unpriced_and_excludes_them_from_the_averages():
    s = summarize([{"net": 100.0}, {"net": None}, {"net": -40.0}])
    assert s["n"] == 2
    assert s["unpriced"] == 1
    assert s["total"] == 60.0
    assert s["avg"] == 30.0
    assert s["best"] == 100.0 and s["worst"] == -40.0


def test_summarize_empty():
    assert summarize([])["n"] == 0
