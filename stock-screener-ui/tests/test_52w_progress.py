"""Pure helpers for 52W batch progress (no DB, Redis or Upstox client)."""
import io
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import compute_52w_ranges_upstox as batch
from scripts.compute_52w_ranges_upstox import (
    ProgressReporter,
    append_github_summary,
    format_eta,
    progress_bar,
    progress_line,
    should_emit_milestone,
)


class _Stream(io.StringIO):
    def __init__(self, tty: bool = False):
        super().__init__()
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


class TestProgressBar:
    @pytest.mark.parametrize(
        "done,total,expected",
        [
            (0, 2787, "[--------------------]"),
            (1400, 2787, "[##########----------]"),
            (2787, 2787, "[####################]"),
            (2788, 2787, "[####################]"),
            (0, 0, "[--------------------]"),
            (-5, 100, "[--------------------]"),
        ],
    )
    def test_geometry(self, done, total, expected):
        assert progress_bar(done, total) == expected

    @pytest.mark.parametrize("width", [1, 5, 10, 40])
    def test_bar_length_tracks_width(self, width):
        bar = progress_bar(1, 2, width)
        assert len(bar) == width + 2
        assert bar.count("#") + bar.count("-") == width

    def test_zero_width_is_safe(self):
        assert progress_bar(1, 2, 0) == "[]"


class TestProgressLine:
    def test_milestone_line_format(self):
        line = progress_line(1400, 2787, 1394, 6, 0, 2.8)
        assert line == (
            "[##########----------] 1,400/2,787 50.2%"
            " · ok 1,394 · skip 6 · fail 0 · 2.8/s · ETA 8m15s"
        )

    @pytest.mark.parametrize(
        "done,total,rate",
        [(0, 0, 0.0), (0, 2787, 0.0), (2788, 2787, 0.0), (1, 10, float("nan")), (1, 10, float("inf"))],
    )
    def test_no_nan_or_infinite_text(self, done, total, rate):
        line = progress_line(done, total, 0, 0, 0, rate)
        assert "nan" not in line.lower()
        assert "inf" not in line.lower()

    def test_done_beyond_total_clamps_percentage_and_eta(self):
        line = progress_line(12, 10, 10, 0, 0, 2.0)
        assert "120.0%" not in line
        assert "100.0%" in line
        assert "ETA 0m00s" in line

    def test_zero_total_reports_zero_percent(self):
        line = progress_line(0, 0, 0, 0, 0, 0.0)
        assert "0.0%" in line
        assert "0/0" in line


class TestFormatEta:
    @pytest.mark.parametrize("seconds,expected", [(0.0, "0m00s"), (495.4, "8m15s"), (3725.0, "1h02m05s")])
    def test_human_readable(self, seconds, expected):
        assert format_eta(seconds) == expected

    @pytest.mark.parametrize("seconds", [None, -1.0, float("nan"), float("inf")])
    def test_unknown_or_invalid_is_question_mark(self, seconds):
        assert format_eta(seconds) == "?"


class TestMilestoneSelection:
    def test_first_five_percent_steps_and_final_are_emitted(self):
        emitted = []
        step = -1
        for done in range(1, 101):
            emit, step = should_emit_milestone(done, 100, step)
            if emit:
                emitted.append(done)
        assert emitted[:3] == [1, 2, 3]
        assert {5, 50, 95, 100}.issubset(emitted)
        assert len(emitted) <= 25
        assert emitted == sorted(set(emitted))

    def test_zero_total_emits_nothing(self):
        assert should_emit_milestone(0, 0, -1) == (False, -1)


class TestProgressReporter:
    def test_non_tty_emits_milestones_only(self):
        stream = _Stream()
        reporter = ProgressReporter(100, stream=stream)
        for done in range(1, 101):
            reporter.update(done, done, 0, 0)
        lines = stream.getvalue().splitlines()
        assert len(lines) <= 25
        assert all("H=" not in line and "L=" not in line for line in lines)
        assert "100/100" in lines[-1]

    def test_tty_throttles_and_refreshes_on_final(self, monkeypatch):
        stream = _Stream(tty=True)
        clock = [0.0]
        monkeypatch.setattr(batch, "time", SimpleNamespace(monotonic=lambda: clock[0]))
        reporter = ProgressReporter(100, stream=stream)
        reporter.update(1, 1, 0, 0)
        clock[0] = 0.2
        reporter.update(5, 5, 0, 0)
        assert stream.getvalue().count("\r") == 1
        clock[0] = 2.0
        reporter.update(10, 10, 0, 0)
        assert stream.getvalue().count("\r") == 2
        reporter.finish(100, 0, 0)
        assert stream.getvalue().count("\r") == 3
        assert stream.getvalue().endswith("\n")

    def test_only_first_ten_failures_are_printed(self):
        stream = _Stream()
        reporter = ProgressReporter(100, stream=stream)
        for i in range(1, 16):
            reporter.note_failure(i, f"FAIL{i}", "boom")
        text = stream.getvalue()
        assert "FAIL10" in text
        assert "FAIL11" not in text
        assert text.count("ERROR boom") == 10


class TestGithubSummary:
    def test_appends_compact_markdown(self, monkeypatch, tmp_path):
        summary = tmp_path / "summary.md"
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
        append_github_summary(2, 2, 1, 0, 1, 5.0)
        text = summary.read_text(encoding="utf-8")
        assert "### 52W range batch" in text
        assert "[####################] 2/2 100.0%" in text
        assert "ok 1 · skip 0 · fail 1 · total 2" in text
        assert "elapsed: 0m05s · throughput: 0.4/s" in text

    def test_no_env_is_a_no_op(self, monkeypatch, tmp_path):
        monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
        assert append_github_summary(0, 0, 0, 0, 0, 0.0) is None


@pytest.mark.parametrize("flag", ["--no-redis", "--dry-run", "--output-json"])
def test_redis_disabled_before_worker_pool(monkeypatch, tmp_path, flag):
    class FakeUpstoxAPI:
        def __init__(self, *args, **kwargs):
            pass

    stub = ModuleType("upstox_trader.config_and_utils.upstox_api")
    stub.UpstoxAPI = FakeUpstoxAPI
    monkeypatch.setitem(sys.modules, "upstox_trader.config_and_utils.upstox_api", stub)
    monkeypatch.setattr(batch.config, "UPSTOX_API_KEY", "test-key")
    monkeypatch.setattr(batch.config, "UPSTOX_API_SECRET", "test-secret")
    monkeypatch.setattr(batch, "load_symbols", lambda *a, **k: ["AAA"])
    monkeypatch.setenv("REDIS_DISABLED", "")
    seen = {}

    def fetch(api, symbol, to_date):
        seen["disabled"] = os.environ.get("REDIS_DISABLED")
        return {"high": 2.0, "low": 1.0, "close": 1.5}

    monkeypatch.setattr(batch, "fetch_range_for_symbol", fetch)
    argv = ["compute", "--source", "json", "--symbol", "AAA"]
    if flag == "--output-json":
        argv += [flag, str(tmp_path / "ranges.json")]
    elif flag == "--no-redis":
        argv += [flag, "--no-db"]
    else:
        argv.append(flag)
    monkeypatch.setattr(sys, "argv", argv)
    batch.main()
    assert seen["disabled"] == "1"
