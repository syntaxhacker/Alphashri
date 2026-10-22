"""Unit tests for ``api/reports_api/nifty_intel.py``.

Pure parsers, payload assembly and cache behaviour are tested with canned
Upstox payloads — no network, no token, no DB. Every upstream call is mocked.
"""

from __future__ import annotations

import pytest

from api.reports_api import nifty_intel as intel


@pytest.fixture(autouse=True)
def _clear_cache():
    intel._cache.clear()
    yield
    intel._cache.clear()


def _change_oi_payload():
    return {
        "data": {
            "total_call_change_oi": 96_000_000,
            "total_put_change_oi": 44_000_000,
            "call_put_oi_data_list": [
                {"strike_price": 26000, "call_change_oi": 12_000_000, "put_change_oi": -1_000_000},
                {"strike_price": 25500, "call_change_oi": -2_000_000, "put_change_oi": 9_000_000},
                {"strike_price": 25900, "call_change_oi": 3_500_000, "put_change_oi": 500_000},
                {"strike_price": 0, "call_change_oi": 1, "put_change_oi": 1},
            ],
        }
    }


def _flow(net: float, buy: float, sell: float):
    return {
        "data": {
            "NSE_EQ|CASH": [
                {"time_stamp": 1, "buy_amount": buy, "sell_amount": sell, "net_value": net}
            ]
        }
    }


def _fake_get_factory(overrides: dict | None = None):
    """Upstox-shaped responses keyed by path, with per-test overrides."""
    responses = {
        "/market/change-oi": _change_oi_payload(),
        "/market/fii": _flow(-1149, 4_100, 5_249),
        "/market/dii": _flow(3201, 8_200, 4_999),
        "/market/max-pain": {"data": {"max_pain_strike": 22900, "spot_price": 22_870.5}},
        "/market/pcr": {"data": {"pcr": 0.69}},
        "/news": {
            "data": {
                "NSE_EQ|INE002A01018": [
                    {
                        "heading": "Nifty closes higher",
                        "article_link": "https://example.test/a",
                        "published_time": 1_760_000_000_000,
                    },
                    {
                        "heading": "Banks lead the rally",
                        "article_link": "https://example.test/b",
                        "published_time": 1_759_999_000_000,
                    },
                ]
            }
        },
    }
    responses.update(overrides or {})

    def fake_get(path, params, timeout):
        value = responses[path]
        if isinstance(value, Exception):
            raise value
        return value

    return fake_get


class TestParsers:
    def test_fii_net_is_pulled_from_cash_segment(self):
        parsed = intel.parse_fii_dii_payload(_flow(-1149, 4_100, 5_249))
        assert parsed == {"buy": 4_100.0, "sell": 5_249.0, "net": -1149.0}

    def test_change_oi_totals_and_rows(self):
        parsed = intel.parse_change_oi_payload(_change_oi_payload())
        assert parsed["total_call_change_oi"] == 96_000_000
        assert parsed["total_put_change_oi"] == 44_000_000
        assert len(parsed["rows"]) == 4
        assert parsed["rows"][0]["side"] == "call"

    def test_max_pain_and_pcr(self):
        assert intel.parse_max_pain_payload({"data": {"max_pain_strike": 22900}})["max_pain"] == 22900
        assert intel.parse_pcr_payload({"data": {"pcr": 0.69}}) == 0.69

    def test_news_is_sorted_newest_first(self):
        items = intel.parse_news_items(_fake_get_factory()("/news", {}, 1), limit=5)
        assert [i["heading"] for i in items] == [
            "Nifty closes higher",
            "Banks lead the rally",
        ]
        assert items[0]["published_ist"].endswith("IST")

    def test_malformed_payloads_never_raise(self):
        assert intel.parse_change_oi_payload(None)["rows"] == []
        assert intel.parse_fii_dii_payload("nope")["net"] is None
        assert intel.parse_max_pain_payload([])["max_pain"] is None
        assert intel.parse_pcr_payload(object()) is None


class TestTopSide:
    def test_ranks_by_absolute_change_and_flattens_to_strike_doi(self):
        rows = intel.parse_change_oi_payload(_change_oi_payload())["rows"]
        assert intel.top_side(rows, "call", 2) == [
            {"strike": 26000.0, "doi": 12_000_000.0},
            {"strike": 25900.0, "doi": 3_500_000.0},
        ]
        assert intel.top_side(rows, "put", 2) == [
            {"strike": 25500.0, "doi": 9_000_000.0},
            {"strike": 26000.0, "doi": -1_000_000.0},
        ]

    def test_zero_changes_are_dropped_instead_of_shown_as_strikes(self):
        rows = [{"strike": 22000, "call": 0, "put": 0}]
        assert intel.top_side(rows, "call") == []

    def test_empty_rows(self):
        assert intel.top_side([], "put") == []


class TestBuildPayload:
    def test_assembles_the_desk_contract(self, monkeypatch):
        monkeypatch.setattr(intel, "_get", _fake_get_factory())
        monkeypatch.setattr(intel, "resolve_news_keys", lambda: ["NSE_EQ|INE002A01018"])

        payload = intel.build_payload("2026-10-21")

        assert payload["fii_net"] == -1149
        assert payload["dii_net"] == 3201
        assert payload["dce_oi"] == 96_000_000
        assert payload["dpe_oi"] == 44_000_000
        assert payload["top_dce"][0] == {"strike": 26000.0, "doi": 12_000_000.0}
        assert payload["top_dpe"][0] == {"strike": 25500.0, "doi": 9_000_000.0}
        assert payload["max_pain"] == 22900
        assert payload["pcr"] == 0.69
        assert payload["news"][0]["heading"] == "Nifty closes higher"
        assert payload["news"][0]["link"] == "https://example.test/a"
        assert payload["news"][0]["published"].endswith("IST")
        assert payload["unavailable"] == []

    def test_news_limit_is_applied(self, monkeypatch):
        monkeypatch.setattr(intel, "_get", _fake_get_factory())
        monkeypatch.setattr(intel, "resolve_news_keys", lambda: ["NSE_EQ|INE002A01018"])
        payload = intel.build_payload("2026-10-21", news_limit=1)
        assert len(payload["news"]) == 1

    def test_missing_sources_degrade_to_null_and_are_named(self, monkeypatch):
        monkeypatch.setattr(
            intel,
            "_get",
            _fake_get_factory(
                {
                    "/market/fii": RuntimeError("token expired"),
                    "/market/dii": RuntimeError("cloudflare"),
                    "/market/change-oi": RuntimeError("upstream 502"),
                    "/market/max-pain": RuntimeError("upstream 502"),
                    "/market/pcr": RuntimeError("upstream 502"),
                    "/news": RuntimeError("upstream 502"),
                }
            ),
        )
        monkeypatch.setattr(intel, "resolve_news_keys", lambda: [])

        payload = intel.build_payload("2026-10-21")

        assert payload["fii_net"] is None
        assert payload["dii_net"] is None
        assert payload["dce_oi"] is None
        assert payload["dpe_oi"] is None
        assert payload["top_dce"] == []
        assert payload["top_dpe"] == []
        assert payload["max_pain"] is None
        assert payload["pcr"] is None
        assert payload["news"] == []
        assert set(payload["unavailable"]) == {
            "fii",
            "dii",
            "change-oi",
            "max-pain",
            "pcr",
            "news",
        }

    def test_duplicate_articles_under_multiple_instrument_keys_are_collapsed(self, monkeypatch):
        same = {
            "heading": "Nifty closes higher",
            "article_link": "https://example.test/a",
            "published_time": 1_760_000_000_000,
        }
        monkeypatch.setattr(
            intel,
            "_get",
            _fake_get_factory(
                {
                    "/news": {
                        "data": {
                            "NSE_EQ|INE002A01018": [same],
                            "NSE_EQ|INE040A01034": [same],
                        }
                    }
                }
            ),
        )
        monkeypatch.setattr(intel, "resolve_news_keys", lambda: [])
        payload = intel.build_payload("2026-10-21")
        assert len(payload["news"]) == 1

    def test_empty_but_valid_payloads_are_marked_unavailable(self, monkeypatch):
        monkeypatch.setattr(
            intel,
            "_get",
            _fake_get_factory(
                {
                    "/market/change-oi": {"data": None},
                    "/market/fii": {"data": {}},
                    "/market/dii": {"data": {}},
                    "/market/max-pain": {"data": None},
                    "/market/pcr": {"data": None},
                    "/news": {"data": None},
                }
            ),
        )
        monkeypatch.setattr(intel, "resolve_news_keys", lambda: [])
        payload = intel.build_payload("2026-10-21")
        assert payload["fii_net"] is None
        assert payload["max_pain"] is None
        assert payload["pcr"] is None
        assert {"fii", "dii", "change-oi", "max-pain", "pcr"}.issubset(
            set(payload["unavailable"])
        )

    def test_change_oi_with_no_rows_is_marked_unavailable(self, monkeypatch):
        monkeypatch.setattr(
            intel,
            "_get",
            _fake_get_factory({"/market/change-oi": {"data": {"call_put_oi_data_list": []}}}),
        )
        monkeypatch.setattr(intel, "resolve_news_keys", lambda: [])
        payload = intel.build_payload("2026-10-21")
        assert payload["top_dce"] == []
        assert "change-oi" in payload["unavailable"]


class TestEndpoint:
    def test_cache_serves_the_second_call_without_refetching(self, monkeypatch):
        calls = {"n": 0}

        def fake_build(date, expiry, limit):
            calls["n"] += 1
            return {"fii_net": -1, "date": date, "expiry": expiry, "news": []}

        monkeypatch.setattr(intel, "build_payload", fake_build)

        first = intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        second = intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)

        assert calls["n"] == 1
        assert first is second

    def test_cache_expires_after_the_ttl(self, monkeypatch):
        calls = {"n": 0}

        def fake_build(date, expiry, limit):
            calls["n"] += 1
            return {"fii_net": calls["n"], "date": date, "expiry": expiry, "news": []}

        monkeypatch.setattr(intel, "build_payload", fake_build)
        real_time = intel.time.time
        clock = {"now": 1_000.0}
        monkeypatch.setattr(intel.time, "time", lambda: clock["now"])

        intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        clock["now"] += intel.CACHE_TTL_SEC + 1
        second = intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)

        assert calls["n"] == 2
        assert second["fii_net"] == 2
        monkeypatch.setattr(intel.time, "time", real_time)

    def test_payload_assembly_failure_still_returns_200_shaped_data(self, monkeypatch):
        def boom(*_args, **_kwargs):
            raise RuntimeError("everything is on fire")

        monkeypatch.setattr(intel, "build_payload", boom)

        payload = intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)

        assert payload["fii_net"] is None
        assert payload["top_dce"] == []
        assert payload["news"] == []
        assert "pcr" in payload["unavailable"]

    def test_all_unavailable_payload_is_cached_briefly_only(self, monkeypatch):
        calls = {"n": 0}

        def fake_build(date, expiry, limit):
            calls["n"] += 1
            return {"date": date, "expiry": expiry, "news": [],
                    "unavailable": list(intel.ALL_SOURCES)}

        monkeypatch.setattr(intel, "build_payload", fake_build)
        clock = {"now": 1_000.0}
        monkeypatch.setattr(intel.time, "time", lambda: clock["now"])

        intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        clock["now"] += intel.UNAVAILABLE_TTL_SEC - 1
        intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        assert calls["n"] == 1  # still inside the 30 s grace window

        clock["now"] += 2
        intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        assert calls["n"] == 2  # a transient outage is retried quickly

    def test_partial_payload_uses_the_full_ttl(self, monkeypatch):
        calls = {"n": 0}

        def fake_build(date, expiry, limit):
            calls["n"] += 1
            return {"date": date, "expiry": expiry, "news": [],
                    "unavailable": ["news"]}  # one source failed, others fine

        monkeypatch.setattr(intel, "build_payload", fake_build)
        clock = {"now": 1_000.0}
        monkeypatch.setattr(intel.time, "time", lambda: clock["now"])

        intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        clock["now"] += intel.UNAVAILABLE_TTL_SEC + 1
        intel.get_nifty_intel(date="2026-10-21", expiry="current_week", news_limit=5)
        assert calls["n"] == 1  # a partial payload is a normal 5-minute cache

    def test_cold_cache_is_built_once_by_concurrent_callers(self, monkeypatch):
        import threading
        import time as _time

        calls = {"n": 0}
        lock = threading.Lock()

        def slow_build(date, expiry, limit):
            with lock:
                calls["n"] += 1
            _time.sleep(0.05)
            return {"date": date, "expiry": expiry, "news": [], "unavailable": []}

        monkeypatch.setattr(intel, "build_payload", slow_build)

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(
                intel.get_nifty_intel(date="2026-10-21", expiry="current_week",
                                      news_limit=5)))
            for _ in range(6)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert calls["n"] == 1  # single-flight: one upstream fan-out
        assert len(results) == 6
        assert all(r["date"] == "2026-10-21" for r in results)

    def test_bad_dates_and_expiries_are_rejected_before_upstream(self, monkeypatch):
        from fastapi import HTTPException

        called = []
        monkeypatch.setattr(intel, "build_payload",
                            lambda *a, **k: called.append(a) or {})
        for bad in ("21-10-2026", "2026-13-40", "today"):
            with pytest.raises(HTTPException) as exc:
                intel.get_nifty_intel(date=bad, expiry="current_week", news_limit=5)
            assert exc.value.status_code == 400
        for bad in ("27-10-2026", "next_week"):
            with pytest.raises(HTTPException) as exc:
                intel.get_nifty_intel(date="2026-10-21", expiry=bad, news_limit=5)
            assert exc.value.status_code == 400
        assert called == []

    def test_valid_expiry_accepts_current_week_and_a_date(self, monkeypatch):
        monkeypatch.setattr(intel, "build_payload",
                            lambda date, expiry, limit: {"date": date,
                                                         "expiry": expiry,
                                                         "unavailable": []})
        assert intel.get_nifty_intel(date="2026-10-21", expiry="current_week",
                                     news_limit=5)["expiry"] == "current_week"
        assert intel.get_nifty_intel(date="2026-10-21", expiry="2026-10-27",
                                     news_limit=5)["expiry"] == "2026-10-27"
