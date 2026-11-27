"""Release sync watcher: 52W freshness checks and cancellable polling (offline)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import sync_refresh_assets as sync
from trading import release_sync_watcher as watcher

pytestmark = pytest.mark.unit


def _asset(release: str, name: str) -> sync.ReleaseAsset:
    return sync.ReleaseAsset(release=release, name=name, url="https://example.invalid/x")


def _stub_env(monkeypatch: pytest.MonkeyPatch, values: dict[str, str]) -> None:
    monkeypatch.setattr(
        watcher,
        "os",
        SimpleNamespace(getenv=lambda key, default=None: values.get(key, default)),
    )


class TestLatest52wAsOf:
    def test_max_52w_date_across_releases_ignores_agri_and_other_names(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        remote = [
            _asset("data-2026-10", "52w/2026-10-31.json.gz"),
            _asset("data-2026-11", "2026-12-05.jsonl.gz"),
            _asset("data-2026-11", "agri-2026-12-05.json"),
            _asset("data-2026-11", "manifests/52w-2026-12-01.json"),
            _asset("data-2026-11", "release-notes.md"),
            _asset("data-2026-11", "52w/2026-11-21.json.gz"),
            _asset("data-2026-11", "52w/2026-11-27.json.gz"),
        ]
        seen: dict[str, str] = {}

        def fake_list(**kwargs):
            seen.update(kwargs)
            return remote

        monkeypatch.setattr(sync, "list_github_assets", fake_list)
        result = sync.latest_52w_as_of(
            repo="test/repo", token="test-token", api_url="https://example.invalid"
        )

        assert result == "2026-11-27"
        assert seen == {
            "repo": "test/repo",
            "token": "test-token",
            "api_url": "https://example.invalid",
        }

    def test_none_when_no_52w_asset(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            sync,
            "list_github_assets",
            lambda **_: [_asset("data-2026-11", "2026-11-27.jsonl.gz")],
        )
        assert sync.latest_52w_as_of() is None


class TestLastApplied52wAsOf:
    def test_uses_last_ok_record_and_its_max_date(self, tmp_path: Path):
        ledger = [
            {"status": "ok", "week52_dates": ["2026-12-10"]},
            {"status": "failed", "week52_dates": ["2026-12-20"]},
            {"status": "ok", "week52_dates": []},
            {"status": "ok", "week52_dates": ["2026-11-20", "2026-11-27"]},
            {"status": "failed", "week52_dates": ["2026-12-25"]},
        ]
        path = tmp_path / "refresh_runs.json"
        path.write_text(json.dumps(ledger), encoding="utf-8")

        assert sync.last_applied_52w_as_of(state_file=path) == "2026-11-27"

    @pytest.mark.parametrize(
        "contents", [None, "{not json", '{"status": "ok"}', "[]"]
    )
    def test_missing_or_corrupt_ledger_is_none(self, tmp_path: Path, contents):
        path = tmp_path / "refresh_runs.json"
        if contents is not None:
            path.write_text(contents, encoding="utf-8")

        assert sync.last_applied_52w_as_of(state_file=path) is None


class TestSyncOnce:
    @pytest.mark.parametrize(
        ("latest", "applied"),
        [("2026-11-20", "2026-11-27"), ("2026-11-27", "2026-11-27")],
    )
    def test_current_when_no_newer_asset(
        self, monkeypatch: pytest.MonkeyPatch, latest: str, applied: str
    ):
        _stub_env(monkeypatch, {})
        monkeypatch.setattr(watcher, "latest_52w_as_of", lambda: latest)
        monkeypatch.setattr(watcher, "last_applied_52w_as_of", lambda: applied)
        run_sync = MagicMock()
        monkeypatch.setattr(watcher, "run_sync", run_sync)

        assert watcher.sync_once() == "current"
        run_sync.assert_not_called()

    @pytest.mark.parametrize("applied", [None, "2026-11-27"])
    def test_applies_newer_asset_with_exact_kwargs(
        self, monkeypatch: pytest.MonkeyPatch, applied
    ):
        _stub_env(monkeypatch, {"GITHUB_TOKEN": "test-token"})
        monkeypatch.setattr(watcher, "latest_52w_as_of", lambda: "2026-12-01")
        monkeypatch.setattr(watcher, "last_applied_52w_as_of", lambda: applied)
        run_sync = MagicMock()
        monkeypatch.setattr(watcher, "run_sync", run_sync)

        assert watcher.sync_once() == "applied"
        run_sync.assert_called_once_with(
            mode="latest", allow_empty=True, token="test-token"
        )

    def test_error_when_run_sync_raises(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
    ):
        _stub_env(monkeypatch, {})
        monkeypatch.setattr(watcher, "latest_52w_as_of", lambda: "2026-12-01")
        monkeypatch.setattr(watcher, "last_applied_52w_as_of", lambda: "2026-11-27")
        run_sync = MagicMock(side_effect=RuntimeError("boom"))
        monkeypatch.setattr(watcher, "run_sync", run_sync)

        assert watcher.sync_once() == "error"
        assert "RuntimeError: boom" in capsys.readouterr().out
        run_sync.assert_called_once()


class TestReleaseSyncTask:
    def test_startup_delay_then_poll_and_clean_cancel(self, monkeypatch: pytest.MonkeyPatch):
        delays: list[float] = []
        ticks: list[str] = []

        async def fake_sleep(seconds):
            delays.append(float(seconds))
            if len(delays) == 3:
                raise asyncio.CancelledError()

        async def fake_to_thread(func, *args, **kwargs):
            return func(*args, **kwargs)

        def fake_sync_once():
            ticks.append("tick")
            return "current"

        monkeypatch.setattr(
            watcher,
            "asyncio",
            SimpleNamespace(
                CancelledError=asyncio.CancelledError,
                sleep=fake_sleep,
                to_thread=fake_to_thread,
            ),
        )
        _stub_env(monkeypatch, {})
        monkeypatch.setattr(watcher, "sync_once", fake_sync_once)

        async def run():
            await watcher.release_sync_task()
            return "exited"

        assert asyncio.run(run()) == "exited"
        assert delays == [30.0, 900.0, 900.0]
        assert len(ticks) == 2

    def test_disabled_flag_skips_sync_and_honours_overrides(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        delays: list[float] = []
        ticks: list[str] = []

        async def fake_sleep(seconds):
            delays.append(float(seconds))
            if len(delays) == 2:
                raise asyncio.CancelledError()

        async def fake_to_thread(func, *args, **kwargs):
            return func(*args, **kwargs)

        def fake_sync_once():
            ticks.append("tick")
            return "current"

        monkeypatch.setattr(
            watcher,
            "asyncio",
            SimpleNamespace(
                CancelledError=asyncio.CancelledError,
                sleep=fake_sleep,
                to_thread=fake_to_thread,
            ),
        )
        _stub_env(
            monkeypatch,
            {
                "RELEASE_SYNC_ENABLED": "0",
                "RELEASE_SYNC_STARTUP_DELAY_SEC": "5",
                "RELEASE_SYNC_POLL_SEC": "600",
            },
        )
        monkeypatch.setattr(watcher, "sync_once", fake_sync_once)

        async def run():
            await watcher.release_sync_task()
            return "exited"

        assert asyncio.run(run()) == "exited"
        assert delays == [5.0, 600.0]
        assert ticks == []
