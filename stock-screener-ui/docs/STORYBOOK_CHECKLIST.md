# Storybook Coverage Checklist — Every Page & Component

**Generated:** 2026-08-23 — branch `feat/ui-common-storybook` — 98 stories, 358 total (including docs)
**Rule:** Every story renders the **exact app component** (no custom wrapper) with **realistic fixtures** from `src/stories/fixtures.ts` where data is needed, otherwise the component's natural empty/loading state. No ad-hoc mocks.

---

## Pages — 15 routes, 15 templates (100%)

| Route | Page file | Story | Mock strategy | Status | Mistakes fixed |
|---|---|---|---|---|---|
| `/` | `pages/screener/ScreenerContainer.tsx` | `Templates/Stock Screener` | `window.fetch` mock → 50 NSE stocks from `MOCK_SECTOR_STOCKS` | ✅ | Was empty — now populated |
| `/chart/:symbol` | `pages/chart/ChartView.tsx` | `Templates/Chart` | `window.fetch` → `MOCK_CHART_DATA` (50 candles + OR/pivot) | ✅ | Was no mock — now shows candles |
| `/heatmap` | `pages/heatmap/HeatmapPage.tsx` | `Templates/Heatmap` | `window.fetch` → `MOCK_HEATMAP_RESPONSE` + `MOCK_SECTORS_RESPONSE` (50 stocks, 8 sectors) | ✅ **Fixed 2026-08-23** — was empty due to no backend |
| `/news` | `pages/NewsPage.tsx` | `Templates/News` | Exact `NewsPage` with `MemoryRouter` — no data mock, shows empty/loading as app does | ✅ | Requires `NewsWebSocketProvider` — now provided globally in `preview.tsx` |
| `/options` | `pages/options/OptionsContainer.tsx` → `OptionsPage` | `Templates/Options` | Props from `MOCK_OPTION_CHAIN` (NIFTY 23500, 7 strikes, CE/PE OI/IV) passed directly to `OptionsPage` | ✅ | Was empty — now shows chain table |
| `/settings` | `pages/settings/SettingsPage.tsx` | `Templates/Settings` | Exact `SettingsPage` in `MemoryRouter` — no data mock, shows broker form | ✅ | No `useAuth` — no provider needed |
| `/strategies` | `pages/strategies/StrategiesContainer.tsx` | `Templates/Strategy Lab` | Exact `BacktestPage` with `MOCK_BACKTEST_RESULTS` via `window.fetch` mock | ✅ | Was empty — now shows results table |
| `/bots` | `components/bots/BotsPage.tsx` | `Templates/Bots` | Exact `BotsPage` in `MemoryRouter` with `AuthContext` mock — no data mock, shows empty/loading | ✅ | Needs `AuthProvider` — now global |
| `/paper` | `components/paper-trading/PaperTradingView2.tsx` | `Templates/Paper Trading` (Live/Empty/History/Dashboard) | `MockSetup` sets store via `setPositions`/`setPortfolio`/`setChartData` with `MOCK_PAPER_*` + `MOCK_CHART_DATA` + `window.fetch` mock for `/api/bots` etc. | ✅ **Fixed 2026-08-23** — was empty due to no store data; now uses exact `PaperTradingView` + fixtures |
| `/replay` | `components/replay/ReplayPage.tsx` | `Templates/Replay` | Exact `ReplayPage` in `MemoryRouter` — no data mock, shows config empty | ✅ | No `useAuth` |
| `/sector` | `components/sector/SectorPage2.tsx` | `Templates/Trading Desk → Sector Dashboard` | Exact `SectorPage` with `MOCK_HEATMAP_RESPONSE` via fetch mock | ✅ **Fixed** — was same as Paper (all `AggregatedDashboard`) — now distinct |
| `/admin` | `pages/AdminPage.tsx` | `Templates/Trading Desk → Admin Dashboard` | Exact `AdminPage` (LLM/52W/NewsQueue tabs) — requires `is_admin` | ✅ **Fixed** — was same as Paper — now distinct, global `AuthContext` provides admin mock |
| `/experiments` | `components/experiments/ExperimentsPage.tsx` | `Templates/Experiments` | Exact `ExperimentsPage` in `MemoryRouter` — no data mock | ✅ | No provider needed |
| `/` shell | `components/layout/AppLayout.tsx` | `Templates/Application Shell` (Default/Collapsed/Mobile/Error) | Exact `AppLayout` with `AuthProvider` + `MemoryRouter` — no ticker mock (fetches real or shows empty) | ✅ | Was `useAuth` throw — now global HOC + `withMockAuth` removed (exact) |
| `/auth` | `components/auth/LoginForm2.tsx` | `Templates/Auth` (Login/Register) | Exact `LoginForm2` in `MemoryRouter` — no data mock | ✅ | No `useAuth` needed for form itself |

---

## Components — 142 files, 31 with stories (22% of feature layer, 100% of design-system layer)

### Design System (100%)

| Layer | Count | Stories | Status |
|---|---|---|---|
| Primitives `src/ui` | 55 | 55 (`Primitives/*`) | ✅ 100% — every wrapper has CSF3 + realistic NSE data |
| Foundations | 3 | `Foundations/Colors, Typography, Spacing & Elevation` | ✅ From `palette.ts` tokens |
| Composites `components/common` | 12 | 12 (`Composites/*` incl. `ChatPopup`, `PreviewChart`, `SectionHeader`) | ✅ 100% — `SectionHeader` made common 2026-08-23 |
| **Design System total** | **70** | **70** | **✅ 100%** |

### Feature Components (patterns — where realistic mocks are needed)

| Component | Story | Mock | Status |
|---|---|---|---|
| `PaperPositionsTable2` | `Patterns/Tables/Positions` | `setPositions(MOCK_PAPER_POSITIONS)` | ✅ |
| `PaperHistoryTable2` | `Patterns/Tables/PaperHistory` | `setTrades(MOCK_PAPER_TRADES)` | ✅ |
| `TradeHistoryTable` (backtest) | `Patterns/Tables/TradeHistory` | `MOCK_BACKTEST_RESULTS` → `Trade[]` | ✅ |
| `SectorTable` + `IntervalMoversTable` | `Patterns/Tables/SectorTables` | `MOCK_SECTOR_STOCKS` → `SectorItem`/`Mover` | ✅ |
| `BacktestChart` | `Patterns/Charts/BacktestChart` | `MOCK_CANDLES` + `MOCK_CHART_DATA` | ✅ |
| `SectorHeatmapView` | `Patterns/Charts/SectorHeatmap` | `MOCK_SECTOR_STOCKS` → sectors | ✅ **Fixed** — was empty, now with `SectorHeatmapView` props |
| `ReplayChart` | `Patterns/Charts/ReplayChart` | `MOCK_CANDLES` via `candlesBySymbol` | ✅ |
| `HeatmapTreemap` (via `HeatmapPage`) | `Templates/Heatmap` | `MOCK_HEATMAP_RESPONSE` | ✅ Fixed 2026-08-23 |

### Remaining Feature Components — No Isolated Story (covered via page template)

These are rendered **inside** their page template above, so they are visually covered but have no isolated `Composites/*` story. Add only if you need isolated visual regression:

- `components/bots/BotStatusPanel2`, `BotConfigModal2`, `StrategyPerformance` — inside `Bots` and `Asset Detail → Bot Detail`
- `components/paper-trading/PaperChart2`, `WatchlistScan2`, `SelectedPositionBar`, `BotCardStrip`, `ActivityFeed` — inside `Paper Trading → Live`
- `components/replay/ReplayChart`, `ReplayStats`, `ReplayTradeLog` — inside `Replay` template
- `components/sector/SectorTable`, `SectorCorrelationTab` — inside `Sector` dashboard
- `components/options/OptionChain/*` — inside `Options` template (chain table already has OI/volume bars)
- `components/news/*` (9 files) — `NewsList`, `ArticleDetail` is inside `Asset Detail → NewsDetail`, the rest are subcomponents
- `components/experiments/*` (5 files) — inside `Experiments` template

**Decision:** For enterprise, the current `Templates/*` coverage is sufficient for page-level visual regression. Add isolated `Composites/*` stories for the 4 most reused (BotStatusPanel, PaperChart, ReplayChart, NewsList) only if you want per-component Chromatic snapshots.

---

## Common Mistakes Checklist (and fix status)

| Mistake | Where it was | Fix | Status |
|---|---|---|---|
| `useAuth must be used within an AuthProvider` | `AdminPage`, `AppLayout` via `NavbarNested` | Global `AuthContext.Provider` HOC in `.storybook/preview.tsx:62` (mocked admin `qa@test.com`) — no per-story `vi.mock` | ✅ Fixed |
| `useNewsWebSocket must be used within a NewsWebSocketProvider` | `NewsPanel2`, `SectorPage` | Same global HOC now wraps `NewsWebSocketProvider` | ✅ Fixed 2026-08-23 |
| `You cannot render a <Router> inside another <Router>` | `ClickableSymbol` (had `BrowserRouter` + global `MemoryRouter`) | Removed global `MemoryRouter` from `preview.tsx` — only `Auth`+`News` globally, Router per-story | ✅ Fixed |
| `NavLink` icons invisible (`icon="[object Object]"`) | `NavbarLinksGroup` + `AppShell` story | `src/ui/navigation/NavLink.tsx:4` now maps `icon` → `leftSection` (Mantine v8 API) | ✅ Fixed |
| Trading Desk stories all same component | `Dashboard.stories.tsx` had 3× `AggregatedDashboard` | Now distinct: Paper=`AggregatedDashboard`, Sector=`SectorPage`, Admin=`AdminPage` | ✅ Fixed |
| Heatmap no data | `HeatmapPage` fetches `/api/heatmap/pe` with no mock | `MOCK_HEATMAP_RESPONSE` (50 stocks) + `MOCK_SECTORS_RESPONSE` via `window.fetch` mock in `Heatmap.stories.tsx:7` | ✅ Fixed |
| Paper dashboard not in sync (custom `Stat` vs `CompactStat`) | `Dashboard.stories.tsx:4` custom `Stat` | Rewrote to `CompactStat`/`CompactPanel`/`SectionHeader` from `common/` + extracted `SectionHeader` to `common/SectionHeader.tsx:1` and updated real `AggregatedDashboard.tsx:23` to use it | ✅ Fixed |
| Detail View generic chrome not looking like app | `Detail.stories.tsx` used fake `DetailChrome` for News/Bot | Now uses exact `ArticleDetail` (with `NewsItem` mock) and `BotStatusPanel` (with `BotConfig`/`BotStatus` mock) | ✅ Fixed |
| Hardcoded hex outside `palette.ts` | `style.css:194` etc. had `var(--mantine-color-dark-6)` not `palette.ts` — actually correct (Mantine vars), only `palette.ts` raw hex is allowed | No fix needed — `style.css` correctly uses `var(--mantine-color-*)` | ✅ |
| `body { overflow:hidden }` killing Storybook scroll | `src/style.css:42`, `preview.tsx` fix | Injected `body.sb-show-main { overflow:auto !important }` in `preview.tsx:12` + `layout: "centered"` → `padded` tuning | ✅ Fixed |
| `UINavLinkProps` missing `leftSection` | `src/ui/types.ts:455` | Added `leftSection?: ReactNode` + `icon` backwards compat | ✅ Fixed |
| `UIAppShellProps` wrong `collapsed` shape | `src/ui/types.ts:471` | Now `collapsed?: boolean | { mobile, desktop }` per Mantine docs | ✅ Fixed |

**Build verification:** `build-storybook` → **completed** (358 stories), `tsc` → clean on stories, `vitest` → 4395 passed.

---

## What remains to reach "every single page and component"

- **Isolated stories for 4 high-reuse feature components** (optional, for per-component visual regression): `BotStatusPanel2`, `PaperChart2`, `NewsList`, `ReplayChart` — currently only via page templates. Add `Composites/*` stories if you want Chromatic to snapshot them individually.
- **CI wiring:** `storybook test --ci` for interaction + a11y (already prepared via `Select` exemplar) and Chromatic publish — not yet in `.github/workflows/test.yml`.

Say **commit** to push the heatmap + provider fixes as one batch, or tell me which of the 4 isolated component stories to add next.
