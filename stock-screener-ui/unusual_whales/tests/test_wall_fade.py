"""Tests for the CME session guard, tick aggregations, and the wall-fade detector."""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import mw_session as S  # noqa: E402
import mw_tickstore as T  # noqa: E402
import wall_fade as W  # noqa: E402
from _tickfile import build_tick_file  # noqa: E402

ET = ZoneInfo("America/New_York")
WALL = 100.0
BASE = 1_790_712_000_000  # an arbitrary ms anchor


# --------------------------------------------------------------- mw_session ---


@pytest.mark.parametrize("when,expected", [
    (datetime(2026, 9, 27, 16, 59, tzinfo=ET), False),  # Sunday pre-open
    (datetime(2026, 9, 27, 17, 0, tzinfo=ET), True),    # Sunday open
    (datetime(2026, 9, 28, 17, 30, tzinfo=ET), False),  # Mon daily halt
    (datetime(2026, 9, 28, 18, 0, tzinfo=ET), True),    # Mon reopen
    (datetime(2026, 9, 29, 9, 30, tzinfo=ET), True),    # RTH
    (datetime(2026, 10, 2, 16, 59, tzinfo=ET), True),   # Friday pre-close
    (datetime(2026, 10, 2, 17, 0, tzinfo=ET), False),   # Friday close
    (datetime(2026, 10, 3, 12, 0, tzinfo=ET), False),   # Saturday
])
def test_cme_futures_open(when, expected):
    assert S.cme_futures_open(when) is expected


def test_next_open_during_daily_halt_is_the_reopen():
    nxt = S.next_open(datetime(2026, 9, 28, 17, 30, tzinfo=ET))
    assert (nxt.hour, nxt.minute) == (18, 0)
    assert nxt.date() == datetime(2026, 9, 28).date()


def test_next_open_on_saturday_is_sunday_1700():
    nxt = S.next_open(datetime(2026, 10, 3, 12, 0, tzinfo=ET))
    assert nxt.weekday() == 6 and (nxt.hour, nxt.minute) == (17, 0)


def test_staleness_not_stale_while_exchange_closed(monkeypatch):
    """The whole point: a 45-min-old tick during the daily halt is EXPECTED."""
    halt = datetime(2026, 9, 28, 17, 30, tzinfo=ET)  # Monday halt
    old = int(halt.timestamp() * 1000) - 45 * 60 * 1000
    monkeypatch.setattr(T, "latest_tick", lambda *a, **k: {"ts": old, "price": 1.0, "instrument": "MNQZ6.CME"})
    st = S.staleness("MNQ", now=halt)
    assert st["open"] is False
    assert st["stale"] is False
    assert st["age_min"] == pytest.approx(45.0, abs=0.2)


def test_staleness_stale_when_open_and_quiet(monkeypatch):
    when = datetime(2026, 9, 29, 11, 0, tzinfo=ET)  # RTH
    old = int(when.timestamp() * 1000) - 20 * 60 * 1000
    monkeypatch.setattr(T, "latest_tick", lambda *a, **k: {"ts": old, "price": 1.0, "instrument": "MNQZ6.CME"})
    st = S.staleness("MNQ", now=when)
    assert st["open"] is True and st["stale"] is True


def test_staleness_fresh_while_open(monkeypatch):
    when = datetime(2026, 9, 29, 11, 0, tzinfo=ET)
    monkeypatch.setattr(T, "latest_tick",
                        lambda *a, **k: {"ts": int(when.timestamp() * 1000) - 30_000, "price": 1.0})
    st = S.staleness("MNQ", now=when)
    assert st["open"] is True and st["stale"] is False


# ------------------------------------------------------------- tick storage ---


def test_decode_ticks_round_trip(tmp_path):
    f = build_tick_file(tmp_path / "b.tick_data", [(100, 100.25, 3, True), (250, 99.75, 7, False)])
    out = T.decode_ticks(f)
    assert [t["ts"] for t in out] == [BASE + 100, BASE + 250]
    assert out[1]["price"] == pytest.approx(99.75)
    assert out[1]["is_ask"] is False and out[0]["is_ask"] is True


def test_volume_profile_poc_and_value_area():
    # flat 6x10 volume at 100..105 -> POC 100, expansion upward to 104
    ticks = [(i, 100.0 + i, 10, True) for i in range(6)]
    p = T.volume_profile(ticks, tick=1.0)
    assert p["poc"] == 100.0
    assert p["vah"] == 104.0
    assert p["val"] == 100.0


def test_volume_profile_expands_down_when_heavier():
    ticks = [(0, 100.0, 5, True), (1, 99.0, 20, True), (2, 98.0, 20, True)]
    p = T.volume_profile(ticks, tick=1.0)
    assert p["poc"] == 99.0
    assert p["val"] <= 98.0


def test_volume_profile_none_without_volume():
    assert T.volume_profile([(0, 100.0, 0, True)], tick=1.0) is None


def test_cumulative_delta_signed_by_side():
    assert T.cumulative_delta([(0, 1, 5, True), (1, 1, 3, False)]) == 2
    assert T.cumulative_delta([(0, 1, 5, False)]) == -5


def test_tick_cache_loads_and_prunes(tmp_path):
    b1 = 1_790_700_000_000
    b2 = b1 + 3_600_000
    build_tick_file(tmp_path / f"RITHMIC/MNQZ6.CME/{b1}.tick_data", [(1, 10.0, 1, True)], block_start=b1)
    build_tick_file(tmp_path / f"RITHMIC/MNQZ6.CME/{b2}.tick_data", [(2, 20.0, 1, True)], block_start=b2)
    cache = T.TickCache("MNQ", root=tmp_path)
    both = cache.load(b1)
    assert [t[1] for t in both] == [10.0, 20.0]
    # a window whose start is past the first block's end must drop it
    late = cache.load(b2 + 1)
    assert [t[1] for t in late] == [20.0]
    assert len(cache._blocks) == 1


def test_tick_cache_repicks_up_a_rewritten_block(tmp_path):
    b = 1_790_700_000_000
    p = tmp_path / f"RITHMIC/MNQZ6.CME/{b}.tick_data"
    build_tick_file(p, [(1, 10.0, 1, True)], block_start=b)
    cache = T.TickCache("MNQ", root=tmp_path)
    assert len(cache.load(0)) == 1
    build_tick_file(p, [(1, 10.0, 1, True), (2, 11.0, 1, True)], block_start=b)  # MotiveWave rewrote it
    assert len(cache.load(0)) == 2


# --------------------------------------------------------------- wall_fade ---


def ticks(*seq, base=BASE):
    """seq: (ms_offset, price, volume, is_ask)"""
    return [(base + o, p, v, a) for o, p, v, a in seq]


def failed_breakout(*, delta_negative=True, retest=False, vol=10, tail=70):
    """Arm above the wall, cross below at +6s, then hold below."""
    out = [(0, 100.5, vol, True), (1000, 101.0, vol, True), (6000, 99.5, vol, not delta_negative)]
    for i in range(7, tail):
        px = 99.0 - i * 0.01
        if retest and i == 20:
            px = 100.4  # poke back above the wall mid-window
        out.append((i * 1000, px, vol, not delta_negative))
    return ticks(*out)


def levels(wall=WALL):
    return {"symbol": "MNQZ6", "price": 99.0, "basis": 5.0,
            "levels": [{"key": "call_wall", "mnq": wall}, {"key": "gamma_flip", "mnq": 98.0},
                       {"key": "gamma_magnet", "mnq": 95.0}, {"key": "put_wall", "mnq": 95.0}]}


def test_detect_fires_on_failed_breakout():
    sig = W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                   now_ms=BASE + 80_000, confirm_s=60, min_vol=100)
    assert sig is not None and sig["kind"] == "fade"
    assert sig["failure_high"] == pytest.approx(101.0)
    assert sig["stop"] == pytest.approx(103.5)  # failure high + 2.5 buffer
    assert sig["entry"] == pytest.approx(99.5)  # the cross
    assert sig["entry_confirm"] < WALL
    assert sig["cvd"] < 0 and sig["rr"] > 0


def test_detect_ignores_when_wall_never_reached():
    t = ticks((0, 98.0, 10, True), (1000, 97.0, 10, False), (70_000, 96.0, 10, False))
    assert W.detect(levels(), t, wall=WALL, target=90.0, now_ms=BASE + 80_000) is None


def test_detect_requires_negative_delta():
    sig = W.detect(levels(), failed_breakout(delta_negative=False), wall=WALL, target=90.0,
                   now_ms=BASE + 80_000, confirm_s=60, min_vol=100)
    assert sig is None


def test_detect_survives_a_retest_of_the_wall():
    """A poke back above the wall mid-window must not invalidate the failure."""
    sig = W.detect(levels(), failed_breakout(retest=True), wall=WALL, target=90.0,
                   now_ms=BASE + 80_000, confirm_s=60, min_vol=100)
    assert sig is not None and sig["kind"] == "fade"


def test_detect_waits_for_the_confirmation_window():
    assert W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                    now_ms=BASE + 7_000, confirm_s=60, min_vol=100) is None


def test_detect_ignores_thin_volume():
    assert W.detect(levels(), failed_breakout(vol=1), wall=WALL, target=90.0,
                    now_ms=BASE + 80_000, confirm_s=60, min_vol=200) is None


def test_detect_ignores_when_target_is_above_entry():
    assert W.detect(levels(), failed_breakout(), wall=WALL, target=99.4,
                    now_ms=BASE + 80_000, confirm_s=60, min_vol=100) is None


def test_detect_ignores_a_stale_cross():
    """Walls drift; a cross from 6+ min ago must not alert in live mode."""
    assert W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                    now_ms=BASE + 400_000, confirm_s=60, min_vol=100, freshness_s=120) is None


def test_detect_replay_mode_ignores_freshness():
    sig = W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                   now_ms=BASE + 400_000, confirm_s=60, min_vol=100, freshness_s=None)
    assert sig is not None and sig["kind"] == "fade"


def test_detect_emits_accept_signal_when_wall_holds():
    t = ticks(*[(i * 1000, 101.0 + i * 0.001, 10, True) for i in range(0, 1300, 10)])
    sig = W.detect(levels(), t, wall=WALL, target=90.0, now_ms=BASE + 2_000_000, accept_min=20)
    assert sig is not None and sig["kind"] == "accept"
    assert sig["entry"] is None


def test_detect_no_accept_signal_before_hold_period():
    t = ticks(*[(i * 1000, 101.0, 10, True) for i in range(0, 300, 10)])
    assert W.detect(levels(), t, wall=WALL, target=90.0, now_ms=BASE + 400_000, accept_min=20) is None


def test_detect_accept_requires_positive_delta():
    t = ticks(*[(i * 1000, 101.0, 10, False) for i in range(0, 1300, 10)])
    assert W.detect(levels(), t, wall=WALL, target=90.0, now_ms=BASE + 2_000_000, accept_min=20) is None


def test_detect_handles_empty_ticks():
    assert W.detect(levels(), [], wall=WALL, target=90.0, now_ms=BASE) is None


def test_format_alert_mentions_stop_and_disclaimer():
    sig = W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                   now_ms=BASE + 80_000, confirm_s=60, min_vol=100)
    msg = W.format_alert(sig)
    assert "FAILED BREAKOUT" in msg and "stop" in msg and "Not advice" in msg


def test_store_is_idempotent_per_session(tmp_path):
    con = W.connect(tmp_path / "s.db")
    sig = W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                   now_ms=BASE + 80_000, confirm_s=60, min_vol=100)
    assert W.store(con, sig) is True
    assert W.store(con, sig) is False  # same setup, same trigger -> deduped
    assert con.execute("SELECT COUNT(*) FROM signals").fetchone()[0] == 1


def test_store_allows_distinct_setups_in_one_session(tmp_path):
    con = W.connect(tmp_path / "s.db")
    first = W.detect(levels(), failed_breakout(), wall=WALL, target=90.0,
                     now_ms=BASE + 80_000, confirm_s=60, min_vol=100)
    second = dict(first, trigger_at_ms=first["trigger_at_ms"] + 3_600_000)
    assert W.store(con, first) is True
    assert W.store(con, second) is True  # a genuinely different setup
    assert con.execute("SELECT COUNT(*) FROM signals").fetchone()[0] == 2
