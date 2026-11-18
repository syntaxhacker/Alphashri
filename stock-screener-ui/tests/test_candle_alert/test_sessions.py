from datetime import datetime

from candle_alert.config import UTC
from candle_alert.sessions import (
    current_sessions,
    next_session,
    session_color,
    session_detail,
    session_label,
)


def _at(hour, minute=0, day=17):
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def test_asian_session():
    assert session_label(_at(2)) == "ASIAN"
    assert session_color("ASIAN") == "#38BDF8"


def test_london_session():
    assert session_label(_at(9)) == "LONDON"
    assert session_color("LONDON") == "#FBBF24"


def test_ny_session():
    assert session_label(_at(18)) == "NY"


def test_london_ny_overlap():
    assert session_label(_at(15)) == "LONDON + NY"
    assert "+" in session_detail(_at(15))


def test_weekend_is_closed():
    assert session_label(_at(12, day=21)) == "MARKET CLOSED"
    assert current_sessions(_at(12, day=21)) == []
    assert session_color("MARKET CLOSED") == "#6B7688"


def test_next_session_after_asian_close():
    name, start = next_session(_at(6, 30))
    assert name == "LONDON"
    assert start == _at(8)


def test_session_detail_shows_ist_countdown():
    detail = session_detail(_at(6, 30))
    assert detail.startswith("MARKET CLOSED · next LONDON")
    assert "13:30 IST" in detail
    assert "in 1h30m" in detail


def test_dst_london_still_active_in_summer():
    summer = datetime(2026, 7, 15, 9, 0, tzinfo=UTC)  # 10:00 BST
    assert "LONDON" in session_label(summer)
