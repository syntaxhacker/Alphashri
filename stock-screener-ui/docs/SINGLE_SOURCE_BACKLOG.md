# Single-source / DRY backlog (verified at `87ca3354`)

Remaining work from the four single-source audits in
`/workspaces/test-rag/.agent-artifacts/audits/single-source/`. Every `file:line`
below was checked against this commit; items that were already fixed are called
out as **ALREADY FIXED** instead of being described as open. Paths are relative
to the repo root (most start with `stock-screener-ui/`).

## 1. Shipped

All verified / parity-proven / merged to develop; status mapping from
`REMEDIATION-STATUS.md`:

- **#376** D1+D2 — config-owned telegram toggle + Upstox token precedence; dependency pins aligned.
- **#377** A1 — index lot sizes aliased to canonical `INDEX_CONTRACT_META` (3 wrong values corrected).
- **#378** B2 — 8 numeric coercion clones consolidated, guard extended (0 empirical diffs).
- **#379** C4/H9 — 13 IST/session-date forks consolidated; 18:30Z pinning proven.
- **#380** C5 — 4 indicator forks → canonical variants, bit-exact (no number changes).
- **#381** A3 — trading-cost forks → canonical calculator (paper fee schedule preserved).
- **#382** M1/M5 — 11 52W ratio expressions → 7 bit-exact canonical variants (float operand order preserved).
- **#383** B1/C4-leftover — guard-evading IST literals consolidated; 65/65 parity probes, guard extended.
- `ss-pivot-dto` — verified false positive (5 sites call canonical math; dict projections are consumer contracts). No change.

## 2. Deferred — needs user decision (behavior change)

### A2 — paper-endpoint 52W re-derivation and inline pivots

- **Current-bar inclusion / band**: `stock-screener-ui/api/paper/endpoints.py:576-603`
  fetches 400 calendar days to *today* (`:579-587`), takes `highs[-252:]` (`:591`)
  so the current bar is included, and sets `near_high` at `<= 3.0` (`:602`).
  `get_52w_levels()` at `endpoints.py:948-979` re-derives the same way
  (to_date today at `:963-964`, `highs[-252:]` at `:972`).
  **Canonical**: `stock-screener-ui/trading/week52/ranges.py:70-87` reads the
  release-synced `52w_range:all` Redis entry then the `stock_52w_range` DB row
  (no per-request bar recompute). The batch builder
  `trading/week52_utils.py:57-78` defaults `exclude_current=True` (`:62`) for
  high/low while keeping the last close (`:73`) — the exact opposite of the
  paper endpoint. Gap math is
  `trading/week52/math.py:92-96`, and the canonical "near" band is
  `touched_52w_gap_threshold_pct()` = **1.0%** at `trading/week52/config.py:73-75`
  (also `touch_eps_pct()` = 0.5% at `:78-80`).
  **User-visible delta**: paper 52W high/low, `distance_*_pct` and `near_high`
  change (3% → 1%, current bar excluded). Needs explicit sign-off; do NOT
  "fix" by silently adopting canonical numbers.
- **Classic pivots inline**: `endpoints.py:605-618` computes `pp/r1/r2/s1/s2`
  locally from the previous day's bar. **Canonical**:
  `stock-screener-ui/trading/pivot_utils.py:29` `calculate_pivot_points()`
  (dataclass `PivotPoints` at `:16`). **Delta**: pivot values/rounding may move
  in the paper chart/snapshot payloads.
- **ALREADY FIXED — own cache dir/TTL**: the audit's `endpoints.py:906` own
  `CACHE_52W_DIR` + 5-min literal is now `endpoints.py:910-911`, importing
  `PAPER_52W_CACHE_DIR` and `PAPER_52W_FILE_TTL_MINUTES` from canonical
  `trading/week52/keys.py:22-28` (TTL 5 min). No work left on this sub-item.

### A4 — twin live `config.py` divergences

Root `config.py` is used by `upstox_trader/**` and bot processes;
`stock-screener-ui/config.py` by the API. Pick a "which value wins" per setting:

| Setting | Root `config.py` | UI `stock-screener-ui/config.py` | User-visible delta |
|---|---|---|---|
| CORS | `:15-18` default `https://alphashri.pages.dev`, patterns `https://*.alphashri.pages.dev,http://localhost:*,http://127.0.0.1:*` | `:20-29` default `http://localhost:5173`, patterns `http://localhost:*,http://127.0.0.1:*,http://192.168.*.*:*` | Prod frontend origin accepted in one process and rejected in the other; LAN origins allowed only by UI copy. |
| `DATABASE_URL` | `:28-33` default `sqlite:///<repo-root>/db/alphashri.db`, no relative-path rewrite | `:41-54` default `sqlite:///<stock-screener-ui>/db/alphashri.db`, rewrites `sqlite:///./…` to absolute | Two different default DB files by process; relative URLs resolve differently. |
| `UPSTOX_CONFIG` shape | `:50-53` `{api_key, api_secret}` only | `:66-74` adds `access_token`, `api_key_primary`, `api_secret_primary`, `username`, `password` | Keys read by API consumers are absent in bot process (KeyError / silent empty). |
| `.env` load set | `:10-12` only `.env.local` | `:13-16` `.env.local`, `.env.dev`, `.env` | Secrets present only in `.env` are visible to API but not bot; load precedence differs. |

- `PORT` default is 8765 in both (`config.py:14`, `stock-screener-ui/config.py:19`) — no decision needed.
- **ALREADY FIXED — third IST literal**: `stock-screener-ui/trading/timezone.py:1-10`
  now re-exports `config.IST` with a byte-identical +05:30 fallback, so it is no
  longer an independent clock. Remaining A4 piece: `stock-screener-ui/config.py:7`
  still defines its own `IST` literal instead of re-exporting the root value.

### Market-hours fallbacks (unify into `trading.utils.is_market_open()`)

Canonical is `stock-screener-ui/trading/utils.py:90-99` (09:15–15:30 IST,
weekends + exchange holidays). All four sites already delegate when the import
works; the **fallback** is what diverges and changes gate behavior:

- `stock-screener-ui/options_paper/live.py:51-57` — primary `:53-54`, fallback
  weekday-only `(9,15) <= (now.hour, now.minute) <= (15,40)` at `:57`.
  Delta: admits 15:30–15:40 and ignores holidays.
- `stock-screener-ui/api_server_fastapi.py:145-156` — primary `:151-152`,
  fallback `8 <= hour <= 16` at `:155-156`. Delta: opens 08:00–09:15, runs to
  16:00, ignores holidays; background jobs fire at wrong times.
- `stock-screener-ui/api/reports_api/fyers_ws.py:75-82` — primary `:78-80`,
  fallback `return True` at `:82`. Delta: WS reports "market open" on any
  day/time if the canonical import fails.
- `stock-screener-ui/chart_patterns/tail_refresh.py:362-366` — primary
  `:362-364`, fallback `return True` at `:366`. Delta: tail refresh keeps polling
  outside sessions/holidays.

## 3. Deferred — needs deps-enabled runner (frontend; no bun/node_modules here)

- **A5 type collisions**: `ChainRow` defined three times with incompatible
  `ce`/`pe` shapes — `src/api/optionsDock.ts:81`, `src/utils/optionsStrategies.ts:32`,
  `src/pages/report/optionChainMetrics.ts:46`. `Week52Levels` defined twice
  with wholly different fields — `src/types/shared.ts:53` (`date`, `52w_high`)
  vs `src/types/paperTrading.ts:111` (`high_52w`, `low_52w`); a wrong import
  compiles and reads `undefined`. Consolidate under `src/types/` with wire-shape parity.
- **B3 rgba guard gap**: `src/test/theme-single-source.test.ts:133-134` only
  checks hex/`alpha()` output; `src/components/common/colorHygiene.spec.ts:24,44-80`
  has an `rgba()` regex but scans only `src/components/common`, `src/ui` and
  `src/style.css` (green/red rgba allowlisted at `:58-65`). Off-palette leaks:
  `src/pages/report/SetupRadarStrip.tsx:39,71` and `NiftySqueezeRadar.tsx:298,426`
  (`rgba(63,185,80)` = `#3FB950`, green anchor absent from palette; `:426` also
  `rgba(248,81,73)` = `#F85149`), and `src/components/backtest/BacktestResultsTable.tsx:135`
  (`rgba(88,166,255)` = `#58A6FF`). Need a repo-wide rgba guard + palette-derived `alpha()`.
- **C1 NIFTY capability branches**: **31** non-test branches in `src` (audit said
  ~22; spellings vary). Main clusters: `niftyReportStore.effectsCore.ts:112,233,251,365,381,417,440,451,461,473`,
  `niftyReportStore.reportHandlers.ts:93,163,380`,
  `niftyReportStore.effectsReplay.ts:161,203`, `niftyReportStore.derived.ts:67`,
  `niftyReportStore.helpers.ts:37`, `ReportDecisionStrip.tail.tsx:56,71,84,87,114`,
  `ReportDecisionStrip.moreStats.tsx:137`, `ReportToolbar.tsx:347,543,624`,
  `ReportStrips.tsx:220`, `IndexMoversStrip.tsx:335,371`,
  `IndexMoversModal.tsx:204`, `src/components/window/panels/expiryPicker.tsx:79`.
  Introduce one capability descriptor on `ReportSymbol` and migrate consumers.
- **C2 universe-label registries**: three divergent sets —
  `chart_patterns/universes.py:31-41` (`All NSE Equity`, `NIFTY 50`, `Bank Nifty`),
  `api/chart_patterns.py:127-131` (`Nifty 50`, `All NSE Equities`),
  `src/config/marketUniverses.ts:81-83` (`All NSE`, `Nifty 50`, `Nifty 500`).
  One generator/source plus a guard comparing labels as well as IDs.
- **C3 fullscreen state machine**: `src/hooks/usePatternFullscreenSolid.ts`
  (855 lines) and `src/pages/patterns/patternsFullscreen.ts` (833 lines) = 1,688
  lines, ~75% duplicate per audit; `patternsFullscreen.ts:2` calls itself a
  Solid port / local twin. Extract one module.
- **D3 API route strings**: `src/api/config.ts:12-23` owns `API_ENDPOINTS`, but
  only 5 source modules import it (`chartPreview.ts`, `correlation.ts`,
  `sectorCorrelation.ts`, `sectorHistory.ts`, `components/layout/MarketTicker.tsx`).
  **29** `${API_BASE}/api/paper` matches remain (27 inline source strings plus
  `config.ts:15` and `config.test.ts:12`), e.g. `src/api/paperTrading.ts:82,93,105,133,146,162,180,195,208,238,311,324,361,380,399,415,428,458,472`,
  `src/api/botControlApi.ts:30,42,53`, `src/state/strategies.ts:213`,
  `src/components/paper-trading/LivePriceUpdater.tsx:90`. Route all through the registry.

## 4. Open backend follow-ups

- **`options_paper/spec.py:106-112` `TICK_SIZES`**: `BANKNIFTY 0.05` vs canonical
  `api/options_underlying.py:93` **1.05**; `FINNIFTY 0.05` vs `:94` **1.05**;
  `SENSEX 0.05` vs `:96` **5.0** (extra divergence not in the status file).
  `MIDCPNIFTY 0.05` matches `:95`. Alias `INDEX_CONTRACT_META` the same way
  `INDEX_LOTS` does at `options_paper/spec.py:52-55`; prove field-by-field parity.
- **`chart_patterns/indicators.py` session-registry literals — reduced to doc-only**:
  code is **ALREADY FIXED** (`:50` imports `TZ_IST` from `trading.timezone`;
  `:52-60,101,552,573` use it). Only the module docstring at `:12` still
  hardcodes `"Asia/Kolkata"`. Decide whether to reword the docstring; no code
  divergence remains. (Status-file B1 guard scope note.)
- **ALREADY FIXED — `api/paper/endpoints.py:884` cost defaults**: `:888-894` now
  read `costs.BROKERAGE_PCT`, `MIN_BROKERAGE`, `STT_PCT`, `EXCHANGE_CHARGES_PCT`,
  `SEBI_FEE_PCT`, `STAMP_DUTY_PCT`, `GST_PCT` from canonical `backtest/costs.py`.
  No flat defaults left in the reset handler.
- **`basis_text` unused import**: `api/reports_api/nifty_bursts.py:42` imports
  `basis_text`; only `fuel_state` (`:957`) and `plan_allowed` (`:959`) are used.
  Remove the dead import.
- **`OrderFlowAuthError` fate**: `api/broker_hub/adapters/base.py:56-62` defines
  the exception; repo-wide grep finds zero references/usages. Decide delete vs
  wire into broker auth-failure handling. (Not in the audit artifacts — from the brief.)
- **`db/models/__init__.py` re-export rule (table registration)**: all 19 model
  modules are currently imported and listed in `__all__` (`:1-78`), so the rule
  is satisfied, but nothing guards it. A new declarative model imported only in
  its own module would be missing from `Base.metadata` used by
  `tests/conftest.py:73,272`. Add a guard that walks `db/models/*.py` and fails
  when a `Base` subclass isn't re-exported here. (Not in the audit artifacts.)
- **`ANOMALY_BASELINE_SESSIONS` doc-only reader**: `api/event_radar/contract.py:88`
  defines `5`, exported at `:221`; the only reader is `docs/event-radar.md:97`.
  `api/event_radar/anomaly.py:357-358` derives the baseline from available bars
  instead. Wire the constant into the fetch/poller or delete it.
- **`news_poller._poller_executor` assigned-unused**: `api/news/news_poller.py:241`
  creates a `ThreadPoolExecutor(max_workers=3)` that is never referenced or
  shut down. Remove it or use it for the scoring calls.
- **`GLOBAL_PER_SECOND`**: `upstox_trader/rate_limiter.py:65` defines `50` with
  zero reads; the limiter is minute-based (`GLOBAL_PER_MINUTE = 500` at `:66`,
  used at `:149,353`). Delete the dead constant or implement a per-second cap.
  (Root `upstox_trader/**`, not under `stock-screener-ui/`.)
- **ALREADY FIXED — `scripts/market/*` evasive coercion clones**: status-file
  residual is resolved — `tests/test_numbers_single_source.py:29-35` now scans
  `scripts` in both `PRODUCTION_PATHS` and `EVASIVE_SCAN_PATHS`, and
  `scripts/market/nifty_tape_review_quant.py:70-72` delegates `_f` to canonical
  `to_float` (registered at `tests/test_numbers_single_source.py:54`). No open work.

## 5. Rules for whoever picks this up

- Write the failing-first test before the change; prove the audit finding reproduces.
- Parity is bit-exact, or the delta is measured and stated (counts, units, sample fixture).
- No `skip`, `xfail`, allowlist entry, or deleted assertion to make a gate green.
- No silent gate weakening: extending guard scope is fine only together with the clone fixes it catches.
- One lane per file set / one owner per file; do not touch another lane's files.
- Model: `opencode-go/hy4-flash-free`. Work in a worktree; **no git writes by subagent** — leave changes unstaged; main agent is sole git actor.
- Run only narrow targeted tests plus `git diff --check`; report exact command and pass/fail counts.
- A2, A4 and the market-hours fallbacks change behavior: get explicit user sign-off before merging anything beyond additive parity.
- Source artifacts: `.agent-artifacts/audits/single-source/{config-registry,frontend,trading-math,backend}-findings.md` and `{REMEDIATION-PLAN,REMEDIATION-STATUS}.md`.
