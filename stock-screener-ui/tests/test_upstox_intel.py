"""Pure-function tests for scripts/upstox_intel.py (no network, no DB writes)."""
import argparse

import pytest

from scripts.upstox_intel import (
    _current_week_tuesday,
    _expiry_param,
    build_payload,
    parse_change_oi_payload,
    parse_fii_dii_payload,
    parse_max_pain_payload,
    parse_news_items,
    parse_oi_payload,
    parse_pcr_payload,
    render,
    top_change_oi,
)

pytestmark = pytest.mark.unit


def _args(**overrides):
    base = {
        "date": "2026-10-21",
        "expiry": "current_week",
        "news_limit": 5,
        "timeout": 10.0,
    }
    base.update(overrides)
    return argparse.Namespace(**base)


# ---------------------------------------------------------------------------
# OI
# ---------------------------------------------------------------------------
def test_parse_oi_enveloped():
    payload = {"status": "success", "data": {"total_call_oi": 100.0, "total_put_oi": 80.0}}
    assert parse_oi_payload(payload) == {"total_call_oi": 100.0, "total_put_oi": 80.0}


def test_parse_oi_official_key_names():
    # documented shape: total_calls / total_puts
    payload = {"status": "success", "data": {"total_calls": 9800000, "total_puts": 12500000}}
    assert parse_oi_payload(payload) == {"total_call_oi": 9800000.0, "total_put_oi": 12500000.0}


def test_parse_oi_missing_and_malformed():
    assert parse_oi_payload({}) == {"total_call_oi": None, "total_put_oi": None}
    assert parse_oi_payload(None) == {"total_call_oi": None, "total_put_oi": None}
    assert parse_oi_payload({"data": "junk"}) == {"total_call_oi": None, "total_put_oi": None}
    assert parse_oi_payload({"data": {"total_call_oi": "x", "total_put_oi": float("nan")}}) == {
        "total_call_oi": None,
        "total_put_oi": None,
    }


# ---------------------------------------------------------------------------
# change in OI + top-5
# ---------------------------------------------------------------------------
CHANGE_FIXTURE = {
    "status": "success",
    "data": {
        "total_call_change_oi": 5000.0,
        "total_put_change_oi": -3000.0,
        "call_put_oi_data_list": [
            {"strike_price": 26000, "call_change_oi": 100, "put_change_oi": 50},
            {"strike_price": 26100, "call_change_oi": -4000, "put_change_oi": 100},
            {"strike_price": 26200, "call_change_oi": 10, "put_change_oi": 9000},
            {"strike_price": 26300, "call_change_oi": 500, "put_change_oi": -600},
            {"strike_price": 26400, "call_change_oi": 200, "put_change_oi": 100},
            {"strike_price": 26500, "call_change_oi": 50, "put_change_oi": 40},
            {"strike_price": 26600, "call_change_oi": 0, "put_change_oi": 0},
        ],
    },
}


def test_parse_change_oi_totals_and_sides():
    parsed = parse_change_oi_payload(CHANGE_FIXTURE)
    assert parsed["total_call_change_oi"] == 5000.0
    assert parsed["total_put_change_oi"] == -3000.0
    assert len(parsed["rows"]) == 7
    by_strike = {r["strike"]: r for r in parsed["rows"]}
    assert by_strike[26100.0]["side"] == "call"  # |-4000| > |100|
    assert by_strike[26200.0]["side"] == "put"  # |9000| > |10|
    assert by_strike[26300.0]["side"] == "put"
    assert by_strike[26200.0]["total"] == pytest.approx(9010.0)


def test_top_change_oi_selects_five_strongest():
    parsed = parse_change_oi_payload(CHANGE_FIXTURE)
    top = top_change_oi(parsed["rows"])
    assert len(top) == 5
    strikes = [r["strike"] for r in top]
    assert strikes[0] == 26200.0  # |9010| combined dominates
    assert strikes[1] == 26100.0
    assert 26600.0 not in strikes  # zero move never makes the cut
    assert 26500.0 not in strikes


def test_parse_change_oi_skips_malformed_rows():
    payload = {
        "data": {
            "total_call_change_oi": 1,
            "total_put_change_oi": 2,
            "call_put_oi_data_list": [
                "junk",
                {"no_strike": 1},
                {"strike_price": "x", "call_change_oi": 5, "put_change_oi": 5},
                {"strike_price": 26000},
            ],
        }
    }
    parsed = parse_change_oi_payload(payload)
    assert len(parsed["rows"]) == 1
    assert parsed["rows"][0]["strike"] == 26000.0
    assert parsed["rows"][0]["call"] == 0.0


def test_parse_change_oi_malformed_payload():
    assert parse_change_oi_payload(None)["rows"] == []
    assert parse_change_oi_payload({})["rows"] == []
    assert parse_change_oi_payload({"data": []})["rows"] == []


# ---------------------------------------------------------------------------
# max pain / PCR / FII-DII
# ---------------------------------------------------------------------------
def test_parse_max_pain():
    parsed = parse_max_pain_payload(
        {"status": "success", "data": {"max_pain_strike": 26000, "spot_price": 26123.45}}
    )
    assert parsed == {"max_pain": 26000.0, "spot": 26123.45}


def test_parse_max_pain_official_shape():
    # documented shape: max_pain + spot_closing_price + insights
    parsed = parse_max_pain_payload(
        {
            "status": "success",
            "data": {
                "max_pain": 24050.0,
                "spot_closing_price": 24044.35,
                "insights": [{"max_pain": 24050.0, "spot_price": 23988.3, "time": "15:15"}],
            },
        }
    )
    assert parsed == {"max_pain": 24050.0, "spot": 24044.35}


def test_parse_max_pain_spot_falls_back_to_last_insight():
    parsed = parse_max_pain_payload(
        {
            "data": {
                "max_pain": 24050.0,
                "insights": [
                    {"spot_price": 23955.0, "time": "09:15"},
                    {"spot_price": 23988.3, "time": "15:15"},
                ],
            }
        }
    )
    assert parsed == {"max_pain": 24050.0, "spot": 23988.3}


def test_parse_max_pain_aliases_and_missing():
    assert parse_max_pain_payload({"data": {"max_pain": 1, "spot": 2}}) == {
        "max_pain": 1.0,
        "spot": 2.0,
    }
    assert parse_max_pain_payload({}) == {"max_pain": None, "spot": None}
    assert parse_max_pain_payload(None) == {"max_pain": None, "spot": None}


def test_parse_pcr():
    assert parse_pcr_payload({"status": "success", "data": {"pcr": 0.92}}) == pytest.approx(0.92)
    assert parse_pcr_payload({"data": {"pcr_oi": 1.1}}) == pytest.approx(1.1)
    assert parse_pcr_payload({"data": 0.5}) == pytest.approx(0.5)
    assert parse_pcr_payload({}) is None
    assert parse_pcr_payload(None) is None
    assert parse_pcr_payload({"data": {"pcr": "x"}}) is None


def test_parse_fii_dii_latest_interval_wins():
    payload = {
        "status": "success",
        "data": {
            "NSE_EQ|CASH": [
                {"time_stamp": 1777401000000, "buy_amount": 1000, "sell_amount": 900},
                {"time_stamp": 1777487400000, "buy_amount": 1200, "sell_amount": 1500},
            ]
        },
    }
    assert parse_fii_dii_payload(payload) == {"buy": 1200.0, "sell": 1500.0, "net": -300.0}


def test_parse_fii_dii_prefers_cash_segment():
    payload = {
        "data": {
            "NSE_FO|STOCK_FUTURES": [
                {"time_stamp": 1777487400000, "buy_amount": 999, "sell_amount": 1}
            ],
            "NSE_EQ|CASH": [
                {"time_stamp": 1777487400000, "buy_amount": 100, "sell_amount": 60}
            ],
        }
    }
    assert parse_fii_dii_payload(payload) == {"buy": 100.0, "sell": 60.0, "net": 40.0}


def test_parse_fii_dii_derives_net_and_degrades():
    assert parse_fii_dii_payload({"data": {"buy_value": 500, "sell_value": 700}}) == {
        "buy": 500.0,
        "sell": 700.0,
        "net": -200.0,
    }
    assert parse_fii_dii_payload({}) == {"buy": None, "sell": None, "net": None}
    assert parse_fii_dii_payload(None) == {"buy": None, "sell": None, "net": None}
    assert parse_fii_dii_payload({"data": []}) == {"buy": None, "sell": None, "net": None}
    assert parse_fii_dii_payload({"data": ["junk"]}) == {"buy": None, "sell": None, "net": None}


# ---------------------------------------------------------------------------
# news
# ---------------------------------------------------------------------------
def test_parse_news_items_mapping_and_ist_conversion():
    # documented shape: {instrument_key: [items]}, published_time = epoch ms
    payload = {
        "status": "success",
        "data": {
            "NSE_EQ|INE002A01018": [
                {
                    "heading": "Old story",
                    "article_link": "https://x.test/old",
                    "published_time": 1792468800000,  # 2026-10-20 09:30 IST
                },
                {
                    "heading": "New story",
                    "article_link": "https://x.test/new",
                    "published_time": 1792555200000,  # 2026-10-21 09:30 IST
                },
            ]
        },
    }
    items = parse_news_items(payload, limit=5)
    assert len(items) == 2
    assert items[0]["heading"] == "New story"
    assert items[0]["published_ist"] == "10-21 09:30 IST"
    assert items[0]["link"] == "https://x.test/new"
    assert items[1]["published_ist"] == "10-20 09:30 IST"


def test_parse_news_items_limit_and_skips():
    payload = {
        "data": [
            {"heading": "", "article_link": "https://x.test/blank"},  # skipped: no heading
            "junk",  # skipped: not a dict
            {"heading": "A", "published_time": "not-a-date"},
            {"heading": "B", "published_time": "2026-10-21T04:00:00+05:30"},
        ]
    }
    items = parse_news_items(payload, limit=1)
    assert len(items) == 1
    assert items[0]["published_ist"] == "10-21 04:00 IST"  # already IST, unchanged
    items = parse_news_items(payload, limit=5)
    assert [i["heading"] for i in items] == ["B", "A"]
    assert items[1]["published_ist"] == "—"  # bad date degrades, item kept


def test_parse_news_items_malformed():
    assert parse_news_items(None) == []
    assert parse_news_items({}) == []
    assert parse_news_items({"data": "junk"}) == []


# ---------------------------------------------------------------------------
# expiry param
# ---------------------------------------------------------------------------
def test_expiry_param_current_week_defers_to_upstox():
    assert _expiry_param("current_week") == {"expiry": "current_week"}
    assert _expiry_param(None) == {"expiry": "current_week"}
    assert _expiry_param("2026-10-28") == {"expiry": "2026-10-28"}


def test_current_week_tuesday():
    assert _current_week_tuesday("2026-10-21") == "2026-10-27"  # Wed -> Tue
    assert _current_week_tuesday("2026-10-27") == "2026-10-27"  # Tue -> today
    assert _current_week_tuesday("2026-10-26") == "2026-10-27"  # Mon -> Tue
    assert _current_week_tuesday("2026-10-28") == "2026-11-03"  # Wed -> next Tue


def test_build_payload_retries_null_keyword_with_tuesday(monkeypatch):
    import scripts.upstox_intel as intel

    calls: list[dict] = []

    def fake_get(path, params, timeout):
        calls.append({"path": path, "params": dict(params)})
        if path == "/market/oi":
            if params.get("expiry") == "current_week":
                return {"status": "success", "data": None}
            return {
                "status": "success",
                "data": {"total_calls": 10, "total_puts": 20, "expiry": "27-10-2026"},
            }
        raise RuntimeError("boom")

    monkeypatch.setattr(intel, "_get", fake_get)
    monkeypatch.setattr(intel, "resolve_news_keys", lambda: [])

    payload = build_payload(_args())
    assert payload["oi"] == {"total_call_oi": 10.0, "total_put_oi": 20.0}
    assert payload["resolved_expiry"] == "27-10-2026"
    oi_calls = [c for c in calls if c["path"] == "/market/oi"]
    assert [c["params"]["expiry"] for c in oi_calls] == ["current_week", "2026-10-27"]


# ---------------------------------------------------------------------------
# graceful degradation
# ---------------------------------------------------------------------------
def test_build_payload_degrades_per_source(monkeypatch):
    import scripts.upstox_intel as intel

    def fake_get(path, params, timeout):
        if path == "/market/pcr":
            return {"status": "success", "data": {"pcr": 1.05}}
        if path == "/market/fii":
            return {"status": "success", "data": [{"buy_value": 1, "sell_value": 2, "net_value": -1}]}
        raise RuntimeError("boom")

    monkeypatch.setattr(intel, "_get", fake_get)
    monkeypatch.setattr(intel, "resolve_news_keys", lambda: ["NSE_EQ|INE002A01018"])

    payload = build_payload(_args())
    assert payload["pcr"] == pytest.approx(1.05)
    assert payload["fii"] == {"buy": 1.0, "sell": 2.0, "net": -1.0}
    assert payload["oi"] is None
    assert payload["change_oi"] is None
    assert payload["max_pain"] is None
    assert payload["dii"] is None
    assert payload["news"] is None
    failed = {e.split("(")[0].strip() for e in payload["errors"]}
    assert failed == {
        "unavailable: oi",
        "unavailable: change-oi",
        "unavailable: max-pain",
        "unavailable: dii",
        "unavailable: news",
    }


def test_render_marks_each_failure_and_keeps_successes():
    payload = {
        "date": "2026-10-21",
        "expiry": "current_week",
        "oi": None,
        "change_oi": None,
        "max_pain": {"max_pain": 26000.0, "spot": 26100.0},
        "pcr": 0.95,
        "fii": None,
        "dii": {"buy": 8000.0, "sell": 7500.0, "net": 500.0},
        "news": None,
        "errors": ["unavailable: oi (RuntimeError: boom)"],
    }
    text = render(payload)
    assert "unavailable: oi" in text
    assert "unavailable: change-oi" in text
    assert "unavailable: fii" in text
    assert "unavailable: news" in text
    assert "26,000" in text  # max pain still renders
    assert "0.95" in text  # PCR still renders
    assert "DII net" in text
