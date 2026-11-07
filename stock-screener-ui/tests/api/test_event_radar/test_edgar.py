"""EDGAR adapter tests — all against a recorded EFTS payload, no network."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from api.event_radar.sources import edgar
from api.event_radar.sources.edgar import (
    EDGAR_FTS_URL,
    MAX_ENRICH_PER_RUN,
    QUERIES,
    EdgarHit,
    extract_event_date,
    extract_title,
    fetch_document_text,
    fetch_events,
    is_exhibit_label,
    passes_item_filter,
    search,
    strip_filing_boilerplate,
    to_events,
)

FIXTURES = Path(__file__).parent / "fixtures"
#: A trimmed recording of a real EFTS response for ``"investor day"`` over
#: 2026-10-15..2026-10-29 (8-K + 6-K). It deliberately keeps the junk the bug
#: report describes: earnings releases (Item 2.02) and an exhibit-label-only
#: snippet. ROIV is the good hit: filed 2026-10-21, announcing an investor day
#: on 2026-12-09.
RECORDED_FTS = "edgar_events_8k_6k.json"
ROIV_DOCUMENT = "roiv_investor_day_8k_ex99_1.htm"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _load_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


class FakeResponse:
    def __init__(
        self,
        payload=None,
        status_code: int = 200,
        content: bytes | None = None,
        text: str | None = None,
    ):
        self.payload = payload
        self.status_code = status_code
        self.content = content
        self.text = text

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeClient:
    """Stand-in for requests.Session: only ``get(url, headers, timeout)``."""

    def __init__(self, responder):
        self.responder = responder
        self.calls: list[dict] = []

    def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        result = self.responder(url) if callable(self.responder) else self.responder
        if isinstance(result, Exception):
            raise result
        return result

    @property
    def search_calls(self) -> list[dict]:
        return [call for call in self.calls if call["url"].startswith(EDGAR_FTS_URL)]

    @property
    def document_calls(self) -> list[dict]:
        return [call for call in self.calls if EDGAR_FTS_URL not in call["url"]]


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch):
    monkeypatch.setattr(edgar, "REQUEST_SPACING_SECONDS", 0.0)
    monkeypatch.setattr(edgar, "DOCUMENT_SPACING_SECONDS", 0.0)


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query, keep_blank_values=True)


class TestUserAgent:
    def test_default_contact(self, monkeypatch):
        monkeypatch.delenv("EVENT_RADAR_CONTACT", raising=False)
        assert edgar._user_agent() == "alphashri-event-radar contact@example.com"

    def test_env_contact(self, monkeypatch):
        monkeypatch.setenv("EVENT_RADAR_CONTACT", "ops@alphashri.test")
        assert edgar._user_agent() == "alphashri-event-radar ops@alphashri.test"


class TestSearchRequest:
    def test_query_string_contract(self):
        client = FakeClient(FakeResponse(_load("edgar_investor_day_8k.json")))
        search(
            client,
            '"investor day"',
            dt.date(2026, 10, 20),
            dt.date(2026, 10, 28),
            forms=("8-K",),
        )
        assert len(client.calls) == 1
        call = client.calls[0]
        assert call["url"].startswith(EDGAR_FTS_URL + "?")
        assert call["headers"]["User-Agent"].startswith("alphashri-event-radar")
        assert call["timeout"] == edgar.REQUEST_TIMEOUT
        params = _query(call["url"])
        assert params["q"] == ['"investor day"']
        assert params["forms"] == ["8-K"]
        assert params["dateRange"] == ["custom"]
        assert params["startdt"] == ["2026-10-20"]
        assert params["enddt"] == ["2026-10-28"]

    def test_default_forms_are_8k_and_6k(self):
        client = FakeClient(FakeResponse({"hits": {"hits": []}}))
        search(client, '"guidance"', dt.date(2026, 1, 1), dt.date(2026, 2, 1))
        assert _query(client.calls[0]["url"])["forms"] == ["8-K,6-K"]


class TestSearchParsing:
    def test_recorded_payload(self):
        client = FakeClient(FakeResponse(_load("edgar_investor_day_8k.json")))
        hits = search(
            client, '"investor day"', dt.date(2026, 10, 20), dt.date(2026, 10, 28)
        )
        assert len(hits) == 2

        orcl = hits[0]
        assert orcl.symbol == "ORCL"
        assert orcl.name == "ORACLE CORP"
        assert orcl.cik == "0001341439"
        assert orcl.form == "8-K"
        assert orcl.filed == "2026-10-23"
        assert orcl.url == (
            "https://www.sec.gov/Archives/edgar/data/1341439/"
            "000134143926000087/orcl-8k.htm"
        )
        assert "Investor Day" in orcl.snippet

        msft = hits[1]
        assert msft.symbol == "MSFT"  # first of (MSFT, MSFT-PD)
        assert msft.name == "MICROSOFT CORP"

    def test_empty_hits(self):
        client = FakeClient(FakeResponse({"hits": {"hits": []}}))
        assert search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []

    def test_missing_cik_is_skipped(self):
        payload = {
            "hits": {
                "hits": [
                    {
                        "_id": "0000000000-26-000001:doc.htm",
                        "_source": {
                            "display_names": ["NOBODY CORP (NOB)"],
                            "form": "8-K",
                            "file_date": "2026-10-22",
                        },
                    }
                ]
            }
        }
        client = FakeClient(FakeResponse(payload))
        assert search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []

    def test_missing_id_is_skipped(self):
        payload = {
            "hits": {
                "hits": [
                    {
                        "_source": {
                            "ciks": ["0001341439"],
                            "display_names": ["ORACLE CORP (ORCL)"],
                            "form": "8-K",
                            "file_date": "2026-10-23",
                        }
                    }
                ]
            }
        }
        client = FakeClient(FakeResponse(payload))
        assert search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []

    def test_unparseable_cik_is_skipped(self):
        payload = {
            "hits": {
                "hits": [
                    {
                        "_id": "abc:doc.htm",
                        "_source": {
                            "ciks": ["not-a-cik"],
                            "display_names": ["ORACLE CORP (ORCL)"],
                            "form": "8-K",
                            "file_date": "2026-10-23",
                        },
                    }
                ]
            }
        }
        client = FakeClient(FakeResponse(payload))
        assert search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"hits": None},
            {"hits": {"hits": "not-a-list"}},
            {"hits": {"hits": [None, "x", {"_source": None}]}},
            [1, 2, 3],
        ],
    )
    def test_shape_drift_never_raises(self, payload):
        client = FakeClient(FakeResponse(payload))
        assert search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []

    def test_non_200_raises_with_status(self):
        client = FakeClient(FakeResponse({}, status_code=429))
        with pytest.raises(RuntimeError, match="429"):
            search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1))

    def test_unparseable_json_raises(self):
        client = FakeClient(FakeResponse(ValueError("bad json")))
        with pytest.raises(RuntimeError, match="unparseable"):
            search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1))

    def test_hit_without_document_name_is_skipped(self):
        payload = {
            "hits": {
                "hits": [
                    {
                        "_id": "0001341439-26-000087:",
                        "_source": {
                            "ciks": ["0001341439"],
                            "display_names": ["ORACLE CORP (ORCL)"],
                            "form": "8-K",
                            "file_date": "2026-10-23",
                        },
                    }
                ]
            }
        }
        client = FakeClient(FakeResponse(payload))
        assert search(client, '"investor day"', dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []


class TestThrottle:
    def test_waits_between_calls(self, monkeypatch):
        monkeypatch.setattr(edgar, "REQUEST_SPACING_SECONDS", 0.15)
        monkeypatch.setattr(edgar, "_last_request_at", 9.95)
        slept: list[float] = []
        ticks = iter([10.0, 10.05])
        monkeypatch.setattr(edgar.time, "monotonic", lambda: next(ticks))
        monkeypatch.setattr(edgar.time, "sleep", slept.append)

        edgar._throttle()

        assert slept == [pytest.approx(0.1)]

    def test_no_wait_when_spacing_is_zero(self, monkeypatch):
        slept: list[float] = []
        monkeypatch.setattr(edgar, "REQUEST_SPACING_SECONDS", 0.0)
        monkeypatch.setattr(edgar.time, "sleep", slept.append)
        edgar._throttle()
        assert slept == []


def _hit(**overrides) -> EdgarHit:
    base = {
        "symbol": "ORCL",
        "name": "ORACLE CORP",
        "cik": "0001341439",
        "form": "8-K",
        "filed": "2026-10-23",
        "url": "https://www.sec.gov/Archives/edgar/data/1341439/1/doc.htm",
        "snippet": "Oracle to host Investor Day on October 28, 2026.",
    }
    base.update(overrides)
    return EdgarHit(**base)


class TestToEvents:
    def test_date_from_snippet_wins(self):
        events = to_events([_hit()], "investor_day")
        assert len(events) == 1
        ev = events[0]
        assert ev.symbol == "ORCL"
        assert ev.event_type == "investor_day"
        assert ev.event_date == "2026-10-28"
        assert ev.announced_at == "2026-10-23"
        assert ev.source == "edgar"
        assert ev.confidence == 0.6
        assert ev.source_url == _hit().url
        assert ev.title == "Oracle to host Investor Day on October 28, 2026."
        assert "CIK 0001341439" in (ev.notes or "")

    def test_fallback_to_filed_date(self):
        events = to_events([_hit(snippet="Oracle will host an investor day.")], "investor_day")
        assert events[0].event_date == "2026-10-23"
        assert events[0].confidence == 0.45

    def test_title_fallback_when_snippet_empty(self):
        events = to_events([_hit(snippet="")], "investor_day")
        assert events[0].title == "ORACLE CORP investor_day"
        assert "CIK" in (events[0].notes or "")

    def test_long_snippet_is_trimmed_to_160(self):
        events = to_events([_hit(snippet="x" * 400)], "investor_day")
        assert len(events[0].title) == 160

    def test_hit_without_symbol_is_dropped(self):
        assert to_events([_hit(symbol=None)], "investor_day") == []

    def test_hit_without_any_date_is_dropped(self):
        assert to_events([_hit(filed="", snippet="no dates here")], "investor_day") == []

    def test_today_is_accepted_for_signature_parity(self):
        events = to_events([_hit()], "investor_day", today=dt.date(2026, 10, 29))
        assert events[0].event_date == "2026-10-28"


class TestTitleSanitising:
    """8-K bodies lead with the item caption; a title must start at the prose."""

    @pytest.mark.parametrize(
        "raw, expected",
        [
            (
                "☐ Section 7—Regulation FD Item 7.01 Regulation FD Disclosure "
                "On October 28, 2026, Oracle Corporation issued a press release.",
                "On October 28, 2026, Oracle Corporation issued a press release.",
            ),
            (
                "Item 8.01 Other Events On October 23, 2026, the Company announced "
                "it will host an Investor Day.",
                "On October 23, 2026, the Company announced it will host an Investor Day.",
            ),
            ("Item 2.02 Results of Operations and Financial Condition", ""),
            (
                "Roivant will also host an investor day on Wednesday, December 9, 2026.",
                "Roivant will also host an investor day on Wednesday, December 9, 2026.",
            ),
            (
                "EX-99.1 2 dp255384_ex9901.htm EXHIBIT 99.1 Exhibit 99.1 "
                "Auna Announces Participation in Investor Day",
                "Auna Announces Participation in Investor Day",
            ),
        ],
    )
    def test_strip_filing_boilerplate(self, raw, expected):
        assert strip_filing_boilerplate(raw) == expected

    def test_caption_only_headline_falls_back_to_company_label(self):
        title = extract_title(
            "", "ORACLE CORP", "investor_day", "Item 2.02 Results of Operations"
        )
        assert title == "ORACLE CORP — Investor Day"


class TestFetchEvents:
    def test_loops_queries_and_dedupes(self):
        payload = _load("edgar_investor_day_8k.json")

        def responder(url: str):
            params = _query(url)
            if "investor day" in params["q"][0]:
                return FakeResponse(payload)
            return FakeResponse({"hits": {"hits": []}})

        client = FakeClient(responder)
        events = fetch_events(client, dt.date(2026, 10, 20), dt.date(2026, 10, 28))
        # Enrichment adds one document GET per surviving hit, so count only the
        # searches: the contract under test is "one search per query".
        searches = [c for c in client.calls if c["url"].startswith(EDGAR_FTS_URL)]
        assert len(searches) == len(QUERIES)
        assert {ev.event_type for ev in events} == {"investor_day"}
        assert {ev.symbol for ev in events} == {"ORCL", "MSFT"}

    def test_one_failing_query_does_not_blank_the_calendar(self):
        payload = _load("edgar_investor_day_8k.json")

        def responder(url: str):
            params = _query(url)
            if params["q"] == ['"analyst day"']:
                raise RuntimeError("edgar: HTTP 503")
            if "investor day" in params["q"][0]:
                return FakeResponse(payload)
            return FakeResponse({"hits": {"hits": []}})

        events = fetch_events(FakeClient(responder), dt.date(2026, 10, 20), dt.date(2026, 10, 28))
        assert len(events) == 2

    def test_empty_when_everything_is_empty(self):
        client = FakeClient(FakeResponse({"hits": {"hits": []}}))
        assert fetch_events(client, dt.date(2026, 1, 1), dt.date(2026, 2, 1)) == []
