"""Tests for trading/calendar.py market-calendar helper."""

import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import trading.calendar as cal
from trading.timezone import IST


def _no_holidays(monkeypatch):
    monkeypatch.setattr(cal, "is_trading_holiday", lambda d=None: False)


def test_weekend_is_not_trading_day(monkeypatch):
    _no_holidays(monkeypatch)
    assert cal.is_trading_day(date(2026, 1, 17)) is False  # Saturday
    assert cal.is_trading_day(date(2026, 1, 18)) is False  # Sunday
    assert cal.is_trading_day(datetime(2026, 1, 17, 10, 0, tzinfo=IST)) is False


def test_weekday_is_trading_day(monkeypatch):
    _no_holidays(monkeypatch)
    assert cal.is_trading_day(date(2026, 1, 20)) is True  # Tuesday
    assert cal.is_trading_day(datetime(2026, 1, 20, 10, 0, tzinfo=IST)) is True


def test_last_completed_session_from_weekend_returns_friday(monkeypatch):
    _no_holidays(monkeypatch)
    # Saturday -> Friday
    assert cal.last_completed_session(datetime(2026, 1, 17, 10, 0, tzinfo=IST)) == date(
        2026, 1, 16
    )
    # Sunday -> Friday
    assert cal.last_completed_session(datetime(2026, 1, 18, 10, 0, tzinfo=IST)) == date(
        2026, 1, 16
    )
    # Monday pre-open -> Friday
    assert cal.last_completed_session(datetime(2026, 1, 19, 9, 0, tzinfo=IST)) == date(
        2026, 1, 16
    )


def test_trading_holiday_is_skipped(monkeypatch):
    holidays = {date(2026, 1, 26)}  # Monday
    monkeypatch.setattr(cal, "is_trading_holiday", lambda d=None: (
        (d.date() if isinstance(d, datetime) else d) in holidays
    ))
    assert cal.is_trading_day(date(2026, 1, 26)) is False
    # Tuesday after the holiday, before close -> previous session skips
    # Monday holiday, so back to Friday Jan 23.
    assert cal.last_completed_session(datetime(2026, 1, 27, 10, 0, tzinfo=IST)) == date(
        2026, 1, 23
    )


def test_last_completed_session_before_close_is_previous_day(monkeypatch):
    _no_holidays(monkeypatch)
    # Tuesday 10:00 (before 15:30) -> Monday
    assert cal.last_completed_session(datetime(2026, 1, 20, 10, 0, tzinfo=IST)) == date(
        2026, 1, 19
    )


def test_last_completed_session_after_close_is_today(monkeypatch):
    _no_holidays(monkeypatch)
    # Exactly at close counts as completed.
    assert cal.last_completed_session(datetime(2026, 1, 20, 15, 30, tzinfo=IST)) == date(
        2026, 1, 20
    )
    # After close -> today.
    assert cal.last_completed_session(datetime(2026, 1, 20, 16, 5, tzinfo=IST)) == date(
        2026, 1, 20
    )


def test_next_session_open_same_day_before_open(monkeypatch):
    _no_holidays(monkeypatch)
    assert cal.next_session_open(datetime(2026, 1, 20, 9, 0, tzinfo=IST)) == datetime(
        2026, 1, 20, 9, 15, tzinfo=IST
    )


def test_next_session_open_across_weekend(monkeypatch):
    _no_holidays(monkeypatch)
    # Friday after close -> Monday 09:15.
    assert cal.next_session_open(datetime(2026, 1, 16, 16, 0, tzinfo=IST)) == datetime(
        2026, 1, 19, 9, 15, tzinfo=IST
    )
    # Saturday -> Monday 09:15.
    assert cal.next_session_open(datetime(2026, 1, 17, 10, 0, tzinfo=IST)) == datetime(
        2026, 1, 19, 9, 15, tzinfo=IST
    )


def test_next_session_open_skips_holiday(monkeypatch):
    holidays = {date(2026, 1, 26)}  # Monday holiday
    monkeypatch.setattr(cal, "is_trading_holiday", lambda d=None: (
        (d.date() if isinstance(d, datetime) else d) in holidays
    ))
    # Friday Jan 23 after close -> Tuesday Jan 27 09:15 (skips weekend + holiday).
    assert cal.next_session_open(datetime(2026, 1, 23, 16, 0, tzinfo=IST)) == datetime(
        2026, 1, 27, 9, 15, tzinfo=IST
    )


def test_session_stamp(monkeypatch):
    _no_holidays(monkeypatch)
    assert (
        cal.session_stamp(datetime(2026, 1, 20, 16, 0, tzinfo=IST)) == "2026-01-20"
    )
    assert (
        cal.session_stamp(datetime(2026, 1, 20, 10, 0, tzinfo=IST)) == "2026-01-19"
    )
