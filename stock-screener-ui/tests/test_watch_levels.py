"""Unit tests for the --require-close helpers in scripts/watch_levels.py.

Pure logic only: no network, no clock (``now`` is passed in).
"""

from datetime import datetime, timedelta, timezone

import pytest

from scripts.watch_levels import (
    _arm,
    bar_closes_beyond,
    consume_complete_lines,
    last_completed_bar,
)

IST = timezone(timedelta(hours=5, minutes=30))


def _row(t: str, spot) -> dict:
    return {"t": t, "spot": spot}


def test_excludes_forming_bar():
    rows = [
        _row("2026-10-21T10:00:10+05:30", 22680.0),  # completed minute
        _row("2026-10-21T10:00:50+05:30", 22675.0),  # completed minute close
        _row("2026-10-21T10:01:05+05:30", 22650.0),  # forming bar: excluded
    ]
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22675.0


def test_only_forming_bar_returns_none():
    rows = [_row("2026-10-21T10:01:05+05:30", 22650.0)]
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    assert last_completed_bar(rows, now) is None


def test_hour_boundary():
    rows = [
        _row("2026-10-21T09:59:40+05:30", 22700.0),
        _row("2026-10-21T10:00:05+05:30", 22690.0),  # forming at 10:00:30
    ]
    now = datetime.fromisoformat("2026-10-21T10:00:30+05:30")
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22700.0


def test_midnight_boundary():
    rows = [
        _row("2026-10-20T23:59:50+05:30", 22710.0),
        _row("2026-10-21T00:00:10+05:30", 22720.0),  # forming at 00:00:40
    ]
    now = datetime.fromisoformat("2026-10-21T00:00:40+05:30")
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22710.0


def test_future_rows_excluded():
    rows = [
        _row("2026-10-21T10:00:50+05:30", 22675.0),
        _row("2026-10-21T10:05:00+05:30", 22000.0),  # clock skew / future
    ]
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22675.0


def test_below_close_checks():
    assert bar_closes_beyond({"spot": 22689.0}, "below", 22690.0) is True
    assert bar_closes_beyond({"spot": 22690.0}, "below", 22690.0) is True
    assert bar_closes_beyond({"spot": 22691.7}, "below", 22690.0) is False


def test_above_close_checks():
    assert bar_closes_beyond({"spot": 22801.0}, "above", 22800.0) is True
    assert bar_closes_beyond({"spot": 22800.0}, "above", 22800.0) is True
    assert bar_closes_beyond({"spot": 22799.5}, "above", 22800.0) is False


def test_bar_closes_beyond_bad_input():
    assert bar_closes_beyond(None, "below", 22690.0) is False
    assert bar_closes_beyond({}, "below", 22690.0) is False
    assert bar_closes_beyond({"spot": "junk"}, "below", 22690.0) is False
    assert bar_closes_beyond({"spot": 22680.0}, "sideways", 22690.0) is False


def test_malformed_rows_skipped():
    rows = [
        {"t": "not-a-time", "spot": 22600.0},   # bad t
        {"t": "2026-10-21T10:00:10+05:30"},      # missing spot
        {"t": "2026-10-21T10:00:20+05:30", "spot": "junk"},  # bad spot
        {"t": "2026-10-21T10:00:30+05:30", "spot": 0},       # bad tick
        {"t": "2026-10-21T10:00:40+05:30", "spot": -5},      # bad tick
        "not-a-dict",
        None,
        _row("2026-10-21T10:00:50+05:30", 22675.0),  # only good row
    ]
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22675.0


def test_empty_tape_returns_none():
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    assert last_completed_bar([], now) is None


def test_all_malformed_returns_none():
    rows = [{"t": "bad", "spot": "bad"}, {"nope": 1}]
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    assert last_completed_bar(rows, now) is None


def test_naive_now_assumed_ist():
    rows = [_row("2026-10-21T10:00:50+05:30", 22675.0)]
    now = datetime(2026, 10, 21, 10, 1, 30)  # naive -> IST
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22675.0


def test_close_triggers_only_on_bar_close_not_tick():
    # The desk case: tick pierced to 22691.7 but the bar closed at 22695.
    rows = [
        _row("2026-10-21T10:00:50+05:30", 22695.0),  # bar close above trigger
        _row("2026-10-21T10:01:05+05:30", 22691.7),  # live pierce (forming)
        _row("2026-10-21T10:01:20+05:30", 22689.0),  # live pierce (forming)
    ]
    now = datetime.fromisoformat("2026-10-21T10:01:30+05:30")
    bar = last_completed_bar(rows, now)
    assert bar is not None
    assert bar["spot"] == 22695.0
    assert bar_closes_beyond(bar, "below", 22690.0) is False


# ---------------------------------------------------------------------------
# Pre-trigger buffer
# ---------------------------------------------------------------------------

def _levels(side, level):
    return [{"side": side, "level": level, "label": "x"}]


def test_arm_uses_pre_pct_buffer_when_it_exceeds_the_floor():
    levels = _levels("below", 22500.0)
    _arm(levels, 22700.0, 0.95, 2.0)  # 5% of 200 pts = 10 pts
    assert levels[0]["buffer"] == pytest.approx(10.0)
    assert levels[0]["trigger"] == pytest.approx(22510.0)


def test_arm_uses_the_min_buffer_floor_for_a_near_level():
    levels = _levels("below", 22699.0)  # only 1 pt away
    _arm(levels, 22700.0, 0.95, 2.0)
    # the 2-pt floor is CAPPED at the 1-pt distance, so the trigger never
    # arms beyond the starting spot (22701 would fire instantly)
    assert levels[0]["buffer"] == pytest.approx(1.0)
    assert levels[0]["trigger"] == pytest.approx(22700.0)


def test_arm_floor_is_capped_at_distance():
    levels = _levels("below", 22690.0)  # 10 pts away, floor 50
    _arm(levels, 22700.0, 0.95, 50.0)
    assert levels[0]["buffer"] == pytest.approx(10.0)
    assert levels[0]["trigger"] == pytest.approx(22700.0)


def test_arm_clamps_pre_pct():
    levels = _levels("below", 22600.0)
    _arm(levels, 22700.0, 2.0, 0.0)  # >1 clamped to 1 -> fire AT the level
    assert levels[0]["trigger"] == pytest.approx(22600.0)
    levels = _levels("below", 22600.0)
    _arm(levels, 22700.0, -1.0, 0.0)  # <0 clamped to 0 -> fire at spot
    assert levels[0]["trigger"] == pytest.approx(22700.0)


def test_arm_level_already_through_spot_has_no_negative_distance():
    levels = _levels("above", 22600.0)  # already through the level
    _arm(levels, 22700.0, 0.95, 2.0)
    assert levels[0]["distance"] == 0.0
    # no negative buffer: the trigger stays at the level (fires next tick)
    assert levels[0]["buffer"] == 0.0
    assert levels[0]["trigger"] == pytest.approx(22600.0)


# ---------------------------------------------------------------------------
# Partial-line buffer
# ---------------------------------------------------------------------------

def test_consume_complete_lines_keeps_the_partial_tail():
    lines, rest = consume_complete_lines("", '{"a": 1}\n{"b": 2}\n{"c"')
    assert lines == ['{"a": 1}', '{"b": 2}']
    assert rest == '{"c"'


def test_consume_complete_lines_reassembles_across_chunks():
    first_lines, rest = consume_complete_lines("", '{"half"')
    assert first_lines == [] and rest == '{"half"'
    lines, rest = consume_complete_lines(rest, ': 3}\n{"next": 4}\n')
    assert lines == ['{"half": 3}', '{"next": 4}']
    assert rest == ""


def test_consume_complete_lines_empty_input():
    assert consume_complete_lines("", "") == ([], "")
    assert consume_complete_lines("abc", "") == ([], "abc")
