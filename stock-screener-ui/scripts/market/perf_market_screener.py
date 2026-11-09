"""Performance probe for the Market screener + symbol-chart path (pre-release baseline).

Bounded, sequential requests (no flooding). Request plan (24 total, 1 s spacing):

  snapshot : 3 universes x (3x force=true "cold" + 3x warm) = 18
  chart    : RELIANCE / POWERMECH / SPCL x (1 cold + 1 cached) = 6

Snapshot budgets (budgets are always evaluated and printed; --strict also
makes the exit code nonzero on any breach):

  warm all_equity p50  <= 1500 ms
  warm nifty500   p50  <= 2000 ms
  chart RELIANCE cold  <= 8000 ms (POWERMECH cold: same budget)
  chart SPCL cached    <= 2000 ms (cold SPCL run is reported separately —
      the first no-data click pays the upstream fetch; the budget guards
      the repeat-click negative-cache path)

Why these numbers: the snapshot backend caches one TV scan per
(universe, limit) for 15 s, so a warm hit must be well under the upstream
scan time; the symbol-chart endpoint caps one candle fetch at
CHART_FETCH_TIMEOUT_SEC (7 s default), so 8 s leaves 1 s of client
overhead; no-data answers are negative-cached for 5 min, so a cached
no-data read must be near-instant.

Run with the project venv, e.g.:
    .venv/bin/python scripts/market/perf_market_screener.py [--strict]
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import statistics
import sys
import time
from typing import Any

import requests

DEFAULT_API_BASE = "http://localhost:8765"
SNAPSHOT_PATH = "/api/market/snapshot"
CHART_PATH = "/api/chart-patterns/symbol/{symbol}/chart"
UNIVERSES = ("all_equity", "nifty500", "nse_fo")
# RELIANCE: has data. POWERMECH: transient upstream failures. SPCL: no data.
CHART_SYMBOLS = ("RELIANCE", "POWERMECH", "SPCL")

BUDGETS = [
    ("warm all_equity snapshot p50", 1500.0),
    ("warm nifty500 snapshot p50", 2000.0),
    ("chart RELIANCE cold", 8000.0),
    ("chart POWERMECH cold", 8000.0),
    ("chart SPCL cached", 2000.0),
]


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = pct / 100.0 * (len(ordered) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return ordered[int(rank)]
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def latency_summary(samples: list[dict[str, Any]]) -> dict[str, Any]:
    """p50/p95/min/max over the successful samples of one group."""
    lat = sorted(
        s["latency_ms"] for s in samples if s.get("status") is not None
    )
    if not lat:
        return {"min": None, "p50": None, "p95": None, "max": None, "n": 0}
    return {
        "min": round(lat[0], 1),
        "p50": round(percentile(lat, 50), 1),
        "p95": round(percentile(lat, 95), 1),
        "max": round(lat[-1], 1),
        "n": len(lat),
    }


def fetch_once(
    session: requests.Session, url: str, timeout: float
) -> dict[str, Any]:
    """One streamed GET capturing wire bytes, headers and latency."""
    started = time.perf_counter()
    try:
        response = session.get(url, stream=True, timeout=timeout)
        wire = response.raw.read(decode_content=False)
        latency_ms = (time.perf_counter() - started) * 1000.0
    except requests.RequestException as exc:
        return {
            "status": None,
            "error": f"{type(exc).__name__}: {exc}",
            "latency_ms": round((time.perf_counter() - started) * 1000.0, 1),
            "wire_bytes": 0,
            "raw_bytes": 0,
            "gzip": False,
            "headers": {},
            "payload": None,
        }
    content_encoding = response.headers.get("content-encoding", "")
    try:
        raw = (
            gzip.decompress(wire)
            if "gzip" in content_encoding.lower()
            else wire
        )
    except OSError:
        raw = wire
    payload: Any = None
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        payload = {"_unparseable": str(exc)}
    return {
        "status": response.status_code,
        "latency_ms": round(latency_ms, 1),
        "wire_bytes": len(wire),
        "raw_bytes": len(raw),
        "gzip": "gzip" in content_encoding.lower(),
        "headers": {
            k: v
            for k, v in response.headers.items()
            if k.lower()
            in ("content-encoding", "content-length", "content-type",
                "age", "x-cache", "cache-control", "cf-cache-status")
        },
        "payload": payload,
    }


def describe_snapshot(sample: dict[str, Any]) -> dict[str, Any]:
    """Pull the reporting fields out of one snapshot response."""
    body = sample.get("payload") or {}
    rows = body.get("rows") if isinstance(body, dict) else None
    return {
        "status": sample["status"],
        "latency_ms": sample["latency_ms"],
        "wire_bytes": sample["wire_bytes"],
        "raw_bytes": sample["raw_bytes"],
        "gzip": sample["gzip"],
        "rows": len(rows) if isinstance(rows, list) else None,
        "total": body.get("total") if isinstance(body, dict) else None,
        "update_mode": body.get("update_mode") if isinstance(body, dict) else None,
        "as_of": body.get("as_of") if isinstance(body, dict) else None,
        "cached": None,  # inferred below from as_of equality, not a body field
        "headers": sample["headers"],
        "error": sample.get("error"),
    }


def describe_chart(sample: dict[str, Any]) -> dict[str, Any]:
    """Pull the reporting fields out of one symbol-chart response."""
    body = sample.get("payload") or {}
    candles = body.get("candles") if isinstance(body, dict) else None
    return {
        "status": sample["status"],
        "latency_ms": sample["latency_ms"],
        "wire_bytes": sample["wire_bytes"],
        "raw_bytes": sample["raw_bytes"],
        "gzip": sample["gzip"],
        "candles": len(candles) if isinstance(candles, list) else None,
        "error": body.get("error") if isinstance(body, dict) else None,
        "note": body.get("note") if isinstance(body, dict) else None,
        "from_cache": body.get("from_cache") if isinstance(body, dict) else None,
        "transport_error": sample.get("error"),
    }


def maybe_authenticate(
    session: requests.Session, base: str,
    email: str, password: str,
) -> bool:
    """One login attempt (only used when the anonymous probe gets 401)."""
    try:
        resp = session.post(
            f"{base}/api/auth/login",
            json={"email": email, "password": password},
            timeout=15.0,
        )
    except requests.RequestException:
        return False
    if resp.status_code != 200:
        return False
    token = (resp.json() or {}).get("access_token")
    if not token:
        return False
    session.headers["Authorization"] = f"Bearer {token}"
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_API_BASE)
    parser.add_argument("--limit", type=int, default=4000)
    parser.add_argument("--runs", type=int, default=3,
                        help="runs per snapshot group (cold and warm)")
    parser.add_argument("--chart-runs", type=int, default=2)
    parser.add_argument("--spacing", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--email", default=os.environ.get("QA_EMAIL", "qa@test.com"))
    parser.add_argument("--password", default=os.environ.get("QA_PASS", "qa123"))
    parser.add_argument("--token", default=os.environ.get("PERF_TOKEN", ""))
    parser.add_argument("--strict", action="store_true",
                        help="exit nonzero when any budget is breached")
    parser.add_argument("--out", default="/tmp/opencode/perf_market_screener.json")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    session = requests.Session()
    session.headers.update({"Accept": "application/json",
                            "Accept-Encoding": "gzip"})
    if args.token:
        session.headers["Authorization"] = f"Bearer {args.token}"

    request_count = 0
    authed = False

    def get(url: str) -> dict[str, Any]:
        nonlocal request_count, authed
        request_count += 1
        sample = fetch_once(session, url, args.timeout)
        # Snapshot/chart are public, but stay robust if a deployment
        # gates them: one login attempt on 401, then one retry.
        if sample["status"] in (401, 403) and not authed:
            if maybe_authenticate(session, base, args.email, args.password):
                authed = True
                request_count += 1
                sample = fetch_once(session, url, args.timeout)
        # Sleep only between requests, never after the last one.
        return sample

    # --- Snapshot: cold (force=true) then warm, per universe -------------
    snapshot_groups: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for universe in UNIVERSES:
        groups = {"cold": [], "warm": []}
        for run in range(args.runs):
            url = (f"{base}{SNAPSHOT_PATH}?universe={universe}"
                   f"&limit={args.limit}&force=true")
            groups["cold"].append(describe_snapshot(get(url)))
            time.sleep(args.spacing)
        for run in range(args.runs):
            url = (f"{base}{SNAPSHOT_PATH}?universe={universe}"
                   f"&limit={args.limit}")
            groups["warm"].append(describe_snapshot(get(url)))
            time.sleep(args.spacing)
        # Warm-hit marker: as_of is generated per request by the backend,
        # so identical as_of is NOT evidence of a hit. The body carries no
        # cache flag — 'cached' stays unknown; judge by latency instead.
        for sample in groups["warm"]:
            sample["cached"] = None
            sample["cached_note"] = (
                "unknown: no cache flag in body; as_of is per-request. "
                "Rows identical across runs is weak evidence (TV data moves slowly)."
            )
        snapshot_groups[universe] = groups

    # --- Chart: cold then cached, per symbol ----------------------------
    chart_groups: dict[str, list[dict[str, Any]]] = {}
    for symbol in CHART_SYMBOLS:
        samples = []
        for run in range(args.chart_runs):
            url = f"{base}{CHART_PATH.format(symbol=symbol)}?timeframe=1D"
            samples.append(describe_chart(get(url)))
            time.sleep(args.spacing)
        chart_groups[symbol] = samples

    # --- Summaries + budgets ---------------------------------------------
    summaries: dict[str, Any] = {}
    for universe in UNIVERSES:
        summaries[f"snapshot:{universe}"] = {
            kind: latency_summary(samples)
            for kind, samples in snapshot_groups[universe].items()
        }
    for symbol in CHART_SYMBOLS:
        summaries[f"chart:{symbol}"] = latency_summary(chart_groups[symbol])
        summaries[f"chart:{symbol}:cold"] = latency_summary(
            chart_groups[symbol][:1]
        )

    warm_all = summaries["snapshot:all_equity"]["warm"]["p50"]
    warm_nifty500 = summaries["snapshot:nifty500"]["warm"]["p50"]
    cold_reliance = summaries["chart:RELIANCE:cold"]["p50"]
    # Cold chart latency is the single first sample (see summaries above).
    cold_powermechan = chart_groups["POWERMECH"][0]["latency_ms"]
    cached_spcl = (
        chart_groups["SPCL"][1]["latency_ms"]
        if len(chart_groups["SPCL"]) > 1
        else chart_groups["SPCL"][0]["latency_ms"]
    )
    actuals = {
        BUDGETS[0][0]: warm_all,
        BUDGETS[1][0]: warm_nifty500,
        BUDGETS[2][0]: cold_reliance,
        BUDGETS[3][0]: cold_powermechan,
        BUDGETS[4][0]: cached_spcl,
    }
    budget_results = []
    for name, budget in BUDGETS:
        actual = actuals[name]
        verdict = (
            "FAIL"
            if actual is None or actual > budget
            else "PASS"
        )
        budget_results.append(
            {"check": name, "actual_ms": actual, "budget_ms": budget,
             "verdict": verdict}
        )

    # --- Report -----------------------------------------------------------
    print(f"base={base}  requests={request_count}  "
          f"limit={args.limit}  runs={args.runs}+{args.chart_runs}")
    for universe in UNIVERSES:
        for kind in ("cold", "warm"):
            stats = summaries[f"snapshot:{universe}"][kind]
            samples = snapshot_groups[universe][kind]
            first = samples[0] if samples else {}
            print(
                f"snapshot {universe:>10} {kind:>4}: "
                f"min={stats['min']} p50={stats['p50']} "
                f"p95={stats['p95']} max={stats['max']} ms  "
                f"rows={first.get('rows')} wire={first.get('wire_bytes')}B "
                f"gzip={first.get('gzip')} update_mode={first.get('update_mode')!r} "
                f"cached={first.get('cached')} "
                f"as_of={first.get('as_of')} "
                f"statuses={[s['status'] for s in samples]}"
            )
    for symbol in CHART_SYMBOLS:
        for index, sample in enumerate(chart_groups[symbol]):
            label = "cold" if index == 0 else f"run{index + 1}"
            print(
                f"chart {symbol:>9} {label:>5}: {sample['latency_ms']} ms  "
                f"candles={sample['candles']} status={sample['status']} "
                f"error={sample['error']!r} note={sample['note']!r} "
                f"wire={sample['wire_bytes']}B"
            )
    print("\n== budgets ==")
    for result in budget_results:
        print(
            f"[{result['verdict']}] {result['check']}: "
            f"{result['actual_ms']} ms vs {result['budget_ms']:.0f} ms"
        )

    report = {
        "base": base,
        "request_count": request_count,
        "snapshot": snapshot_groups,
        "chart": chart_groups,
        "summaries": summaries,
        "budgets": budget_results,
    }
    try:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, default=str)
        print(f"\nJSON report -> {args.out}")
    except OSError as exc:
        print(f"(could not write JSON report: {exc})", file=sys.stderr)

    breached = any(r["verdict"] == "FAIL" for r in budget_results)
    if args.strict and breached:
        print("STRICT: budget breached, exiting 1", file=sys.stderr)
        return 1
    if breached:
        print("(budgets breached; re-run with --strict to fail the build)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
