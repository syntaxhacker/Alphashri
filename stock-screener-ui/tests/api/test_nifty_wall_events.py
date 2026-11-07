import json
from pathlib import Path

import pytest

from api.reports_api.nifty_wall_events import detect_wall_events


def _row(hhmm: str, spot: float, cw: float = 23700.0, pw: float = 23500.0, mp: float = 23650.0):
    return {"t": f"2026-11-03T{hhmm}:00+05:30", "spot": spot, "call_wall": cw,
            "put_wall": pw, "max_pain": mp}


def _series(start_min: int, count: int, spot: float, **kw):
    return [_row(f"{9 + (start_min + i) // 60:02d}:{(start_min + i) % 60:02d}", spot, **kw)
            for i in range(count)]


class TestCallWall:
    def test_test_then_rejection_with_max_pain_target(self):
        rows = _series(45, 12, 23690.0) + _series(57, 10, 23650.0)
        events = detect_wall_events(rows)
        kinds = [(e["kind"], e["side"]) for e in events]
        assert ("wall_test", "call") in kinds
        rejection = next(e for e in events if e["kind"] == "rejection")
        assert rejection["side"] == "call"
        assert rejection["level"] == 23700.0
        assert rejection["target"] == 23650.0
        assert rejection["moved_pts"] >= 25

    def test_test_then_break(self):
        rows = _series(45, 12, 23690.0) + _series(57, 6, 23760.0)
        events = detect_wall_events(rows)
        assert ("wall_test", "call") in [(e["kind"], e["side"]) for e in events]
        brk = next(e for e in events if e["kind"] == "break")
        assert brk["side"] == "call"
        assert brk["moved_pts"] >= 50

    def test_short_poke_is_not_a_test(self):
        # Only 4 frames inside the zone -> below TEST_MIN_FRAMES.
        rows = _series(45, 4, 23690.0) + _series(49, 10, 23640.0)
        assert detect_wall_events(rows) == []

    def test_far_from_wall_no_events(self):
        rows = _series(45, 20, 23400.0, cw=23700.0, pw=23000.0)
        assert detect_wall_events(rows) == []


class TestPutWall:
    def test_put_wall_break(self):
        rows = _series(45, 12, 23510.0) + _series(57, 10, 23470.0)
        events = detect_wall_events(rows)
        assert ("wall_test", "put") in [(e["kind"], e["side"]) for e in events]
        brk = next(e for e in events if e["kind"] == "wall_break")
        assert brk["level"] == 23500.0
        assert brk["moved_pts"] >= 25


REAL_TAPE = Path("experiments/data/nifty_tape/2026-11-03.jsonl")


@pytest.mark.skipif(not REAL_TAPE.exists(), reason="2026-11-03 tape not present")
def test_real_tape_finds_the_1210_rejection():
    rows = [json.loads(line) for line in REAL_TAPE.read_text().splitlines() if line.strip()]
    events = detect_wall_events(rows)
    tests = [e for e in events if e["kind"] == "wall_test" and e["side"] == "call"]
    assert tests, "the 23,700 call wall test should be detected"
    assert any(e["level"] == 23700.0 for e in tests)
    rejections = [e for e in events if e["kind"] == "rejection" and e["side"] == "call"]
    assert rejections, "the 12:10 rejection should be detected"
    rej = rejections[0]
    assert rej["t"][11:16] >= "12:09"
    assert rej["moved_pts"] >= 40


@pytest.mark.skipif(not REAL_TAPE.exists(), reason="2026-11-03 tape not present")
def test_bursts_feed_maps_wall_events_with_target():
    from api.reports_api.nifty import _wall_event_alerts

    rows = [json.loads(line) for line in REAL_TAPE.read_text().splitlines() if line.strip()]
    alerts = _wall_event_alerts(rows)
    kinds = {a["type"] for a in alerts}
    assert {"wall_test", "rejection"} <= kinds
    rej = next(a for a in alerts if a["type"] == "rejection")
    assert "target max pain" in rej["detail"]
    assert rej["target"] == 23650.0
    assert rej["severity"] == "alert"


# ---------------------------------------------------------------------------
# recall journal
# ---------------------------------------------------------------------------

from api.reports_api import nifty_wall_events as we  # noqa: E402


class TestEventJournal:
    def test_persist_is_append_only_and_idempotent(self, tmp_path):
        events = detect_wall_events(_series(45, 12, 23690.0)
                                    + _series(57, 10, 23650.0))
        assert events

        first = we.persist_events(events, "2026-11-03", path=tmp_path)
        assert first == {"added": len(events), "skipped": 0}

        # Polling the feed again must not grow the journal.
        again = we.persist_events(events, "2026-11-03", path=tmp_path)
        assert again == {"added": 0, "skipped": len(events)}

        journal = we.read_events("2026-11-03", path=tmp_path)
        assert len(journal) == len(events)
        assert all(row["date"] == "2026-11-03" for row in journal)
        assert {row["kind"] for row in journal} == {
            row["kind"] for row in events}

    def test_a_later_retest_is_a_new_event(self, tmp_path):
        base = detect_wall_events(_series(45, 12, 23690.0))
        we.persist_events(base, "2026-11-03", path=tmp_path)
        retest = [dict(ev, t="2026-11-03T14:30:00+05:30") for ev in base]
        out = we.persist_events(retest, "2026-11-03", path=tmp_path)
        assert out["added"] == len(retest)

    def test_recall_reports_missing_and_extra(self, tmp_path):
        tape = _series(45, 12, 23690.0) + _series(57, 10, 23650.0)
        detected = detect_wall_events(tape)

        # Alerted only the first event -> the rest are "missing".
        we.persist_events(detected[:1], "2026-11-03", path=tmp_path)
        # ... plus an event the tape no longer reproduces.
        we.persist_events([{"t": "2026-11-03T09:00:00+05:30",
                            "side": "call", "kind": "break",
                            "level": 24000.0}], "2026-11-03", path=tmp_path)

        report = we.recall_report("2026-11-03", rows=tape, path=tmp_path)

        assert report["detected"] == len(detected)
        assert report["alerted"] == 2
        assert report["matched"] == 1
        assert len(report["missing"]) == len(detected) - 1
        assert [ev["kind"] for ev in report["extra"]] == ["break"]

    def test_recall_with_a_clean_journal_has_nothing_missing(self, tmp_path):
        tape = _series(45, 12, 23690.0) + _series(57, 10, 23650.0)
        detected = detect_wall_events(tape)
        we.persist_events(detected, "2026-11-03", path=tmp_path)

        report = we.recall_report("2026-11-03", rows=tape, path=tmp_path)

        assert report["missing"] == []
        assert report["extra"] == []
        assert report["matched"] == report["detected"] == report["alerted"]

    def test_journal_reads_are_tolerant_of_junk(self, tmp_path):
        path = tmp_path / "2026-11-03.jsonl"
        path.write_text('{"t": "x", "kind": "break"}\nnot json\n\n')
        assert len(we.read_events("2026-11-03", path=tmp_path)) == 1

    def test_bursts_feed_persists_to_the_journal(self, tmp_path, monkeypatch):
        from api.reports_api import nifty

        monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path / "tape")
        monkeypatch.setattr(we, "EVENTS_DIR", tmp_path / "events")
        monkeypatch.setattr(nifty, "_ensure_tape_task", lambda: None)
        monkeypatch.setattr(nifty, "_snapshot_oi_context", lambda _d: (None, 0.0))
        monkeypatch.setattr(nifty, "notify_telegram", lambda _a: False)
        monkeypatch.setattr(nifty, "notify_new_bursts", lambda *a, **k: 0)
        monkeypatch.setattr(nifty, "_market_open", lambda: False)

        date_str = "2026-11-03"
        frames = [_row(f"{9 + (45 + i) // 60:02d}:{(45 + i) % 60:02d}", 23690.0)
                  for i in range(12)]
        frames += [_row("12:10", 23650.0), _row("12:11", 23640.0)]
        for f in frames:
            f.update({"ce_oi": 1000, "pe_oi": 900, "ce_vol": 10,
                      "pe_vol": 9, "strikes_top": [{"strike": 23500}]})
        (tmp_path / "tape").mkdir()
        with open(tmp_path / "tape" / f"{date_str}.jsonl", "w") as fh:
            for f in frames:
                fh.write(json.dumps(f) + "\n")

        out = nifty.get_nifty_bursts(date=date_str, window=15, min_abs=0)
        walls = [b for b in out["bursts"]
                 if b.get("type") in ("wall_test", "rejection")]
        assert walls
        journal = we.read_events(date_str)
        assert journal, "the feed must leave an audit trail"
        # Second poll: no duplicate lines.
        before = len(journal)
        nifty.get_nifty_bursts(date=date_str, window=15, min_abs=0)
        assert len(we.read_events(date_str)) == before
