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
  asset names; 31 sync tests pass.
- **Agri released and synced:** six `data-2026-06..11` releases uploaded, 342
  assets (171 gzip payloads + 171 manifests, 60/62/60/60/62/38 per month).
  Dry run validated 171 days; local apply wrote **1,108,058 rows** and
  quarantined 87, with all 22 commodity keys anchored at **2026-11-21**.
- **Options chain state:** field-scoped store subscribers; 240-contract
  regression showed chain filter+sort rebuilds on unrelated notifications
  **18 → 0**. 62 targeted tests pass.
- **ITM PE report panel:** content-signature memos stop one full ECharts
  `setOption(notMerge)+resize` per identical live frame; 12 tests pass.
- **Market map:** one filtered row set reused for counts/rendering; a no-op
  resize no longer triggers a full ECharts relayout/recolour (60-tile fixture:
  **+1 setOption and +60 tile recolours → 0**). Real label-changing resizes
  still repaint. 11 heatmap performance tests pass.
- **Report endpoints:** profitability/options-report read paths de-duplicated.
  `compute_report` cold **245.3ms → 87.5ms median (~2.8×)**; eager date
  formatting **331.9ms → 24–33ms (~10–13×)**; repeated tape reads
  **24.31ms → 0.03ms** via an mtime/size cache. 61 targeted tests pass; warm
  profitability benchmark PASS.
- **Test structure:** removed the legacy `src/test/test-utils.tsx` shim,
  added a no-return guard + README, and added `docs/TESTING_INDEX.md` plus
  guards for Playwright placement, legacy helper imports and unit-style E2E
  files. 99 frontend helper/consumer tests and 11 layout guards pass.
- **Full-suite debt burned down:** news-poller over-mocking **7 → 0 failures**
  (14 tests), ORB/config/db stale expectations **14 → 0** (204 tests), and
  targeted coverage remained intact.
- **DB-backed tests:** broker/bot helper sessions now use the schema-initialized
  test DB; 45 tests pass in default and empty-DB CI simulation (was 26 failures
  in CI simulation).
- **Date-sensitive tests:** pinned the real `is_derivatives_open` and
  `_today_is_session` seams and froze the 1D live-edge clock to a weekday;
  **9 → 0 failures** (43 tests).
- **Week52 shim tests:** import order fixed and local cache/order_factory
  setters added; **3 silent skips → 14 passing tests**.
- **Local PR fast tier:** **686 passed, 3 skipped in 4m10s** (budget < 5m).
- **Test-debt tracker:** `docs/TEST_DEBT.md` records fixed clusters, remaining
  source-gap/fixture clusters, policy and the fresh full-sweep command.
- **Root auth fixture:** stopped entering the FastAPI lifespan per test;
  setup p95 **407ms → 16ms** (96% lower) with 100 targeted tests passing.
- **Screener dashboard cache:** identical universe/limit/mincap reads reuse the
  client snapshot (30s, shorter than server TTL), with explicit refresh bypass
  and no failure caching; 716 screener tests pass.
- **Home desk cache:** one view-level catalyst lease prevents a refetch on every
  breakpoint reflow (**4 fetches → 1**); derived arrays are keyed by
  session/universe/layout with a 30s TTL and explicit clear/refresh. All home
  tests pass.
- **Patterns cache:** unchanged catalog/scan keys reuse client/server reads with
  explicit refresh invalidation; 72 frontend + 6 backend cache tests pass.

## Final state at 19:12 IST

- Worktree clean except untracked `plan.md`.
- Release assets: 6 monthly tags, 342 assets, dry-run + local apply verified.
- Four app-wide lanes completed; no new full-suite run.
- PR #235 remains blocked only by GitGuardian’s historical `qa123` finding;
  clearing it requires a feature-branch history rewrite or dashboard ignore,
  both deliberately left for explicit approval.
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
