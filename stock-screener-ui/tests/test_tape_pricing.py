"""Tape session selection + date-aware official close (no network).

Regression guard for the 25,867 "previous close": the recorder writes
``<date>.gaps.jsonl`` next to the tape, and that stem used to be picked as the
previous session — the lookup then fell through to a February CSV and handed
25,867.30 (the 2026-02-09 close) to the strategy filters for an October
session whose official close was 22,811.35.
"""

from __future__ import annotations

import datetime as dt

import pytest

from options_paper import tape


@pytest.fixture(autouse=True)
def _clean_cache():
    tape._OFFICIAL_CLOSE_CACHE.clear()
    yield
    tape._OFFICIAL_CLOSE_CACHE.clear()


def _write_tape(directory, date_str, spot=22700.0, premium=100.0):
    directory.mkdir(parents=True, exist_ok=True)
    row = {"t": f"{date_str}T15:29:00+05:30", "spot": spot,
           "atm_strike": 22700, "atm_ce_ltp": premium, "atm_pe_ltp": premium,
           "expiry": "2026-10-27"}
    (directory / f"{date_str}.jsonl").write_text(
        '{"bad json"\n' + __import__("json").dumps(row) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Session stems
# ---------------------------------------------------------------------------

def test_available_dates_excludes_gap_logs_and_junk(tmp_path, monkeypatch):
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path)
    for name in ("2026-10-15.jsonl", "2026-10-16.jsonl",
                 "2026-10-16.gaps.jsonl", "2026-10-17.notes.jsonl",
                 "notes.jsonl"):
        (tmp_path / name).write_text("", encoding="utf-8")
    assert tape.available_dates() == ["2026-10-15", "2026-10-16"]


def test_available_dates_missing_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path / "nope")
    assert tape.available_dates() == []


def test_prev_session_close_skips_the_gaps_log_and_uses_the_official_close(
        tmp_path, monkeypatch):
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path)
    _write_tape(tmp_path, "2026-10-15", spot=23100.0)
    _write_tape(tmp_path, "2026-10-16", spot=23120.0)
    (tmp_path / "2026-10-16.gaps.jsonl").write_text(
        '{"t": "2026-10-16T10:00:00+05:30", "reason": "chain fetch failed"}\n',
        encoding="utf-8")
    calls = []

    def fake_official(date_str=None, timeout=10.0):
        calls.append(date_str)
        return {("2026-10-15"): 23200.0, ("2026-10-16"): 23146.30}.get(date_str)

    monkeypatch.setattr(tape, "official_nifty_close", fake_official)

    close = tape.prev_session_close("2026-10-19")

    assert close == pytest.approx(23146.30)  # 10-16, NOT the Feb CSV's 25,867
    assert calls == ["2026-10-16"]           # the .gaps stem was never asked for


def test_prev_session_close_falls_back_to_the_tape_when_official_fails(
        tmp_path, monkeypatch):
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path)
    _write_tape(tmp_path, "2026-10-16", spot=23120.0, premium=100.0)
    monkeypatch.setattr(tape, "official_nifty_close",
                        lambda date_str=None, timeout=10.0: None)
    assert tape.prev_session_close("2026-10-19") == pytest.approx(23120.0)


def test_prev_session_close_uses_the_latest_strictly_earlier_session(
        tmp_path, monkeypatch):
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path)
    _write_tape(tmp_path, "2026-10-15")
    _write_tape(tmp_path, "2026-10-16")
    _write_tape(tmp_path, "2026-10-19")
    seen = []
    monkeypatch.setattr(tape, "official_nifty_close",
                        lambda date_str=None, timeout=10.0: seen.append(date_str) or 1.0)
    tape.prev_session_close("2026-10-19")
    assert seen == ["2026-10-16"]  # today's own tape is never "previous"


def test_prev_session_close_for_today(tmp_path, monkeypatch):
    today = dt.date(2026, 10, 22)
    prev = "2026-10-21"
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path)
    _write_tape(tmp_path, prev, spot=22900.0)
    (tmp_path / f"{prev}.gaps.jsonl").write_text(
        '{"t": "2026-10-21T10:00:00+05:30", "reason": "tick timed out"}\n',
        encoding="utf-8")
    seen = []
    monkeypatch.setattr(
        tape, "official_nifty_close",
        lambda date_str=None, timeout=10.0: seen.append(date_str) or 22811.35)

    assert tape.prev_session_close(today) == pytest.approx(22811.35)
    assert seen == [prev]  # the date BEFORE today, never today's own tape


# ---------------------------------------------------------------------------
# Stale CSV guard
# ---------------------------------------------------------------------------

def _write_csv(path, rows):
    lines = ["date,open,high,low,close,volume"]
    lines += [f"{d},1,1,1,{c},0" for d, c in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_stale_csv_is_ignored(tmp_path, monkeypatch):
    csv_path = tmp_path / "nifty_spot_daily.csv"
    _write_csv(csv_path, [("2026-02-09", 25867.30)])
    monkeypatch.setattr(tape, "SPOT_DAILY", csv_path)
    assert tape._csv_prev_close("2026-10-16") is None


def test_current_csv_is_used(tmp_path, monkeypatch):
    today = dt.date.today()
    yesterday = (today - dt.timedelta(days=1)).isoformat()
    csv_path = tmp_path / "nifty_spot_daily.csv"
    _write_csv(csv_path, [(yesterday, 22800.0)])
    monkeypatch.setattr(tape, "SPOT_DAILY", csv_path)
    assert tape._csv_prev_close(today.isoformat()) == pytest.approx(22800.0)


def test_prev_session_close_without_tape_falls_back_to_a_current_csv(
        tmp_path, monkeypatch):
    monkeypatch.setattr(tape, "TAPE_DIR", tmp_path / "no-tapes")
    today = dt.date.today()
    csv_path = tmp_path / "nifty_spot_daily.csv"
    _write_csv(csv_path, [((today - dt.timedelta(days=1)).isoformat(), 22811.35)])
    monkeypatch.setattr(tape, "SPOT_DAILY", csv_path)
    assert tape.prev_session_close(today.isoformat()) == pytest.approx(22811.35)


# ---------------------------------------------------------------------------
# Date-aware official close
# ---------------------------------------------------------------------------

def test_official_close_routes_past_dates_to_the_daily_candle(monkeypatch):
    today = dt.date.today().isoformat()
    calls = {"daily": [], "live": 0}

    def fake_daily(date_str, timeout=10.0):
        calls["daily"].append(date_str)
        return {"2026-10-16": 23146.30}.get(date_str)

    def fake_live(timeout=10.0):
        calls["live"] += 1
        return 22811.35

    monkeypatch.setattr(tape, "fetch_daily_close", fake_daily)
    monkeypatch.setattr(tape, "fetch_live_close", fake_live)

    assert tape.official_nifty_close("2026-10-16") == pytest.approx(23146.30)
    assert tape.official_nifty_close("2026-10-15") is None
    assert calls["daily"] == ["2026-10-16", "2026-10-15"]
    assert calls["live"] == 0  # a past date never reads today's quote

    assert tape.official_nifty_close(today) == pytest.approx(22811.35)
    assert calls["live"] == 1


def test_official_close_caches_per_date(monkeypatch):
    calls = []

    def fake_daily(date_str, timeout=10.0):
        calls.append(date_str)
        return 23000.0

    monkeypatch.setattr(tape, "fetch_daily_close", fake_daily)
    monkeypatch.setattr(tape, "_is_today", lambda ds: False)

    assert tape.official_nifty_close("2026-10-16") == 23000.0
    assert tape.official_nifty_close("2026-10-16") == 23000.0
    assert calls == ["2026-10-16"]  # second call served from the per-date cache

    assert tape.official_nifty_close("2026-10-15") == 23000.0
    assert calls == ["2026-10-16", "2026-10-15"]  # separate date, separate fetch


def test_official_close_returns_none_without_a_token(monkeypatch):
    monkeypatch.setattr(tape, "upstox_token", lambda: None)
    assert tape.official_nifty_close("2026-10-16") is None


# ---------------------------------------------------------------------------
# Daily candle parsing
# ---------------------------------------------------------------------------

def test_parse_daily_candles_and_close_for_date():
    payload = {"data": {"candles": [
        ["2026-10-16T00:00:00+05:30", 23000, 23150, 22950, 23146.3, 0, 0],
        ["2026-10-15T00:00:00+05:30", 22900, 23000, 22800, 22950.0, 0, 0],
        ["bad-row", 1],
    ]}}
    rows = tape.parse_daily_candles(payload)
    assert [r["date"] for r in rows] == ["2026-10-16", "2026-10-15"]
    assert tape.close_for_date(rows, "2026-10-16") == pytest.approx(23146.3)
    assert tape.close_for_date(rows, "2026-10-13") is None
    assert tape.close_for_date([{"date": "2026-10-16", "close": 0}],
                               "2026-10-16") is None
