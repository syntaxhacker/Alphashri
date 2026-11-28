"""Broker-status expiry must be computed in IST, never against naive UTC.

The stored Upstox ``token_timestamp`` is a naive IST wall clock. Comparing it
against ``datetime.utcnow()`` produced a 5h30m error that reported a long-dead
token as "connected". These tests pin the clock and the stored timestamp so the
arithmetic is reproducible.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import config
from api.brokers import _get_fyers_status, _get_token_status

IST = config.IST


def _frozen_datetime(now_ist: datetime):
    """A datetime stand-in whose now()/utcnow() are pinned to ``now_ist``."""

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now_ist if tz is None or tz == IST else now_ist.astimezone(tz)

        @classmethod
        def utcnow(cls):
            return now_ist.astimezone(timezone.utc).replace(tzinfo=None)

    return FrozenDatetime


def _status(created_naive_ist: str, now_ist: datetime) -> dict:
    """Evaluate status for a token created at ``created_naive_ist`` (naive IST
    string, exactly as stored) evaluated at ``now_ist`` (aware IST)."""
    with patch("api.brokers.datetime", _frozen_datetime(now_ist)):
        with patch("api.brokers._get_upstox_token_from_db", return_value={
            "access_token": "token-under-test",
            "token_timestamp": created_naive_ist,
        }):
            return _get_token_status()


class TestUpstoxExpiryTimezone:
    def test_dead_token_from_measured_bug_reports_disconnected(self):
        # Measured live: created 2026-11-18 03:43:47 IST, evaluated 2026-11-19
        # 08:51 IST. The token died at 2026-11-19 03:30 IST (5h21m earlier).
        now = datetime(2026, 11, 19, 8, 51, tzinfo=IST)
        status = _status("2026-11-18T03:43:47", now)

        assert status["connected"] is False
        assert status["expires_in_hours"] <= 0

    def test_token_created_ten_minutes_ago_is_connected(self):
        now = datetime(2026, 11, 19, 8, 51, tzinfo=IST)
        created = (now - timedelta(minutes=10)).replace(tzinfo=None).isoformat()
        status = _status(created, now)

        assert status["connected"] is True
        # Created after 03:30 IST -> expires next day 03:30 IST, so ~18h39m left.
        assert 18 < status["expires_in_hours"] < 19

    def test_expires_at_is_aware_and_round_trips_to_same_instant(self):
        now = datetime(2026, 11, 19, 8, 51, tzinfo=IST)
        status = _status("2026-11-18T03:43:47", now)

        parsed = datetime.fromisoformat(status["expires_at"])
        assert parsed.tzinfo is not None
        assert parsed.utcoffset() == IST.utcoffset(None)
        assert parsed == datetime(2026, 11, 19, 3, 30, tzinfo=IST)

    def test_near_expiry_eleven_minutes_is_still_connected(self):
        # Expiry is always 03:30 IST; at 03:19 IST exactly 11 minutes remain.
        now = datetime(2026, 11, 19, 3, 19, tzinfo=IST)
        status = _status("2026-11-19T01:00:00", now)

        assert status["connected"] is True
        assert abs(status["expires_in_hours"] - 0.18) < 0.02


def _fyers_status(created_naive_ist: str, now_ist: datetime) -> dict:
    """Same frozen clock, but for the Fyers status row."""
    with patch("api.brokers.datetime", _frozen_datetime(now_ist)):
        with patch("api.brokers.get_shared_broker_token", return_value={
            "access_token": "fyers-token-under-test",
            "token_timestamp": created_naive_ist,
        }):
            return _get_fyers_status()


class TestFyersExpiryTimezone:
    """The same naive-IST bug existed here, one shift in the other direction.

    Fyers treats a missing ``tzinfo`` as UTC and built its own +05:30 offset, so
    a naive-IST row had its wall clock moved 5h30m *backwards* before the expiry
    math — reporting a token dead up to 5.5h early, or alive past its life.
    """

    def test_a_token_created_an_hour_ago_is_connected(self):
        now = datetime(2026, 11, 19, 8, 51, tzinfo=IST)
        created = (now - timedelta(hours=1)).replace(tzinfo=None).isoformat()

        status = _fyers_status(created, now)

        # Fyers expires 06:00 IST next occurrence: 2026-11-20 06:00 -> ~21h left.
        assert status["connected"] is True
        assert 20 < status["expires_in_hours"] < 22

    def test_expires_at_is_aware(self):
        now = datetime(2026, 11, 19, 8, 51, tzinfo=IST)
        status = _fyers_status("2026-11-19T07:51:00", now)

        parsed = datetime.fromisoformat(status["expires_at"])
        assert parsed.tzinfo is not None
        assert parsed.utcoffset() == IST.utcoffset(None)

    def test_a_token_older_than_its_expiry_is_disconnected(self):
        # Created 2026-11-18 01:00 IST -> expires 2026-11-18 06:00 IST, long gone.
        now = datetime(2026, 11, 19, 8, 51, tzinfo=IST)

        status = _fyers_status("2026-11-18T01:00:00", now)

        assert status["connected"] is False
