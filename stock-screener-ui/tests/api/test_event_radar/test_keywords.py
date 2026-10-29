"""Keyword classifier tests — the mapping is product policy, so pin it down."""

from __future__ import annotations

import pytest

from api.event_radar.keywords import (
    EVENT_KEYWORDS,
    EXCLUDES,
    PHRASE_PRIORITY,
    match,
    matched_phrases,
)

#: one representative headline per event type
SAMPLE_HEADLINES = {
    "investor_day": "Oracle to host its Investor Day on October 28",
    "analyst_day": "Company sets Analyst Day for December",
    "capital_markets_day": "Barclays Capital Markets Day 2026",
    "strategy_day": "Management hosts a Strategy Day next month",
    "rnd_day": "The company will hold an R&D Day in June",
    "business_update": "Third quarter Business Update scheduled",
    "guidance": "Management raises guidance for fiscal 2027",
    "shareholder_meeting": "Notice of Annual General Meeting",
}


class TestCoverage:
    def test_every_event_type_matches(self):
        for event_type, headline in SAMPLE_HEADLINES.items():
            found_type, phrase = match(headline)
            assert found_type == event_type, headline
            assert phrase is not None

    def test_every_keyword_phrase_is_prioritised(self):
        declared = {p for phrases in EVENT_KEYWORDS.values() for p in phrases}
        assert declared.issubset(set(PHRASE_PRIORITY)), (
            declared - set(PHRASE_PRIORITY)
        )

    def test_priority_has_no_duplicates(self):
        assert len(PHRASE_PRIORITY) == len(set(PHRASE_PRIORITY))

    def test_excludes_documented_and_non_empty(self):
        assert EXCLUDES
        assert all(phrase.strip() for phrase in EXCLUDES)

    @pytest.mark.parametrize(
        "phrase,event_type",
        [(p, t) for t, phrases in EVENT_KEYWORDS.items() for p in phrases],
    )
    def test_each_registered_phrase_fires(self, phrase, event_type):
        assert match(f"Company announces {phrase}")[0] == event_type


class TestMatching:
    def test_plural_is_same_event(self):
        assert match("Oracle Investor Days return in 2027") == (
            "investor_day",
            "investor day",
        )

    def test_extra_whitespace_and_punctuation(self):
        assert match("Investor  Day,")[0] == "investor_day"
        assert match("CAPITAL   MARKETS DAY!")[0] == "capital_markets_day"
        assert match("Capital Markets Day.")[0] == "capital_markets_day"

    def test_no_partial_word_match(self):
        assert match("The investorday page is down") == (None, None)
        assert match("Superinvestor days") == (None, None)

    def test_unrelated_text_matches_nothing(self):
        assert match("Q3 revenue beat expectations") == (None, None)
        assert match("day trading") == (None, None)

    def test_day_trading_vetoes_overlapping_investor_day(self):
        assert match("Investor day trading desk buzz") == (None, None)

    def test_record_date_elsewhere_does_not_veto(self):
        # A genuine investor-day release often ends with a dividend record date.
        text = "Oracle to host Investor Day; record date for dividend is November 2"
        assert match(text)[0] == "investor_day"

    def test_special_meeting_record_date_is_vetoed(self):
        text = "Special meeting of stockholders record date announced"
        assert match(text) == (None, None)

    def test_case_insensitive(self):
        assert match("INVESTOR DAY")[0] == "investor_day"
        assert match("investor day")[0] == "investor_day"


class TestPriority:
    def test_analyst_and_investor_day_beats_investor_day(self):
        assert match("Analyst and Investor Day 2026") == (
            "analyst_day",
            "analyst and investor day",
        )

    def test_slash_variant(self):
        assert match("Analyst/Investor Day webcast") == (
            "analyst_day",
            "analyst/investor day",
        )

    def test_capital_markets_day_beats_generic_day_phrases(self):
        assert match("Capital Markets Day and Investor Day")[0] == (
            "capital_markets_day"
        )

    def test_matched_phrases_most_specific_first(self):
        phrases = matched_phrases("Capital Markets Day followed by an Investor Day")
        assert phrases[0] == "capital markets day"
        assert "investor day" in phrases
        assert len(phrases) == len(set(phrases))

    def test_matched_phrases_empty_for_noise(self):
        assert matched_phrases("nothing to see here") == []
        assert matched_phrases("") == []


class TestEdgeInputs:
    @pytest.mark.parametrize("value", ["", "   ", None])  # type: ignore[list-item]
    def test_empty_input(self, value):
        assert match(value) == (None, None)  # type: ignore[arg-type]
        assert matched_phrases(value) == []  # type: ignore[arg-type]

    def test_non_string_never_raises(self):
        assert match(123) == (None, None)  # type: ignore[arg-type]

    def test_iter_phrases_matches_priority(self):
        from api.event_radar.keywords import iter_phrases

        assert tuple(iter_phrases()) == PHRASE_PRIORITY

    def test_priority_phrase_missing_from_event_keywords_is_ignored(self, monkeypatch):
        # Guards the drift case: a phrase in PHRASE_PRIORITY that no event type
        # declares must be skipped, not crash classification.
        from api.event_radar import keywords

        monkeypatch.delitem(keywords._PHRASE_TO_TYPE, "investor day")
        assert match("Oracle investor day") == (None, None)
