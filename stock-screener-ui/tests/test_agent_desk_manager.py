"""Pure helpers for scripts/agent_desk_manager.py (no network, no DB).

Focus: the plan is resolved from the CLI/book/ledger (never a stale expiry),
a leg is identified by id/direction (a re-entry at the same strike must not
close the wrong leg), the package P&L is net of costs, and an incomplete EOD
flatten is reported instead of being logged as "done".
"""

from __future__ import annotations

import pytest

from scripts import agent_desk_manager as mgr


# ---------------------------------------------------------------------------
# Ledger parsing + plan resolution
# ---------------------------------------------------------------------------

LEDGER_TEXT = """
## 2026-10-21
- **SHORT STRANGLE** 22,700 PE @ 64.5 + 23,300 CE @ 55.2 = **119.7 credit**
- later note
"""


def test_parse_ledger_strangle():
    parsed = mgr.parse_ledger_strangle(LEDGER_TEXT, default_expiry="2026-10-27")
    assert parsed["expiry"] == "2026-10-27"
    assert parsed["legs"] == {22700.0: "PE", 23300.0: "CE"}
    assert parsed["entries"] == {("PE", 22700.0): 64.5, ("CE", 23300.0): 55.2}


def test_parse_ledger_strangle_takes_the_last_line_and_inline_date():
    text = LEDGER_TEXT + "\nSHORT STRANGLE 22,600 PE @ 70 + 23,400 CE @ 60 (2026-11-03)\n"
    parsed = mgr.parse_ledger_strangle(text, default_expiry="2026-10-27")
    assert parsed["expiry"] == "2026-11-03"
    assert parsed["legs"] == {22600.0: "PE", 23400.0: "CE"}


def test_parse_ledger_strangle_missing_or_bad():
    assert mgr.parse_ledger_strangle("") is None
    assert mgr.parse_ledger_strangle(None) is None
    assert mgr.parse_ledger_strangle("SHORT STRANGLE 0 PE @ x + 0 CE @ y") is None


def test_resolve_plan_prefers_cli_then_book_then_ledger():
    cli = mgr.resolve_plan(cli_expiry="2026-11-03",
                           cli_legs={22800: "CE", 22600: "PE"},
                           positions=[{"opt": "CE", "strike": 23300,
                                       "entry_premium": 50, "expiry": "2026-10-27"}],
                           ledger={"expiry": "2026-10-29",
                                   "legs": {22700: "PE"},
                                   "entries": {("PE", 22700): 64.5}})
    assert cli["expiry"] == "2026-11-03"
    assert cli["legs"] == {22800.0: "CE", 22600.0: "PE"}

    from_book = mgr.resolve_plan(positions=[
        {"opt": "PE", "strike": 22500, "entry_premium": 80.0, "expiry": "2026-10-29"},
        {"opt": "CE", "strike": 23400, "entry_premium": 40.0, "expiry": "2026-10-29"},
    ], ledger={"expiry": "2026-10-27", "legs": {22700: "PE"}, "entries": {}})
    assert from_book["expiry"] == "2026-10-29"
    assert from_book["legs"] == {22500.0: "PE", 23400.0: "CE"}
    assert from_book["entries"][("PE", 22500.0)] == 80.0

    from_ledger = mgr.resolve_plan(positions=[],
                                   ledger={"expiry": "2026-10-29",
                                           "legs": {22700: "PE", 23300: "CE"},
                                           "entries": {("PE", 22700): 64.5}})
    assert from_ledger["expiry"] == "2026-10-29"
    assert from_ledger["legs"] == {22700.0: "PE", 23300.0: "CE"}

    fallback = mgr.resolve_plan()
    assert fallback["expiry"] == mgr.EXPIRY
    assert fallback["legs"] == mgr.DEFAULT_STRANGLE


def test_resolve_plan_ignores_non_option_positions():
    plan = mgr.resolve_plan(positions=[
        {"opt": "STRADDLE", "strike": 22850, "entry_premium": 119.7},
        {"opt": "PE", "strike": None},
        "junk",
    ], ledger=None)
    assert plan["legs"] == mgr.DEFAULT_STRANGLE  # nothing usable -> defaults


def test_threat_levels_from_strikes():
    levels = mgr.threat_levels({22700: "PE", 23300: "CE"}, offset=80)
    assert levels == {"ce": 23220.0, "pe": 22780.0}
    assert mgr.threat_levels({}) == {"ce": None, "pe": None}


# ---------------------------------------------------------------------------
# Leg identification
# ---------------------------------------------------------------------------

POSITIONS = [
    {"id": "a1", "opt": "CE", "strike": 23300.0, "direction": "SHORT",
     "entry_premium": 55.2, "qty": 65},
    {"id": "b2", "opt": "PE", "strike": 23300.0, "direction": "LONG",
     "entry_premium": 40.0, "qty": 65},
]


def test_find_leg_prefers_the_id():
    # Same strike, opposite sides: the id is the only unambiguous key.
    assert mgr.find_leg(POSITIONS, "CE", 23300.0, leg_id="b2") is POSITIONS[1]
    assert mgr.find_leg(POSITIONS, "CE", 23300.0, leg_id="nope") is None


def test_find_leg_matches_side_and_strike_when_unambiguous():
    assert mgr.find_leg(POSITIONS, "PE", 23300.0) is POSITIONS[1]
    assert mgr.find_leg(POSITIONS, "CE", 22700.0) is None


def test_find_leg_refuses_an_ambiguous_match():
    dupes = [POSITIONS[0], {**POSITIONS[0], "id": "a2"}]
    assert mgr.find_leg(dupes, "CE", 23300.0) is None
    # direction alone cannot split two identical SHORT CE legs —
    # only an id can, so the call refuses rather than guessing.
    assert mgr.find_leg(dupes, "CE", 23300.0, direction="SHORT") is None
    # but it does reject a direction that matches nothing
    assert mgr.find_leg(POSITIONS, "CE", 23300.0, direction="LONG") is None


# ---------------------------------------------------------------------------
# Package P&L net of costs
# ---------------------------------------------------------------------------

QUOTES = {
    ("CE", 23300.0): {"ltp": 42.0, "bid": 41.8, "ask": 42.2},
    ("PE", 22700.0): {"ltp": 88.0, "bid": 87.8, "ask": 88.2},
}


def test_package_pnl_is_net_of_costs_and_uses_each_legs_direction():
    positions = [
        {"opt": "CE", "strike": 23300.0, "direction": "SHORT",
         "entry_premium": 55.2, "qty": 65},
        {"opt": "PE", "strike": 22700.0, "direction": "SHORT",
         "entry_premium": 64.5, "qty": 65},
    ]
    out = mgr.package_pnl(positions, QUOTES)
    assert out["open"] == 2 and out["priced"] == 2
    assert out["gross"] == pytest.approx((55.2 - 42.0) * 65 + (64.5 - 88.0) * 65)
    assert out["costs"] > 0
    assert out["net"] == pytest.approx(out["gross"] - out["costs"])
    assert out["net"] < out["gross"]


def test_package_pnl_respects_a_long_leg_at_the_same_strike():
    # The 2026-10-21 bug: a new LONG PE scored against the old SHORT entry.
    long_pe = [{"opt": "PE", "strike": 22700.0, "direction": "LONG",
                "entry_premium": 70.0, "qty": 65}]
    out = mgr.package_pnl(long_pe, {("PE", 22700.0): {"ltp": 90.0}})
    assert out["gross"] == pytest.approx((90.0 - 70.0) * 65)
    assert out["net"] > 0  # profitable long, not a fake -2,395 "cut"


def test_package_pnl_skips_unpriced_legs():
    out = mgr.package_pnl([{"opt": "CE", "strike": 23300.0, "direction": "SHORT",
                            "entry_premium": 55.2, "qty": 65}], {})
    assert out == {"gross": 0.0, "costs": 0.0, "net": 0.0,
                   "priced": 0, "open": 1}


# ---------------------------------------------------------------------------
# Closing + EOD verify (manual plumbing mocked)
# ---------------------------------------------------------------------------

def test_close_leg_books_the_right_leg_and_only_it(monkeypatch):
    positions = [dict(POSITIONS[0]), dict(POSITIONS[1])]
    booked = []
    saved = []
    monkeypatch.setattr(mgr.manual, "_load", lambda: list(positions))
    monkeypatch.setattr(mgr.manual, "_last_tick", lambda: None)
    monkeypatch.setattr(mgr.manual, "_close_position",
                        lambda p, tk, px, reason: booked.append((p["id"], px, reason)) or
                        {"net": 1.0})
    monkeypatch.setattr(mgr.manual, "_save", lambda rows: saved.append(rows))

    res = mgr._close_leg("PE", 23300.0, 41.0, "test", leg_id="b2",
                         direction="LONG")

    assert res == {"net": 1.0}
    assert booked == [("b2", 41.0, "test")]
    assert [p["id"] for p in saved[0]] == ["a1"]  # only the target leg removed


def test_close_leg_refuses_an_ambiguous_leg(monkeypatch):
    dupes = [dict(POSITIONS[0]), dict(POSITIONS[0], id="a2")]
    monkeypatch.setattr(mgr.manual, "_load", lambda: dupes)
    calls = []
    monkeypatch.setattr(mgr.manual, "_close_position",
                        lambda *a, **k: calls.append(a) or {"net": 0.0})
    monkeypatch.setattr(mgr.manual, "_save", lambda rows: calls.append(rows))

    assert mgr._close_leg("CE", 23300.0, 41.0, "test") is None
    assert calls == []  # nothing booked, nothing removed


def test_flatten_and_verify_reports_remaining_legs(monkeypatch):
    remaining = [{"opt": "CE", "strike": 23300.0}]
    calls = []
    monkeypatch.setattr(mgr, "_close_all", lambda *a, **k: calls.append(a))
    monkeypatch.setattr(mgr, "_open_legs", lambda: list(remaining))

    out = mgr._flatten_and_verify("EOD", {}, [], retry=False)

    assert out == remaining
    assert len(calls) == 1


def test_flatten_and_verify_retries_then_clears(monkeypatch):
    state = {"calls": 0}

    def fake_close(*args, **kwargs):
        state["calls"] += 1
        if state["calls"] >= 2:
            state["remaining"] = []

    state["remaining"] = [{"opt": "CE", "strike": 23300.0}]
    monkeypatch.setattr(mgr, "_close_all", fake_close)
    monkeypatch.setattr(mgr, "_open_legs", lambda: list(state["remaining"]))

    assert mgr._flatten_and_verify("EOD", {}, []) == []
    assert state["calls"] == 2  # one retry, then verified flat


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_legs_arg_parser():
    assert mgr._legs_arg("22,700:pe") == {22700.0: "PE"}
    with pytest.raises(Exception):
        mgr._legs_arg("22700")
    with pytest.raises(Exception):
        mgr._legs_arg("22700:XX")
