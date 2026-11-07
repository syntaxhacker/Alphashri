"""Pure-parser tests for scripts/market_clock.py (no network, no DB writes)."""
import pytest

from scripts.market_clock import (
    classify_status,
    next_holiday,
    parse_holidays_payload,
    parse_status_payload,
    parse_timings_payload,
    render,
)

pytestmark = pytest.mark.unit


def test_classify_status_buckets():
    assert classify_status("NORMAL_OPEN") == "OPEN"
    assert classify_status("normal_open") == "OPEN"
    # short/special-session variants are tradable, not CLOSED
    assert classify_status("OPEN") == "OPEN"
    assert classify_status("SPECIAL_OPEN") == "OPEN"
    assert classify_status("special_open") == "OPEN"
    for pre in ("PRE_OPEN_START", "PRE_OPEN_END"):
        assert classify_status(pre) == "PRE_OPEN"
    for closed in ("NORMAL_CLOSE", "CLOSING_START", "CLOSING_END", None, "", "WEIRD_NEW"):
        assert classify_status(closed) == "CLOSED"


def test_status_applies_only_to_today():
    from scripts.market_clock import status_applies_to_date, status_for_date

    assert status_applies_to_date("2026-10-21", "2026-10-21") is True
    assert status_applies_to_date("2026-10-20", "2026-10-21") is False
    assert status_applies_to_date("2026-10-22", "2026-10-21") is False
    assert status_applies_to_date("", "2026-10-21") is False

    # A past date must NOT borrow today's live OPEN status.
    past = status_for_date("NSE", "2026-10-16", "2026-10-21", raw="NORMAL_OPEN")
    assert past["state"] == "CLOSED" and past["live"] is False
    assert "live-only" in past["note"]

    today = status_for_date("NSE", "2026-10-21", "2026-10-21", raw="SPECIAL_OPEN")
    assert today["state"] == "OPEN" and today["live"] is True


def test_parse_status_open_and_cas():
    payload = {"status": "success", "data": {
        "exchange": "NSE", "status": "NORMAL_OPEN", "last_updated": 1705549500000,
        "cas_eligible_status": {"status": "CTS_CLOSE", "last_updated": 1705570500000}}}
    parsed = parse_status_payload(payload)
    assert parsed == {"exchange": "NSE", "raw": "NORMAL_OPEN", "state": "OPEN",
                      "last_updated": 1705549500000, "cas_status": "CTS_CLOSE"}


def test_parse_status_malformed():
    assert parse_status_payload({})["state"] == "CLOSED"
    assert parse_status_payload(None)["state"] == "CLOSED"
    assert parse_status_payload({"data": "junk"})["state"] == "CLOSED"
    assert parse_status_payload({"status": "success", "data": {"exchange": "NSE"}})["state"] == "CLOSED"


def test_parse_timings_nse_ist():
    # 1704080700000 = 2024-01-01 03:45:00 UTC = 09:15 IST (NSE open)
    payload = {"status": "success", "data": [
        {"exchange": "MCX", "start_time": 1704079800000, "end_time": 1704108600000},
        {"exchange": "NSE", "start_time": 1704080700000, "end_time": 1704103200000},
    ]}
    assert parse_timings_payload(payload, "NSE") == {"exchange": "NSE", "start": "09:15", "end": "15:30"}
    assert parse_timings_payload(payload, "BSE") == {"exchange": "BSE", "start": None, "end": None}
    assert parse_timings_payload({}, "NSE") == {"exchange": "NSE", "start": None, "end": None}


def test_parse_holidays_filters_exchange():
    payload = {"status": "success", "data": [
        {"date": "2024-01-22", "description": "Holiday A", "holiday_type": "TRADING_HOLIDAY",
         "closed_exchanges": ["NSE"], "open_exchanges": [{"exchange": "MCX"}]},
        {"date": "2024-01-26", "description": "Republic Day", "holiday_type": "TRADING_HOLIDAY",
         "closed_exchanges": ["NSE", "BSE"], "open_exchanges": []},
        {"date": "2024-02-01", "description": "NSE-only session", "holiday_type": "SPECIAL_TIMING",
         "closed_exchanges": ["BSE"], "open_exchanges": [{"exchange": "NSE"}]},
    ]}
    holidays = parse_holidays_payload(payload, "NSE")
    assert [h["date"] for h in holidays] == ["2024-01-22", "2024-01-26"]
    # BSE sees all three: listed closed on 01-26/02-01, and absent from both
    # lists on 01-22 (conservative: not provably open → treated as closed)
    assert [h["date"] for h in parse_holidays_payload(payload, "BSE")] == ["2024-01-22", "2024-01-26", "2024-02-01"]
    assert parse_holidays_payload({}, "NSE") == []
    assert parse_holidays_payload(None, "NSE") == []


def test_next_holiday_picks_first_on_or_after():
    holidays = [{"date": "2024-01-22", "description": "A"}, {"date": "2024-01-26", "description": "B"}]
    assert next_holiday(holidays, "2024-01-22")["date"] == "2024-01-22"
    assert next_holiday(holidays, "2024-01-23")["date"] == "2024-01-26"
    assert next_holiday(holidays, "2024-02-01") is None
    assert next_holiday([], "2024-01-01") is None


def test_render_block():
    clock = {"exchange": "NSE", "date": "2024-01-22", "errors": [],
             "status": {"state": "OPEN", "raw": "NORMAL_OPEN"},
             "session": {"exchange": "NSE", "start": "09:15", "end": "15:30"},
             "next_holiday": {"date": "2024-01-26", "description": "Republic Day"}}
    text = render(clock)
    assert "OPEN" in text and "09:15" in text and "2024-01-26" in text
