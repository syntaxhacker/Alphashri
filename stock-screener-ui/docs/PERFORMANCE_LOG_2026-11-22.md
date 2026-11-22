# Performance log — 2026-11-22

Running record for the app-wide optimization window. Measured claims only;
unmeasured work is marked **in progress**.

## Completed

- **Backend test fixtures:** session schema clone instead of per-test
  `create_all`; cost-4 fixture hashes; deterministic news stubs. Verification
  subset **303 passed in ~20s**; fixture-heavy sample **~10× faster**.
- **Security tests:** login fixtures no longer pay cost-12 bcrypt; file runtime
  **65.3s → 11–13.3s** with all 86 tests passing.
- **Chart-pattern scans:** synthetic pool-selection universes shrunk from
  300–400 to 20–40 symbols; file **25.7s → ~12s**.
- **PR CI:** fast tier **662 tests / 12 shards**; full **8,987-test** sweep
  remains a push/nightly debt alarm. Frontend changed tests now diff the PR base
  and fail on a zero-test selection.
- **Coverage:** measured **86.26% statements / 75.34% branches / 86.81%
  functions / 88.29% lines**; enforced thresholds 86/75/86/88.
- **API latency budgets:** warm health **2.4ms**, login **423ms**, agri prices
  **6.6ms**; cold agri filters **20.5s → 2.17s** (0.56s with covering index).
- **Agri DB:** geography covering index `idx_agri_geo` applied to the local
  cache; `ANALYZE` run; `EXPLAIN` confirms `SCAN ... USING COVERING INDEX`.
  Cold `/filters` measured **2.31s** (budget 10s); DB grew to ~907MB including
  the covering index.
- **Agri packaging:** 171 complete days / 1,108,145 rows / 20.0MB, all
  171 validated against `sync_refresh_assets`; 3 source-gap partial days skipped.
- **Release naming:** sync accepts both prefixed local paths and flat GitHub
  asset names; 31 sync tests pass. Monthly release upload started.
- **Low-quality tests:** 2 genuinely dead tests removed; 41 stale tests fixed.
- **Test budgets:** `perf/budgets.json`, pytest/Vitest timing artifacts,
  warning-only check; `AGENTS.md` last checked **2026-11-22**, next **2026-11-29**.

## In progress at 18:55 IST

- App-wide SolidJS component/store scan.
- Backend report-endpoint latency scan.
- Screener/report SQLite query-plan audit.
- Release asset naming compatibility (flat GitHub asset names).
- Four new app-wide lanes launched at 18:56: screener/market components,
  Solid state/hooks, report endpoint latency, report-page rendering.

## Rules

- Do not claim a gain without a before/after or a deterministic structural
  measurement.
- Do not lower a budget silently; optimize, mark slow, or record owner/date.
- No invented market data; partial agri days stay partial.
