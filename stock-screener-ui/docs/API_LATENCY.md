# API latency benchmarks

`scripts/bench_api.py` measures the HTTP surface of the FastAPI app the way a
client sees it: middleware (auth, CORS, gzip, slow-API), JSON encoding, DB reads
and any cache population are all inside the number. Budgets live in
[`perf/api_budgets.json`](../perf/api_budgets.json); the static contract test is
[`tests/test_api_latency_contract.py`](../tests/test_api_latency_contract.py).

## Commands

Run from `stock-screener-ui/` with the project venv only (no installs, no servers
started by the harness):

```bash
# Warm in-process: real ASGI app over httpx.ASGITransport, no external network.
.venv/bin/python scripts/bench_api.py --in-process --mode warm

# Cold in-process: one request per route in a fresh child interpreter.
.venv/bin/python scripts/bench_api.py --in-process --mode cold

# Warm + cold in one report (two separate tables, never one combined number).
.venv/bin/python scripts/bench_api.py --in-process --mode both

# A quick sample of two routes.
.venv/bin/python scripts/bench_api.py --in-process --mode warm \
  --route health --route login

# Live server (you start it with ./start.sh): ordinary HTTP transport.
.venv/bin/python scripts/bench_api.py --base-url http://localhost:8765 --mode warm

# CI-style gate: FAIL makes the process exit 1; report mode always exits 0.
.venv/bin/python scripts/bench_api.py --base-url http://localhost:8765 --mode warm --enforce

# Machine-readable results and the static contract test.
.venv/bin/python scripts/bench_api.py --in-process --mode warm --json /tmp/opencode/api_latency/warm.json
.venv/bin/python -m pytest tests/test_api_latency_contract.py -q
```

`--warmups` and `--iterations` override the defaults from the budget file
(5 and 30). `--timeout` sets the per-request timeout (60 s by default; the first
agri request can take ~20 s). `--route NAME` is repeatable.

## Warm vs cold semantics

| Mode | Protocol | Cache state |
|---|---|---|
| `warm` | 5 warmups (discarded) then **30 measured iterations** per route. p50/p95/p99 are computed from the 30 samples only. | One process for warmups + iterations. The warmups deliberately absorb one-time cache loads and connection setup. |
| `cold` | **One measured request** per route, no warmups. In-process mode spawns a fresh child interpreter per route, so module-level caches start empty. | Labelled on every row: "fresh interpreter per route; disk caches may persist". Disk-backed caches (e.g. agri files) are *not* deleted — the harness does not mutate user data. |
| `both` | Runs `warm`, then `cold`, as two independent tables and two independent sets of numbers. | Never averaged or mixed across modes. |

Over `--base-url` a cold run **cannot restart the server**, so its rows say
"server-managed; restart/clear caches outside the harness for a true cold run".
Treat those numbers as cold-ish, not a controlled cold measurement. Only
`/api/agri/filters` has an agreed cold budget (10 s); other routes have
`"cold": null` and are reported as `INFO` — measured but not enforced.

Each row also prints sample count and status counts (`2xx/3xx/4xx/5xx`). Errors
and non-2xx responses are counted separately and never become latency samples.

## Verdicts

`p95 <= budget` → **PASS**; `budget < p95 <= budget × warn_factor` (1.25) →
**WARN**; above that → **FAIL**. A route with no budget for the requested mode
is **INFO**. A route that cannot run is **SKIP** with a reason; it never becomes
a FAIL and never fails `--enforce`. `--enforce` exits 1 on FAIL only; plain
report mode always exits 0 so a regression can be investigated without a red CI
step.

## Auth setup

Two routes need a bearer token: `GET /api/market/snapshot` and
`GET /api/replay/configs`. The harness mints a token once with
`POST /api/auth/login` outside the measured samples.

- The email defaults to the documented `qa@test.com` (`BENCH_QA_EMAIL` or
  `--email` overrides it). **The password has no default**: supply it only via
  `BENCH_QA_PASSWORD` or `--password`. With no password, `login` and both auth
  routes are `SKIP` with the reason "BENCH_QA_PASSWORD is not set and there is
  no password fallback" — the harness never embeds a fallback credential.
- **In-process** always creates a throwaway SQLite file under `/tmp/opencode`
  and seeds the QA account into it when a password is supplied. It sets `CI_MODE=1`, `SKIP_ALEMBIC=1` and
  overrides `DATABASE_URL` *before* importing the app, so background jobs,
  Redis and the protected `db/alphashri.db` are never touched. The QA user is
  seeded only for the benchmark DB, not the real one.
- **Live** requires the running server to already have that QA user (see
  `scripts/seed_qa_data.py`). If login fails there, auth routes are `SKIP` with
  the login error as the reason.
- No token is ever written to the repo or to disk by the harness.

## Why these timings are separate from unit-test timings

Unit/pytest timings measure isolated functions, usually with mocked DB/HTTP and
a warm interpreter on a developer machine. They cannot tell you how long a
client waits for auth middleware, response serialization, a disk-cache reload or
a cold ORM connection. Conversely, a wall-clock assertion inside a unit test
flakes on shared CI: the number changes with machine load, neighbouring test
shards and disk state, and it says nothing about the HTTP path.

So the split is deliberate:

1. This harness produces the *numbers* (with explicit warm/cold cache state),
   and reports them without failing by default.
2. The contract test checks the *contract* — exact route list, method, query
   parameters, auth flag and budget values, plus the validation/percentile/
   verdict helpers — with no live server and no wall-clock assertions.
3. Unit tests keep testing behaviour, not milliseconds.

Changing a target means editing `perf/api_budgets.json` and
`tests/test_api_latency_contract.py` together; a silent budget change fails the
contract test.

## Base URLs and endpoint set

| Route | Method | Query | Auth | Warm budget |
|---|---|---|---|---|
| `/api/health` | GET | — | no | 100 ms |
| `/api/auth/login` | POST | JSON `{email,password}` | no | 500 ms |
| `/api/agri/filters` | GET | — | no | 500 ms (10 s cold) |
| `/api/agri/prices` | GET | `commodity=onion&range=1m` | no | 500 ms |
| `/api/reports/nifty` | GET | — | no | 1 s |
| `/api/reports/profitability` | GET | — | no | 2 s |
| `/api/market/snapshot` | GET | `universe=all_equity&limit=100` | yes | 2 s |
| `/api/replay/configs` | GET | — | yes | 500 ms |

## Sample run (2026-11-22, in-process, this workspace)

`--in-process --mode warm` (5 warmups + 30 iterations per route):

| Route | p50 | p95 | p99 | Budget | Verdict |
|---|---:|---:|---:|---:|---|
| health | 0.90 ms | 1.80 ms | 2.39 ms | 100 ms | PASS |
| login | 292.65 ms | 415.47 ms | 447.63 ms | 500 ms | PASS |
| agri_filters | 18.13 ms | 33.52 ms | 38.91 ms | 500 ms | PASS |
| agri_prices | 4.89 ms | 6.60 ms | 6.79 ms | 500 ms | PASS |
| nifty_report | — | — | — | 1 s | **SKIP** (HTTP 404: no snapshot for 2026-11-22, a non-trading day) |
| profitability | 1.61 ms | 2.48 ms | 2.78 ms | 2 s | PASS |
| market_snapshot | 10.84 ms | 16.68 ms | 24.70 ms | 2 s | PASS |
| replay_configs | 4.33 ms | 13.15 ms | 18.96 ms | 500 ms | PASS |

The requested health/login sample alone measured `health p95 2.42 ms` and
`login p95 423.48 ms` over 30 iterations.

`--in-process --mode cold` (one request in a fresh child interpreter):
`health 14.62 ms` (INFO, no cold budget) and `agri_filters 20476 ms`
(**FAIL** vs the 10 s cold budget — a repeatable ~20 s disk-cache reload in
this workspace, not a warm-up artifact). Report mode exits 0; adding `--enforce`
exits 1 for that route.

## Known limitations

- Disk-backed caches are never cleared. A "cold" in-process run has a fresh
  interpreter but may still read warm files; the row says so.
- `/api/reports/nifty` has no stored snapshot on non-trading days and returns
  404. In-process that is `SKIP` ("no successful responses"), not a latency
  failure. Benchmark it with a `date=` parameter on a trading day via
  `--base-url` once a snapshot exists.
- The first agri call in a fresh interpreter can take ~20 s; use the default
  60 s timeout or raise `--timeout`.
