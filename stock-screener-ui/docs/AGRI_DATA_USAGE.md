# Agri mandi data — practical usage guide

Read this before querying, quoting, packaging or syncing agri data. It describes
the data that is **actually in this repo**, not an idealised feed. Background and
source-selection rationale live in [`AGRI_PRICES.md`](./AGRI_PRICES.md); the
operational refresh flow lives in [`RUNBOOK_REFRESH.md`](./RUNBOOK_REFRESH.md).

Golden rule: this is a **read-only local cache**. Never write to or delete
`reports/agri/agri_prices.db` by hand, never invent a price, MSP, arrival or OHLC
bar, and never present a partial day as complete.

## 1. Sources and coverage

- **CKAN seed** — IndiaDataPortal CKAN "APMC Arrivals And Prices", resource `13f9964a-9398-4d49-a7b8-2f57c2396c48`. Exact daily rows **2025-10-27 → 2026-05-31**, imported once with `scripts/market/agri_import.py`. Source tag `agmarknet_ckan`; it does not extend past May 2026.
- **data.gov.in historical feed** — "Variety-wise Daily Market Prices Data of Commodity", resource `35985678-0d79-46b4-9ed6-6f13308a1d24`. Daily/backfill feed via `scripts/market/agri_collect.py` (needs `DATA_GOV_IN_API_KEY`; one arrival date at a time). Source tag `agmarknet_daily`. Source spellings resolve through `api/agri/registry.py`; unmatched names are skipped, not guessed.
- **Current-day cross-check** — data.gov.in resource `9ef84268-d588-465a-a308-a864a43d0070` (42 rows observed 2026-11-22). Not used for history.
- **Local cache** — `reports/agri/agri_prices.db`, table `agri_mandi_prices`, a local build artifact (not committed). Measured coverage: **2,328,450 rows, 391 distinct dates (2025-10-27 → 2026-11-21), 22 commodity keys**. The router opens it read-only; a missing cache is `data_source: "empty"`, never a successful empty load.

Ingestion state lives in `agri_ingest_partitions` (keyed by `source`, `arrival_date`). For `agmarknet_daily`: **171 `complete` partitions** (2026-06-01 → 2026-11-21) and **3 `partial` partitions**.
The CKAN seed has no daily ledger rows; its 217 dates were packaged separately from the verified local cache and uploaded as `data-2025-10` … `data-2026-05` release assets. GitHub release history now covers **388 daily assets** (2025-10-27 → 2026-11-21); the three partial daily partitions remain excluded.

| Arrival date | Status | Fetched / expected | Missing tracked keys |
|---|---|---:|---|
| 2026-08-02 | partial | 3,655 / 14,440 | `jeera` |
| 2026-11-01 | partial | 3,044 / 12,812 | `sunflower` |
| 2026-11-08 | partial | 2,021 / 9,477 | `turmeric`, `jeera` |

These three **remain partial**: only `complete` may be skipped on a refetch, and the packager never promotes `partial` to `complete`. Repair means a whole-date pull that reaches the API `total`, not accepting a non-empty day.

Latest dates: the ledger's last `complete` daily partition is **2026-11-21**, but that day is thin (4,667 rows vs API `expected_total` 15,843; e.g. `turmeric` 7, `sunflower` 10, `jeera` 16, `rice` 57). **2026-11-20 is the last day with broad coverage** (6,752 rows, all 22 keys). Treat 2026-11-21 as a recent extra day, not as a fully trustworthy complete day.

## 2. Units and semantics

- All prices are **₹ per quintal** (`INR/quintal`; source spelling usually `Rs./Quintal`). **1 quintal = 100 kg**, so `₹/kg = ₹/quintal ÷ 100`.
- Arrivals are **qtl**. Source `Metric Tonnes` values are multiplied by 10 into quintals with a warning. A missing arrival stays `None` — never zero — so a CKAN arrival is not erased by an arrival-less daily row.
- `modal` is the **most-traded price**, not a mean. In a `series` point it is the median of that day's mandi modals; `min`/`max` are the 2nd/98th percentiles across markets when ≥5 markets report, else the exact small-sample bounds. A `quote` is one mandi row with its own variety and grade.
- These are **not OHLC**. `min`/`modal`/`max` must never be relabelled as open/high/low/close or used to fabricate candles.
- **No invented MSP.** `registry.msp` is `None` for every key, so `msp` and `distance_to_msp_pct` are `null` with a warning. A UI `hasMsp` flag is only an offline hint, not a verified price.
- Non-quintal published price units (e.g. `Rs./Bundle`) are left **as published** with a warning. Check `price_unit` before comparing prices.

## 3. Freshness

- `GET /api/agri/filters` returns a global `as_of` (`MAX(date)` over the cache) and `freshness_days` (`today IST − as_of` from `config.IST`, **not** the time of the last fetch). A collector run returning zero rows does not advance it.
- `GET /api/agri/prices` uses **per-key latest dates** (`latest_date_per_key`). With `?commodity=` its `as_of` is that key's own latest date; with no key it is the newest dated key (falling back to the global date). Each `snapshot` row carries its own `date` and `freshness_days`.
- **Why a partial day must not advance every commodity:** if 2026-11-08 lacks `turmeric` and `jeera`, those keys stay at their own earlier latest date while other keys can sit on 11-08. Advancing all keys would fabricate a quote and a fake 1W/1M change. Snapshot, comparisons and freshness warnings all honour the per-key anchor.
- Warnings appear when data is >7 days stale, a gap exceeds 7 days, a key trails `as_of` by >7 days, or arrivals/units are inconsistent. Ranges (`1m`…`max`) are anchored to `as_of`, never the wall clock.
- The prices response is cached **in memory** for 60 s, keyed by query + DB file identity (including `-wal`) + IST date. A stale-looking answer after a sync is usually this cache or a pre-change server; verify with a real request and `./start.sh restart` after API edits.

## 4. UI (`/agri`)

- Route `/agri` (nav item **Agri Prices**). The UI is behind app login (`qa@test.com` / `qa123`); the agri **API read endpoints need no bearer token**. No screenshots are needed for documentation.
- Filters: **commodity** (22 keys in 5 groups), **group**, and a cascading **state → district → market** selector from `/filters` (cascade keys in `district_markets` are `"{state}||{district}"`). Ranges `1m`, `3m`, `6m`, `1y`, `max`; `from`/`to` and `compare` (max 5) are URL-driven too.
- Seven chart views: **Price band, Compare, Distribution, Supply vs price, Heatmap, Rolling, Seasonality**. Compare only appears with a selected commodity; OHLC and Arrivals are not views in this build.
- Also shown: KPIs labelled `Prices ₹/quintal · arrivals qtl`, the latest mandi-quotes table, the all-commodity snapshot and a freshness/warning strip. Empty or missing data must be shown as such, not silently zeroed.

## 5. HTTP API

Discover the live contract at `http://localhost:8765/docs` or in `openapi.yaml`
(`agri` tag). All three endpoints are GET and unauthenticated.

**`GET /api/agri/filters`** — no parameters. Response: `ok`, `as_of`,
`freshness_days`, `commodities` (`{key,label,group,unit}`), `groups`
(`{key,label}`), `states`, `districts`, `markets` (plain names),
`state_districts`, `district_markets`.

**`GET /api/agri/prices`** — real query names:

| Param | Meaning |
|---|---|
| `commodity` | tracked key, e.g. `rice`, `onion`, `arhar_tur` |
| `group` | `cereals`, `pulses`, `vegetables`, `oilseeds`, `spices` |
| `state`, `district`, `market` | **exact** names from `/filters` |
| `range` | `1m` \| `3m` \| `6m` \| `1y` \| `max` (default `6m`) |
| `from`, `to` | inclusive ISO dates (Python aliases `date_from`/`date_to`) |
| `compare` | comma-separated keys, max 5 |
| `limit` | quotes to return, 1–1000 (default 100) |

```bash
curl -s 'http://localhost:8765/api/agri/filters' | python3 -m json.tool
curl -sG 'http://localhost:8765/api/agri/prices' \
  --data-urlencode 'commodity=rice' \
  --data-urlencode 'state=Andhra Pradesh' \
  --data-urlencode 'district=Visakhapatnam' \
  --data-urlencode 'from=2026-11-17' --data-urlencode 'to=2026-11-21' \
  --data-urlencode 'range=max' | python3 -m json.tool
```

Response (`PricesResponse`): `ok`, `as_of`, `freshness_days`, `data_source`
(`agmarknet_ckan` | `agmarknet_daily` | `mixed` | `empty`), `filters` (echo uses
`date_from`/`date_to`, not `from`/`to`), `kpis` (`modal`, `min`, `max`, `unit`,
`chg_1w_pct`, `chg_1m_pct`, `chg_6m_pct`, `market_count`, `arrivals_qtl`,
`arrivals_unit`, `msp`, `distance_to_msp_pct`), `series[]`, `snapshot[]`,
`quotes[]`, `quotes_total`, `comparison[]`, `warnings[]`.

`warnings` is a list of strings: `no rows matched the current filters`, `data is
N days old (as_of …); prices may be stale`, `data has a N-day gap (…)`, `arrivals
are missing for N rows`, `non-quintal price units left as published: …`,
`arrivals from Metric Tonnes were multiplied by 10 …`, `unrecognised arrival
units left as published: …`, `MSP not verified for …; distance_to_msp_pct is
null`, and `<label> is N days behind <as_of> …; showing its own latest date`.
Treat them as data, not decoration.

Invalid input returns HTTP 400 (unknown commodity/group/range, non-ISO date,
`from > to`, commodity outside group, >5 compare keys). A missing/empty cache
returns HTTP 200 with `data_source: "empty"` and a warning — check the field
before trusting the payload. `GET /api/agri/commodities` is the legacy option
list.

## 6. SQLite (read-only)

The DB is a shared artifact: **never write, delete, vacuum or "fix" it by hand**.
Only the importer/collector and `sync_refresh_assets.py` own writes; the API's
reader may apply additive column migrations on first open, which is not
permission for manual edits. Use `mode=ro` and `PRAGMA query_only=ON`.

```bash
sqlite3 -readonly reports/agri/agri_prices.db \
  "SELECT COUNT(DISTINCT date), MIN(date), MAX(date) FROM agri_mandi_prices;"
sqlite3 -readonly reports/agri/agri_prices.db \
  "SELECT commodity_key, MAX(date) AS latest FROM agri_mandi_prices
   GROUP BY 1 ORDER BY 1;"
sqlite3 -readonly reports/agri/agri_prices.db \
  "SELECT date, commodity_key, market, modal_price, price_unit
   FROM agri_mandi_prices
   WHERE state='Andhra Pradesh' AND district='Visakhapatnam'
     AND date BETWEEN '2026-11-17' AND '2026-11-21'
   ORDER BY date, commodity_key;"
sqlite3 -readonly reports/agri/agri_prices.db \
  "SELECT arrival_date, status, fetched_rows, expected_total, error
   FROM agri_ingest_partitions WHERE status <> 'complete' ORDER BY 1;"
```

Key columns: `date, state, district, market, commodity, commodity_key, variety,
grade, min_price, max_price, modal_price, arrivals_qtl, price_unit, source,
source_commodity, product_form, arrival_units, price_source, arrivals_source,
ingested_at`. Natural key / upsert identity:
`(date, state, district, market, commodity, variety, grade)`.
`modal_price`/`min_price`/`max_price`/`arrivals_qtl` are nullable and in
₹/quintal and qtl respectively; a `NULL` is missing, not zero.

## 7. Release assets and packaging

`scripts/market/package_agri_db.py` reads the cache strictly read-only
(`mode=ro` + `query_only`) and packages **only** dates whose daily partitions are
all `complete`; the three partial dates above are skipped and listed in the
report. It writes a release-shaped directory (default `build/`):

```text
build/agri/YYYY-MM-DD.jsonl.gz          # one day of canonical rows, sorted keys, mtime=0 gzip
build/manifests/agri-YYYY-MM-DD.json    # that day's manifest
build/releases.tsv                       # paths grouped by data-YYYY-MM tag
```

Monthly tags are `data-YYYY-MM` (e.g. `data-2026-11`). The manifest has exactly
12 fields: `kind`, `as_of`, `date`, `rows`, `commodities`, `source`
(`data.gov.in/35985678-…`), `arrivals_present` (`false` for daily-feed days —
do not invent arrivals), `sha256`, `created_at`, `status`, `quarantined`,
`duplicates`. **`sha256` is over the compressed gzip bytes**:

```bash
sha256sum build/agri/2026-11-20.jsonl.gz   # must equal manifest sha256
gzip -cd build/agri/2026-11-20.jsonl.gz | wc -l   # must equal manifest rows
```

Current release history: **388 complete days**, 2025-10-27 → 2026-11-21,
about **43 MB** of gzip plus 388 manifests. The 2026-06 → 2026-11 block is the
daily data.gov.in feed; 2025-10-27 → 2026-05-31 is the CKAN seed packaged from
the verified local cache. Partials are excluded. Local `build/` artifacts may
exist, but **packaging is not upload**: creating or uploading a GitHub Release
asset is a separate step (`gh release upload` / `refresh-agri.yml`). Local files
do not prove an asset exists remotely —
verify with `gh release view data-YYYY-MM --json assets` before relying on it.
Never upload the SQLite DB itself; the compact delta is the intended asset.

## 8. Local sync

`scripts/sync_refresh_assets.py` downloads from `data-YYYY-MM` releases and
verifies each pair before applying it. Exact commands (no other flags exist):

```bash
.venv/bin/python scripts/sync_refresh_assets.py --latest --dry-run
.venv/bin/python scripts/sync_refresh_assets.py --latest
.venv/bin/python scripts/sync_refresh_assets.py --from 2026-06-01 --to 2026-11-21
.venv/bin/python scripts/sync_refresh_assets.py --release-tag data-2026-11
```

Selection is one of `--latest`, `--release-tag`, or `--from` + `--to`. Other
flags: `--dry-run`, `--repo`, `--assets-dir` (offline/tests), `--cache-dir`,
`--agri-db`, `--state-file`, `--no-redis`, `--allow-empty`. `GITHUB_TOKEN` /
`GH_TOKEN` are read from the environment when needed; no API key is involved.

- `--dry-run` downloads and validates manifest `kind`/date/`rows`/`commodities`
  /`sha256` (and refuses non-`complete` status) but writes **no** DB, Redis or
  state. It prints `Dry run: … no writes`.
- Real run upserts agri rows via `store.upsert_rows` (with its COALESCE/source
  priority rules; invalid price triples are quarantined and rows deduped by the
  natural key), then does a change-only upsert of 52W rows into
  `stock_52w_range`. A missing local Redis is not an error; when Redis is
  present, `52w_range:all` is refreshed only when 52W data was applied, and the
  screener cache is invalidated. `--no-redis` skips that step.
- It prints `MAX(date)` overall and per key, gap warnings, rows applied and
  quarantined, and appends a record to `reports/refresh_runs.json`.
  **Per-key maxima are the partial-day check**: a key must not jump to a day
  where it has no rows.

## 9. Practical examples

**Current week, Andhra Pradesh / Visakhapatnam (Vizag).** Use the exact names
from `/filters` — "Vizag" is not a stored district; "Visakhapatnam" is, with
markets `Bhimunipatnam APMC`, `Pendurthi APMC`, `Visakhapatnam APMC`.

```text
GET /api/agri/prices?commodity=rice&state=Andhra%20Pradesh
    &district=Visakhapatnam&from=2026-11-17&to=2026-11-21
    &range=max&limit=100
```

In the local cache, rice at `Visakhapatnam APMC` has a modal of **₹6,500/qtl**
on 2026-11-17…21 and paddy at `Pendurthi APMC` **₹2,441/qtl**.

**₹/kg conversion:** `₹6,500 per quintal ÷ 100 = ₹65 per kg`; paddy
`₹2,441/qtl ÷ 100 = ₹24.41/kg`. Arrivals `1 qtl = 0.1 tonne`; never divide a
modal price to compare it with a raw `Metric Tonnes` arrival.

## 10. Failure and edge cases

| Situation | What it means / what to do |
|---|---|
| Missing commodity on a partial day | That key keeps its own latest date and `null` changes; 2026-08-02 lacks `jeera`, 2026-11-01 lacks `sunflower`, 2026-11-08 lacks `turmeric`/`jeera`. Do not advance it; re-pull the whole date. |
| Unknown commodity/group/range, bad ISO date, `from > to`, >5 compare | HTTP 400 with the valid values in `detail`. Fix the request; don't substitute a nearest name. |
| Empty day / missing cache | `no rows matched…` warning; missing cache gives `data_source: "empty"` with HTTP 200. Report it as unavailable, not as zero. |
| Stale data | `freshness_days > 7`, per-key "N days behind" and gap warnings. Check the ledger and sync; don't present a stale quote as current. |
| Stale in-memory response | 60 s prices cache keyed by DB identity + IST date; after a sync or code edit verify with a real request and restart the server if needed. |
| Mixed units | `Rs./Bundle` and other non-quintal price units are left as published with a warning; `Metric Tonnes` arrivals are ×10 into qtl with a warning. Read `price_unit`/`arrival_units` before comparing. |
| `cache as_of` mismatch | `/filters.as_of` is global `MAX(date)`; `/prices.as_of` can be the selected key's own date. They are not guaranteed equal — cite which one you are using. |
| Broken release asset | Manifest status must be `complete`; sha256 over gzip bytes, row count, date and `commodities` must match. A checksum mismatch or partial manifest fails the sync — re-download/re-package, never bypass validation. |
| Repairing a partial day | Re-fetch all aliases, page to the API `total`, union + dedupe. Never overwrite a `complete` partition, zero-fill arrivals, or hand-edit the DB. |

## 11. Database maintenance (opt-in CLI)

`scripts/market/agri_db_maintenance.py` is the only maintenance entry point for
the cache. It never deletes rows or reports, never drops indexes, and accepts
only the canonical `reports/agri/agri_prices.db` path (symlinks are resolved;
any other path is refused). Errors are redacted — local paths become `<db>` or
`<path>` — so logs do not leak the filesystem layout.

```bash
# Read-only health report (default mode). Safe while the API/collector are running.
.venv/bin/python scripts/market/agri_db_maintenance.py --check
.venv/bin/python scripts/market/agri_db_maintenance.py --check --json
# Faster metadata-only pass (skips the whole-file integrity scan; still read-only).
.venv/bin/python scripts/market/agri_db_maintenance.py --check --no-quick-check

# After a large backfill or bulk sync: may refresh sqlite_stat1, then checkpoint WAL.
.venv/bin/python scripts/market/agri_db_maintenance.py --optimize

# Offline maintenance window ONLY, with the data owner's approval and the app stopped.
.venv/bin/python scripts/market/agri_db_maintenance.py --vacuum --yes
```

**When to run**

- `--check` — after imports/backfills/syncs, before packaging a release, or
  whenever staleness, bloat or corruption is suspected. It opens `mode=ro` +
  `query_only=ON`: `PRAGMA quick_check`, page/freelist and DB/WAL/SHM sizes,
  every index with its key columns, a duplicate/redundant-index report and
  row/partition counts. No DDL, no rows touched. `quick_check` walks the whole
  file: budget roughly **2 minutes** for the current ~906 MB cache.
- `--optimize` — after bulk writes or index/schema changes, or periodically
  (e.g. monthly). `PRAGMA optimize` can update the small `sqlite_stat1` table
  under a brief write lock, and the `PASSIVE` WAL checkpoint never waits for
  readers, so the API can keep reading. A concurrent writer may make a step a
  no-op; the report shows the checkpoint counters (`busy`, `log`,
  `checkpointed`) rather than hiding it.
- `--vacuum --yes` — only when `--check` shows a material freelist, during an
  offline window: stop the API, collector and any other readers first. The tool
  warns, requires the explicit `--yes`, checks that free space covers the DB +
  WAL + 10% headroom, refuses if a write lock or WAL shared-memory lock is
  held, then rebuilds the file. It does **not** delete rows; only free pages
  are reclaimed. On the real cache this remains an exception to the golden
  "never hand-edit the cache" rule and needs owner approval.

The tests in `tests/api/test_agri/test_db_maintenance.py` exercise all of this
against temp SQLite DBs: check output and index analysis, refusal without
confirmation / while in use / with too little free space, `optimize`, and byte
for byte proof that check mode does not mutate the file.

**Last observed `--check` on the real cache (2026-11-22; snapshot, not a live
value):** `quick_check` `ok` in ~107 s; journal mode `wal`; 221,346 pages ×
4096 B = 906,633,216 B, main file 906,633,216 B, WAL 0 B, SHM 32 KiB;
**freelist 0 pages** (VACUUM would reclaim nothing right now); 2,328,450 price
rows, 391 dates (2025-10-27 → 2026-11-21), 22 commodity keys; ledger 171
`complete` + 3 `partial` partitions. 8 indexes total.

Redundancy report (advisory — **nothing was dropped**):

| Redundant index | Covered by | Reason |
|---|---|---|
| `idx_agri_state` `(state)` | `idx_agri_geo` `(state, district, market)` | leading-column prefix |
| `idx_agri_commodity_key` `(commodity_key)` | `idx_agri_key_date` `(commodity_key, date)` | leading-column prefix |

No exact duplicate indexes were found. Do not run `DROP INDEX` by hand: both
candidate indexes are declared in `store.SCHEMA_SQL` with `CREATE INDEX IF NOT
EXISTS`, so the next writer opening the cache would silently recreate them.
Removing either one is a schema/code decision for the cache owner, not a
maintenance action.
