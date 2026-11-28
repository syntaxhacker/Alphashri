"""Release sync watcher: fingerprint freshness, token forwarding and polling (offline)."""

from __future__ import annotations

import asyncio
import fcntl
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import sync_refresh_assets as sync
from trading import release_sync_watcher as watcher

pytestmark = pytest.mark.unit


def _asset(release: str, name: str, *, updated_at: str | None = None, size: int | None = None):
    return sync.ReleaseAsset(
        release=release,
        name=name,
        url="https://example.invalid/x",
        size=size,
        updated_at=updated_at,
    )


def _stub_env(monkeypatch: pytest.MonkeyPatch, values: dict[str, str]) -> None:
    monkeypatch.setattr(
        watcher,
        "os",
        SimpleNamespace(getenv=lambda key, default=None: values.get(key, default)),
    )


def _pointer(kind: str, as_of: str, fingerprint: str) -> sync.RefreshPointer:
    return sync.RefreshPointer(kind=kind, as_of=as_of, fingerprint=fingerprint)


def _applied(
    *,
    week52: tuple[str, str] = ("2026-11-27", "w-fp"),
    agri: tuple[str, str] | None = ("2026-11-27", "a-fp"),
) -> sync.AppliedPointers:
    return sync.AppliedPointers(
        week52_as_of=week52[0] if week52 else None,
        week52_fingerprint=week52[1] if week52 else None,
        agri_as_of=agri[0] if agri else None,
        agri_fingerprint=agri[1] if agri else None,
    )


def _stub_freshness(monkeypatch, pointers: dict[str, sync.RefreshPointer], applied):
    monkeypatch.setattr(watcher, "latest_refresh_pointers", lambda **_: pointers)
    monkeypatch.setattr(watcher, "last_applied_pointers", lambda **_: applied)
    run_sync = MagicMock()
    monkeypatch.setattr(watcher, "run_sync", run_sync)
    return run_sync


def _stub_sync_loop(monkeypatch, env: dict[str, str], *, cancel_after: int):
    """Stub the async loop seams shared by the release-sync task tests."""
    delays: list[float] = []
    ticks: list[str] = []

    async def fake_sleep(seconds):
        delays.append(float(seconds))
        if len(delays) == cancel_after:
            raise asyncio.CancelledError()

    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_sync_once():
        ticks.append("tick")
        return "current"

    async def run():
        await watcher.release_sync_task()
        return "exited"

    monkeypatch.setattr(
        watcher,
        "asyncio",
        SimpleNamespace(
            CancelledError=asyncio.CancelledError,
            sleep=fake_sleep,
            to_thread=fake_to_thread,
        ),
    )
    _stub_env(monkeypatch, env)
    monkeypatch.setattr(watcher, "sync_once", fake_sync_once)
    return delays, ticks, run


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


class TestLatestRefreshPointers:
    def test_one_listing_yields_both_kinds_with_fingerprints(self, monkeypatch):
        remote = [
            _asset(
                "data-2026-11",
                "2026-11-27.json.gz",
                updated_at="2026-11-27T19:00:00Z",
                size=100,
            ),
            _asset("data-2026-11", "52w-2026-11-27.json", size=10),
            _asset(
                "data-2026-11",
                "2026-11-27.jsonl.gz",
                updated_at="2026-11-27T21:00:00Z",
                size=200,
            ),
            _asset("data-2026-11", "agri-2026-11-27.json", size=20),
        ]
        calls: list[dict] = []

        def fake_list(**kwargs):
            calls.append(kwargs)
            return remote

        monkeypatch.setattr(sync, "list_github_assets", fake_list)

        pointers = sync.latest_refresh_pointers(
            repo="test/repo", token="test-token", api_url="https://example.invalid"
        )

        assert set(pointers) == {"agri", "52w"}
        assert pointers["52w"].as_of == "2026-11-27"
        assert pointers["agri"].as_of == "2026-11-27"
        assert pointers["52w"].fingerprint == sync.refresh_fingerprint(remote[0])
        assert pointers["agri"].fingerprint == sync.refresh_fingerprint(remote[2])
        assert len(calls) == 1

    def test_no_assets_means_no_pointers(self, monkeypatch):
        monkeypatch.setattr(sync, "list_github_assets", lambda **_: [])
        assert sync.latest_refresh_pointers() == {}

    def test_fingerprint_changes_on_same_date_reupload(self):
        first = _asset(
            "data-2026-11", "52w/2026-11-27.json.gz", updated_at="2026-11-27T19:00:00Z", size=100
        )
        republished = _asset(
            "data-2026-11", "52w/2026-11-27.json.gz", updated_at="2026-11-27T21:00:00Z", size=120
        )
        assert sync.refresh_fingerprint(first) != sync.refresh_fingerprint(republished)
        assert sync.refresh_fingerprint(first) == sync.refresh_fingerprint(
            _asset(
                "data-2026-11",
                "52w/2026-11-27.json.gz",
                updated_at="2026-11-27T19:00:00Z",
                size=100,
            )
        )


class TestLedgerFingerprints:
    def test_reads_dates_and_fingerprints_from_ok_and_partial_records(self, tmp_path: Path):
        path = tmp_path / "refresh_runs.json"
        path.write_text(
            json.dumps(
                [
                    {
                        "status": "ok",
                        "week52_dates": ["2026-11-20"],
                        "week52_fingerprint": "old-w",
                        "agri_dates": ["2026-11-20"],
                        "agri_fingerprint": "old-a",
                    },
                    {
                        "status": "failed",
                        "week52_dates": ["2026-12-20"],
                        "week52_fingerprint": "failed-w",
                    },
                    {
                        "status": "partial",
                        "week52_dates": ["2026-11-27"],
                        "week52_fingerprint": "new-w",
                        "agri_dates": [],
                        "agri_fingerprint": None,
                    },
                ]
            ),
            encoding="utf-8",
        )

        applied = sync.last_applied_pointers(path)
        assert applied.week52_as_of == "2026-11-27"
        assert applied.week52_fingerprint == "new-w"
        # The failed agri apply leaves the older applied fingerprint intact.
        assert applied.agri_as_of == "2026-11-20"
        assert applied.agri_fingerprint == "old-a"
        assert sync.last_applied_52w_as_of(path) == "2026-11-27"
        assert sync.last_applied_fingerprints(path) == {"agri": "old-a", "52w": "new-w"}

    def test_legacy_record_without_fingerprint_is_unknown(self, tmp_path: Path):
        path = tmp_path / "refresh_runs.json"
        path.write_text(
            json.dumps([{"status": "ok", "week52_dates": ["2026-11-27"], "agri_dates": []}]),
            encoding="utf-8",
        )
        applied = sync.last_applied_pointers(path)
        assert applied.week52_as_of == "2026-11-27"
        assert applied.week52_fingerprint is None
        assert applied.agri_fingerprint is None


class TestSyncOnce:
    def test_current_when_no_newer_or_changed_pointer(self, monkeypatch):
        _stub_env(monkeypatch, {})
        pointers = {
            "agri": _pointer("agri", "2026-11-27", "a-fp"),
            "52w": _pointer("52w", "2026-11-20", "w-fp"),
        }
        run_sync = _stub_freshness(monkeypatch, pointers, _applied())

        assert watcher.sync_once() == "current"
        run_sync.assert_not_called()

    def test_current_when_no_assets_published(self, monkeypatch):
        _stub_env(monkeypatch, {})
        run_sync = _stub_freshness(monkeypatch, {}, _applied())

        assert watcher.sync_once() == "current"
        run_sync.assert_not_called()

    @pytest.mark.parametrize(
        ("kind", "pointers", "applied"),
        [
            (
                "52w",
                {"52w": _pointer("52w", "2026-11-27", "w-fp-v2")},
                _applied(),
            ),
            (
                "agri",
                {"agri": _pointer("agri", "2026-11-27", "a-fp-v2")},
                _applied(),
            ),
        ],
    )
    def test_same_date_reupload_triggers_apply(self, monkeypatch, kind, pointers, applied):
        """P1: date-only dedupe ignored the 19:00/21:00 re-upload."""
        _stub_env(monkeypatch, {"GITHUB_TOKEN": "test-token"})
        run_sync = _stub_freshness(monkeypatch, pointers, applied)

        assert watcher.sync_once() == "applied"
        run_sync.assert_called_once_with(
            mode="latest", allow_empty=True, token="test-token"
        )

    def test_newer_date_triggers_apply(self, monkeypatch):
        _stub_env(monkeypatch, {})
        pointers = {"52w": _pointer("52w", "2026-12-01", "w-fp")}
        run_sync = _stub_freshness(monkeypatch, pointers, _applied())

        assert watcher.sync_once() == "applied"
        run_sync.assert_called_once()

    def test_agri_only_newer_triggers_apply(self, monkeypatch):
        """P4: the watcher used to ignore agri entirely."""
        _stub_env(monkeypatch, {})
        pointers = {"agri": _pointer("agri", "2026-11-28", "a-fp-v2")}
        run_sync = _stub_freshness(monkeypatch, pointers, _applied())

        assert watcher.sync_once() == "applied"
        run_sync.assert_called_once_with(mode="latest", allow_empty=True, token=None)

    @pytest.mark.parametrize("kind", ["agri", "52w"])
    def test_unknown_fingerprint_applies_once(self, monkeypatch, kind):
        applied = _applied()
        if kind == "agri":
            applied.agri_fingerprint = None
        else:
            applied.week52_fingerprint = None
        pointers = (
            {"agri": _pointer("agri", "2026-11-27", "a-fp")}
            if kind == "agri"
            else {"52w": _pointer("52w", "2026-11-27", "w-fp")}
        )
        run_sync = _stub_freshness(monkeypatch, pointers, applied)

        assert watcher.sync_once() == "applied"
        run_sync.assert_called_once()

    @pytest.mark.parametrize("kind", ["agri", "52w"])
    def test_older_pointer_is_not_rolled_back(self, monkeypatch, kind):
        applied = _applied()
        pointers = (
            {"agri": _pointer("agri", "2026-11-20", "a-fp-v2")}
            if kind == "agri"
            else {"52w": _pointer("52w", "2026-11-20", "w-fp-v2")}
        )
        run_sync = _stub_freshness(monkeypatch, pointers, applied)

        assert watcher.sync_once() == "current"
        run_sync.assert_not_called()

    def test_token_is_forwarded_to_github_listing(self, monkeypatch):
        """P2: sync_once used to call the listing with no token."""
        _stub_env(monkeypatch, {"GH_TOKEN": "test-token"})
        calls: list[dict] = []

        def fake_list(**kwargs):
            calls.append(kwargs)
            return [
                _asset("data-2026-11", "2026-11-28.json.gz", updated_at="t1", size=100),
                _asset("data-2026-11", "52w-2026-11-28.json", size=10),
                _asset("data-2026-11", "2026-11-28.jsonl.gz", updated_at="t2", size=200),
                _asset("data-2026-11", "agri-2026-11-28.json", size=20),
            ]

        monkeypatch.setattr(sync, "list_github_assets", fake_list)
        monkeypatch.setattr(watcher, "last_applied_pointers", lambda **_: _applied())
        monkeypatch.setattr(watcher, "run_sync", MagicMock())

        assert watcher.sync_once() == "applied"
        assert len(calls) == 1
        assert calls[0]["token"] == "test-token"

    def test_partial_ledger_keeps_agri_unapplied_for_retry(self, monkeypatch, tmp_path: Path):
        """P5: an agri failure writes the 52W pointer but leaves agri to retry."""
        _stub_env(monkeypatch, {})
        state = tmp_path / "refresh_runs.json"
        state.write_text(
            json.dumps(
                [
                    {
                        "status": "partial",
                        "week52_dates": ["2026-11-27"],
                        "week52_fingerprint": "w-fp",
                        "agri_dates": [],
                        "agri_fingerprint": None,
                        "agri_error": "agri exploded",
                    }
                ]
            ),
            encoding="utf-8",
        )
        pointers = {
            "52w": _pointer("52w", "2026-11-27", "w-fp"),
            "agri": _pointer("agri", "2026-11-27", "a-fp"),
        }
        monkeypatch.setattr(watcher, "latest_refresh_pointers", lambda **_: pointers)
        monkeypatch.setattr(
            watcher, "last_applied_pointers", lambda **_: sync.last_applied_pointers(state)
        )
        run_sync = MagicMock()
        monkeypatch.setattr(watcher, "run_sync", run_sync)

        assert watcher.sync_once() == "applied"
        run_sync.assert_called_once_with(mode="latest", allow_empty=True, token=None)

    def test_error_when_run_sync_raises(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
    ):
        _stub_env(monkeypatch, {})
        run_sync = _stub_freshness(
            monkeypatch, {"52w": _pointer("52w", "2026-12-01", "w-fp")}, _applied()
        )
        run_sync.side_effect = RuntimeError("boom")

        assert watcher.sync_once() == "error"
        assert "RuntimeError: boom" in capsys.readouterr().out
        run_sync.assert_called_once()

    def test_busy_when_sync_holds_the_state_lock(self, monkeypatch, tmp_path: Path):
        state = tmp_path / "refresh_runs.json"
        lock = Path(f"{state}.lock")
        handle = lock.open("a+")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            run_sync = _stub_freshness(
                monkeypatch, {"52w": _pointer("52w", "2026-12-01", "w-fp")}, _applied()
            )
            run_sync.side_effect = lambda **kwargs: sync.run_sync(
                mode="latest", assets_dir=tmp_path / "missing", state_file=state
            )

            assert watcher.sync_once() == "busy"
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            handle.close()


class TestReleaseSyncTask:
    def test_startup_delay_then_poll_and_clean_cancel(self, monkeypatch: pytest.MonkeyPatch):
        delays, ticks, run = _stub_sync_loop(monkeypatch, {}, cancel_after=3)

        assert asyncio.run(run()) == "exited"
        assert delays == [30.0, 900.0, 900.0]
        assert len(ticks) == 2

    def test_disabled_flag_skips_sync_and_honours_overrides(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        delays, ticks, run = _stub_sync_loop(
            monkeypatch,
            {
                "RELEASE_SYNC_ENABLED": "0",
                "RELEASE_SYNC_STARTUP_DELAY_SEC": "5",
                "RELEASE_SYNC_POLL_SEC": "600",
            },
            cancel_after=2,
        )

        assert asyncio.run(run()) == "exited"
        assert delays == [5.0, 600.0]
        assert ticks == []

    @pytest.mark.parametrize(
        ("startup", "poll", "invalid"),
        [
            ("not-a-number", "900", ("RELEASE_SYNC_STARTUP_DELAY_SEC",)),
            ("30", "-5", ("RELEASE_SYNC_POLL_SEC",)),
            ("nan", "inf", ("RELEASE_SYNC_STARTUP_DELAY_SEC", "RELEASE_SYNC_POLL_SEC")),
            ("-1", "abc", ("RELEASE_SYNC_STARTUP_DELAY_SEC", "RELEASE_SYNC_POLL_SEC")),
        ],
    )
    def test_invalid_delay_env_falls_back_and_still_sleeps(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture, startup, poll, invalid
    ):
        """P3: a parse failure used to spin forever without awaiting."""
        delays, ticks, run = _stub_sync_loop(
            monkeypatch,
            {
                "RELEASE_SYNC_STARTUP_DELAY_SEC": startup,
                "RELEASE_SYNC_POLL_SEC": poll,
            },
            cancel_after=2,
        )

        assert asyncio.run(run()) == "exited"
        assert delays == [30.0, 900.0]
        assert len(ticks) == 1
        out = capsys.readouterr().out
        for name in ("RELEASE_SYNC_STARTUP_DELAY_SEC", "RELEASE_SYNC_POLL_SEC"):
            assert (f"[Release Sync] invalid {name}" in out) is (name in invalid)
