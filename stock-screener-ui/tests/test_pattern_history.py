"""Pure tests for chart_patterns.history.select_last_n."""

from chart_patterns.history import overlaps, select_last_n


def _hit(pid, start, end, conf=50.0):
    return {"pattern_id": pid, "start_date": start, "end_date": end, "confidence": conf}


def test_returns_newest_first():
    hits = [
        _hit("a", "2026-01-01", "2026-01-10"),
        _hit("b", "2026-02-01", "2026-02-10"),
        _hit("c", "2026-03-01", "2026-03-10"),
    ]
    out = select_last_n(hits, 2)
    assert [h["pattern_id"] for h in out] == ["c", "b"]


def test_drops_overlapping_hits():
    hits = [
        _hit("a", "2026-01-01", "2026-01-20"),
        _hit("b", "2026-01-15", "2026-02-20"),  # overlaps a and c
        _hit("c", "2026-02-11", "2026-03-01"),  # does not overlap a
    ]
    out = select_last_n(hits, 3, non_overlapping=True)
    assert [h["pattern_id"] for h in out] == ["c", "a"]


def test_allows_overlaps_when_disabled():
    hits = [
        _hit("a", "2026-01-01", "2026-01-20"),
        _hit("b", "2026-01-15", "2026-02-10"),
    ]
    out = select_last_n(hits, 2, non_overlapping=False)
    assert len(out) == 2


def test_stops_at_n():
    hits = [_hit(str(i), f"2026-0{i}-01", f"2026-0{i}-10") for i in range(1, 6)]
    assert len(select_last_n(hits, 3)) == 3


def test_tie_breaks_on_confidence():
    hits = [
        _hit("low", "2026-01-01", "2026-01-10", conf=40),
        _hit("high", "2026-01-01", "2026-01-10", conf=90),
    ]
    out = select_last_n(hits, 1)
    assert out[0]["pattern_id"] == "high"


def test_empty_and_zero():
    assert select_last_n([], 3) == []
    assert select_last_n([_hit("a", "2026-01-01", "2026-01-10")], 0) == []


def test_overlaps_helper():
    a = _hit("a", "2026-01-01", "2026-01-10")
    b = _hit("b", "2026-01-10", "2026-01-20")
    c = _hit("c", "2026-01-11", "2026-01-20")
    assert overlaps(a, b) is True  # touching endpoints count
    assert overlaps(a, c) is False
