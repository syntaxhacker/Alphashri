# Agri release sources — implementation plan

Plan for a user-facing **Source** dropdown on `/agri` that selects a materialized
GitHub-release snapshot instead of the local cache. Data semantics remain those
in [`AGRI_DATA_USAGE.md`](./AGRI_DATA_USAGE.md); packaging/refresh commands remain
those in [`RUNBOOK_REFRESH.md`](./RUNBOOK_REFRESH.md). This is a tracked plan, not
a claim that the feature ships.

## Goal / non-goals

- **Goal:** let a user pick a released dataset (`local` default, or a release
  snapshot) from one `Select`, with the choice in the URL, and have both
  `/api/agri/filters` and `/api/agri/prices` read that same dataset.
- **Non-goals:** no browser-side GitHub access; no GET that downloads, writes,
  migrates, refreshes Redis or touches 52W data; no new live feed; no change to
  units, partial-day rules, per-key `as_of`, or `data_source` provenance.
- **Rejected: month-only snapshots.** A tag is a label, not a data window. A
  "November only" snapshot would drop the history anchoring 1W/1M/6M changes,
  comparisons and freshness, and would look like fresh data with missing priors —
  a UX trap. Every snapshot is **cumulative through that tag**.

## Data flow

CLI/CI materializer → download + validate monthly release assets → upsert only
agri rows into a new snapshot DB → write `manifest.json` → deploy under
`reports/agri/releases/<tag>/` → `api/agri/sources.py` scans manifests →
`GET /api/agri/sources` → Source dropdown → `?source=` on `/filters` and
`/prices` → read-only SQLite reader → existing aggregate/response pipeline.
GET requests never contact GitHub and never write.

## Source IDs and API contract

- IDs: `local` (default) and `release:<tag>`, e.g. `release:data-2026-11`.
- `GET /api/agri/sources` →
  `{sources:[{id,label,dataset,as_of,rows,status}], default:"local"}`; only
  validated manifests appear. There is **no snapshot index file**.
- `source` is accepted on `GET /api/agri/prices` and `GET /api/agri/filters`;
  an unknown or unavailable source is **400** with the valid IDs in `detail`.
- Prices response gains `source_id` and `dataset`; `data_source` keeps its current
  meaning — row provenance (`agmarknet_ckan` | `agmarknet_daily` | `mixed` |
  `empty`), not the selected dataset.
- The 60 s prices cache key includes `source` as well as query + DB identity
  (including `-wal`) + IST date, so two sources cannot share a response.
- Frontend: `source` URL param omitted when `local`; `/sources` fetch with a
  `local`-only fallback; `Select` labelled **Source**; changing it reloads both
  filters and prices; release selection shows a badge.

## Snapshot layout and manifest

```text
reports/agri/releases/data-2026-11/
  agri_prices.db                 # agri rows only; same schema as the local cache
  manifest.json                  # {version, tag, status:"ready", as_of, rows,
                                 #  dates, cumulative:true, built_at, source_range}
```

`source_range` records the inclusive release-asset window used (e.g.
`{"from":"2025-10-27","to":"2026-11-21"}`). `api/agri/sources.py` scans
`<releases-root>/*/manifest.json`, accepts only `status:"ready"` + `cumulative:true`,
and validates that the DB path is a regular file inside its own tag directory
with a plausible non-zero size before advertising it. Snapshots are local build
artifacts (gitignored), like `reports/agri/agri_prices.db`.

## Materializer

```bash
.venv/bin/python scripts/materialize_agri_release.py \
  --release-tag data-2026-11 \
  --out reports/agri/releases/data-2026-11 \
  --from 2025-10-27 [--cache-dir] [--repo] [--dry-run] [--force]
```

- Reuses sync's download/validate path (`list_github_assets`, `validate_asset`,
  `prepare_agri_rows`) and `api.agri.store.upsert_rows`; validates every asset's
  manifest, gzip `sha256`, row count and `status=complete` before applying it.
- `--from` is the inclusive first date; selection runs **through the tag**, so
  the result is cumulative (2025-10-27 → 2026-11-21 for the example).
- Writes **only** to the new out directory, via a temp dir + atomic rename, and
  writes `manifest.json` last. It never touches the main cache, 52W rows, Redis,
  `refresh_runs.json`, or `reports/**` outside the chosen out path.
- `--dry-run` validates and counts without creating the DB or manifest;
  `--force` replaces an existing out directory (CLI/CI only); `--repo` /
  `--cache-dir` support offline assets and cached downloads.

## Read-only and failure rules

- The snapshot reader opens `mode=ro` + `PRAGMA query_only=ON` and **does not run
  migrations**; it uses the same schema the materializer produced.
- No GET downloads from GitHub, writes a file, or falls back silently: corrupt /
  missing / non-cumulative manifests are omitted from `/sources`; a requested
  source that cannot be opened fails explicitly (400), never as a successful
  empty dataset.
- Partial daily assets remain excluded by sync validation; no missing key is
  advanced and no price, arrival or MSP is invented.

## Rollout

1. Materialize and verify one or two snapshots (`--dry-run` first), check rows,
   dates and per-key maxima against the cache.
2. Deploy the snapshot directories to the host filesystem under
   `reports/agri/releases/<tag>/`, then deploy code (order avoids a window where
   `/sources` lists a source the reader cannot open).
3. `GET /api/agri/sources` must show the release(s) and `default:"local"`.
   Default stays local; users opt in via the dropdown. No automatic source
   switch and no request-time asset fetch. After API edits, `./start.sh restart`.

## Disk / retention

- A cumulative DB is roughly the agri portion of the current cache: the measured
  cache is ~907 MB / 2,328,450 rows / 391 dates; measure each built snapshot
  before setting a hard limit rather than assuming a number.
- Proposed cap: **3 snapshots (~3 GB)** plus `local`. Evict oldest tags by CLI/CI
  only, with readers quiesced; never delete a directory a request may have open.
  Keep the newest tags so the most recent `as_of` survives; log evictions.

## Test plan

- **Backend:** new `tests/api/test_agri/test_sources.py` (manifest scan/validation,
  path and size guard, 400 for unknown source, `source_id`/`dataset`, no
  migrations on open); extend `test_router.py` and `test_cache.py` (source in
  cache key). New `tests/test_materialize_agri_release.py` with temp dirs and
  offline assets: cumulative rows/date range, dry-run no writes, byte-identical
  main cache and untouched 52W/Redis, manifest last, partial/checksum failure.
  Regenerate `openapi.yaml` with `scripts/export_openapi.py` and run the drift test.
- **Frontend:** `src/api/agri.test.ts` (URL includes `source`, omits it for local,
  `/sources` fallback) and `AgriPage`/source-select tests (options, URL sync,
  both filters and prices refetch, release badge, abort of stale requests).
- **E2E:** extend `tests/e2e/agri.spec.ts` + `helpers/agriMocks.ts` to mock
  `/sources`, `/filters`, `/prices`; assert the param and request calls, not a
  GitHub download. Guards: `ui-guard`, `inputs.w-h`, `design-scale`, `theme-single-source`.
- **Evidence gate:** `docs/screenshots/agri-source/` PNGs at **1600×1000** and
  **390×844**: dropdown closed, dropdown open, release source selected; manifest
  with SHA-256, `bun run audit:evidence`, and an independent verifier's **A+**
  before any commit/PR. Any later UI edit voids it.

## Performance / latency

- Same SQLite schema, same aggregate queries and same response shape as local;
  no network on a request path, so warm `/prices` and `/filters` should stay
  inside the existing budgets (agri filters warm p95 500 ms; cold exception
  10,000 ms). Confirm with `scripts/bench_api.py --in-process --mode warm`.
- `/sources` is an O(#snapshots) directory scan of small manifests plus
  `stat`; cache it briefly and refresh it on deployment, not per request.
- Source DBs contain agri rows only (no 52W), and the 60 s response cache is
  keyed per source, so switching sources adds at most one cold read per source —
  measure first-open latency and report p50/p95 rather than asserting it.
- A dropdown change fires two GETs (filters + prices) with abort of the prior
  pair; no extra payload is shipped and no row-level work moves to the browser.

## Exact files to touch (implementation lanes, not this docs task)

- Backend: `api/agri/sources.py` (new), `api/agri/router.py`, `api/agri/contract.py`,
  `api/agri/store.py`; generated `openapi.yaml` via `scripts/export_openapi.py`.
- Materializer: `scripts/materialize_agri_release.py` (new).
- Frontend: `src/types/agri.ts`, `src/api/agri.ts`, `src/pages/agri/AgriPage.tsx`
  (+ source select/test files beside them).
- Tests: `tests/api/test_agri/test_sources.py` (new), `test_router.py`,
  `test_cache.py`, `tests/test_materialize_agri_release.py` (new),
  `src/api/agri.test.ts`, `src/pages/agri/*source*.test.tsx`,
  `tests/e2e/agri.spec.ts`, `tests/e2e/helpers/agriMocks.ts`,
  `tests/contract/test_openapi_sync.py` (existing drift guard).
- Docs/ops for this feature: this file, the link in `docs/AGRI_DATA_USAGE.md`,
  `docs/RUNBOOK_REFRESH.md` (source-materialize step, other agent), and
  `changelog/2026-11-25.md` (per `AGENTS.md`).
