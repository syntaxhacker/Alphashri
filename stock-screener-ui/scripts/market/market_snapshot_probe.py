"""Read-only probe for GET /api/market/snapshot (backend owner's contract check).

Calls the market-snapshot endpoint a handful of times (6 requests max, 1 s
spacing) and reports latency, payload sizes, gzip headers, row counts and
per-field completeness so a frontend/backend handoff can be verified without
flooding the service.

Request plan (6 total — under the 8-request cap):
  1-3. ?universe=all_equity&limit=4000           (×3, latency p50/min/max)
  4.   ?universe=all_equity&limit=4000&force=true (cache-bypass variant)
  5.   ?universe=nifty500&limit=4000             (optional universe)
  6.   ?universe=nse_fo&limit=4000               (optional universe)

Exit code is always 0 on expected "not live yet" states (404 / 502 /
connection-refused) — those are reported, not treated as script errors.
Run with the project venv, e.g.:
    .venv/bin/python scripts/market/market_snapshot_probe.py
"""

from __future__ import annotations

import argparse
import gzip
import json
import statistics
import sys
import time
from typing import Any

import requests

DEFAULT_BASE = "http://localhost:8765/api/market/snapshot"
FIELDS = [
    "close",
    "change",
    "relative_volume",
    "market_cap_cr",
    "rsi",
    "adx",
    "sma200",
    "pos_52w",
]
ROW_LIST_KEYS = ("rows", "data", "results", "stocks", "items", "snapshot", "universe")
TOTAL_KEYS = ("total", "count", "returned", "n")
UPDATE_MODE_KEYS = ("update_mode", "updateMode", "freshness", "mode")


def find_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ROW_LIST_KEYS:
            value = payload.get(key)
            if isinstance(value, list):
                rows = [r for r in value if isinstance(r, dict)]
                if rows:
                    return rows
        # Some envelopes nest rows under meta/result — scan one level deep.
        for value in payload.values():
            if isinstance(value, dict):
                for key in ROW_LIST_KEYS:
                    inner = value.get(key)
                    if isinstance(inner, list) and inner and isinstance(inner[0], dict):
                        return [r for r in inner if isinstance(r, dict)]
    return []


def lookup(payload: Any, keys: tuple[str, ...]) -> Any:
    if isinstance(payload, dict):
        for key in keys:
            if key in payload and payload[key] is not None:
                return payload[key]
        for value in payload.values():
            if isinstance(value, dict):
                for key in keys:
                    if key in value and value[key] is not None:
                        return value[key]
    return None


def is_present(row: dict[str, Any], key: str) -> bool:
    value = row.get(key)
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() not in ("", "null", "None", "nan", "NaN")
    if isinstance(value, float):
        return value == value  # drop NaN
    return True


def completeness(rows: list[dict[str, Any]]) -> dict[str, float]:
    if not rows:
        return {field: 0.0 for field in FIELDS}
    return {
        field: (sum(1 for row in rows if is_present(row, field)) / len(rows)) * 100
        for field in FIELDS
    }


def fetch_once(session: requests.Session, url: str, timeout: float) -> dict[str, Any]:
    """One streamed GET capturing wire bytes, headers and latency."""
    started = time.perf_counter()
    try:
        response = session.get(url, stream=True, timeout=timeout)
        wire = response.raw.read(decode_content=False)  # as-transferred bytes
        latency_ms = (time.perf_counter() - started) * 1000.0
    except requests.RequestException as exc:
        return {
            "url": url,
            "status": None,
            "error": f"{type(exc).__name__}: {exc}",
            "latency_ms": round((time.perf_counter() - started) * 1000.0, 1),
            "headers": {},
            "wire_bytes": 0,
            "raw_bytes": 0,
            "payload": None,
        }
    content_encoding = response.headers.get("content-encoding", "")
    try:
        raw = gzip.decompress(wire) if "gzip" in content_encoding.lower() else wire
    except OSError:
        raw = wire
    payload: Any = None
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        payload = {"_unparseable": str(exc)}
    rows = find_rows(payload)
    sample_keys = sorted(rows[0].keys()) if rows else []
    return {
        "url": url,
        "status": response.status_code,
        "latency_ms": round(latency_ms, 1),
        "headers": {
            "content-encoding": content_encoding or "(none)",
            "content-length": response.headers.get("content-length", "(absent)"),
            "content-type": response.headers.get("content-type", "(absent)"),
        },
        "wire_bytes": len(wire),
        "raw_bytes": len(raw),
        "gzip_hint": bool(content_encoding and "gzip" in content_encoding.lower()),
        "total": lookup(payload, TOTAL_KEYS),
        "update_mode": lookup(payload, UPDATE_MODE_KEYS),
        "top_level_keys": sorted(payload.keys()) if isinstance(payload, dict) else f"[{type(payload).__name__}]",
        "row_count": len(rows),
        "sample_row_keys": sample_keys,
        "completeness_pct": {k: round(v, 1) for k, v in completeness(rows).items()},
        "payload": payload,
    }


def latency_stats(samples: list[dict[str, Any]]) -> dict[str, float | None]:
    lat = sorted(s["latency_ms"] for s in samples if s["status"] is not None)
    if not lat:
        return {"min": None, "p50": None, "max": None}
    return {
        "min": lat[0],
        "p50": round(statistics.median(lat), 1),
        "max": lat[-1],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--spacing", type=float, default=1.0)
    parser.add_argument("--no-optional", action="store_true", help="skip nifty500/nse_fo probes")
    parser.add_argument(
        "--out",
        default="/tmp/opencode/market_snapshot_probe.json",
        help="where to write the JSON summary (scratch only)",
    )
    args = parser.parse_args()

    plan = [
        ("all_equity", f"{args.base}?universe=all_equity&limit=4000"),
        ("all_equity", f"{args.base}?universe=all_equity&limit=4000"),
        ("all_equity", f"{args.base}?universe=all_equity&limit=4000"),
        ("all_equity+force", f"{args.base}?universe=all_equity&limit=4000&force=true"),
    ]
    if not args.no_optional:
        plan.append(("nifty500", f"{args.base}?universe=nifty500&limit=4000"))
        plan.append(("nse_fo", f"{args.base}?universe=nse_fo&limit=4000"))

    session = requests.Session()
    session.headers.update({"Accept": "application/json", "Accept-Encoding": "gzip"})
    results: list[dict[str, Any]] = []
    for index, (label, url) in enumerate(plan):
        if index > 0:
            time.sleep(args.spacing)
        sample = fetch_once(session, url, args.timeout)
        sample["label"] = label
        sample["attempt"] = index + 1
        results.append(sample)
        status = sample["status"]
        print(
            f"[{index + 1}/{len(plan)}] {label}: "
            f"HTTP {status if status is not None else 'ERR'} "
            f"{sample['latency_ms']} ms, wire={sample['wire_bytes']}B raw={sample['raw_bytes']}B"
        )
        if sample.get("error"):
            print(f"    error: {sample['error']}")

    first = results[0] if results else {}
    not_live = (
        first.get("status") in (404, 502)
        or first.get("status") is None
    )
    stats = latency_stats([r for r in results if r["label"] == "all_equity"] or results)

    summary = {
        "base": args.base,
        "request_count": len(results),
        "spacing_s": args.spacing,
        "not_live": not_live,
        "latency_ms_all_equity": stats,
        "first_response": {k: v for k, v in first.items() if k != "payload"},
        "completeness_pct_first": first.get("completeness_pct", {}),
        "gzip_encoding_present": first.get("gzip_hint", False),
        "content_encoding_header": first.get("headers", {}).get("content-encoding"),
        "content_length_header": first.get("headers", {}).get("content-length"),
        "per_request": [
            {
                "label": r["label"],
                "status": r["status"],
                "latency_ms": r["latency_ms"],
                "wire_bytes": r["wire_bytes"],
                "raw_bytes": r["raw_bytes"],
                "total": r["total"],
                "update_mode": r["update_mode"],
                "row_count": r["row_count"],
                "top_level_keys": r["top_level_keys"],
            }
            for r in results
        ],
    }

    print("\n== summary ==")
    if not_live:
        print(
            "STATUS: NOT LIVE YET — endpoint returned "
            f"HTTP {first.get('status') if first else 'ERR'}" + (
                f" ({first.get('error')})" if first and first.get("error") else ""
            )
        )
        print("Re-run this probe once the backend endpoint is deployed; no action on the probe itself.")
    else:
        print("STATUS: LIVE")
        print(f"latency (all_equity x3): min={stats['min']} ms p50={stats['p50']} ms max={stats['max']} ms")
        print(f"total={first.get('total')!r} update_mode={first.get('update_mode')!r} rows={first.get('row_count')}")
        print(f"gzip: {'YES' if summary['gzip_encoding_present'] else 'no'} "
              f"(content-encoding={summary['content_encoding_header']!r}, "
              f"content-length={summary['content_length_header']!r})")
        print(f"wire bytes={first.get('wire_bytes')} raw (decompressed) bytes={first.get('raw_bytes')}")
        print(f"top-level keys: {first.get('top_level_keys')}")
        print(f"sample row keys ({len(first.get('sample_row_keys', []))}): {first.get('sample_row_keys')}")
        print("\nfield completeness (non-null % of rows):")
        for field in FIELDS:
            print(f"  {field:<16} {summary['completeness_pct_first'].get(field, 0.0):>5} %")

    try:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2, default=str)
        print(f"\nJSON summary -> {args.out}")
    except OSError as exc:
        print(f"(could not write JSON summary: {exc})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
