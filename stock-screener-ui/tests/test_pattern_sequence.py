"""Pure tests for the ordered pattern-sequence matcher."""

from chart_patterns.sequence import match_sequence


def _h(pid, start, end):
    return {"pattern_id": pid, "start_date": start, "end_date": end}


def test_matches_consolidation_then_rising_wedge():
    hits = [
        _h("consolidation", "2026-01-01", "2026-02-01"),
        _h("rising_wedge", "2026-02-10", "2026-03-01"),
    ]
    out = match_sequence(hits, ["consolidation", "rising_wedge"])
    assert [h["pattern_id"] for h in out] == ["consolidation", "rising_wedge"]


def test_rejects_when_latest_is_not_the_last_step():
    hits = [
        _h("consolidation", "2026-01-01", "2026-02-01"),
        _h("rising_wedge", "2026-02-10", "2026-03-01"),
        _h("double_bottom", "2026-03-10", "2026-04-01"),
    ]
    assert match_sequence(hits, ["consolidation", "rising_wedge"]) == []


def test_rejects_overlapping_steps():
    hits = [
        _h("consolidation", "2026-01-01", "2026-02-15"),
        _h("rising_wedge", "2026-02-10", "2026-03-01"),
    ]
    assert match_sequence(hits, ["consolidation", "rising_wedge"]) == []


def test_rejects_gap_too_large():
    hits = [
        _h("consolidation", "2026-01-01", "2026-02-01"),
        _h("rising_wedge", "2026-06-01", "2026-06-20"),
    ]
    assert match_sequence(hits, ["consolidation", "rising_wedge"], max_gap_days=20) == []
    assert len(match_sequence(hits, ["consolidation", "rising_wedge"], max_gap_days=200)) == 2


def test_rejects_missing_first_step():
    hits = [_h("rising_wedge", "2026-02-10", "2026-03-01")]
    assert match_sequence(hits, ["consolidation", "rising_wedge"]) == []


def test_uses_the_latest_completed_pair_when_several_exist():
    hits = [
        _h("consolidation", "2025-01-01", "2025-02-01"),
        _h("rising_wedge", "2025-02-10", "2025-03-01"),
        _h("consolidation", "2026-01-01", "2026-02-01"),
        _h("rising_wedge", "2026-02-10", "2026-03-01"),
    ]
    out = match_sequence(hits, ["consolidation", "rising_wedge"])
    assert [h["end_date"] for h in out] == ["2026-02-01", "2026-03-01"]


def test_three_step_sequence():
    hits = [
        _h("double_bottom", "2026-01-01", "2026-01-20"),
        _h("consolidation", "2026-02-01", "2026-02-20"),
        _h("rising_wedge", "2026-03-01", "2026-03-20"),
    ]
    out = match_sequence(hits, ["double_bottom", "consolidation", "rising_wedge"])
    assert [h["pattern_id"] for h in out] == ["double_bottom", "consolidation", "rising_wedge"]


def test_enforces_last_step_recency():
    hits = [
        {**_h("consolidation", "2026-01-01", "2026-02-01"), "status": "confirmed"},
        {**_h("rising_wedge", "2026-02-10", "2026-03-01"), "status": "forming", "bars_ago": 4},
    ]
    assert match_sequence(hits, ["consolidation", "rising_wedge"], max_bars_ago=3) == []
    assert len(match_sequence(hits, ["consolidation", "rising_wedge"], max_bars_ago=5)) == 2


def test_filters_earlier_steps_by_status():
    hits = [
        {**_h("consolidation", "2026-01-01", "2026-02-01"), "status": "failed"},
        {**_h("rising_wedge", "2026-02-10", "2026-03-01"), "status": "confirmed"},
    ]
    assert match_sequence(
        hits, ["consolidation", "rising_wedge"], step_statuses=["confirmed", "forming"]
    ) == []
    assert len(match_sequence(hits, ["consolidation", "rising_wedge"], step_statuses=[])) == 2


def test_short_or_empty_sequence_is_rejected():
    hits = [_h("consolidation", "2026-01-01", "2026-02-01")]
    assert match_sequence(hits, []) == []
    assert match_sequence(hits, ["consolidation"]) == []
