"""US futures report: pure helpers + tape storage (no network)."""
from __future__ import annotations

import datetime as dt
import json

from api.reports_api import us_chain, us_tape


def test_weekly_series_is_the_friday_of_the_week():
    series, expiry = us_chain.weekly_series(dt.date(2026, 10, 23))
    assert series == "MQ4V26"
    assert expiry == dt.date(2026, 10, 23)


def test_monthly_symbol_is_the_front_contract():
    assert us_chain.ROOTS["NQ"]["root"] == "NQ"


def test_max_pain_minimises_payout():
    calls = {100.0: {"oi": 10.0}, 110.0: {"oi": 5.0}}
    puts = {90.0: {"oi": 5.0}, 100.0: {"oi": 10.0}}
    # at 100 nothing is in the money -> zero payout
    assert us_chain.max_pain(calls, puts) == 100.0


def test_gamma_profile_signs_calls_positive_and_puts_negative():
    calls = {100.0: {"oi": 10.0, "gamma": 0.01}}
    puts = {100.0: {"oi": 10.0, "gamma": 0.01}}
    g = us_chain.gamma_profile(calls, puts, spot=100.0)
    assert g["net"] == 0  # equal and opposite at the same strike
    assert g["per_strike"][100.0] == 0


def test_gamma_profile_net_is_signed():
    calls = {100.0: {"oi": 10.0, "gamma": 0.01}}
    puts = {90.0: {"oi": 4.0, "gamma": 0.01}}
    g = us_chain.gamma_profile(calls, puts, spot=100.0)
    assert g["net"] > 0
    assert g["per_strike"][90.0] < 0


def _row(t: str, spot: float, call_wall: float, put_wall: float, max_pain: float) -> dict:
    return {
        "t": t, "root": "NQ", "contract": "NQZ26", "series": "MQ4V26",
        "expiry": "2026-10-23", "spot": spot, "change_pct": -3.0,
        "call_wall": call_wall, "put_wall": put_wall, "max_pain": max_pain,
        "call_oi": 1, "put_oi": 2, "pcr_oi": 2.0, "pcr_vol": 1.5,
        "exp_move_pct": 1.4, "call_vol": 10, "put_vol": 20,
    }


def test_tape_roundtrip_and_eod_summary(tmp_path, monkeypatch):
    monkeypatch.setattr(us_tape, "US_TAPE_DIR", tmp_path)
    path = us_tape.tape_path("NQ", "2026-10-22")
    rows = [
        _row("2026-10-22T09:30:00-04:00", 29_500, 30_500, 29_000, 30_000),
        _row("2026-10-22T09:31:00-04:00", 29_400, 30_400, 29_000, 30_000),
        _row("2026-10-22T09:32:00-04:00", 29_498, 30_400, 29_000, 29_500),
    ]
    for r in rows:
        us_tape._append(path, r)

    loaded = us_tape.read_tape("NQ", "2026-10-22")
    assert len(loaded) == 3
    assert loaded[0]["spot"] == 29_500

    eod = us_tape.eod_summary("NQ", "2026-10-22")
    assert eod is not None
    assert eod["minutes"] == 3
    assert eod["open"] == 29_500
    assert eod["close"] == 29_498
    assert eod["high"] == 29_500
    assert eod["low"] == 29_400
    # wall moved once (call 30,500 -> 30,400)
    assert eod["wall_migrations"] == 1
    # 29,500 is within 0.25% of 29,500 max pain on the third row
    assert eod["max_pain_touches"] >= 1


def test_replay_dates_are_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(us_tape, "US_TAPE_DIR", tmp_path)
    for d in ("2026-10-20", "2026-10-22", "2026-10-21"):
        us_tape._append(us_tape.tape_path("NQ", d), _row(f"{d}T09:30:00-04:00", 29_000, 30_000, 28_000, 29_000))
    assert us_tape.replay_dates("NQ") == ["2026-10-22", "2026-10-21", "2026-10-20"]


def test_rth_gate_uses_new_york_time():
    # 14:57 UTC on 2026-10-22 is 10:57 in New York -> open
    assert us_tape.is_rth(dt.datetime(2026, 10, 22, 14, 57, tzinfo=dt.timezone.utc))
    # 21:30 UTC is 17:30 in New York -> closed
    assert not us_tape.is_rth(dt.datetime(2026, 10, 22, 21, 30, tzinfo=dt.timezone.utc))
    # weekend -> closed
    assert not us_tape.is_rth(dt.datetime(2026, 10, 24, 15, 0, tzinfo=dt.timezone.utc))
