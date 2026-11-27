#!/usr/bin/env python3
"""Synthetic-cache harness for the agri cold-path performance lane.

The real ``reports/agri/agri_prices.db`` is importer-owned and read-only to
this lane. This script builds a deterministic ~1.3M-row cache in an artifact
directory, then measures /api/agri/filters cold (one request in a fresh
process), warm (p50/p95), a cProfile breakdown, and a byte-exact response
matrix for parity checks.

    python scripts/perf/bench_agri.py build
    python scripts/perf/bench_agri.py profile
    python scripts/perf/bench_agri.py cold --runs 3
    python scripts/perf/bench_agri.py warm
    python scripts/perf/bench_agri.py parity --out /path/to/before.json
"""

from __future__ import annotations

import argparse
import cProfile
import hashlib
import io
import json
import os
import pstats
import random
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_ARTIFACT_DIR = Path("/workspaces/test-rag/.agent-artifacts/perf-agri-cold")
TARGET_ROWS = 1_296_000
COMMODITY_COUNT = 20
DAY_COUNT = 160
STATE_COUNT = 27
DISTRICT_COUNT = 12
LAST_DAY = date(2026, 11, 20)


def artifact_paths(artifact_dir: Path) -> tuple[Path, Path, Path]:
    synthetic = artifact_dir / "synthetic"
    return synthetic / "agri_prices.db", synthetic / "releases", synthetic / "meta.json"


def configure(artifact_dir: Path) -> tuple[Path, Path]:
    db_path, releases, _ = artifact_paths(artifact_dir)
    releases.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("AGRI_DB_PATH", str(db_path))
    os.environ.setdefault("AGRI_RELEASES_ROOT", str(releases))
    return db_path, releases


def build(artifact_dir: Path) -> None:
    from api.agri import registry, store

    db_path, _, meta_path = artifact_paths(artifact_dir)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    staging = db_path.with_suffix(".staging.db")
    for path in (staging, db_path.with_suffix(".db-wal"), db_path.with_suffix(".db-shm")):
        if path.exists():
            path.unlink()
    if db_path.exists():
        db_path.unlink()

    keys = list(registry.valid_keys())[:COMMODITY_COUNT]
    names = [registry.source_names_for(key)[0] for key in keys]
    geographies: list[tuple[str, str, str]] = []
    for state_index in range(STATE_COUNT):
        state = f"State{state_index:02d}"
        for district_index in range(DISTRICT_COUNT):
            district = f"District{district_index:02d}"
            geographies.append((state, district, f"Market{district_index:02d}"))
            if district_index % 4 == 0:
                geographies.append((state, district, f"Market{district_index:02d}B"))
    # A handful of incomplete geographies mirrors real rows with blank source
    # fields and exercises the cascade's empty-key branch.
    geographies.extend([("", "", ""), ("State00", "", "")])
    per_day = len(keys) * len(geographies)
    days = [LAST_DAY - timedelta(days=offset) for offset in reversed(range(DAY_COUNT))]

    columns = ", ".join(store.COLUMNS)
    placeholders = ", ".join("?" for _ in store.COLUMNS)
    insert = f"INSERT INTO {store.TABLE} ({columns}) VALUES ({placeholders})"
    rng = random.Random(20261127)
    conn = store.open_writer(staging)
    try:
        batch: list[tuple[Any, ...]] = []
        for day in days:
            iso = day.isoformat()
            for key, name in zip(keys, names):
                for state, district, market in geographies:
                    modal = float(2500 + (rng.random() * 1800) // 5 * 5)
                    batch.append((
                        iso, state, district, market, name, key, "Common", "FAQ",
                        modal - 120.0, modal + 180.0, modal, 12.5, "Rs./Quintal",
                        "agmarknet_ckan", name, "", "Quintals", "ckan_seed",
                        "ckan_seed", iso + "T00:00:00",
                    ))
                    if len(batch) >= 25_000:
                        conn.executemany(insert, batch)
                        batch.clear()
        if batch:
            conn.executemany(insert, batch)
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    os.replace(staging, db_path)
    meta = {
        "rows": len(days) * per_day,
        "days": len(days),
        "commodities": len(keys),
        "geographies": len(geographies),
        "first_day": days[0].isoformat(),
        "last_day": days[-1].isoformat(),
        "bytes": db_path.stat().st_size,
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))


def make_client() -> Any:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.agri.router import router as agri_router

    app = FastAPI()
    app.include_router(agri_router)
    return TestClient(app)


def _request(client: Any, path: str) -> tuple[int, str]:
    response = client.get(path)
    return response.status_code, response.text


def profile(artifact_dir: Path, *, direct: bool = False) -> None:
    configure(artifact_dir)
    from api.agri import aggregate, router as router_module, store

    client = make_client()
    phases: dict[str, float] = {}

    def timed(label: str, target: Any) -> Any:
        original = target

        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                phases[label] = phases.get(label, 0.0) + (time.perf_counter() - start) * 1000.0

        return wrapper

    for label, target in (
        ("open_reader", store.open_reader),
        ("_ensure_migrated", store._ensure_migrated),
        ("cache_identity", store.cache_identity),
        ("fetch_options", store.fetch_options),
        ("_geo_meta", store._geo_meta),
        ("fetch_geography", store.fetch_geography),
        ("freshness_days", aggregate.freshness_days),
        ("filters_handler", router_module.get_agri_filters),
    ):
        setattr(target.__module__ and sys.modules[target.__module__], target.__name__, timed(label, target))

    profiler = cProfile.Profile()
    start = time.perf_counter()
    profiler.enable()
    if direct:
        payload = router_module.get_agri_filters(source="local")
        status, _ = 200, payload.model_dump_json()
    else:
        status, _ = _request(client, "/api/agri/filters")
    profiler.disable()
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    print(f"PROFILE_STATUS: {status}")
    print(f"PROFILE_TOTAL_MS: {elapsed_ms:.2f}")
    print("PHASES_MS: " + json.dumps({k: round(v, 2) for k, v in phases.items()}, sort_keys=True))
    stream = io.StringIO()
    pstats.Stats(profiler, stream=stream).strip_dirs().sort_stats("cumulative").print_stats(30)
    print(stream.getvalue())


def cold_once(artifact_dir: Path) -> None:
    configure(artifact_dir)
    client = make_client()
    start = time.perf_counter()
    status, _ = _request(client, "/api/agri/filters")
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    print(f"COLD_RESULT_MS: {elapsed_ms:.2f}")
    print(f"COLD_STATUS: {status}")


def cold(artifact_dir: Path, runs: int) -> None:
    samples: list[float] = []
    for _ in range(runs):
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--artifact-dir", str(artifact_dir),
             "cold", "--_cold-child"],
            cwd=str(ROOT), capture_output=True, text=True, timeout=300,
        )
        ms: float | None = None
        status: int | None = None
        for line in proc.stdout.splitlines():
            if line.startswith("COLD_RESULT_MS: "):
                ms = float(line.split(": ", 1)[1])
            elif line.startswith("COLD_STATUS: "):
                status = int(line.split(": ", 1)[1])
        if ms is None or status != 200:
            print(f"COLD run failed: rc={proc.returncode} stdout={proc.stdout[-300:]!r} stderr={proc.stderr[-500:]!r}")
            continue
        samples.append(ms)
        print(f"COLD_RUN_MS: {ms:.2f}")
    if samples:
        print(f"COLD_RUNS: {len(samples)} BEST_MS: {min(samples):.2f} MEDIAN_MS: {sorted(samples)[len(samples)//2]:.2f}")


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q / 100.0
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def warm(artifact_dir: Path, warmups: int, iterations: int) -> None:
    configure(artifact_dir)
    client = make_client()
    for _ in range(warmups):
        _request(client, "/api/agri/filters")
    samples: list[float] = []
    for _ in range(iterations):
        start = time.perf_counter()
        status, _ = _request(client, "/api/agri/filters")
        samples.append((time.perf_counter() - start) * 1000.0)
        if status != 200:
            print(f"WARM unexpected status {status}")
    print(f"WARM_SAMPLES: {iterations}")
    print(f"WARM_P50_MS: {percentile(samples, 50):.2f}")
    print(f"WARM_P95_MS: {percentile(samples, 95):.2f}")
    print(f"WARM_P99_MS: {percentile(samples, 99):.2f}")
    print("WARM_RAW_MS: " + ", ".join(f"{value:.2f}" for value in samples))


MATRIX: tuple[str, ...] = (
    "/api/agri/filters",
    "/api/agri/sources",
    "/api/agri/commodities",
    "/api/agri/prices?range=1m",
    "/api/agri/prices?range=3m",
    "/api/agri/prices?range=6m",
    "/api/agri/prices?range=1y",
    "/api/agri/prices?range=max",
    "/api/agri/prices?range=1m&state=State00",
    "/api/agri/prices?range=3m&state=State00&district=District00",
    "/api/agri/prices?range=6m&state=State00&district=District00&market=Market00",
    "/api/agri/prices?range=1y&commodity=onion",
    "/api/agri/prices?range=1m&commodity=onion&state=State01",
    "/api/agri/prices?range=6m&commodity=potato&district=District05",
    "/api/agri/prices?range=3m&commodity=onion&market=Market04B",
    "/api/agri/prices?range=1m&group=vegetables",
    "/api/agri/prices?range=1y&commodity=onion&compare=potato,tomato",
    "/api/agri/prices?range=1m&commodity=onion&from=2026-11-01&to=2026-11-20",
    "/api/agri/prices?range=1m&commodity=onion&limit=7",
    "/api/agri/prices?range=1m&state=NoSuchState",
    "/api/agri/prices?range=bogus",
)


def parity(artifact_dir: Path, out: Path) -> None:
    configure(artifact_dir)
    client = make_client()
    results: dict[str, dict[str, Any]] = {}
    for path in MATRIX:
        status, text = _request(client, path)
        results[path] = {
            "status": status,
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "text": text,
        }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"PARITY_REQUESTS: {len(results)} WRITTEN: {out}")
    for path, result in results.items():
        print(f"  {result['status']} {result['sha256'][:12]} {path}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build")
    sub.add_parser("profile")
    sub.add_parser("profile-direct")
    cold_parser = sub.add_parser("cold")
    cold_parser.add_argument("--runs", type=int, default=1)
    cold_parser.add_argument("--_cold-child", action="store_true", help=argparse.SUPPRESS)
    warm_parser = sub.add_parser("warm")
    warm_parser.add_argument("--warmups", type=int, default=5)
    warm_parser.add_argument("--iterations", type=int, default=30)
    parity_parser = sub.add_parser("parity")
    parity_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    artifact_dir = args.artifact_dir.resolve()
    if args.command == "build":
        build(artifact_dir)
    elif args.command in ("profile", "profile-direct"):
        profile(artifact_dir, direct=args.command == "profile-direct")
    elif args.command == "cold":
        if args._cold_child:
            cold_once(artifact_dir)
        else:
            cold(artifact_dir, args.runs)
    elif args.command == "warm":
        warm(artifact_dir, args.warmups, args.iterations)
    elif args.command == "parity":
        parity(artifact_dir, args.out.resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
