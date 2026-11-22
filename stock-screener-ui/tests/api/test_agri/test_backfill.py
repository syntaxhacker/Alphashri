"""Backfill runner contract: ledger-driven resume, bounded retries, no key leaks.

Every collect attempt is served by a fake that writes the real (temp-file)
partition ledger; data.gov.in is never called from this module.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional
from urllib.parse import quote

import pytest

import config
from api.agri import registry, store
from scripts.market import agri_backfill as backfill

D1 = "2026-06-01"
D2 = "2026-06-02"
D3 = "2026-06-03"


def seed_partition(db: Path, day: str, status: str) -> None:
    conn = store.open_writer(db)
    try:
        store.upsert_partition(
            conn, source=registry.SOURCE_DAILY, arrival_date=day,
            status=status, expected_total=7, fetched_rows=7,
        )
    finally:
        conn.close()


def ledger_status(db: Path, day: str) -> Optional[str]:
    conn = store.open_writer(db)
    try:
        row = store.get_partition(conn, registry.SOURCE_DAILY, day)
        return row["status"] if row else None
    finally:
        conn.close()


class FakeCollector:
    """Scripted collector keyed by date; last step repeats for extra attempts."""

    def __init__(self, db: Path, script: Optional[dict[str, list[Any]]] = None) -> None:
        self.db = db
        self.script = script or {}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, day: str, **kwargs: Any) -> Any:
        self.calls.append((day, kwargs))
        index = sum(1 for called, _ in self.calls if called == day) - 1
        steps = self.script.get(day, [])
        step = steps[min(index, len(steps) - 1)] if steps else "complete"
        if isinstance(step, BaseException):
            raise step
        if step is not None:
            conn = store.open_writer(self.db)
            try:
                store.upsert_partition(
                    conn, source=registry.SOURCE_DAILY, arrival_date=day,
                    status=step, expected_total=7, fetched_rows=7,
                )
            finally:
                conn.close()
        return SimpleNamespace(
            status=step or "complete",
            unique_rows=7,
            reasons=("rows_seen 7 != api total 9",) if step == "partial" else (),
        )

    def days(self) -> list[str]:
        return [day for day, _ in self.calls]


def test_complete_and_empty_partitions_are_skipped_and_rerun_is_idempotent(
    tmp_path: Path,
):
    db = tmp_path / "ledger.db"
    seed_partition(db, D1, "complete")
    seed_partition(db, D2, "empty")
    fake = FakeCollector(db)

    first = backfill.run_backfill(
        D1, D3, db_path=db, api_key="test-key", collect_fn=fake, max_attempts=1,
    )
    assert fake.days() == [D3]
    assert first.counts() == {
        "complete": 1, "partial": 0, "failed": 0, "missing": 0,
        "empty": 0, "skipped": 2,
    }
    assert first.ok is True

    second = backfill.run_backfill(
        D1, D3, db_path=db, api_key="test-key", collect_fn=fake, max_attempts=1,
    )
    assert fake.days() == [D3]
    assert second.counts()["skipped"] == 3
    assert ledger_status(db, D1) == "complete"
    assert ledger_status(db, D2) == "empty"


def test_replace_forces_a_complete_date_and_retries_only_merge(tmp_path: Path):
    db = tmp_path / "replace.db"
    seed_partition(db, D1, "complete")
    fake = FakeCollector(db, {D1: ["partial", "complete"]})

    report = backfill.run_backfill(
        D1, D1, db_path=db, api_key="test-key", collect_fn=fake,
        replace=True, max_attempts=2, backoff_sec=0,
    )

    assert fake.days() == [D1, D1]
    assert [call[1]["replace_date"] for call in fake.calls] == [True, False]
    assert report.counts()["complete"] == 1
    assert ledger_status(db, D1) == "complete"


def test_raised_attempt_does_not_inherit_a_stale_complete_ledger(tmp_path: Path):
    db = tmp_path / "stale.db"
    seed_partition(db, D1, "complete")
    fake = FakeCollector(db, {D1: [RuntimeError("probe failed")]})

    report = backfill.run_backfill(
        D1, D1, db_path=db, api_key="test-key", collect_fn=fake,
        replace=True, max_attempts=2, backoff_sec=0,
        print_fn=lambda _line: None,
    )

    assert fake.days() == [D1, D1]
    assert report.outcomes[0].action == "failed"
    assert report.ok is False
    assert ledger_status(db, D1) == "complete"


def test_partial_and_failed_dates_retry_with_bounded_exponential_backoff(tmp_path: Path):
    db = tmp_path / "retry.db"
    fake = FakeCollector(db, {
        D1: ["partial", "complete"],
        D2: ["failed", "failed", "complete"],
    })
    sleeps: list[float] = []

    report = backfill.run_backfill(
        D1, D2, db_path=db, api_key="test-key", collect_fn=fake,
        max_attempts=3, backoff_sec=1.0, sleep_fn=sleeps.append,
    )

    assert [o.attempts for o in report.outcomes] == [2, 3]
    assert sleeps == [1.0, 1.0, 2.0]
    assert [o.action for o in report.outcomes] == ["complete", "complete"]
    assert report.ok is True


def test_exhausted_attempts_report_partial_failed_missing_and_exit_nonzero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    db = tmp_path / "unresolved.db"
    fake = FakeCollector(db, {
        D1: ["partial"],
        D2: [RuntimeError("boom")],
        D3: ["failed"],
    })
    monkeypatch.setenv("DATA_GOV_IN_API_KEY", "test-key")

    report = backfill.run_backfill(
        D1, D3, db_path=db, collect_fn=fake, max_attempts=3,
        backoff_sec=0, print_fn=lambda _line: None,
    )
    counts = report.counts()
    assert (counts["partial"], counts["failed"], counts["missing"]) == (1, 1, 1)
    assert report.ok is False
    assert [o.attempts for o in report.outcomes] == [3, 3, 3]

    exit_code = backfill.main(
        ["--from", D1, "--to", D3, "--db", str(db),
         "--max-attempts", "1", "--backoff", "0"],
        collect_fn=fake,
    )
    assert exit_code == 1


def test_api_key_is_never_printed_including_error_messages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
):
    db = tmp_path / "secret.db"
    secret = "SUPER+SECRET/KEY=123"
    failure = RuntimeError(
        "HTTPSConnectionPool: GET "
        f"https://api.data.gov.in/resource/x?api-key={quote(secret, safe='')} failed"
    )
    fake = FakeCollector(db, {D1: [failure]})
    monkeypatch.setenv("DATA_GOV_IN_API_KEY", secret)
    lines: list[str] = []

    report = backfill.run_backfill(
        D1, D1, db_path=db, collect_fn=fake, max_attempts=1,
        print_fn=lines.append,
    )
    printed = "\n".join(lines)
    assert secret not in printed
    assert quote(secret, safe="") not in printed
    assert "***" in printed
    assert secret not in report.outcomes[0].error
    assert quote(secret, safe="") not in report.outcomes[0].error
    assert "***" in report.outcomes[0].error

    fake.calls.clear()
    assert backfill.main(
        ["--from", D1, "--to", D1, "--db", str(db), "--max-attempts", "1"],
        collect_fn=fake,
    ) == 1
    assert secret not in capsys.readouterr().out


def test_missing_key_skips_collection_without_printing_any_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    db = tmp_path / "nokey.db"
    monkeypatch.delenv("DATA_GOV_IN_API_KEY", raising=False)
    monkeypatch.setattr(backfill.collector, "API_KEY", "")
    fake = FakeCollector(db)
    lines: list[str] = []

    report = backfill.run_backfill(
        D1, D1, db_path=db, collect_fn=fake, print_fn=lines.append,
    )

    assert fake.calls == []
    assert report.counts()["failed"] == 1
    assert "DATA_GOV_IN_API_KEY is not set" in "\n".join(lines)


def test_options_are_forwarded_and_inter_date_sleep_skips_the_last_date(tmp_path: Path):
    db = tmp_path / "options.db"
    fake = FakeCollector(db)
    sleeps: list[float] = []

    backfill.run_backfill(
        D1, D3, db_path=db, api_key="test-key", collect_fn=fake,
        max_attempts=1, sleep_sec=0.25, sleep_fn=sleeps.append,
        fetch_workers=6, max_pages=2, allow_empty=True, keys=["onion"],
        print_fn=lambda _line: None,
    )

    assert sleeps == [0.25, 0.25]
    assert fake.days() == [D1, D2, D3]
    for _day, kwargs in fake.calls:
        assert kwargs == {
            "keys": ["onion"], "api_key": "test-key", "db_path": db,
            "no_db": False, "dry_run": False, "replace_date": False,
            "allow_empty": True, "max_pages": 2, "fetch_workers": 6,
        }


def test_ledger_is_authoritative_and_timestamps_use_ist(tmp_path: Path):
    db = tmp_path / "authority.db"

    def claims_complete_but_ledgers_partial(day: str, **_kwargs: Any) -> Any:
        conn = store.open_writer(db)
        try:
            store.upsert_partition(
                conn, source=registry.SOURCE_DAILY, arrival_date=day,
                status="partial", expected_total=7, fetched_rows=7,
            )
        finally:
            conn.close()
        return SimpleNamespace(status="complete", unique_rows=7, reasons=())

    at_2am_ist = datetime(2026, 11, 22, 2, 0, tzinfo=config.IST)
    report = backfill.run_backfill(
        D1, D1, db_path=db, api_key="test-key", collect_fn=claims_complete_but_ledgers_partial,
        max_attempts=1, print_fn=lambda _line: None, now=at_2am_ist,
    )

    assert report.outcomes[0].action == "partial"
    assert report.outcomes[0].rows == 7
    assert report.ok is False
    assert report.started_at == "2026-11-22T02:00:00+05:30"
    assert report.finished_at.endswith("+05:30")


def test_empty_result_is_accepted_when_allowed(tmp_path: Path):
    db = tmp_path / "empty.db"

    def empty_day(day: str, **_kwargs: Any) -> Any:
        conn = store.open_writer(db)
        try:
            store.upsert_partition(
                conn, source=registry.SOURCE_DAILY, arrival_date=day,
                status="empty", expected_total=0, fetched_rows=0,
            )
        finally:
            conn.close()
        return SimpleNamespace(status="empty", unique_rows=0, reasons=())

    report = backfill.run_backfill(
        D1, D1, db_path=db, api_key="test-key", collect_fn=empty_day,
        max_attempts=1, allow_empty=True, print_fn=lambda _line: None,
    )

    assert report.counts()["empty"] == 1
    assert report.ok is True


def test_invalid_range_and_options_fail_before_collecting(tmp_path: Path):
    db = tmp_path / "invalid.db"
    fake = FakeCollector(db)

    with pytest.raises(backfill.BackfillError):
        backfill.parse_bound("not-a-date")
    with pytest.raises(backfill.BackfillError):
        backfill.date_span(D3, D1)
    with pytest.raises(backfill.BackfillError):
        backfill.run_backfill(
            D1, D2, db_path=db, api_key="test-key", collect_fn=fake, max_attempts=0,
        )
    assert backfill.main(["--from", D3, "--to", D1, "--db", str(db)], collect_fn=fake) == 2
    assert backfill.main(
        ["--from", D1, "--to", D2, "--db", str(db), "--commodity", "bogus"],
        collect_fn=fake,
    ) == 2
    assert fake.calls == []
