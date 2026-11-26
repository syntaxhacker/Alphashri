# Refresh runbook — 52W ranges and agri mandi prices

Operational guide for the scheduled data refresh. **No Railway and no hosted
backend.** Compute runs on GitHub-hosted Actions; compact daily outputs live in
GitHub Releases; a local sync applies them to SQLite and, when present, Redis.

Paths:

- Workflows: `.github/workflows/refresh-52w.yml`, `.github/workflows/refresh-agri.yml`
- Release tag: `data-YYYY-MM`
- Local agri cache: `reports/agri/agri_prices.db`
- Local sync: `scripts/sync_refresh_assets.py`
- Release materializer: `scripts/materialize_agri_release.py`
- Release snapshots: `reports/agri/releases/<data-YYYY-MM>/`
- Ledger table: `agri_ingest_partitions`
- Run log: `refresh_runs.json` (local)

If `gh workflow list` does not show a workflow, the W10 workflow is not merged
on the ref you are dispatching. Do not fall back to Railway; run the local
collector/compute command until the workflow is available.

---

## 1. Preconditions

1. `gh auth status` is healthy and you can read/write releases on the repo.
2. The GitHub `production` environment contains:
   - `DATA_GOV_IN_API_KEY`
   - `UPSTOX_API_KEY`
   - `UPSTOX_API_SECRET`
3. The data.gov.in key is the **rotated** key. The key pasted in chat is
   compromised and must not be used.
4. The local repo has `.venv/` and the cache at `reports/agri/agri_prices.db`.
5. Only one refresh runs at a time. Both workflows use concurrency groups with
   `cancel-in-progress: false`; do not dispatch overlapping backfills anyway.

Schedules (UTC → IST):

| Job | Cron | IST | Purpose |
|---|---|---|---|
| 52W | `30 13 * * 1-5` | 19:00 | After NSE close, daily candles available |
| 52W catch-up | `30 15 * * 1-5` | 21:00 | Covers a delayed/dropped run |
| Agri morning | `30 2 * * *` | 08:00 | Collect yesterday's published data |
| Agri evening | `30 14 * * *` | 20:00 | Catch late publication |

GitHub caveats: schedules run only on `main`, are UTC, can be delayed under
load, and public-repo schedules disable after 60 days without repository
activity. Keep assets under ~10 MB/day compressed.

---

## 2. Dispatch 52W ranges

```bash
gh workflow run refresh-52w.yml \
  --ref main \
  -f to_date=2026-11-21 \
  -f limit=0 \
  -f dry_run=false

gh run list --workflow=refresh-52w.yml --limit 3
gh run watch <run-id>
```

- `to_date` — optional ISO date; omit for the latest completed session.
- `limit` — `0` means the full universe; use `25` for a smoke test.
- `dry_run=true` computes and validates without uploading a release asset.

Smoke first when changing the script or throttling:

```bash
gh workflow run refresh-52w.yml --ref main -f limit=25 -f dry_run=true
```

The job writes a gzipped JSON asset only (`--output-json --no-db --no-redis`);
it must not import the FastAPI app or touch a DB/Redis. A catch-up run with no
missing symbols exits 0 and uploads nothing.

Local equivalent (compute-only, still allowed):

```bash
.venv/bin/python scripts/compute_52w_ranges_upstox.py \
  --output-json reports/52w/2026-11-21.json.gz \
  --no-db --no-redis --max-symbols 25
```

---

## 3. Dispatch agri

Morning/evening normal run (collect D-1):

```bash
gh workflow run refresh-agri.yml --ref main -f dry_run=false
```

Explicit date (`DD/MM/YYYY`):

```bash
gh workflow run refresh-agri.yml \
  --ref main \
  -f date=21/11/2026 \
  -f dry_run=false
```

Backfill range (`YYYY-MM-DD`):

```bash
gh workflow run refresh-agri.yml \
  --ref main \
  -f from_date=2026-06-01 \
  -f to_date=2026-06-07 \
  -f dry_run=false
```

`dry_run=true` probes the API total and validates the page/row counts without
uploading an asset. The workflow must:

1. Resolve D-1 in `Asia/Kolkata`, never host-local “today”.
2. Probe `limit=1&filters[Arrival_Date]=target` and read `total` +
   `updated_date`.
3. Fetch the **whole date** with no commodity filter, paging
   `limit=1000&offset=...` until `offset + count >= total`.
4. Normalize every raw commodity spelling through the registry/alias table.
5. Union + dedupe by the natural key; never stop at the first alias.
6. Mark `partial` when `rows_seen != total`, and never advance the date.
7. Write `agri/YYYY-MM-DD.jsonl.gz` + `manifests/agri-YYYY-MM-DD.json` and
   upload them to `data-YYYY-MM`.

The live day had **15,843 rows** at the API, not 3,942. A whole-date pull is
~16–23 pages; per-alias first-match pulls would explode to ~15,000 requests.

---

## 4. Backfill a date range

As of 2026-11-23, GitHub releases cover **2025-10-27 → 2026-11-21 (388 daily
assets)**; the old `2026-06-01 → 2026-11-21` hole is closed. Keep this recipe
for a future hole. Dispatch in chunks of at most 31 days, newest-first for
freshness, and verify each release asset before starting the next chunk. The
workflow file must exist on the default branch before `gh workflow run` can
dispatch it (this repository's copy lives on `develop` until released).

```bash
for range in \
  2026-11-15:2026-11-21 \
  2026-11-08:2026-11-14 \
  2026-11-01:2026-11-07 \
  2026-10-25:2026-10-31 \
  2026-10-18:2026-10-24 \
  2026-10-11:2026-10-17 \
  2026-10-04:2026-10-10 \
  2026-09-27:2026-10-03 \
  2026-09-20:2026-09-26 \
  2026-09-13:2026-09-19 \
  2026-09-06:2026-09-12 \
  2026-08-30:2026-09-05 \
  2026-08-23:2026-08-29 \
  2026-08-16:2026-08-22 \
  2026-08-09:2026-08-15 \
  2026-08-02:2026-08-08 \
  2026-07-26:2026-08-01 \
  2026-07-19:2026-07-25 \
  2026-07-12:2026-07-18 \
  2026-07-05:2026-07-11 \
  2026-06-28:2026-07-04 \
  2026-06-21:2026-06-27 \
  2026-06-14:2026-06-20 \
  2026-06-07:2026-06-13 \
  2026-06-01:2026-06-06
do
  from=${range%%:*}
  to=${range##*:}
  gh workflow run refresh-agri.yml --ref main -f from_date="$from" -f to_date="$to"
  gh run watch
  gh release download data-${to:0:7} -p "manifests/agri-$to.json" -O - | jq .
done
```

A whole-date pull is roughly 16–23 pages/day, so the full gap is about
3,000–4,000 requests. Chunk across days to stay under the personal-key quota and
the 6-hour job limit. Skip only partitions with `status='complete'`; re-fetch
`partial` and `failed`.

After the backfill, ensure the 1W/1M/6M anchors exist before relying on changes.
The newest-first order makes the screen useful before the older weeks finish.

---

## 5. Rotate keys

Rotate the exposed data.gov.in key, then the Upstox credentials if they were
shared. Never print a key; never run with `set -x`.

```bash
# Reads the value from stdin; do not put the key in shell history or a log.
gh secret set DATA_GOV_IN_API_KEY --env production

gh secret set UPSTOX_API_KEY --env production
gh secret set UPSTOX_API_SECRET --env production

# Names only, never values.
gh secret list --env production
```

Steps:

1. Create the replacement key in the data.gov.in account.
2. Set the secret in the GitHub `production` environment.
3. Revoke the old key at the provider.
4. Run one agri `dry_run=true` dispatch and confirm it can read the API.
5. Check recent Actions logs for accidental key output; if found, rotate again
   and remove the log artifact.
6. Local `.env` / `.env.dev` may keep `DATA_GOV_IN_API_KEY` for the collector;
   it is never committed.

Secrets are only consumed by the runner; the local sync does not need an API key
because it downloads release assets over GitHub auth.

---

## 6. Inspect release assets

```bash
gh release list --limit 5
gh release view data-2026-11 --json tagName,assets \
  --jq '.assets[] | "\(.name)  \(.size) bytes"'

gh release download data-2026-11 \
  -p 'manifests/agri-2026-11-21.json' -O -

gh release download data-2026-11 \
  -p 'agri/2026-11-21.jsonl.gz' -D /tmp/agri-assets

gzip -cd /tmp/agri-assets/2026-11-21.jsonl.gz | wc -l
gzip -cd /tmp/agri-assets/2026-11-21.jsonl.gz | head -2 | jq -c .
sha256sum /tmp/agri-assets/2026-11-21.jsonl.gz
```

Manifest shape:

```json
{
  "kind": "agri",
  "as_of": "2026-11-21",
  "rows": 3942,
  "commodities": 22,
  "source": "data.gov.in/35985678-...",
  "arrivals_present": false,
  "status": "partial",
  "sha256": "...",
  "created_at": "2026-11-21T20:30:00+05:30"
}
```

Checks:

- `rows` matches the gzip line count (JSONL) or the array length (JSON).
- `sha256` matches `sha256sum` of the downloaded asset.
- `status` is `complete`; a `partial` asset is a diagnostic, not a finish line.
- `arrivals_present` is `false` for daily-feed days; do not invent arrivals.
- The asset is the compact delta, not the 360 MB SQLite DB.

Release layout:

```text
tag: data-2026-11
  agri/2026-11-21.jsonl.gz
  agri/2026-11-22.jsonl.gz
  52w/2026-11-21.json.gz
  52w/2026-11-22.json.gz
  manifests/agri-2026-11-21.json
  manifests/52w-2026-11-22.json
```

Keep the last 24 monthly releases; older tags are pruned by the scheduled job.

---

## 7. Run the local sync

Back up first if the local DB is important:

```bash
.venv/bin/python scripts/backup_db.py --skip-if-today
```

Latest assets only:

```bash
.venv/bin/python scripts/sync_refresh_assets.py --latest
```

A specific backfill window:

```bash
.venv/bin/python scripts/sync_refresh_assets.py \
  --from 2026-06-01 --to 2026-11-21
```

The sync must:

1. Resolve the latest monthly release.
2. Download missing assets.
3. Verify SHA256 + row count.
4. Upsert agri rows into SQLite with the corrected key/source rules.
5. Upsert 52W rows into SQLite.
6. Refresh local Redis `52w_range:all` only if local Redis is present.
7. Invalidate the local screener cache.
8. Print `MAX(date)` per agri key, the 52W row count, rows applied and any gap
   warnings.
9. Record status/timestamps in `refresh_runs.json`.

The app may call the sync on startup as a lightweight check, but it must never
block startup on a slow download. A manual command is the default.

Post-sync verification:

```bash
sqlite3 reports/agri/agri_prices.db \
  "select commodity_key, max(date), count(*) from agri_mandi_prices group by 1 order by 1;"

sqlite3 reports/agri/agri_prices.db \
  "select count(*) from stock_52w_range;" 2>/dev/null || true
```

If local Redis is absent, the SQLite DB is the source of truth. Restart the app
when you have changed API code; `start.sh` does not run with `--reload`.

---

## 7A. Materialize a release snapshot (read-only source for `/agri`)

The local cache stays the default source. A materialized snapshot is a separate,
cumulative agri-only SQLite DB that a user can select with `?source=`. It is a
local build artifact, never uploaded as a release asset.

```bash
# Dry run first: validate assets and count rows, write nothing.
.venv/bin/python scripts/materialize_agri_release.py \
  --release-tag data-2026-11 \
  --out reports/agri/releases/data-2026-11 \
  --from 2025-10-27 --dry-run

# Real build (fails if the out directory already exists unless --force).
.venv/bin/python scripts/materialize_agri_release.py \
  --release-tag data-2026-11 \
  --out reports/agri/releases/data-2026-11 \
  --from 2025-10-27

# Rebuild an existing snapshot (CLI/CI only; readers must be quiesced).
.venv/bin/python scripts/materialize_agri_release.py \
  --release-tag data-2026-11 \
  --out reports/agri/releases/data-2026-11 \
  --from 2025-10-27 --force
```

Flags: `--release-tag data-YYYY-MM` and `--from YYYY-MM-DD` and `--out` are
required; `--cache-dir` (default `reports/refresh_assets`) reuses downloaded
assets; `--repo` selects the GitHub repository; `--assets-dir` consumes a
release-shaped local directory offline; `--dry-run` and `--force` behave as
above. `GITHUB_TOKEN` / `GH_TOKEN` are read from the environment (never printed).

Semantics — **do not confuse this with `sync_refresh_assets.py`**:

1. Reuses the sync download/validation path: manifest kind/date/`rows`/
   `commodities`/`sha256`, `status=complete`, per-date row validation.
   `prepare_agri_rows` normalises, quarantines and dedupes before
   `store.upsert_rows`. Partial days remain excluded.
2. `--from` is the inclusive first date; selection runs **through the newest
   asset in the tag**, pulling the intervening assets from earlier monthly
   releases, so history and 1W/1M/6M anchors survive. A month-only snapshot is
   not acceptable.
3. Writes **only** `agri_prices.db` + `manifest.json` inside a staging directory,
   then atomically replaces the out directory (manifest last). The main cache,
   52W tables, Redis and `refresh_runs.json` are untouched. `--force` is required
   to overwrite an existing directory. The DB uses rollback journal (no
   WAL/SHM sidecars) so readers never write.
4. Manifest: `{version:1, tag, status:"ready", as_of, rows, dates,
   cumulative:true, built_at, source_range:{from,to}}`.

Deploy order: build/verify the snapshot **before** deploying the API change; then
`GET /api/agri/sources` must list `local` first and the new
`release:<tag>` with its `as_of`, `rows` and `status:"ready"`. After API edits,
`./start.sh restart` — `start.sh` has no reload. Verify both endpoints read the
same dataset:

```bash
curl -s 'http://localhost:8765/api/agri/sources' | python3 -m json.tool
curl -sG 'http://localhost:8765/api/agri/prices' \
  --data-urlencode 'source=release:data-2026-11' \
  --data-urlencode 'commodity=rice' --data-urlencode 'range=max' | python3 -m json.tool
curl -sG 'http://localhost:8765/api/agri/filters' \
  --data-urlencode 'source=release:data-2026-11' | python3 -m json.tool
```

A missing/unopenable snapshot is HTTP 400, never an empty success; an existing
but empty snapshot reports `data_source: "empty"`. `data_source` stays row
provenance; `source_id`/`dataset` identify the selected dataset.

**Retention:** proposed cap **3 snapshots** (each roughly the agri portion of
the ~907 MB cache — measure before setting a hard limit) plus `local`. Evict
oldest tags via CLI/CI only, with readers quiesced: `rm -rf` is not a hot
operation; keep the newest `as_of` values and log every eviction. Never delete a
directory a request may have open, and never delete `reports/agri/agri_prices.db`
or any other report artifact.

---

## 8. Recover a partial day

**Do not rerun with the old skip-if-date-exists logic.** The collector used to
stop at the first alias that returned records. A single row marked the date as
done and the rest of the day stayed invisible.

### 8.1 Confirm the partition state

```bash
sqlite3 reports/agri/agri_prices.db \
  "select source, arrival_date, status, expected_total, fetched_rows, pages,
          http_429, api_updated_at, started_at, finished_at, error
     from agri_ingest_partitions
    where arrival_date >= '2026-11-01'
    order by arrival_date desc;"
```

`status` is one of `complete`, `partial`, `failed`. Only `complete` may be
skipped. If the table or columns are absent, the W10 ledger migration has not
been applied yet; use the release manifest's `status` and the API probe instead.

### 8.2 Probe the API total

```bash
curl -sG "https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24" \
  --data-urlencode "api-key=$DATA_GOV_IN_API_KEY" \
  --data-urlencode "format=json" \
  --data-urlencode "limit=1" \
  --data-urlencode "filters[Arrival_Date]=21/11/2026" \
  | jq '{total, updated_date, count: (.records | length)}'
```

If `fetched_rows` is below `total`, the day is `partial`. Do not treat a
non-empty day as complete.

### 8.3 Repair the date

Preferred: dispatch the same date with the whole-date pull. If the workflow
exposes `replace_date`, set it so the collector does not skip the existing
partition:

```bash
gh workflow run refresh-agri.yml \
  --ref main \
  -f date=21/11/2026 \
  -f replace_date=true \
  -f dry_run=false
```

Local fallback (requires the key in the environment; never paste it into the
command line or a log):

```bash
export DATA_GOV_IN_API_KEY   # already set in the shell
.venv/bin/python scripts/market/agri_collect.py \
  --date 21/11/2026 \
  --replace-date \
  --output-jsonl reports/agri/2026-11-21.jsonl.gz
```

The repair must fetch **all aliases**, union + dedupe, page past the 1,000-row
limit, and write `rows_seen == total`. Then sync the asset locally.

### 8.4 Known case — 2026-11-21

The first collection found **3,942 rows vs 15,843 at the API (≈24.9%)**:

| Commodity | New rows | CKAN daily average | Coverage |
|---|---:|---:|---:|
| Rice | 1 (`Broken Rice` only) | 145 | 0.7% |
| Arhar/Tur | 4 (`Pegeon Pea` only) | 161 | 2.5% |
| Chilli | 18 (`Chilly Capsicum` only) | 552 | 3.3% |
| Groundnut | 11 (`Ground Nut Seed` only) | 132 | 8.3% |
| Chana | 26 (`Kabuli Chana` only) | 281 | 9.3% |
| Potato | 448 | 564 | 79.4% |
| Onion | 510 | 605 | 84.4% |
| Tomato | 530 | 553 | 95.9% |

Paddy is only `Paddy(Common)` and coriander only `Coriander(Leaves)`. This day is
**partial**. It must not advance every commodity's `as_of` or be marked
complete. After a proper whole-date repair, the row count should reach the API
`total` (15,843 at the time of the incident), not 3,942.

### 8.5 After recovery

1. Verify the manifest `status=complete`, row count and SHA256.
2. Run `sync_refresh_assets.py --latest`.
3. Confirm per-key `MAX(date)` and the gap warning disappear for the repaired
   key.
4. Check the UI: no continuous line across the hole, 1W/1M changes are `null`
   where anchors are missing, and a partial day is labelled.

If the date is still partial after a retry, leave it `partial`, record the
`http_429`/error in the ledger, and stop. Do not advance the date, overwrite a
complete partition, or fill missing arrivals with zero.

---

## 9. Troubleshooting

| Symptom | Check | Action |
|---|---|---|
| 429 / repeated 5xx from data.gov.in | Ledger `http_429`; provider status | Stop the chunk, wait, resume; never hammer with parallel aliases |
| Workflow succeeds but no release asset | `contents: write` permission; tag month | Fix permissions, re-dispatch; do not upload the DB |
| Schedule never fires | Workflow on `main`? repo active in last 60 days? | Run `workflow_dispatch`; re-enable the schedule |
| Asset >10 MB/day | Page/row count; product/unit explosion | Keep the compact delta; investigate duplicate aliases |
| Local `MAX(date)` unchanged | Sync found no new asset; wrong tag | `gh release list`; run `--latest` again with logs |
| 52W range empty in the UI | Local Redis stale or absent | Sync refreshes Redis when present; otherwise DB is authoritative |
| `tsc`/UI shows old API shape | Server running pre-change code | `./start.sh restart`; confirm with a real request |

---

## 10. One-line health check

```bash
gh run list --workflow=refresh-agri.yml --limit 1 --json conclusion,createdAt \
  && gh release view data-$(date +%Y-%m) --json assets --jq '.assets[].name' \
  && .venv/bin/python scripts/sync_refresh_assets.py --latest
```
