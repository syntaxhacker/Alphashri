#!/usr/bin/env python3
"""Resumable multi-date backfill for the agri whole-date collector.

Runs :func:`scripts.market.agri_collect.collect_date` over an inclusive date
range, using the SQLite ingestion ledger as the source of truth for what is
already done. Only ``complete`` (and a previously verified ``empty``) partition
is skipped; ``partial``, ``failed`` and never-attempted dates are retried with
bounded attempts and exponential backoff.

Usage:
  .venv/bin/python scripts/market/agri_backfill.py --from 2026-06-01 --to 2026-11-21
  .venv/bin/python scripts/market/agri_backfill.py --from 2026-11-15 --to 2026-11-21 --replace
  .venv/bin/python scripts/market/agri_backfill.py --from 2026-11-01 --to 2026-11-07 \\
      --fetch-workers 4 --sleep 1.0 --max-attempts 3 --backoff 2.0
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable, Optional
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from api.agri import registry, store  # noqa: E402
from scripts.market import agri_collect as collector  # noqa: E402

SOURCE = registry.SOURCE_DAILY
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_SEC = 2.0
DEFAULT_SLEEP_SEC = 0.0
DEFAULT_FETCH_WORKERS = 4
SKIPPABLE = frozenset({"complete", "empty"})
REPORTABLE = ("complete", "partial", "failed", "missing", "empty", "skipped")

CollectFn = Callable[..., Any]
PrintFn = Callable[[str], None]
SleepFn = Callable[[float], None]


class BackfillError(ValueError):
    """Invalid range or option; the backfill did not run."""


@dataclass
class DateOutcome:
    day: str
    action: str
    status: str = ""
    attempts: int = 0
    rows: int = 0
    error: str = ""


@dataclass
class BackfillReport:
    started_at: str
    requested: int
    finished_at: str = ""
    outcomes: list[DateOutcome] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        counts = {name: 0 for name in REPORTABLE}
        for outcome in self.outcomes:
            counts[outcome.action] += 1
        return counts

    @property
    def ok(self) -> bool:
        counts = self.counts()
        return not (counts["partial"] or counts["failed"] or counts["missing"])

    def summary(self) -> str:
        counts = self.counts()
        return (
            f"BACKFILL complete={counts['complete']} partial={counts['partial']} "
            f"failed={counts['failed']} missing={counts['missing']} "
            f"empty={counts['empty']} skipped={counts['skipped']} "
            f"(requested={self.requested})"
        )


def parse_bound(value: str) -> str:
    """Accept ISO (documented) and DD/MM/YYYY; always return ISO."""
    try:
        return collector.parse_arrival_date(value)
    except ValueError as exc:
        raise BackfillError(
            f"invalid date {value!r}; expected YYYY-MM-DD (or DD/MM/YYYY)"
        ) from exc


def date_span(first: str, last: str) -> list[str]:
    start = date.fromisoformat(first)
    end = date.fromisoformat(last)
    if end < start:
        raise BackfillError(f"--from {first} is after --to {last}")
    days: list[str] = []
    cursor = start
    while cursor <= end:
        days.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return days


def _redact(text: str, secret: str) -> str:
    """Requests errors can embed the API key, raw or URL-encoded, in the URL."""
    if not secret:
        return text
    return text.replace(secret, "***").replace(quote(secret, safe=""), "***")


def run_backfill(
    from_day: str,
    to_day: str,
    *,
    db_path: Optional[str | Path] = None,
    api_key: Optional[str] = None,
    keys: Optional[Iterable[str]] = None,
    replace: bool = False,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    backoff_sec: float = DEFAULT_BACKOFF_SEC,
    sleep_sec: float = DEFAULT_SLEEP_SEC,
    fetch_workers: int = DEFAULT_FETCH_WORKERS,
    max_pages: int = 0,
    allow_empty: bool = False,
    collect_fn: Optional[CollectFn] = None,
    print_fn: PrintFn = print,
    sleep_fn: SleepFn = time.sleep,
    now: Optional[datetime] = None,
) -> BackfillReport:
    """Collect every date in range, resuming from the partition ledger."""
    if max_attempts < 1:
        raise BackfillError("--max-attempts must be >= 1")
    if backoff_sec < 0 or sleep_sec < 0:
        raise BackfillError("--backoff and --sleep must be >= 0")
    if fetch_workers < 1:
        raise BackfillError("--fetch-workers must be >= 1")

    days = date_span(parse_bound(from_day), parse_bound(to_day))
    started = now or datetime.now(config.IST)
    if started.tzinfo is None:
        started = started.replace(tzinfo=config.IST)
    report = BackfillReport(
        started_at=started.astimezone(config.IST).isoformat(timespec="seconds"),
        requested=len(days),
    )

    key = api_key if api_key is not None else (
        os.getenv("DATA_GOV_IN_API_KEY") or getattr(collector, "API_KEY", "")
    )
    collect = collect_fn or collector.collect_date
    conn = store.open_writer(db_path)
    try:
        for index, day in enumerate(days):
            if index and sleep_sec:
                sleep_fn(sleep_sec)

            initial = (store.get_partition(conn, SOURCE, day) or {}).get("status")
            if initial in SKIPPABLE and not replace:
                outcome = DateOutcome(day=day, action="skipped", status=str(initial))
                report.outcomes.append(outcome)
                print_fn(f"[{index + 1}/{len(days)}] {day}  SKIP ({initial})")
                continue

            outcome = DateOutcome(day=day, action="failed", status=initial or "missing")
            if not key:
                outcome.error = "DATA_GOV_IN_API_KEY is not set"
                report.outcomes.append(outcome)
                print_fn(f"[{index + 1}/{len(days)}] {day}  FAILED  {outcome.error}")
                continue

            for attempt in range(1, max_attempts + 1):
                outcome.attempts = attempt
                attempt_ok = False
                try:
                    result = collect(
                        day,
                        keys=keys,
                        api_key=key,
                        db_path=db_path,
                        no_db=False,
                        dry_run=False,
                        # A forced refetch deletes rows once; retries only merge.
                        replace_date=bool(replace and attempt == 1),
                        allow_empty=allow_empty,
                        max_pages=max_pages,
                        fetch_workers=fetch_workers,
                    )
                    attempt_ok = True
                    outcome.rows = int(getattr(result, "unique_rows", 0) or 0)
                    outcome.error = _redact(
                        "; ".join(str(r) for r in (getattr(result, "reasons", ()) or ())),
                        key,
                    )
                except Exception as exc:
                    outcome.error = _redact(f"{type(exc).__name__}: {exc}", key)

                latest = (store.get_partition(conn, SOURCE, day) or {}).get("status")
                outcome.status = latest or "missing"
                # A raised attempt must never inherit an older success row.
                if attempt_ok and outcome.status in ("complete", "empty"):
                    break
                if attempt < max_attempts:
                    delay = backoff_sec * (2 ** (attempt - 1))
                    if delay:
                        sleep_fn(delay)

            final = outcome.status
            if not attempt_ok:
                outcome.action = "missing" if outcome.status == "missing" else "failed"
            elif final in ("complete", "partial", "failed", "empty"):
                outcome.action = final
            else:
                outcome.action = "missing" if initial is None else "failed"
            report.outcomes.append(outcome)
            suffix = f" — {outcome.error}" if outcome.error else ""
            print_fn(
                f"[{index + 1}/{len(days)}] {day}  {outcome.action.upper()}  "
                f"{outcome.attempts} attempt(s), {outcome.rows} row(s){suffix}"
            )
    finally:
        conn.close()

    report.finished_at = (
        datetime.now(config.IST).astimezone(config.IST).isoformat(timespec="seconds")
    )
    print_fn(report.summary())
    if not report.ok:
        for outcome in report.outcomes:
            if outcome.action in ("partial", "failed", "missing"):
                suffix = f" ({outcome.error})" if outcome.error else ""
                print_fn(f"  UNRESOLVED {outcome.day}: {outcome.action}{suffix}")
    return report


def _arg_date(value: str) -> str:
    try:
        return parse_bound(value)
    except BackfillError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _commodity_keys(value: str) -> list[str]:
    keys: list[str] = []
    invalid: list[str] = []
    for token in str(value or "").split(","):
        token = token.strip()
        if not token:
            continue
        key = registry.commodity_key_for(token)
        if key:
            keys.append(key)
        else:
            invalid.append(token)
    if invalid or not keys:
        raise BackfillError(
            f"invalid --commodity value(s): {', '.join(invalid or ['<empty>'])}"
        )
    return list(dict.fromkeys(keys))


def main(argv: Optional[list[str]] = None, *, collect_fn: Optional[CollectFn] = None) -> int:
    ap = argparse.ArgumentParser(
        description="Resumable multi-date backfill of agri mandi prices"
    )
    ap.add_argument("--from", dest="from_day", required=True, type=_arg_date,
                    metavar="YYYY-MM-DD", help="First arrival date (inclusive)")
    ap.add_argument("--to", dest="to_day", required=True, type=_arg_date,
                    metavar="YYYY-MM-DD", help="Last arrival date (inclusive)")
    ap.add_argument("--replace", action="store_true",
                    help="Refetch dates whose partition is already complete/empty")
    ap.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS,
                    help=f"Retries per date (default {DEFAULT_MAX_ATTEMPTS})")
    ap.add_argument("--backoff", type=float, default=DEFAULT_BACKOFF_SEC,
                    dest="backoff_sec",
                    help=f"Base retry backoff in seconds (default {DEFAULT_BACKOFF_SEC})")
    ap.add_argument("--sleep", type=float, default=DEFAULT_SLEEP_SEC,
                    dest="sleep_sec",
                    help=f"Pause between dates in seconds (default {DEFAULT_SLEEP_SEC})")
    ap.add_argument("--fetch-workers", type=int, default=DEFAULT_FETCH_WORKERS,
                    help=f"Parallel page fetches per date (default {DEFAULT_FETCH_WORKERS})")
    ap.add_argument("--max-pages", type=int, default=0,
                    help="Safety page cap per date; hitting it marks the date partial")
    ap.add_argument("--commodity", default=None,
                    help="Comma-separated commodity keys to require (default: all tracked)")
    ap.add_argument("--allow-empty", action="store_true",
                    help="Accept a date with zero published rows as a valid holiday")
    ap.add_argument("--db", type=Path, default=None, help="Target SQLite path")
    args = ap.parse_args(argv)

    try:
        keys = _commodity_keys(args.commodity) if args.commodity else None
        report = run_backfill(
            args.from_day,
            args.to_day,
            db_path=args.db,
            replace=args.replace,
            max_attempts=args.max_attempts,
            backoff_sec=args.backoff_sec,
            sleep_sec=args.sleep_sec,
            fetch_workers=args.fetch_workers,
            max_pages=args.max_pages,
            keys=keys,
            allow_empty=args.allow_empty,
            collect_fn=collect_fn,
        )
    except BackfillError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
