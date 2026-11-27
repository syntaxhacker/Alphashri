import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "slow_api_report.py"
spec = importlib.util.spec_from_file_location("slow_api_report", SCRIPT)
report = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = report
spec.loader.exec_module(report)


def test_normalize_path_collapses_ids_and_queries():
    assert report.normalize_path("/api/chart/abc123def/123?x=1") == "/api/chart/{id}/{id}"
    assert report.normalize_path("/api/users/550e8400-e29b-41d4-a716-446655440000") == "/api/users/{id}"
    assert report.normalize_path("/api/screener") == "/api/screener"


def test_percentile_nearest_rank():
    values = [10.0, 20.0, 30.0, 40.0]
    assert report.percentile(values, 50) == 20.0
    assert report.percentile(values, 95) == 40.0
    assert report.percentile([], 95) == 0.0


def test_read_records_accepts_jsonl_and_logger_lines(tmp_path: Path):
    path = tmp_path / "slow.jsonl"
    path.write_text(
        '{"ts":"2026-11-17T05:00:00Z","method":"GET","path":"/a/1","route":"/a/{id}","status":200,'
        '"ttfb_ms":12.0,"total_ms":20.0,"stream":false}\n'
        'INFO: SLOW_API {"ts":"2026-11-17T05:01:00Z","method":"POST","path":"/b",'
        '"route":"/b","status":500,"ttfb_ms":900.0,"total_ms":950.0,"stream":false}\n',
        encoding="utf-8",
    )
    records = report.read_records([path])
    assert len(records) == 2
    assert records[0].route == "/a/{id}"
    assert records[1].status == 500
    assert records[1].ttfb_ms == 900.0


def test_read_records_dedupes_same_record_from_jsonl_and_log(tmp_path: Path):
    payload = (
        '{"ts":"2026-11-17T05:00:00Z","method":"GET","path":"/a","route":"/a",'
        '"status":200,"ttfb_ms":800.0,"total_ms":850.0,"stream":false}'
    )
    jsonl = tmp_path / "slow.jsonl"
    log = tmp_path / "app.log"
    jsonl.write_text(payload + "\n", encoding="utf-8")
    log.write_text("WARNING: SLOW_API " + payload + "\n", encoding="utf-8")

    records = report.read_records([jsonl, log])
    assert len(records) == 1


def test_summarize_groups_by_route_and_uses_ttfb_for_streams():
    records = [
        report.record_from_dict(
            {"route": "/api/x", "method": "GET", "status": 200, "ttfb_ms": 100, "total_ms": 120}
        ),
        report.record_from_dict(
            {"route": "/api/x", "method": "GET", "status": 500, "ttfb_ms": 300, "total_ms": 350}
        ),
        report.record_from_dict(
            {"route": "/api/stream", "method": "GET", "status": 200, "ttfb_ms": 15, "total_ms": 9000, "stream": True}
        ),
    ]
    assert all(r is not None for r in records)
    rows = {r["route"]: r for r in report.summarize(records)}
    assert rows["/api/x"]["count"] == 2
    assert rows["/api/x"]["errors"] == 1
    assert rows["/api/x"]["p95_ms"] == 350
    # A 9s SSE stream with 15ms TTFB must not look like a 9s endpoint.
    assert rows["/api/stream"]["p95_ms"] == 15


def test_since_parser_accepts_relative_and_iso():
    parsed = report.parse_since("30m")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc
    assert parsed < datetime.now(timezone.utc)

    exact = report.parse_since("2026-11-17T05:00:00Z")
    assert exact == datetime(2026, 11, 17, 5, 0, tzinfo=timezone.utc)

    with pytest.raises(SystemExit):
        report.parse_since("tomorrow")
