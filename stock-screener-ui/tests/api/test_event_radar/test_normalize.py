"""Normalisation tests — every helper is total, so malformed input is a case."""

from __future__ import annotations

import datetime as dt

import pytest

from api.event_radar.contract import Event
from api.event_radar.normalize import (
    clean_symbol,
    dedupe,
    in_range,
    make_event_id,
    parse_date,
    parse_display_name,
)


def _event(
    symbol: str = "ORCL",
    event_date: str = "2026-10-28",
    event_type: str = "investor_day",
    source: str = "edgar",
    title: str = "Title",
    event_id: str = "id-1",
) -> Event:
    return Event(
        id=event_id,
        symbol=symbol,
        event_type=event_type,  # type: ignore[arg-type]
        title=title,
        event_date=event_date,
        source=source,  # type: ignore[arg-type]
    )


class TestCleanSymbol:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("NASDAQ:ORCL", "ORCL"),
            ("NSE:RELIANCE", "RELIANCE"),
            ("ORCL, ORCL-PD", "ORCL"),
            ("BRK.B", "BRK.B"),
            (" AAPL ", "AAPL"),
            ("aapl", "AAPL"),
            ("NYSE: BRK.B", "BRK.B"),
            ("ORCL.", "ORCL"),
            ('"MSFT"', "MSFT"),
        ],
    )
    def test_valid_symbols(self, raw, expected):
        assert clean_symbol(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [None, "", "   ", "N/A", "N/A.", "NONE.", "-", "!!", "0001341439", "1234", "A" * 40],
    )
    def test_junk_and_empty(self, raw):
        assert clean_symbol(raw) is None

    def test_non_string_never_raises(self):
        assert clean_symbol(123) is None  # type: ignore[arg-type]
        assert clean_symbol(["ORCL"]) is None  # type: ignore[arg-type]


class TestParseDisplayName:
    def test_full_triple(self):
        name, symbols, cik = parse_display_name(
            "ORACLE CORP  (ORCL, ORCL-PD)  (CIK 0001341439)"
        )
        assert name == "ORACLE CORP"
        assert symbols == ["ORCL", "ORCL-PD"]
        assert cik == "0001341439"

    def test_without_cik(self):
        assert parse_display_name("ORACLE CORP (ORCL)") == (
            "ORACLE CORP",
            ["ORCL"],
            None,
        )

    def test_without_parentheses(self):
        assert parse_display_name("ORACLE CORP") == ("ORACLE CORP", [], None)

    def test_cik_only(self):
        name, symbols, cik = parse_display_name("ORACLE CORP (CIK 0001341439)")
        assert name == "ORACLE CORP"
        assert symbols == []
        assert cik == "0001341439"

    def test_symbol_only(self):
        name, symbols, cik = parse_display_name("(ORCL)")
        assert name is None
        assert symbols == ["ORCL"]
        assert cik is None

    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_empty(self, raw):
        assert parse_display_name(raw) == (None, [], None)  # type: ignore[arg-type]

    def test_non_string_never_raises(self):
        assert parse_display_name(42) == (None, [], None)  # type: ignore[arg-type]


class TestParseDate:
    @pytest.mark.parametrize(
        "raw",
        [
            "2026-10-28",
            "October 28, 2026",
            "Oct. 28, 2026",
            "Oct 28 2026",
            "28 October 2026",
            "28 Oct, 2026",
            "28th October 2026",
            "October 28, 2026 4:00 PM ET",
            "Investor Day on October 28, 2026 at 9:00 a.m. ET",
            "2026-10-28T13:00:00Z",
            "Filed 2026-10-28 and updated 2026-10-30",
        ],
    )
    def test_supported_formats(self, raw):
        assert parse_date(raw) == dt.date(2026, 10, 28)

    @pytest.mark.parametrize(
        "raw",
        [
            None,
            "",
            "   ",
            "no date here",
            "February 30, 2026",
            "2026-13-45",
            "Q3 results",
            "...",
            " , ",
        ],
    )
    def test_unparseable(self, raw):
        assert parse_date(raw) is None

    def test_non_string_never_raises(self):
        assert parse_date(20261028) is None  # type: ignore[arg-type]

    def test_first_date_wins(self):
        assert parse_date("August 1, 2026 and October 28, 2026") == dt.date(
            2026, 8, 1
        )


class TestMakeEventId:
    def test_slugifies(self):
        assert (
            make_event_id("edgar", "ORCL 2026-10-28 Investor Day")
            == "edgar:orcl-2026-10-28-investor-day"
        )

    def test_trims_and_collapses(self):
        assert make_event_id("tv", "  ORCL__earnings!! ") == "tv:orcl-earnings"

    def test_empty_key(self):
        assert make_event_id("wire", "") == "wire:"


class TestDedupe:
    def test_seed_beats_edgar_beats_tv(self):
        seed = _event(source="seed", title="Oracle Investor Day in Austin")
        edgar = _event(source="edgar", title="Oracle Investor Day in Austin, TX")
        tv = _event(source="tv", title="ORCL earnings")
        assert dedupe([tv, edgar, seed]) == [seed]

    def test_edgar_beats_tv(self):
        edgar = _event(source="edgar", title="A")
        tv = _event(source="tv", title="A very long tv title")
        assert dedupe([tv, edgar]) == [edgar]

    def test_tie_on_precedence_keeps_longer_title(self):
        short = _event(source="edgar", title="Investor Day", event_id="short")
        long = _event(
            source="edgar",
            title="Oracle to host Investor Day on October 28",
            event_id="long",
        )
        assert dedupe([short, long]) == [long]

    def test_identical_titles_keep_first(self):
        first = _event(source="edgar", title="Same", event_id="first")
        second = _event(source="edgar", title="Same", event_id="second")
        assert dedupe([first, second]) == [first]

    def test_different_type_or_date_is_not_deduped(self):
        a = _event(source="tv", event_type="earnings")
        b = _event(source="tv", event_type="dividend")
        c = _event(source="tv", event_date="2026-10-29")
        assert len(dedupe([a, b, c])) == 3

    def test_sort_order(self):
        late = _event(symbol="ZZZ", event_date="2026-11-05", source="tv")
        early_tv = _event(
            symbol="AAA", event_date="2026-10-28", source="tv", event_id="e1"
        )
        early_seed = _event(
            symbol="AAA",
            event_date="2026-10-28",
            source="seed",
            event_type="dividend",
            event_id="e2",
        )
        ordered = dedupe([late, early_tv, early_seed])
        assert ordered == [early_seed, early_tv, late]

    def test_returns_new_list_and_does_not_mutate_input(self):
        events = [_event(source="tv")]
        result = dedupe(events)
        assert result == events
        assert result is not events

    def test_empty(self):
        assert dedupe([]) == []


class TestInRange:
    def test_inclusive_both_ends(self):
        start, end = dt.date(2026, 10, 1), dt.date(2026, 10, 31)
        assert in_range(_event(event_date="2026-10-01"), start, end)
        assert in_range(_event(event_date="2026-10-31"), start, end)
        assert in_range(_event(event_date="2026-10-15"), start, end)

    def test_outside(self):
        start, end = dt.date(2026, 10, 1), dt.date(2026, 10, 31)
        assert not in_range(_event(event_date="2026-09-30"), start, end)
        assert not in_range(_event(event_date="2026-11-01"), start, end)

    def test_malformed_event_date_is_out_of_range(self):
        event = _event()
        object.__setattr__(event, "event_date", "not-a-date")
        assert not in_range(event, dt.date(2026, 1, 1), dt.date(2026, 12, 31))
