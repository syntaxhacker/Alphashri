# Route Surface Audit

Inventory of where every page route lives, plus an exact rename plan for the `*2` files.

- Repository: `stock-screener-ui/` (SolidJS 1.9 + Vite, `@/*` → `src/*` per `tsconfig.json`)
- Evidence date: 2026-11-14
- Method: read `src/App.tsx` in full, resolved every lazy specifier with `test -e`, grep with
  `grep -rn … --include=*.ts --include=*.tsx | grep -v node_modules`.
- State: **current worktree**, after the standalone `/heatmap` page was removed. The Heatmap UI
  that survived lives in `src/components/heatmap/` and is rendered by the Screener's Market tab
  (`MarketMapView`). See `docs/DELETION_LOG.md` for the deletion record.

---

## Part 1 — Route → component origin

`src/App.tsx` has **29 `<Route path=…>` elements**: **27** point at a named lazy component,
**2** are inline `<Navigate>` redirects with no component home.

| # | route path | component | defining file (resolved) | home | notes |
|---|---|---|---|---|---|
| 1 | `/` | `ScreenerContainer` | `src/pages/screener/ScreenerContainer.tsx` | `src/pages` | direct `.then(m => m.ScreenerContainer)` |
| 2 | `/backtest` | `BacktestPage` | `src/components/backtest/BacktestPage.tsx` | `src/components` | via barrel `src/components/backtest/index.ts` |
| 3 | `/experiments` | `ExperimentsPage` | `src/components/experiments/ExperimentsPage.tsx` | `src/components` | **no barrel** in `components/experiments/` |
| 4 | `/paper` | `PaperTradingView` | `src/components/paper-trading/PaperTradingView2.tsx` | `src/components` | via barrel `paper-trading/index.ts`; file has the `2` suffix, export name does not |
| 5 | `/replay` | `ReplayPage` | `src/components/replay/ReplayPage.tsx` | `src/components` | via barrel `replay/index.ts` |
| 6 | `/strategy-runner` | `StrategyRunnerPage` | `src/components/strategy-runner/StrategyRunnerPage.tsx` | `src/components` | via barrel `strategy-runner/index.ts` |
| 7 | `/sector` | `SectorPage` | `src/components/sector/SectorPage2.tsx` | `src/components` | direct import; file has the `2` suffix, export is `SectorPage` |
| 8 | `/strategies` | `StrategiesContainer` | `src/pages/strategies/StrategiesContainer.tsx` | `src/pages` | — |
| 9 | `/bots` | `BotsPage` | `src/components/bots/BotsPage.tsx` | `src/components` | barrel is `components/bots/components.ts` (**not** `index.ts`) |
| 10 | `/options` | `OptionsContainer` | `src/pages/options/OptionsContainer.tsx` | `src/pages` | — |
| 11 | `/report/nifty` | *(inline)* | — | — | `component={() => <Navigate href="/report/index" />}` |
| 12 | `/report/index` | `NiftyReportPage` | `src/pages/report/NiftyReportShell.tsx` | `src/pages` | variable name ≠ export name (`NiftyReportShell`) |
| 13 | `/report/us` | `UsReportPage` | `src/pages/report/us/UsReportPage.tsx` | `src/pages` | — |
| 14 | `/settings` | `SettingsPage` | `src/pages/settings/SettingsPage.tsx` | `src/pages` | — |
| 15 | `/news` | `NewsPage` | `src/pages/NewsPage.tsx` | `src/pages` | default export |
| 16 | `/admin` | `AdminPage` | `src/pages/AdminPage.tsx` | `src/pages` | default export |
| 17 | `/agri` | `AgriContainer` | `src/pages/agri/AgriContainer.tsx` | `src/pages` | 6-line container; renders `./AgriPage` |
| 18 | `/orderflow` | `OrderFlowPage` | `src/pages/orderflow/OrderFlowPage.tsx` | `src/pages` | — |
| 19 | `/patterns` | `PatternsContainer` | `src/pages/patterns/PatternsContainer.tsx` | `src/pages` | also has a `default` export |
| 20 | `/report` | `ReportContainer` | `src/pages/report/ReportContainer.tsx` | `src/pages` | — |
| 21 | `/report/profit` | `ProfitabilityPage` | `src/pages/report/Profitability.tsx` | `src/pages` | file name (`Profitability`) ≠ export name |
| 22 | `/poc/kit` | `KitPoc` | `src/pages/poc/KitPoc.tsx` | `src/pages` | — |
| 23 | `/poc/smc` | `SmcPoc` | `src/pages/poc/SmcPoc.tsx` | `src/pages` | default export |
| 24 | `/poc/smc-trades` | `SmcTrades` | `src/pages/poc/SmcTrades.tsx` | `src/pages` | 10-line shim over `@/components/replay/core/ReplayShell` |
| 25 | `/poc/tick-replay` | `TickReplay` | `src/pages/poc/TickReplay.tsx` | `src/pages` | 11-line shim over `@/components/replay/core/ReplayShell` |
| 26 | `/poc/replay` | `ReplayIndexPage` | `src/pages/poc/ReplayIndexPage.tsx` | `src/pages` | default export |
| 27 | `/poc/replay/:strategyId` | `ReplayStrategyPage` | `src/pages/poc/ReplayStrategyPage.tsx` | `src/pages` | param route; default export |
| 28 | `/chart/:symbol?` | `ChartView` | `src/pages/chart/ChartView.tsx` | `src/pages` | optional param; default export |
| 29 | `*` | *(inline)* | — | — | catch-all `<Navigate href="/" />` |

### Summary counts

| bucket | count |
|---|---|
| `<Route path=…>` total | **29** |
| resolving to `src/pages/**` | **20** |
| resolving to `src/components/**` | **7** |
| inline `<Navigate>` (no component) | **2** |

The 7 `src/components/**` routes, explicitly:

| route path | module specifier in `src/App.tsx` |
|---|---|
| `/sector` | `./components/sector/SectorPage2` |
| `/backtest` | `./components/backtest` (barrel) |
| `/experiments` | `./components/experiments/ExperimentsPage` |
| `/paper` | `./components/paper-trading` (barrel) |
| `/replay` | `./components/replay` (barrel) |
| `/strategy-runner` | `./components/strategy-runner` (barrel) |
| `/bots` | `./components/bots/components` (barrel) |

Verification:

```bash
grep -c "<Route path=" src/App.tsx                                    # 29
grep -c "lazy(() => import" src/App.tsx                               # 27
grep "lazy(() => import" src/App.tsx | grep -c "\./pages/"            # 20
grep "lazy(() => import" src/App.tsx | grep -c "\./components/"       # 7

# every lazy specifier resolves (no MISSING printed)
grep -o 'import("[^"]*"' src/App.tsx | sed 's/import("\.\///;s/"$//' | while read m; do
  test -e "src/$m.tsx" || test -e "src/$m.ts" || test -e "src/$m/index.ts" \
    || echo "MISSING src/$m"; done
```

Note: `src/components/sector/`, `src/components/experiments/`, `src/components/auth/` and
`src/components/news/` have **no barrel**. Barrels that exist: `backtest/index.ts`,
`paper-trading/index.ts`, `replay/index.ts`, `strategy-runner/index.ts`, `screener/index.ts`,
`strategies/index.ts`, `patterns/index.ts`, `common/index.ts`, `bots/components.ts`.

---

## Part 2 — `*2` rename plan

Trailing-digit files under `src` (excluding `node_modules`): **11 `.tsx`, 0 `.ts`**.

```bash
find src -name "*2.tsx" -o -name "*2.ts" | grep -v node_modules | wc -l   # 11
find src -name "*2.ts"  | grep -v node_modules | wc -l                    # 0
```

**Every one of the 11 has no non-`2` sibling** — verified with `test -e` on both extensions.
12 co-located test files also carry the suffix (`*2.test.tsx` ×11 + `PaperChart2.render.test.tsx`).

### 2a. Source files (11) — rename table

| # | current path | non-`2` sibling? | importers (`file:line`) | proposed new path |
|---|---|---|---|---|
| 1 | `src/components/auth/AuthProvider2.tsx` | **no** | `src/App.tsx:4` · `src/components/auth/AuthProvider2.test.tsx:6` · `src/components/auth/LoginForm2.tsx:2` · `src/components/auth/LoginForm2.test.tsx:20` (vi.mock) · `src/components/layout/NavbarNested.tsx:24` · `src/components/layout/NavbarNested.test.tsx:7` · `src/components/layout/UserButton.tsx:4` · `src/pages/admin/Admin52wRangePanel.tsx:8` · `src/pages/admin/Admin52wRangePanel.test.tsx:18` (vi.mock) · `src/pages/admin/AdminPatternTimeframesPanel.tsx:5` · `src/pages/admin/AdminPatternTimeframesPanel.test.tsx:17` (vi.mock) · `src/pages/admin/LLMStatsPanel.tsx:4` · `src/pages/admin/NewsQueuePanel.tsx:6` · `src/pages/admin/OrderFlowJournalPanel.tsx:7` · `src/pages/admin/OrderFlowJournalPanel.test.tsx:23` (vi.mock) · `src/test/pages.test.tsx:5` · `src/test-utils/testUtils.tsx:6,18,19,20` | `src/components/auth/AuthProvider.tsx` |
| 2 | `src/components/auth/LoginForm2.tsx` | **no** | `src/App.tsx:5` · `src/components/auth/LoginForm2.test.tsx:6` · `src/components/auth/LoginForm.test.ts:2` | `src/components/auth/LoginForm.tsx` |
| 3 | `src/components/bots/BotConfigModal2.tsx` | **no** | `src/components/bots/BotConfigModal2.test.tsx:6` · `src/components/bots/BotsPage.tsx:28` · `src/components/bots/components.ts:2` | `src/components/bots/BotConfigModal.tsx` |
| 4 | `src/components/bots/BotStatusPanel2.tsx` | **no** | `src/components/bots/BotStatusPanel2.test.tsx:6` · `src/components/bots/BotsPage.tsx:29` · `src/components/bots/components.ts:3` | `src/components/bots/BotStatusPanel.tsx` |
| 5 | `src/components/news/NewsPanel2.tsx` | **no** | `src/components/layout/SidebarHeader.tsx:4` · `src/components/layout/AppLayout.test.tsx:60` (vi.mock) · `src/components/news/NewsPanel2.test.tsx:57` | `src/components/news/NewsPanel.tsx` |
| 6 | `src/components/paper-trading/PaperChart2.tsx` | **no** | `src/components/paper-trading/index.ts:4` · `src/components/paper-trading/PaperChart2.render.test.tsx:6` · `src/components/paper-trading/PaperTradingView2.test.tsx:95` (vi.mock) | `src/components/paper-trading/PaperChart.tsx` |
| 7 | `src/components/paper-trading/PaperHistoryTable2.tsx` | **no** | `src/components/paper-trading/index.ts:3` · `src/components/paper-trading/PaperHistoryTable2.test.tsx:93` · `src/components/paper-trading/PaperTradingView2.test.tsx:99` (vi.mock) | `src/components/paper-trading/PaperHistoryTable.tsx` |
| 8 | `src/components/paper-trading/PaperPositionsTable2.tsx` | **no** | `src/components/paper-trading/index.ts:2` · `src/components/paper-trading/PaperPositionsTable2.test.tsx:6` · `src/components/paper-trading/PaperTradingView2.test.tsx:91` (vi.mock) | `src/components/paper-trading/PaperPositionsTable.tsx` |
| 9 | `src/components/paper-trading/PaperTradingView2.tsx` | **no** | `src/components/paper-trading/index.ts:6` · `src/components/paper-trading/PaperTradingView2.test.tsx:123` | `src/components/paper-trading/PaperTradingView.tsx` |
| 10 | `src/components/paper-trading/WatchlistScan2.tsx` | **no** | `src/components/paper-trading/PaperTradingView2.tsx:37` · `src/components/paper-trading/WatchlistScan2.test.tsx:6` | `src/components/paper-trading/WatchlistScan.tsx` |
| 11 | `src/components/sector/SectorPage2.tsx` | **no** | `src/App.tsx:15` · `src/components/sector/SectorPage2.test.tsx:5` | `src/components/sector/SectorPage.tsx` |

### 2b. Test files (12) — rename table

| # | current path | carries a `*2` module path? | proposed new path | same-stem partner after rename |
|---|---|---|---|---|
| 1 | `src/components/auth/AuthProvider2.test.tsx` | yes (`:6`) | `src/components/auth/AuthProvider.test.tsx` | — |
| 2 | `src/components/auth/LoginForm2.test.tsx` | yes (`:6`, `:20` vi.mock) | `src/components/auth/LoginForm.test.tsx` | ⚠ coexists with `LoginForm.test.ts` (different ext, both run) |
| 3 | `src/components/bots/BotConfigModal2.test.tsx` | yes (`:6`) | `src/components/bots/BotConfigModal.test.tsx` | — |
| 4 | `src/components/bots/BotStatusPanel2.test.tsx` | yes (`:6`) | `src/components/bots/BotStatusPanel.test.tsx` | — |
| 5 | `src/components/news/NewsPanel2.test.tsx` | yes (`:57`) | `src/components/news/NewsPanel.test.tsx` | — |
| 6 | `src/components/paper-trading/PaperChart2.test.tsx` | **no** (tests pure helpers) | `src/components/paper-trading/PaperChart.test.tsx` | — |
| 7 | `src/components/paper-trading/PaperChart2.render.test.tsx` | yes (`:6`) | `src/components/paper-trading/PaperChart.render.test.tsx` | — |
| 8 | `src/components/paper-trading/PaperHistoryTable2.test.tsx` | yes (`:93`) | `src/components/paper-trading/PaperHistoryTable.test.tsx` | ⚠ coexists with `PaperHistoryTable.test.ts` |
| 9 | `src/components/paper-trading/PaperPositionsTable2.test.tsx` | yes (`:6`) | `src/components/paper-trading/PaperPositionsTable.test.tsx` | ⚠ coexists with `PaperPositionsTable.test.ts` |
| 10 | `src/components/paper-trading/PaperTradingView2.test.tsx` | yes (`:91`, `:95`, `:99`, `:123`) | `src/components/paper-trading/PaperTradingView.test.tsx` | — |
| 11 | `src/components/paper-trading/WatchlistScan2.test.tsx` | yes (`:6`) | `src/components/paper-trading/WatchlistScan.test.tsx` | — |
| 12 | `src/components/sector/SectorPage2.test.tsx` | yes (`:5`) | `src/components/sector/SectorPage.test.tsx` | ⚠ coexists with `SectorPage.test.ts` (tests `./sectorUtils`, unrelated) |

Every rename target is free — no collisions (verified for all 23 targets with `test -e`).

### 2c. Files whose import strings must change — 49 edits across 44 files

Count method (every module-path string literal that ends in a `*2` name):

```bash
grep -rnoE "\"[^\"]*/?(AuthProvider2|LoginForm2|BotConfigModal2|BotStatusPanel2|NewsPanel2|PaperChart2|PaperHistoryTable2|PaperPositionsTable2|PaperTradingView2|WatchlistScan2|SectorPage2)\"" \
  src --include=*.ts --include=*.tsx | grep -v node_modules | wc -l    # 47
# 17 live inside the 13 renamed files; 30 inside the 20 external files
```

Plus `src/test/table-structure.test.ts:36,38` (path strings that do **not** end in the bare name,
so the grep above misses them): **47 + 2 = 49 string edits**.

**Renamed-only, zero content edit (10 of 23):** sources `AuthProvider2.tsx`, `BotConfigModal2.tsx`,
`BotStatusPanel2.tsx`, `NewsPanel2.tsx`, `PaperChart2.tsx`, `PaperHistoryTable2.tsx`,
`PaperPositionsTable2.tsx`, `WatchlistScan2.tsx`, `SectorPage2.tsx` (none imports a `*2` module
internally), plus `PaperChart2.test.tsx` (tests pure legend helpers).

**External files that must be edited (20 files, 30 sites):**

| file | lines | what changes |
|---|---|---|
| `src/App.tsx` | 4, 5, 15 | `AuthProvider2`→`AuthProvider`, `LoginForm2`→`LoginForm`, `SectorPage2`→`SectorPage` |
| `src/components/bots/BotsPage.tsx` | 28, 29 | `./BotConfigModal2`, `./BotStatusPanel2` |
| `src/components/bots/components.ts` | 2, 3 | re-export specifiers |
| `src/components/layout/NavbarNested.tsx` | 24 | `../auth/AuthProvider2` |
| `src/components/layout/NavbarNested.test.tsx` | 7 | `../auth/AuthProvider2` |
| `src/components/layout/UserButton.tsx` | 4 | `../auth/AuthProvider2` |
| `src/components/layout/SidebarHeader.tsx` | 4, 94 | default import name **and** `../news/NewsPanel2`; JSX tag `<NewsPanel2 />` at 94 |
| `src/components/layout/AppLayout.test.tsx` | 60 | `vi.mock("../news/NewsPanel2")` |
| `src/components/auth/LoginForm.test.ts` | 2 | `./LoginForm2` |
| `src/components/paper-trading/index.ts` | 2, 3, 4, 6 | 4 re-export specifiers |
| `src/pages/admin/NewsQueuePanel.tsx` | 6 | `../../components/auth/AuthProvider2` |
| `src/pages/admin/OrderFlowJournalPanel.tsx` | 7 | idem |
| `src/pages/admin/AdminPatternTimeframesPanel.tsx` | 5 | idem |
| `src/pages/admin/LLMStatsPanel.tsx` | 4 | idem |
| `src/pages/admin/Admin52wRangePanel.tsx` | 8 | idem |
| `src/pages/admin/Admin52wRangePanel.test.tsx` | 18 | `vi.mock(...)` |
| `src/pages/admin/AdminPatternTimeframesPanel.test.tsx` | 17 | `vi.mock(...)` |
| `src/pages/admin/OrderFlowJournalPanel.test.tsx` | 23 | `vi.mock(...)` |
| `src/test/pages.test.tsx` | 5 | `@/components/auth/AuthProvider2` |
| `src/test-utils/testUtils.tsx` | 6, 18, 19, **20** | import + `vi.mock` + `vi.importActual<…>` type arg **and** its second string argument on line 20 |

**Renamed files that also need an internal string edit (13):**

| file | line | string |
|---|---|---|
| `src/components/auth/LoginForm2.tsx` | 2 | `from "./AuthProvider2"` |
| `src/components/paper-trading/PaperTradingView2.tsx` | 37 | `from "./WatchlistScan2"` |
| `src/components/auth/AuthProvider2.test.tsx` | 6 | `from "./AuthProvider2"` |
| `src/components/auth/LoginForm2.test.tsx` | 6, 20 | `from "./LoginForm2"`, `vi.mock("./AuthProvider2")` |
| `src/components/bots/BotConfigModal2.test.tsx` | 6 | `from "./BotConfigModal2"` |
| `src/components/bots/BotStatusPanel2.test.tsx` | 6 | `from "./BotStatusPanel2"` |
| `src/components/news/NewsPanel2.test.tsx` | 57 | `from "./NewsPanel2"` |
| `src/components/paper-trading/PaperChart2.render.test.tsx` | 6 | `from "./PaperChart2"` |
| `src/components/paper-trading/PaperHistoryTable2.test.tsx` | 93 | `from "./PaperHistoryTable2"` |
| `src/components/paper-trading/PaperPositionsTable2.test.tsx` | 6 | `from "./PaperPositionsTable2"` |
| `src/components/paper-trading/PaperTradingView2.test.tsx` | 91, 95, 99, 123 | 3 × `vi.mock` + 1 import |
| `src/components/paper-trading/WatchlistScan2.test.tsx` | 6 | `from "./WatchlistScan2"` |
| `src/components/sector/SectorPage2.test.tsx` | 5 | `from "./SectorPage2"` |

**One non-import file that must be edited (path-string allowlist):**
`src/test/table-structure.test.ts:36` (`"components/paper-trading/PaperHistoryTable2.tsx"`) and
`:38` (`"components/paper-trading/WatchlistScan2.tsx"`). Both still declare `const columns`, so a
rename without updating these literals makes the guard report them as new offenders.

### Files-to-edit count

| bucket | count |
|---|---|
| rename operations (11 source + 12 test) | **23** |
| external files with import/mock/export-string edits | **20** |
| renamed files also needing an internal string edit | **13** (subset of the 23) |
| extra file edited for path strings (`table-structure.test.ts`) | **1** |
| **distinct files touched** | **44** (23 renamed + 20 edited-in-place + 1 path-string) |
| **module-path string edits** | **49** (17 inside renamed files + 30 external + 2 allowlist) |

Optional identifier edits (only if the *symbol* name is also cleaned): `SidebarHeader.tsx:94`
(`<NewsPanel2 />`), `PaperTradingView2.tsx:37,206` + `WatchlistScan2.tsx:48`
(`WatchlistScan2` → `WatchlistScan`), plus `describe("…2")` titles. Excluding those keeps the diff
at 49 string edits.

---

## Part 3 — Layering inversions

`src/components/**` importing from `src/pages/**`: **7 sites / 6 files** (5 production, 1 test;
one file contributes 2 sites).

| file:line | imported symbol(s) | form |
|---|---|---|
| `src/components/screener/index.ts:1` | `ScreenerContainer` ← `../../pages/screener/ScreenerContainer` | **barrel re-export** |
| `src/components/screener/ScreenerPage.tsx:33` | `MarketScreenerPage` ← `../../pages/market/MarketScreenerPage` | **dynamic `import()`** (lazy tab) |
| `src/components/screener/ScreenerPage.tsx:51` | `MarketScreenerPage` ← `../../pages/market/MarketScreenerPage` | **dynamic `import()`** (prefetch) |
| `src/components/patterns/PatternListView.tsx:8` | `fullscreenDedupeKey` ← `@/pages/patterns/fullscreenKey` | named import (prod) |
| `src/components/common/SymbolDockProvider.tsx:5` | `usePatternFullscreen` ← `@/pages/report/usePatternFullscreenSolid` | named import (prod) |
| `src/components/common/SymbolDockProvider.test.tsx:24` | `__resetFullscreen` ← `@/pages/patterns/fullscreenKey` | named import (test) |
| `src/components/strategies/index.ts:7` | `StrategiesContainer` ← `../../pages/strategies/StrategiesContainer` | **barrel re-export** |

### The `from "…"` grep is incomplete — it misses two real inversions

This command (used in most audits) misses dynamic imports:

```bash
grep -rn "from \"@/pages\|from \"\.\./\.\./pages\|from \"\.\./pages" src/components --include=*.ts --include=*.tsx
# → 5 lines: misses ScreenerPage.tsx:33 and :51
```

The complete, quote/dynamic-agnostic command:

```bash
grep -rnE "(from|import\()[[:space:]]*['\"](@/pages|(\.\./)+pages)/" src/components \
  --include=*.ts --include=*.tsx | grep -v node_modules
# → 7 sites / 6 unique files
```

**Barrel re-exports:** `src/components/screener/index.ts:1` and
`src/components/strategies/index.ts:7`. Both barrels are **unused** by any importer
(`grep -rn "components/screener\"" src tests` → 0 hits; likewise strategies) and both are listed in
`knip.json` `ignore`.

**Not inversions (comment-only, excluded):** `src/components/replay/core/ReplayChartHost.tsx:2`,
`src/components/replay/core/useReplayClock.ts:1`, `src/components/replay/tick/types.ts:1`.

**Reverse direction, for context:** `src/pages/**` → `src/components/**` is ~150 import sites, i.e.
the sanctioned direction is an order of magnitude larger.

---

## Part 4 — Risk notes per proposed move

Legend: **(a)** tests importing by relative path · **(b)** barrel re-exports ·
**(c)** `vi.mock()` path strings.

### 1. `AuthProvider2.tsx` → `AuthProvider.tsx` — highest risk (20 path literals across 17 files)

- (a) `AuthProvider2.test.tsx:6` (`./AuthProvider2`), `LoginForm2.test.tsx:20` (**vi.mock**),
  `NavbarNested.test.tsx:7`, `Admin52wRangePanel.test.tsx:18` (**vi.mock**),
  `AdminPatternTimeframesPanel.test.tsx:17` (**vi.mock**), `OrderFlowJournalPanel.test.tsx:23`
  (**vi.mock**), `src/test/pages.test.tsx:5` (alias `@/…`), `src/test-utils/testUtils.tsx:6`
- (b) none (no `src/components/auth/index.ts`)
- (c) four `vi.mock` sites above + `testUtils.tsx:18`
- (extra) `testUtils.tsx:19-20` uses the path **twice more**, inside `typeof import("…")` and as
  `importActual`'s second argument. Missing line 20 makes the mock resolve to a non-existent module
  while the test imports the new one — a silent unmocked-provider failure, not a resolution error.
- (extra) `src/App.tsx:4` imports `{ AuthProvider, useAuth }`; export names have no `2`, so only
  the specifier changes.

### 2. `LoginForm2.tsx` → `LoginForm.tsx` (3 sites)

- (a) `LoginForm2.test.tsx:6`, `LoginForm.test.ts:2`
- (b) none
- (c) none pointing here
- (extra) **stem collision:** `LoginForm.test.ts` already exists and imports `LoginForm2`. After
  the rename both `LoginForm.test.ts` and `LoginForm.test.tsx` exist (legal). The `.ts` file must be
  edited at line 2 or it fails to resolve.

### 3. `BotConfigModal2.tsx` → `BotConfigModal.tsx` (3 sites)

- (a) `BotConfigModal2.test.tsx:6` · (b) **yes** `components.ts:2` · (c) none

### 4. `BotStatusPanel2.tsx` → `BotStatusPanel.tsx` (3 sites)

- (a) `BotStatusPanel2.test.tsx:6` · (b) **yes** `components.ts:3` · (c) none
- (extra) `src/App.tsx:22` resolves `/bots` through `components/bots/components`; a missed
  specifier here breaks the **route**, not just a test.

### 5. `NewsPanel2.tsx` → `NewsPanel.tsx` (3 sites, 1 optional identifier rename)

- (a) `NewsPanel2.test.tsx:57` · (b) none · (c) `AppLayout.test.tsx:60`
- (extra) default export is named `NewsPanel2` (`NewsPanel2.tsx:405`). Renaming only the file is
  safe; renaming the function also touches `SidebarHeader.tsx:4,94` and the test.

### 6. `PaperChart2.tsx` → `PaperChart.tsx` (3 sites)

- (a) `PaperChart2.render.test.tsx:6` · (b) **yes** `index.ts:4`
- (c) `PaperTradingView2.test.tsx:95`
- (extra) `PaperChart2.test.tsx` has zero references to `PaperChart2` (pure helper test) — rename-only.
- (extra) stale prose: `src/utils/chart/normalizePaper.ts:221` comment mentions `PaperChart2.tsx`.

### 7. `PaperHistoryTable2.tsx` → `PaperHistoryTable.tsx` (3 sites + allowlist)

- (a) `PaperHistoryTable2.test.tsx:93` · (b) **yes** `index.ts:3`
- (c) `PaperTradingView2.test.tsx:99`
- (extra) allowlist string at `table-structure.test.ts:36`; the component declares `const columns`.
- (extra) stem collision with `PaperHistoryTable.test.ts` (tests `utils/tradeHistoryUtils`).

### 8. `PaperPositionsTable2.tsx` → `PaperPositionsTable.tsx` (3 sites)

- (a) `PaperPositionsTable2.test.tsx:6` · (b) **yes** `index.ts:2`
- (c) `PaperTradingView2.test.tsx:91`
- (extra) stem collision with `PaperPositionsTable.test.ts` (tests `./PositionsHelpers`).

### 9. `PaperTradingView2.tsx` → `PaperTradingView.tsx` (2 sites)

- (a) `PaperTradingView2.test.tsx:123` · (b) **yes** `index.ts:6`; `src/App.tsx:19` uses that barrel
- (c) none
- (extra) **barrel cycle:** `PaperTradingView2.tsx:29` imports its siblings via `from "."`, i.e.
  it imports `index.ts`, which re-exports this file. The cycle exists today; a rename is the moment
  to break it (`from "."` → direct `./PaperX` imports).
- (extra) `AGENTS.md:138` references `PaperTradingView2.tsx` by name.

### 10. `WatchlistScan2.tsx` → `WatchlistScan.tsx` (2 sites)

- (a) `WatchlistScan2.test.tsx:6` · (b) none · (c) none
- (extra) the only `*2` file whose exported symbol keeps the digit: `export function WatchlistScan2`
  (`:48`), consumed at `PaperTradingView2.tsx:206`. File-only rename is safe; symbol rename touches
  `PaperTradingView2.tsx:37,206` and the test.
- (extra) allowlist string at `table-structure.test.ts:38`; declares `const columns` at `:128`.

### 11. `SectorPage2.tsx` → `SectorPage.tsx` (2 sites)

- (a) `SectorPage2.test.tsx:5` · (b) none · (c) none
- (extra) `src/App.tsx:15` imports it directly (route-critical); the export is already `SectorPage`.
- (extra) stem collision with `SectorPage.test.ts` (imports `./sectorUtils`, unrelated).

### Cross-cutting risks

| risk | evidence |
|---|---|
| `pages.test.tsx` and `routes.test.ts` regex-scan `App.tsx` **as raw text** | `src/test/pages.test.tsx:6,136`, `src/test/routes.test.ts:2,4` parse `lazy(() => import("…")` out of `App.tsx?raw`. A rename must keep that clause shape or the suites silently see fewer pages (the guard is only `>20`). They resolve modules via `import.meta.glob`, so renamed files are picked up automatically. |
| Guards that walk the FS by content | `ui-guard.test.ts` and `design-scale.test.ts` are name-agnostic (no edits); `table-structure.test.ts` has the two literal allowlist entries above. |
| Docs/tests that reference `*2` names as text | `docs/MAP.md`, `AGENTS.md:138`, `test_cases/auth-layout.md`, `test_cases/news.md`. Not build breakers; `docs/MAP.md` documents the current `2`-suffix policy and would become false. |
| Nothing pins the filenames | `grep -rn "PaperChart2\|PaperTradingView2\|WatchlistScan2\|PaperHistoryTable2" .github vitest.config.ts vite.config.ts playwright.config.ts package.json` → 0 hits. |
| E2E specs never name the modules | `grep -rn "…2" tests/e2e` → 0 hits. Renames are invisible to Playwright (specs drive routes and DOM only). |
| `check-size-limits.cjs` is not wired into any script | `grep -n "check-size" package.json` → no hit. |

---

## Corrections to the task brief

1. **"~7 routes under `src/components/`"** — exactly **7** (table in Part 1). The route list is 29
   entries but only 27 components, because two entries are inline `<Navigate>`.
2. **Part 3's grep is incomplete** — it misses the two dynamic `import()` inversions in
   `src/components/screener/ScreenerPage.tsx:33,51`. Real totals are **7 sites / 6 files**.
3. **"every importer"** — the `tests/` half returns **0 hits for all 11 basenames**; no `*2` module
   is imported from `tests/` (E2E/Python trees never touch them).
4. **"expected no sibling"** — confirmed for all 11, via `test -e` on both `.tsx` and `.ts`.
5. **Sibling *stem* tests exist** for four of them (`LoginForm.test.ts`, `PaperHistoryTable.test.ts`,
   `PaperPositionsTable.test.ts`, `SectorPage.test.ts`). They are `.ts`, so no rename collides — but
   `LoginForm.test.ts:2` imports the module being renamed and must be edited.
6. **`docs/MAP.md` documents the current `2`-suffix policy** ("do not rename; barrels re-export
   under the clean name"). This document supersedes it only if the rename is actually executed.

---

## Unverified

- **Whether the rename improves anything at runtime.** No build/lint/test run was permitted for the
  audit; renaming is a pure specifier change, and the raw-`App.tsx` regex suites plus the
  `table-structure` allowlist are the only places shown to need care.
- **Bundle/chunk names after rename** — not measured.
- **Whether `screener/index.ts` and `strategies/index.ts` are truly dead** — 0 importers and a
  `knip.json` ignore entry, but `knip` was not run.

## Blockers

None.

---

## Appendix — exact commands run

```bash
# Part 1 — routes
grep -c "<Route path=" src/App.tsx                                    # 29
grep -c "lazy(() => import" src/App.tsx                               # 27
grep "lazy(() => import" src/App.tsx | grep -c "\./pages/"            # 20
grep "lazy(() => import" src/App.tsx | grep -c "\./components/"       # 7
grep -o 'import("[^"]*"' src/App.tsx | sed 's/import("\.\///;s/"$//' | while read m; do
  test -e "src/$m.tsx" || test -e "src/$m.ts" || test -e "src/$m/index.ts" \
    || echo "MISSING src/$m"; done                                     # no output

# Part 2 — *2 surface
find src -name "*2.tsx" -o -name "*2.ts" | grep -v node_modules | sort  # 11 (+0 .ts)
find src -name "*2.test.tsx" | grep -v node_modules | wc -l             # 11
find src -name "*.render.test.tsx" | grep -v node_modules               # 1 → 12 test files
grep -rnoE "\"[^\"]*/?(AuthProvider2|LoginForm2|BotConfigModal2|BotStatusPanel2|NewsPanel2|PaperChart2|PaperHistoryTable2|PaperPositionsTable2|PaperTradingView2|WatchlistScan2|SectorPage2)\"" \
  src --include=*.ts --include=*.tsx | grep -v node_modules | wc -l     # 47
grep -c "PaperHistoryTable2\|WatchlistScan2" src/test/table-structure.test.ts  # 2
for p in <23 rename targets>; do test -e "$p" && echo "COLLIDES $p" || echo "free $p"; done

# Part 3 — inversions (complete grep, includes dynamic import)
grep -rnE "(from|import\()[[:space:]]*['\"](@/pages|(\.\./)+pages)/" src/components \
  --include=*.ts --include=*.tsx | grep -v node_modules                 # 7 sites
grep -rnE "(from|import\()[[:space:]]*['\"](@/components|(\.\./)+components)/" src/pages \
  --include=*.ts --include=*.tsx | grep -v node_modules | wc -l         # ~150 (reverse)

# Part 4 / cross-cutting
grep -rn "import\.meta\.glob" src --include=*.ts --include=*.tsx        # pages.test.tsx, routes.test.ts
grep -rn "PaperChart2\|PaperTradingView2\|WatchlistScan2\|PaperHistoryTable2" \
  .github vitest.config.ts vite.config.ts playwright.config.ts package.json  # 0
ls tests/e2e/*.spec.ts | wc -l                                          # 44
```
