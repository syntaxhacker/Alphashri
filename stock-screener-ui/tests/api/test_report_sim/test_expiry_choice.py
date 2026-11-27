"""The nearest-expiry rule must keep today's 0-DTE contract while open."""

from api.reports_api.nifty import pick_nearest_expiry


def _exp(date: str, days: int) -> dict:
    return {"date": date, "days_to_expiry": days}


def test_includes_today_while_the_session_is_open():
    expiries = [_exp("2026-11-09", 0), _exp("2026-11-17", 8)]

    chosen = pick_nearest_expiry(expiries, "2026-11-09", include_today=True)

    assert chosen is not None
    assert chosen["date"] == "2026-11-09"


def test_skips_today_after_the_close():
    expiries = [_exp("2026-11-09", 0), _exp("2026-11-17", 8)]

    chosen = pick_nearest_expiry(expiries, "2026-11-09", include_today=False)

    assert chosen is not None
    assert chosen["date"] == "2026-11-17"


def test_date_only_listing_uses_the_same_rule():
    expiries = [{"date": "2026-11-09"}, {"date": "2026-11-17"}]

    assert pick_nearest_expiry(expiries, "2026-11-09", True)["date"] == "2026-11-09"
    assert pick_nearest_expiry(expiries, "2026-11-09", False)["date"] == "2026-11-17"


def test_falls_back_to_the_first_listing_when_nothing_is_eligible():
    expiries = [_exp("2026-11-09", 0)]

    chosen = pick_nearest_expiry(expiries, "2026-11-09", include_today=False)

    assert chosen is not None
    assert chosen["date"] == "2026-11-09"


def test_empty_listing_returns_none():
    assert pick_nearest_expiry([], "2026-11-09", include_today=True) is None
