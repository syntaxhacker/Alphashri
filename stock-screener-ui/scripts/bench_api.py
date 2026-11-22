#!/usr/bin/env python3
"""Warm/cold API latency harness for the Alphashri FastAPI app.

Two transports, never mixed in one number:

* ``--in-process`` drives the real ASGI app through ``httpx.ASGITransport`` in
  this interpreter (and, for cold mode, in a fresh child interpreter per route).
  CI_MODE + SKIP_ALEMBIC + an isolated temp SQLite file keep startup free of
  background jobs and away from ``db/alphashri.db``.
* ``--base-url URL`` drives a running server over ordinary HTTP. Cold mode over
  HTTP cannot restart the server, so its cache state is labelled explicitly.

Run from the repo root with the project venv:
    .venv/bin/python scripts/bench_api.py --in-process --mode warm
    .venv/bin/python scripts/bench_api.py --in-process --mode cold
    .venv/bin/python scripts/bench_api.py --base-url http://localhost:8765 --mode warm --enforce
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterator

import httpx

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

BUDGETS_PATH = ROOT / "perf" / "api_budgets.json"
RESULT_SENTINEL = "BENCH_RESULT:"
HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"})
MODES = ("warm", "cold", "both")
BUDGET_MODES = ("warm", "cold")

DEFAULT_EMAIL = "qa@test.com"
DEFAULT_TIMEOUT = 60.0
PASSWORD_MISSING_REASON = (
    "BENCH_QA_PASSWORD is not set and there is no password fallback; "
    "set BENCH_QA_PASSWORD or pass --password to benchmark login/auth routes"
)

_TOP_KEYS = frozenset({"schema_version", "description", "defaults", "routes"})
_ROUTE_KEYS = frozenset({"method", "path", "query", "auth", "budgets_ms", "cache_state"})
_DEFAULT_KEYS = frozenset({"warmups", "iterations", "warn_factor", "percentiles"})


@dataclass(frozen=True)
class RouteSpec:
    name: str
    method: str
    path: str
    query: dict[str, str]
    auth: bool
    budgets_ms: dict[str, float | None]
    cache_state: str


@dataclass
class Measurement:
    route: str
    mode: str
    method: str
    path: str
    p50_ms: float | None
    p95_ms: float | None
    p99_ms: float | None
    budget_ms: float | None
    verdict: str
    detail: str
    cache_state: str
    samples: int = 0
    status_counts: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


# --- pure helpers (no app import, no network; the contract test uses these) ---


def validate_budgets(doc: Any) -> list[str]:
    """Return human-readable problems; an empty list means the document is usable."""
    problems: list[str] = []
    if not isinstance(doc, dict):
        return ["root must be a JSON object"]

    for key in _TOP_KEYS - set(doc):
        problems.append(f"missing top-level key {key!r}")
    for key in set(doc) - _TOP_KEYS:
        problems.append(f"unknown top-level key {key!r}")
    if doc.get("schema_version") != 1:
        problems.append("schema_version must be 1")

    defaults = doc.get("defaults")
    if not isinstance(defaults, dict):
        problems.append("defaults must be an object")
    else:
        for key in _DEFAULT_KEYS - set(defaults):
            problems.append(f"defaults.{key} is missing")
        for key in set(defaults) - _DEFAULT_KEYS:
            problems.append(f"defaults.{key} is unknown")
        for key in ("warmups", "iterations"):
            value = defaults.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                problems.append(f"defaults.{key} must be a positive integer")
        warn = defaults.get("warn_factor")
        if not isinstance(warn, (int, float)) or isinstance(warn, bool) or warn < 1:
            problems.append("defaults.warn_factor must be a number >= 1")
        pcts = defaults.get("percentiles")
        if not isinstance(pcts, list) or set(pcts) != {50, 95, 99}:
            problems.append("defaults.percentiles must be exactly [50, 95, 99]")

    routes = doc.get("routes")
    if not isinstance(routes, dict) or not routes:
        problems.append("routes must be a non-empty object keyed by route name")
        return problems
    for name, route in routes.items():
        prefix = f"routes.{name}"
        if not isinstance(name, str) or not name:
            problems.append(f"{prefix}: route name must be a non-empty string")
        if not isinstance(route, dict):
            problems.append(f"{prefix} must be an object")
            continue
        for key in _ROUTE_KEYS - set(route):
            problems.append(f"{prefix}.{key} is missing")
        for key in set(route) - _ROUTE_KEYS:
            problems.append(f"{prefix}.{key} is unknown")
        if route.get("method") not in HTTP_METHODS:
            problems.append(f"{prefix}.method must be one of {sorted(HTTP_METHODS)}")
        path = route.get("path")
        if not isinstance(path, str) or not path.startswith("/"):
            problems.append(f"{prefix}.path must start with '/'")
        query = route.get("query")
        if not isinstance(query, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) for k, v in query.items()
        ):
            problems.append(f"{prefix}.query must map string keys to string values")
        if not isinstance(route.get("auth"), bool):
            problems.append(f"{prefix}.auth must be a boolean")
        budgets = route.get("budgets_ms")
        if not isinstance(budgets, dict) or set(budgets) - set(BUDGET_MODES):
            problems.append(f"{prefix}.budgets_ms may only contain {list(BUDGET_MODES)}")
        else:
            if "warm" not in budgets or not isinstance(budgets["warm"], (int, float)) or budgets["warm"] <= 0:
                problems.append(f"{prefix}.budgets_ms.warm must be a positive number")
            cold = budgets.get("cold")
            if cold is not None and (not isinstance(cold, (int, float)) or cold <= 0):
                problems.append(f"{prefix}.budgets_ms.cold must be null or a positive number")
        if not isinstance(route.get("cache_state"), str) or not route["cache_state"].strip():
            problems.append(f"{prefix}.cache_state must describe the cache state")
    return problems


def load_budgets(path: str | Path | None = None) -> dict[str, Any]:
    """Read and validate the budget file, raising ValueError with all problems."""
    target = Path(path) if path is not None else BUDGETS_PATH
    try:
        doc = json.loads(target.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"budget file not found: {target}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"budget file is not valid JSON: {target}: {exc}") from exc
    problems = validate_budgets(doc)
    if problems:
        raise ValueError(f"invalid budget file {target}:\n  - " + "\n  - ".join(problems))
    return doc


def parse_routes(doc: dict[str, Any]) -> dict[str, RouteSpec]:
    """Turn a validated budget document into immutable route specs."""
    routes: dict[str, RouteSpec] = {}
    for name, raw in doc["routes"].items():
        routes[name] = RouteSpec(
            name=name,
            method=raw["method"],
            path=raw["path"],
            query=dict(raw["query"]),
            auth=raw["auth"],
            budgets_ms={mode: raw["budgets_ms"].get(mode) for mode in BUDGET_MODES},
            cache_state=raw["cache_state"],
        )
    return routes


def percentile(values: list[float], q: float) -> float | None:
    """Linear-interpolated percentile; q is 0..100. Empty input yields None."""
    if not isinstance(q, (int, float)) or not 0 <= q <= 100:
        raise ValueError("q must be between 0 and 100")
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * (q / 100.0)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return float(ordered[lower] + (position - lower) * (ordered[upper] - ordered[lower]))


def summarize(values: list[float]) -> dict[str, float | int | None]:
    return {
        "count": len(values),
        "p50_ms": percentile(values, 50),
        "p95_ms": percentile(values, 95),
        "p99_ms": percentile(values, 99),
        "min_ms": min(values) if values else None,
        "max_ms": max(values) if values else None,
    }


def classify(p95_ms: float | None, budget_ms: float | None, warn_factor: float = 1.25) -> str:
    """PASS within budget, WARN inside the grace band, FAIL beyond it."""
    if p95_ms is None:
        return "SKIP"
    if budget_ms is None:
        return "INFO"
    if p95_ms <= budget_ms:
        return "PASS"
    if p95_ms <= budget_ms * warn_factor:
        return "WARN"
    return "FAIL"


def status_counts(statuses: list[int]) -> dict[str, int]:
    counts = {"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0}
    for status in statuses:
        key = f"{status // 100}xx"
        counts[key] = counts.get(key, 0) + 1
    return counts


def build_request(
    spec: RouteSpec, *, credentials: dict[str, str], token: str | None
) -> tuple[str, str, dict[str, Any]]:
    """Build the call for a route; quoted params keep query values explicit."""
    kwargs: dict[str, Any] = {}
    if spec.query:
        kwargs["params"] = dict(spec.query)
    if spec.name == "login":
        kwargs["json"] = dict(credentials)
    if spec.auth and token:
        kwargs["headers"] = {"Authorization": f"Bearer {token}"}
    return spec.method, spec.path, kwargs


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Benchmark warm/cold latency of Alphashri API routes."
    )
    transport = parser.add_mutually_exclusive_group(required=True)
    transport.add_argument("--base-url", metavar="URL", help="Benchmark a running server over HTTP.")
    transport.add_argument(
        "--in-process",
        action="store_true",
        help="Drive the FastAPI app in-process via httpx.ASGITransport (no external network).",
    )
    parser.add_argument("--mode", choices=MODES, default="warm", help="warm (default), cold, or both.")
    parser.add_argument("--budgets", type=Path, default=BUDGETS_PATH, help="Budget JSON file.")
    parser.add_argument("--route", action="append", default=[], metavar="NAME", help="Only run this route (repeatable).")
    parser.add_argument("--email", default=os.getenv("BENCH_QA_EMAIL", DEFAULT_EMAIL), help="QA login email.")
    parser.add_argument(
        "--password",
        default=os.getenv("BENCH_QA_PASSWORD"),
        help="QA login password from BENCH_QA_PASSWORD (no default; login/auth SKIP when absent).",
    )
    parser.add_argument("--warmups", type=int, default=None, help="Override default warmup count.")
    parser.add_argument("--iterations", type=int, default=None, help="Override default measured iteration count.")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="Per-request timeout in seconds.")
    parser.add_argument("--json", type=Path, default=None, metavar="PATH", help="Also write machine-readable results.")
    parser.add_argument(
        "--enforce", action="store_true", help="Exit 1 if any route is FAIL (default mode always exits 0)."
    )
    parser.add_argument("--_cold-child", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--_emit-result-line", action="store_true", help=argparse.SUPPRESS)
    return parser


# --- transport and measurement ---


def configure_isolated_env() -> Path:
    """Force CI mode and a throwaway DB so the in-process app never touches user data."""
    base = Path("/tmp/opencode")
    if not base.is_dir():
        base = Path(tempfile.gettempdir())
    workdir = Path(tempfile.mkdtemp(prefix=f"api-latency-{os.getpid()}-", dir=str(base)))
    os.environ["CI_MODE"] = "1"
    os.environ["SKIP_ALEMBIC"] = "1"
    os.environ["DATABASE_URL"] = f"sqlite:///{workdir / 'bench.db'}"
    return workdir


def seed_qa_user(email: str, password: str) -> None:
    """Create the documented QA account in the isolated DB so login can be measured."""
    from api.auth import hash_password
    from db.database import SessionLocal
    from db.models.user import User

    session = SessionLocal()
    try:
        if session.query(User).filter(User.email == email).first() is None:
            session.add(
                User(
                    email=email,
                    hashed_password=hash_password(password),
                    display_name="QA Benchmark",
                    is_active=True,
                )
            )
            session.commit()
    finally:
        session.close()


@asynccontextmanager
async def make_client(args: argparse.Namespace) -> Iterator[httpx.AsyncClient]:
    if args.in_process:
        configure_isolated_env()
        from api_server_fastapi import app  # lazy: importing the app starts DB/config work

        async with app.router.lifespan_context(app):
            if args.password:
                seed_qa_user(args.email, args.password)
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://bench.local", timeout=args.timeout
            ) as client:
                yield client
    else:
        async with httpx.AsyncClient(base_url=args.base_url, timeout=args.timeout) as client:
            yield client


async def issue(
    client: httpx.AsyncClient, spec: RouteSpec, credentials: dict[str, str], token: str | None
) -> tuple[float, int | None, str | None, Any]:
    method, path, kwargs = build_request(spec, credentials=credentials, token=token)
    started = time.perf_counter()
    try:
        response = await client.request(method, path, **kwargs)
    except Exception as exc:  # a failed call is data, not a crash of the harness
        return (time.perf_counter() - started) * 1000.0, None, f"{type(exc).__name__}: {exc}", None
    try:
        payload = response.json()
    except Exception:
        payload = None
    return (time.perf_counter() - started) * 1000.0, response.status_code, None, payload


async def mint_token(
    client: httpx.AsyncClient, credentials: dict[str, str], login_spec: RouteSpec | None
) -> tuple[str | None, str | None]:
    """Mint a bearer token outside the measured samples; auth routes need one."""
    if login_spec is None:
        return None, "no /api/auth/login route in the budget file"
    spec = login_spec
    _, status, error, payload = await issue(client, spec, credentials, None)
    if error:
        return None, f"token setup failed: {error}"
    if status != 200:
        return None, f"token setup returned HTTP {status}"
    token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        return None, "token setup response had no access_token"
    return token, None


async def measure_route(
    client: httpx.AsyncClient,
    spec: RouteSpec,
    credentials: dict[str, str],
    token: str | None,
    *,
    mode: str,
    warmups: int,
    iterations: int,
    warn_factor: float,
    in_process: bool,
    cache_label: str,
) -> Measurement:
    if mode == "warm":
        for _ in range(warmups):
            await issue(client, spec, credentials, token)

    samples: list[float] = []
    statuses: list[int] = []
    errors: list[str] = []
    for _ in range(1 if mode == "cold" else iterations):
        elapsed, status, error, _ = await issue(client, spec, credentials, token)
        if error:
            errors.append(error)
        elif status is not None and status < 400:
            samples.append(elapsed)
            statuses.append(status)
        else:
            errors.append(f"HTTP {status}")

    stats = summarize(samples)
    budget = spec.budgets_ms.get(mode)
    p95 = stats["p95_ms"]
    if not samples:
        verdict = "SKIP" if in_process else "FAIL"
        detail = f"no successful responses ({len(errors)} error(s))"
    elif budget is None:
        verdict = "INFO"
        detail = "no agreed budget for this mode"
    else:
        verdict = classify(p95, budget, warn_factor)
        detail = "within budget" if verdict == "PASS" else f"budget {float(budget):.1f} ms"
    if errors:
        detail += f"; first_error={errors[0][:120]}"

    return Measurement(
        route=spec.name,
        mode=mode,
        method=spec.method,
        path=spec.path,
        p50_ms=stats["p50_ms"],
        p95_ms=p95,
        p99_ms=stats["p99_ms"],
        budget_ms=budget,
        verdict=verdict,
        detail=detail,
        cache_state=cache_label,
        samples=stats["count"],
        status_counts=status_counts(statuses),
        errors=errors[:5],
    )


def cache_label(mode: str, in_process: bool) -> str:
    if not in_process:
        return "server-managed; restart/clear caches outside the harness for a true cold run" if mode == "cold" else "server-managed; warmups included"
    if mode == "cold":
        return "fresh interpreter per route; disk caches may persist"
    return "one process for warmups + iterations"


def cold_child_command(args: argparse.Namespace, name: str) -> list[str]:
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--in-process",
        "--mode",
        "cold",
        "--route",
        name,
        "--budgets",
        str(args.budgets),
        "--email",
        args.email,
    ]
    if args.password:
        command += ["--password", args.password]
    command += ["--timeout", str(args.timeout), "--_cold-child", "--_emit-result-line"]
    return command


def run_cold_child(args: argparse.Namespace, name: str) -> Measurement:
    """Cold in-process runs need a fresh interpreter; capture its one result line."""
    try:
        proc = subprocess.run(
            cold_child_command(args, name),
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=args.timeout * 4 + 90,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return Measurement(
            route=name, mode="cold", method="", path="", p50_ms=None, p95_ms=None,
            p99_ms=None, budget_ms=None, verdict="SKIP", detail=f"cold child could not run: {exc}",
            cache_state=cache_label("cold", True),
        )
    for line in proc.stdout.splitlines():
        if line.startswith(RESULT_SENTINEL):
            try:
                return Measurement(**json.loads(line[len(RESULT_SENTINEL):]))
            except (ValueError, TypeError) as exc:
                return Measurement(
                    route=name, mode="cold", method="", path="", p50_ms=None, p95_ms=None,
                    p99_ms=None, budget_ms=None, verdict="SKIP", detail=f"bad child result: {exc}",
                    cache_state=cache_label("cold", True),
                )
    tail = (proc.stderr or proc.stdout).strip()[-200:]
    return Measurement(
        route=name, mode="cold", method="", path="", p50_ms=None, p95_ms=None, p99_ms=None,
        budget_ms=None, verdict="SKIP", detail=f"cold child rc={proc.returncode}: {tail}",
        cache_state=cache_label("cold", True),
    )


async def run_mode(
    args: argparse.Namespace,
    specs: dict[str, RouteSpec],
    mode: str,
    warn_factor: float,
    login_spec: RouteSpec | None,
) -> list[Measurement]:
    if mode == "cold" and args.in_process and not args._cold_child:
        return [run_cold_child(args, name) for name in specs]

    password_missing = not args.password
    credentials = {"email": args.email, "password": args.password or ""}
    results: list[Measurement] = []
    async with make_client(args) as client:
        token, token_error = None, "not needed"
        if password_missing:
            token_error = PASSWORD_MISSING_REASON
        elif any(spec.auth for spec in specs.values()):
            token, token_error = await mint_token(client, credentials, login_spec)
        for name, spec in specs.items():
            if password_missing and spec.name == "login":
                results.append(
                    Measurement(
                        route=name, mode=mode, method=spec.method, path=spec.path,
                        p50_ms=None, p95_ms=None, p99_ms=None,
                        budget_ms=spec.budgets_ms.get(mode), verdict="SKIP",
                        detail=PASSWORD_MISSING_REASON,
                        cache_state=cache_label(mode, args.in_process),
                    )
                )
                continue
            if spec.auth and not token:
                results.append(
                    Measurement(
                        route=name, mode=mode, method=spec.method, path=spec.path,
                        p50_ms=None, p95_ms=None, p99_ms=None,
                        budget_ms=spec.budgets_ms.get(mode), verdict="SKIP",
                        detail=f"no bearer token: {token_error or 'login unavailable'}",
                        cache_state=cache_label(mode, args.in_process),
                    )
                )
                continue
            results.append(
                await measure_route(
                    client, spec, credentials, token,
                    mode=mode,
                    warmups=args.warmups,
                    iterations=args.iterations,
                    warn_factor=warn_factor,
                    in_process=args.in_process,
                    cache_label=cache_label(mode, args.in_process),
                )
            )
    return results


def render_table(results: list[Measurement]) -> None:
    headers = ("ROUTE", "MODE", "P50(ms)", "P95(ms)", "P99(ms)", "BUDGET(ms)", "VERDICT", "SAMPLES", "DETAIL")
    rows = [
        (
            r.route,
            r.mode,
            "-" if r.p50_ms is None else f"{r.p50_ms:.2f}",
            "-" if r.p95_ms is None else f"{r.p95_ms:.2f}",
            "-" if r.p99_ms is None else f"{r.p99_ms:.2f}",
            "-" if r.budget_ms is None else f"{r.budget_ms:.2f}",
            r.verdict,
            str(r.samples),
            r.detail,
        )
        for r in results
    ]
    widths = [len(h) for h in headers]
    for row in rows:
        widths = [max(width, len(cell)) for width, cell in zip(widths, row)]
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        doc = load_budgets(args.budgets)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    defaults = doc["defaults"]
    args.warmups = args.warmups if args.warmups is not None else defaults["warmups"]
    args.iterations = args.iterations if args.iterations is not None else defaults["iterations"]
    if args.warmups < 0 or args.iterations < 1:
        print("ERROR: --warmups must be >= 0 and --iterations must be >= 1", file=sys.stderr)
        return 2

    all_specs = parse_routes(doc)
    login_spec = all_specs.get("login")
    specs = all_specs
    if args.route:
        unknown = set(args.route) - set(specs)
        if unknown:
            print(f"ERROR: unknown route(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        specs = {name: specs[name] for name in args.route}
    if args._cold_child and set(specs) != {args.route[0] if args.route else ""}:
        print("ERROR: cold child needs exactly one --route", file=sys.stderr)
        return 2

    warn_factor = defaults["warn_factor"]
    modes = (args.mode,) if args.mode != "both" else ("warm", "cold")
    all_results: list[Measurement] = []
    for mode in modes:
        results = asyncio.run(run_mode(args, specs, mode, warn_factor, login_spec))
        all_results.extend(results)
        if not args._emit_result_line:
            protocol = (
                f"{args.iterations} measured iterations after {args.warmups} warmups"
                if mode == "warm"
                else "1 measured request in a fresh process, no warmups"
            )
            print(f"\n=== {mode.upper()} ({protocol}) ===")
            render_table(results)
            print("Cache state: " + "; ".join(f"{r.route}={r.cache_state}" for r in results))

    if args._emit_result_line and len(all_results) == 1:
        print(RESULT_SENTINEL + json.dumps(asdict(all_results[0])))
        return 0

    if args.json is not None:
        payload = {
            "budgets": str(args.budgets),
            "modes": list(modes),
            "transport": "in-process" if args.in_process else args.base_url,
            "warmups": args.warmups,
            "iterations": args.iterations,
            "measurements": [asdict(m) for m in all_results],
        }
        args.json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nWrote {args.json}")

    counts: dict[str, int] = {}
    for result in all_results:
        counts[result.verdict] = counts.get(result.verdict, 0) + 1
    print("\nVerdicts: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    skipped = [r for r in all_results if r.verdict == "SKIP"]
    if skipped:
        print("Skipped: " + "; ".join(f"{r.route} ({r.mode}): {r.detail}" for r in skipped))
    if args.enforce and any(r.verdict == "FAIL" for r in all_results):
        print("ENFORCE: at least one route failed its budget", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
