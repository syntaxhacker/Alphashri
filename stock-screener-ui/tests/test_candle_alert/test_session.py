from datetime import datetime

from candle_alert.config import UTC
from candle_alert.session import IST, next_close_ist, previous_4h_close_ist


def test_next_close_ist_one_hour():
    now = datetime(2026, 11, 17, 4, 30, tzinfo=UTC)  # 10:00 IST, Tuesday
    close = next_close_ist(60, now)
    assert close.astimezone(IST).strftime("%H:%M") == "10:15"


def test_next_close_ist_four_hour():
    now = datetime(2026, 11, 17, 4, 30, tzinfo=UTC)  # 10:00 IST
    close = next_close_ist(240, now)
    assert close.astimezone(IST).strftime("%H:%M") == "13:15"


def test_next_close_ist_skips_weekend():
    now = datetime(2026, 11, 20, 11, 30, tzinfo=UTC)  # Friday 17:00 IST, after last close
    close = next_close_ist(60, now)
    local = close.astimezone(IST)
    assert local.weekday() == 0  # Monday
    assert local.strftime("%H:%M") == "10:15"


def test_previous_4h_close_ist():
    now = datetime(2026, 11, 17, 4, 30, tzinfo=UTC)  # 10:00 IST, before 13:15
    close = previous_4h_close_ist(now)
    assert close.astimezone(IST).strftime("%Y-%m-%d %H:%M") == "2026-11-16 13:15"

    after = datetime(2026, 11, 17, 9, 0, tzinfo=UTC)  # 14:30 IST, after 13:15
    assert previous_4h_close_ist(after).astimezone(IST).strftime("%H:%M") == "13:15"
