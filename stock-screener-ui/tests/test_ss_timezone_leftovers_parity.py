"""Parity pins for the IST fork bodies consolidated out of candles/chart-patterns.

The pinned values were captured from the pre-refactor helpers (65 probes); this
file keeps the observable outputs and the delegation contract frozen so a future
change to the canonical helpers cannot silently alter candle caching or tails.
"""
from __future__ import annotations

import ast
import inspect
import textwrap
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest

import config
import trading.utils as trading_utils
from api import chart_patterns as cp_api
from chart_patterns import candles
from chart_patterns import _ist_date
from trading import calendar as tcal

IST = config.IST


def _frame(index):
    return pd.DataFrame({"close": [1.0] * len(index)}, index=index)


@pytest.fixture
def no_holidays(monkeypatch):
    monkeypatch.setattr(trading_utils, "is_trading_holiday", lambda d: False)


# --- frame_last_date: 18:30Z pinning, degenerate indexes, canonical source ---

@pytest.mark.parametrize(
    "index,expected",
    [
        (pd.DatetimeIndex(["2026-01-29 18:30:00"]), "2026-01-30"),
        (pd.DatetimeIndex(["2026-01-29 00:00:00"]), "2026-01-29"),
        (pd.DatetimeIndex(["2026-01-29 18:30:00"], tz="UTC"), "2026-01-30"),
        (pd.DatetimeIndex(["2026-01-30 00:15:00"], tz=IST), "2026-01-30"),
        (pd.DatetimeIndex(["2026-01-30 00:15:00"], tz="Asia/Kolkata"), "2026-01-30"),
        (pd.RangeIndex(3), None),
        (pd.DatetimeIndex([pd.NaT]), None),
    ],
)
def test_frame_last_date_pinned(index, expected):
    assert candles.frame_last_date(_frame(index)) == expected


def test_frame_last_date_delegates_to_canonical_ist_date(monkeypatch):
    seen = []
    real = _ist_date.ist_date

    def spy(value):
        seen.append(value)
        return real(value)

    monkeypatch.setattr(_ist_date, "ist_date", spy)
    frame = _frame(pd.DatetimeIndex(["2026-01-29 18:30:00"], tz="UTC"))
    assert candles.frame_last_date(frame) == "2026-01-30"
    assert seen == [pd.Timestamp("2026-01-29 18:30:00", tz="UTC")]


# --- last completed session: pinned outputs + canonical delegation ----------

@pytest.mark.parametrize(
    "now,expected",
    [
        (datetime(2026, 10, 2, 16, 0, tzinfo=IST), "2026-10-02"),
        (datetime(2026, 10, 2, 15, 30, tzinfo=IST), "2026-10-02"),
        (datetime(2026, 10, 2, 10, 0, tzinfo=IST), "2026-10-01"),
        (datetime(2026, 10, 3, 12, 0, tzinfo=IST), "2026-10-02"),
        (datetime(2026, 10, 4, 12, 0, tzinfo=IST), "2026-10-02"),
        (datetime(2026, 10, 2, 16, 0), "2026-10-02"),
        (datetime(2026, 10, 2, 16, 0, tzinfo=timezone.utc), "2026-10-02"),
        # Plain dates are the documented divergence from trading.calendar:
        # the candle helper treats a date as already past the 15:30 close.
        (date(2026, 10, 2), "2026-10-02"),
        (date(2026, 10, 3), "2026-10-02"),
    ],
)
def test_last_completed_session_pinned(no_holidays, now, expected):
    assert candles._last_completed_session(now).isoformat() == expected


def test_last_completed_session_preserves_holiday_and_calendar_error_policy(monkeypatch):
    monkeypatch.setattr(
        trading_utils,
        "is_trading_holiday",
        lambda d: (d.date() if isinstance(d, datetime) else d) == date(2026, 10, 5),
    )
    monday = datetime(2026, 10, 5, 16, 0, tzinfo=IST)
    assert candles._last_completed_session(monday) == date(2026, 10, 2)

    def boom(d):
        raise RuntimeError("calendar down")

    monkeypatch.setattr(trading_utils, "is_trading_holiday", boom)
    assert candles._last_completed_session(datetime(2026, 10, 2, 16, 0, tzinfo=IST)) == date(2026, 10, 2)


def test_last_completed_session_keeps_365_day_cap():
    ref = date(2026, 10, 2)
    only_session = ref - timedelta(days=370)
    broken = lambda d: (d.date() if isinstance(d, datetime) else d) != only_session
    original = trading_utils.is_trading_holiday
    try:
        trading_utils.is_trading_holiday = broken
        assert candles._last_completed_session(ref) == date(2026, 10, 1)
    finally:
        trading_utils.is_trading_holiday = original


def test_last_completed_session_injects_clock_and_predicate(monkeypatch):
    frozen = datetime(2026, 10, 2, 16, 0, tzinfo=IST)
    monkeypatch.setattr(candles, "_now_ist", lambda: frozen)
    assert candles._last_completed_session() == date(2026, 10, 2)

    monkeypatch.setattr(candles, "_is_trading_day", lambda d: False)
    assert candles._last_completed_session() == date(2026, 10, 1)
    assert tcal.last_completed_session_lenient(
        frozen, day_check=lambda d: False
    ) == date(2026, 10, 1)


def test_last_completed_session_fork_is_a_thin_wrapper():
    tree = ast.parse(textwrap.dedent(inspect.getsource(candles._last_completed_session)))
    fn = tree.body[0]
    body = ast.dump(fn)
    assert "last_completed_session_lenient" in body
    assert not any(
        isinstance(node, (ast.While, ast.For, ast.AsyncFor))
        or (isinstance(node, ast.Attribute) and node.attr in {"tz_convert", "tz_localize", "isoformat"})
        or (isinstance(node, ast.Name) and node.id == "MARKET_CLOSE")
        for node in ast.walk(fn)
    )


def test_now_ist_reads_the_canonical_timezone():
    now = candles._now_ist()
    assert now.utcoffset() == timedelta(hours=5, minutes=30)
    assert now.tzinfo is config.IST


# --- api/chart_patterns: period-bar partial flag -----------------------------

@pytest.mark.parametrize(
    "bar,now,expected",
    [
        ("2026-10-07 10:00:00+00:00", "2026-10-08 10:00:00", True),
        ("2026-10-07 10:00:00+00:00", "2026-11-02 10:00:00", False),
        ("2026-10-07 04:45:00+00:00", "2026-10-08 10:00:00", True),
    ],
)
def test_period_bar_partial_pinned(bar, now, expected):
    assert cp_api._period_bar_partial(bar, "1W", now) is expected
    assert cp_api._period_bar_partial(bar, "1M", now) is expected


@pytest.mark.parametrize(
    "value",
    ["2026-10-02 09:15:00", "2026-10-02 03:45:00+00:00", "2026-10-02 09:15:00+05:30"],
)
def test_local_timestamp_config_ist_matches_kolkata_zone(value):
    assert cp_api._local_timestamp(value, config.IST).isoformat() == \
        cp_api._local_timestamp(value, "Asia/Kolkata").isoformat()
    assert cp_api._now_timestamp(value, config.IST).isoformat() == \
        cp_api._now_timestamp(value, "Asia/Kolkata").isoformat()
