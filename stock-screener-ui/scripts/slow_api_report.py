#!/usr/bin/env python3
"""Summarize slow API requests captured by ``api.slow_api.SlowAPIMiddleware``.

The middleware appends one JSON record per slow request to
``logs/slow_api.jsonl`` and also writes a ``SLOW_API {...}`` line to the
uvicorn log. This tool reads either source and reports the routes that are
actually hurting, with p50/p95/max latency.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

DEFAULT_JSONL = Path("logs/slow_api.jsonl")
DEFAULT_LOG = Path("logs/alphashri.log")

_UUID = re.compile(r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=/|$)")
_HEX = re.compile(r"/[0-9a-fA-F]{8,}(?=/|$)")
_NUM = re.compile(r"/\d+(?=/|$)")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T")


@dataclass
class Record:
    ts: Optional[datetime]
    method: str
    route: str
    status: int
    ttfb_ms: float
    total_ms: float
    stream: bool
    raw: dict[str, Any]


def normalize_path(path: str) -> str:
    path = path.split("?", 1)[0]
    path = _UUID.sub("/{id}", path)
    path = _HEX.sub("/{id}", path)
    path = _NUM.sub("/{id}", path)
    return path


def parse_ts(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def record_from_dict(obj: dict[str, Any]) -> Optional[Record]:
    try:
        ttfb = float(obj.get("ttfb_ms") or 0.0)
        total = float(obj.get("total_ms") or ttfb)
    except (TypeError, ValueError):
        return None
    route = str(obj.get("route") or obj.get("path") or "unknown")
    if route in ("unknown", ""):
        return None
    if not obj.get("route"):
        route = normalize_path(route)
    return Record(
        ts=parse_ts(obj.get("ts")),
        method=str(obj.get("method") or ""),
        route=route,
        status=int(obj.get("status") or 0),
        ttfb_ms=ttfb,
        total_ms=total,
        stream=bool(obj.get("stream")),
        raw=obj,
    )


def _dict_from_line(line: str) -> Optional[dict[str, Any]]:
    line = line.strip()
    if not line:
        return None
    if line.startswith("{"):
        try:
            obj = json.loads(line)
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    marker = "SLOW_API "
    pos = line.find(marker)
    if pos < 0:
        return None
    try:
        obj = json.loads(line[pos + len(marker):])
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def read_records(paths: Iterable[Path]) -> list[Record]:
    records: list[Record] = []
    seen: set[tuple[Any, ...]] = set()
    for path in paths:
        if not path.exists() or not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    obj = _dict_from_line(line)
                    if obj is None:
                        continue
                    record = record_from_dict(obj)
                    if record is None:
                        continue
                    key = (
                        record.ts,
                        record.method,
                        record.raw.get("path"),
                        record.status,
                        record.ttfb_ms,
                        record.total_ms,
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    records.append(record)
        except OSError:
            continue
    records.sort(key=lambda r: r.ts or datetime.min.replace(tzinfo=timezone.utc))
    return records


def parse_since(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = value.strip().lower()
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([smhd])", text)
    if match:
        amount = float(match.group(1))
        unit = match.group(2)
        seconds = amount * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        return datetime.now(timezone.utc) - timedelta(seconds=seconds)
    parsed = parse_ts(value)
    if parsed is None:
        raise SystemExit(f"bad --since value: {value!r} (use 30m/2h/7d or ISO-8601)")
    return parsed


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100.0 * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


def summarize(records: list[Record], min_ms: float = 0.0) -> list[dict[str, Any]]:
    buckets: dict[str, list[Record]] = defaultdict(list)
    for record in records:
        latency = record.ttfb_ms if record.stream else record.total_ms
        if latency >= min_ms:
            buckets[record.route].append(record)

    rows: list[dict[str, Any]] = []
    for route, items in buckets.items():
        ttfb = [r.ttfb_ms for r in items]
        total = [r.ttfb_ms if r.stream else r.total_ms for r in items]
        rows.append(
            {
                "route": route,
                "count": len(items),
                "p50_ms": round(percentile(total, 50), 1),
                "p95_ms": round(percentile(total, 95), 1),
                "max_ms": round(max(total), 1),
                "p95_ttfb_ms": round(percentile(ttfb, 95), 1),
                "errors": sum(1 for r in items if r.status >= 500),
                "last": max((r.ts for r in items if r.ts), default=None),
                "methods": sorted({r.method for r in items if r.method}),
            }
        )
    return rows


def fmt_ts(value: Optional[datetime]) -> str:
    return value.astimezone().strftime("%H:%M:%S") if value else "—"


def print_table(rows: list[dict[str, Any]], top: int, sort_key: str) -> None:
    rows = sorted(rows, key=lambda r: (r[sort_key], r["count"]), reverse=True)[:top]
    if not rows:
        print("No SLOW_API records matched. Restart the API after adding the middleware;")
        print("set SLOW_API_MS=200 (and optionally SLOW_API_LOG_ALL=1) for a fuller sample.")
        return
    header = f"{'ROUTE':<58} {'METHOD':<7} {'N':>5} {'P50':>8} {'P95':>8} {'MAX':>8} {'ERR':>4} {'LAST':>9}"
    print(header)
    print("-" * len(header))
    for row in rows:
        route = row["route"]
        if len(route) > 57:
            route = "…" + route[-56:]
        methods = ",".join(row["methods"])[:7]
        print(
            f"{route:<58} {methods:<7} {row['count']:>5} "
            f"{row['p50_ms']:>8.1f} {row['p95_ms']:>8.1f} {row['max_ms']:>8.1f} "
            f"{row['errors']:>4} {fmt_ts(row['last']):>9}"
        )


def follow(paths: list[Path], min_ms: float) -> None:
    jsonl = paths[0]
    print(f"Following {jsonl} (Ctrl-C to stop). Latency in ms; stream routes use TTFB.")
    jsonl.parent.mkdir(parents=True, exist_ok=True)
    jsonl.touch(exist_ok=True)
    with jsonl.open("r", encoding="utf-8", errors="replace") as fh:
        fh.seek(0, 2)
        while True:
            line = fh.readline()
            if not line:
                time.sleep(1.0)
                continue
            obj = _dict_from_line(line)
            if obj is None:
                continue
            record = record_from_dict(obj)
            if record is None:
                continue
            latency = record.ttfb_ms if record.stream else record.total_ms
            if latency < min_ms:
                continue
            stream = " stream" if record.stream else ""
            print(
                f"{fmt_ts(record.ts)} {record.method:<6} {record.status:>3} "
                f"{latency:>8.1f}ms  {record.route}{stream}"
            )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Report slow API routes from middleware logs.")
    parser.add_argument(
        "--jsonl",
        default=str(DEFAULT_JSONL),
        help=f"JSONL written by SlowAPIMiddleware (default: {DEFAULT_JSONL})",
    )
    parser.add_argument(
        "--log",
        action="append",
        default=None,
        help=f"Also parse SLOW_API lines from a log file (default: {DEFAULT_LOG})",
    )
    parser.add_argument("--since", help="Only records newer than e.g. 30m, 2h, 7d or ISO-8601")
    parser.add_argument("--top", type=int, default=20, help="Rows to show (default 20)")
    parser.add_argument("--min-ms", type=float, default=0.0, help="Ignore faster records")
    parser.add_argument("--sort", choices=("p95", "max", "count", "p50"), default="p95")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    parser.add_argument("--follow", action="store_true", help="Live-tail the JSONL file")
    parser.add_argument("--fail-over", type=float, default=None, help="Exit 1 if any record is slower")
    args = parser.parse_args(argv)

    jsonl = Path(args.jsonl)
    if args.follow:
        follow([jsonl], args.min_ms)
        return 0

    logs = [Path(p) for p in (args.log if args.log else [str(DEFAULT_LOG)])]
    paths = [jsonl] + [p for p in logs if p != jsonl]
    records = read_records(paths)

    since = parse_since(args.since)
    if since is not None:
        records = [r for r in records if r.ts is not None and r.ts >= since]

    rows = summarize(records, min_ms=args.min_ms)
    if args.json:
        print(json.dumps(rows, default=str, indent=2))
    else:
        sources = ", ".join(str(p) for p in paths if p.exists())
        print(f"SLOW API REPORT  source: {sources or 'none'}  records: {len(records)}")
        print_table(rows, top=args.top, sort_key=args.sort + "_ms" if args.sort != "count" else "count")

    if args.fail_over is not None:
        slowest = max(
            (r.ttfb_ms if r.stream else r.total_ms for r in records),
            default=0.0,
        )
        if slowest >= args.fail_over:
            print(f"FAIL: slowest request {slowest:.1f}ms >= {args.fail_over:.1f}ms", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
