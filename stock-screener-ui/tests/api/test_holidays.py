"""
Tests for Holidays API endpoints.

Tests the /api/holidays endpoints for:
- Listing holidays with filters (year, type, date range)
- Checking if a specific date is a holiday
- Getting trading dates in a date range
"""

import sys
from pathlib import Path
from datetime import date

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class TestHolidaysAPI:
    """Tests for GET /api/holidays."""

    def test_empty_holidays_list(self, client, db):
        response = client.get("/api/holidays")
        assert response.status_code == 200
        data = response.json()
        assert "holidays" in data
        assert data["holidays"] == []

    def test_list_holidays_after_seed(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2026, 3, 3), description="Holi", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2026, 2, 19), description="Chhatrapati Shivaji Maharaj Jayanti", type=HolidayType.CLEARING))
        db.commit()

        response = client.get("/api/holidays")
        assert response.status_code == 200
        data = response.json()
        assert len(data["holidays"]) == 3

        dates = [h["date"] for h in data["holidays"]]
        assert dates == ["2026-01-26", "2026-02-19", "2026-03-03"]

    def test_filter_by_year(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2025, 12, 25), description="Christmas", type=HolidayType.TRADING))
        db.commit()

        response = client.get("/api/holidays?year=2026")
        assert response.status_code == 200
        data = response.json()
        assert len(data["holidays"]) == 1
        assert data["holidays"][0]["date"] == "2026-01-26"

    def test_filter_by_type_trading(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2026, 2, 19), description="CSMJ", type=HolidayType.CLEARING))
        db.commit()

        response = client.get("/api/holidays?type=trading")
        assert response.status_code == 200
        data = response.json()
        assert len(data["holidays"]) == 1
        assert data["holidays"][0]["type"] == "trading"

    def test_filter_by_type_clearing(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2026, 2, 19), description="CSMJ", type=HolidayType.CLEARING))
        db.commit()

        response = client.get("/api/holidays?type=clearing")
        assert response.status_code == 200
        data = response.json()
        assert len(data["holidays"]) == 1
        assert data["holidays"][0]["type"] == "clearing"

    def test_filter_by_date_range(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 15), description="Municipal Election", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.add(MarketHoliday(date=date(2026, 3, 3), description="Holi", type=HolidayType.TRADING))
        db.commit()

        response = client.get("/api/holidays?from_date=2026-01-20&to_date=2026-02-01")
        assert response.status_code == 200
        data = response.json()
        assert len(data["holidays"]) == 1
        assert data["holidays"][0]["date"] == "2026-01-26"

    def test_invalid_date_range_ignored(self, client, db):
        response = client.get("/api/holidays?from_date=not-a-date")
        assert response.status_code == 200

    def test_holiday_response_shape(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.commit()

        response = client.get("/api/holidays")
        data = response.json()
        h = data["holidays"][0]
        assert "date" in h
        assert "description" in h
        assert "type" in h
        assert h["date"] == "2026-01-26"
        assert h["description"] == "Republic Day"
        assert h["type"] == "trading"

    def test_unique_date_constraint(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType
        from sqlalchemy.exc import IntegrityError

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.commit()

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Duplicate", type=HolidayType.TRADING))
        with pytest.raises(IntegrityError):
            db.commit()


class TestHolidayCheck:
    """Tests for GET /api/holidays/check."""

    def test_check_trading_holiday(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.commit()

        response = client.get("/api/holidays/check?date=2026-01-26")
        assert response.status_code == 200
        data = response.json()
        assert data["is_holiday"] is True
        assert data["type"] == "trading"
        assert data["description"] == "Republic Day"

    def test_check_clearing_holiday(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 2, 19), description="CSMJ", type=HolidayType.CLEARING))
        db.commit()

        response = client.get("/api/holidays/check?date=2026-02-19")
        assert response.status_code == 200
        data = response.json()
        assert data["is_holiday"] is True
        assert data["type"] == "clearing"

    def test_check_weekend(self, client, db):
        response = client.get("/api/holidays/check?date=2026-01-17")
        assert response.status_code == 200
        data = response.json()
        assert data["is_holiday"] is True
        assert data["type"] == "weekend"

    def test_check_sunday(self, client, db):
        response = client.get("/api/holidays/check?date=2026-01-18")
        assert response.status_code == 200
        data = response.json()
        assert data["is_holiday"] is True
        assert data["type"] == "weekend"

    def test_check_normal_day(self, client, db):
        response = client.get("/api/holidays/check?date=2026-01-20")
        assert response.status_code == 200
        data = response.json()
        assert data["is_holiday"] is False
        assert data["type"] is None

    def test_check_invalid_date(self, client, db):
        response = client.get("/api/holidays/check?date=not-a-date")
        assert response.status_code == 200
        data = response.json()
        assert data["is_holiday"] is False

    def test_check_missing_date_param(self, client, db):
        response = client.get("/api/holidays/check")
        assert response.status_code == 422


class TestTradingDates:
    """Tests for GET /api/holidays/trading-dates."""

    def test_trading_dates_basic(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 1, 26), description="Republic Day", type=HolidayType.TRADING))
        db.commit()

        response = client.get("/api/holidays/trading-dates?from_date=2026-01-23&to_date=2026-01-28")
        assert response.status_code == 200
        data = response.json()
        assert "trading_dates" in data
        assert "total" in data
        assert "2026-01-26" not in data["trading_dates"]
        assert "2026-01-23" in data["trading_dates"]
        assert "2026-01-27" in data["trading_dates"]

    def test_trading_dates_excludes_weekends(self, client, db):
        response = client.get("/api/holidays/trading-dates?from_date=2026-01-16&to_date=2026-01-21")
        assert response.status_code == 200
        data = response.json()
        for d in data["trading_dates"]:
            dt = date.fromisoformat(d)
            assert dt.weekday() < 5, f"{d} is a weekend"

    def test_trading_dates_excludes_holidays(self, client, db):
        from db.models.holiday import MarketHoliday, HolidayType

        db.add(MarketHoliday(date=date(2026, 3, 3), description="Holi", type=HolidayType.TRADING))
        db.commit()

        response = client.get("/api/holidays/trading-dates?from_date=2026-03-02&to_date=2026-03-05")
        data = response.json()
        assert "2026-03-03" not in data["trading_dates"]
        assert "2026-03-02" in data["trading_dates"]
        assert "2026-03-04" in data["trading_dates"]

    def test_trading_dates_invalid_range(self, client, db):
        response = client.get("/api/holidays/trading-dates?from_date=bad&to_date=bad")
        assert response.status_code == 200
        data = response.json()
        assert data["trading_dates"] == []
        assert data["total"] == 0
