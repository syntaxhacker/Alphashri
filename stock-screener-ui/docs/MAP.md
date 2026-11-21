# MAP — where to go to do X

One screen. Every path below was checked to exist. Read this before grepping the tree.

**New here / new agent?** Start with [`AGENT_QUICKSTART.md`](./AGENT_QUICKSTART.md) (commands, folder map, unit/E2E/backend recipes).

## Stack (verified in `package.json`)

SolidJS `1.9.19` · Vite `8` · Tailwind `4.3.5` (`@tailwindcss/vite`) · TypeScript `5.7.3` ·
`@solidjs/router 1.0.3` · vitest 4 · Playwright 1.58.
No React, no Redux, no MUI/Mantine — `src/test/no-react.test.ts` fails the build if a React-era import
reappears (`react` in `bun.lock` is only a transitive peer of `@storybook/icons` / `use-sync-external-store`).

## Task → location

| I want to… | Go to |
| --- | --- |
| Add/change a route | `src/App.tsx` — routes registered inside `<Router>`; all 27 pages are `lazy()`-loaded from `./pages/` (none from `./components/`) |
| Page entry | `src/pages/<feature>/` — seven are thin `index.tsx` re-exports whose implementations live in `src/components/<feature>/` |
| Render a table | `src/components/common/TanStackTable.tsx` (sticky header, dense rows, `TableColumnDef`) |
| Column definitions | `src/components/table/columns/index.tsx` (`symbolColumn` / `numColumn` / `textColumn` / `badgeColumn` / `sparkColumn`); screener variants in `src/components/screener/columns/`; otherwise inline `TableColumnDef[]` beside the consumer |
| Cells (number/text/symbol/badge) | `src/components/common/tableCells.tsx` (`NumCell`, `TextCell`, `SymbolCell`, `BadgeCell`) |
| Active-filter status band | `src/components/common/FilterStatusRow.tsx` — always-mounted 24px chip row with placeholder + Clear all (no mount jump) |
| Panels / stats | `src/components/common/compact.tsx` (`CompactPanel`, `CompactStat`, `CompactStatGrid`) |
| Options analytics tabs | `src/components/options-dock/analytics/` — `AnalyticsTabStrip` (PAYOFF/SMILE/TERM/SURFACE/PROB), `AnalyticsPanel`, `SmilePanel`, `TermPanel`, `SurfacePanel`, `ProbPanel` |
| Design tokens / colours | `src/ui/palette.ts` — single source; mirrored into `src/tailwind.css` `@theme` (guard: `src/test/theme-single-source.test.ts`). Never a raw hex. Side/level semantics: `docs/COLOR_SEMANTICS.md` |
| Currency / units (₹ vs $, Cr vs B) | `src/config/currency.ts` — `CURRENCIES`, `currencyFor()`; formatters read the row's `currency`, never the screen name |
| Market universe / cap-tier descriptor | `src/config/marketUniverses.ts` — FE mirror of `api/market_screen/config.py`; one descriptor per universe (incl. `us`) |
| Options limits (expiries / surface strikes) | `src/config/optionsAnalytics.ts` — `ANALYTICS_DEFAULT_EXPIRIES` (3), `ANALYTICS_MAX_EXPIRIES` (6), `SURFACE_MAX_STRIKES` (21) |
| Frontend request caps (market / value) | `src/config/apiLimits.ts` — `MARKET_ROW_CAP` (4000), `MARKET_SYMBOL_CAP` (20), `VALUE_ROW_CAP` (100); limits the FE actually sends on the wire |
| UI primitives | `src/ui/` (barrel `src/ui/index.ts`): `Box/Flex/Stack/Group/Grid/Paper/Card/...`, `inputs/`, `layout/` |
| API call | `src/api/*.ts` — one file per feature (52 non-test files) |
| Global state | `src/state/*.ts` via `src/state/createSubscriber.ts` + `src/hooks/useStoreSubscription.ts` |
| "Redux" slices | `src/state/store/` — Solid `createStore`, *not* Redux (no `react-redux`) |
| Shared hook | `src/hooks/` |
| Pure helper | `src/utils/` |
| Type | `src/types/` |
| Feature component | `src/components/<feature>/` |
| Test | co-located `*.test.ts(x)`; E2E in `tests/e2e/*.spec.ts` (57 specs) |

## Disambiguation — things named "patterns"

| Path | What it actually is |
| --- | --- |
| `src/components/patterns/` | The **chart-pattern feature UI** (`PatternListView`, `PatternGrid`, `PatternChartBody`, `PatternFullscreenView`, …). |
| `src/pages/patterns/` | The **chart-pattern route** (`PatternsContainer.tsx`, `PatternsPage.tsx`, `patternsFullscreen.ts`). |

The old `src/patterns/` folder (12 GoF demo modules + `index.ts` barrel) is deleted. Its two non-demo contents were relocated:
- Inline-SVG Tabler icons → `src/ui/icons.tsx` (import `@/ui/icons`)
- Test-only `@/ui` stand-in → `src/test-utils/solidUiMock.tsx` (import `@/test-utils/solidUiMock`; tests only)

`@/ui/icons` is **not** the chart-pattern feature. `solidUiMock` is **not** product UI — never import it from non-test code.

## Known traps

- **`2` suffix — gone.** The 11 `*2.tsx` sources and 12 `*2.test.tsx` tests were renamed to their
  un-suffixed names (`AuthProvider`, `LoginForm`, `SectorPage`, `PaperTradingView`, `PaperChart`,
  `PaperHistoryTable`, `PaperPositionsTable`, `WatchlistScan`, `BotConfigModal`, `BotStatusPanel`,
  `NewsPanel`); no `*2` file remains under `src`. Barrels (`components/paper-trading/index.ts`,
  `components/bots/components.ts`) and `src/App.tsx` now point at the clean names.
- **Layering inversion.** `src/components/**` importing `src/pages/**` already happens in
  `StrategyRunnerTabs.tsx`, `PatternListView.tsx`, `SymbolDockProvider.tsx`, `MarketMapView.tsx`
  (plus tests). Do not add more — move the helper down into `src/utils/` instead.
- **`AGENTS.md` is 702 lines** and mostly backend/strategy lore. UI rules live separately:
  `UI_RULES.md` (81), `UI_CHECKLIST.md`, `LAYOUT_CONTRACT.md` (84), `SUBAGENT_RULES.md` (407),
  `TEST_RULES.md` (694).
- **No `*.columns.ts` files.** Columns are factories (`components/table/columns`) or inline arrays;
  don't hunt for a `*.columns.ts` beside the consumer.
- **Two icon modules — import from `src/components/common/Icons.tsx`.** The canonical set is
  `src/components/common/Icons.tsx` (25 KB, generic `<Icon name="…" />` registry, 45 importers).
  `src/ui/icons.tsx` (5.5 KB, 18 importers) holds the inline-SVG Tabler components used by `@/ui`
  (native Solid components, not React `forwardRef`). There is **no** `src/patterns/icons.tsx` —
  the old GoF demo folder is deleted. Do not add a third copy.
- **`components/bots` barrel is `components.ts`,** not `index.ts`.

## Read the minimum

- **Route inventory + the `*2` rename plan**: `docs/ROUTE_SURFACE_AUDIT.md` (current routes, where
  each page component lives, and the 49-edit rename plan) — read it before moving or renaming a page.
- **No-jump layout geometry**: `docs/LAYOUT_INVARIANTS.md` — measured 24px filter/status rows and
  table tops (market/screener) plus the conditionally-mounted `SymbolChips` case; read before moving
  a header/filter band or changing row mount logic (E2E asserts 24px + Δ ≤ 1px).
- **API shape**: `openapi.yaml` at the repo root (12.7k lines, generated — never hand-edit) or live
  `/openapi.json`. Do not read `api/**/*.py` routers to discover endpoints; only open one when the
  schema is incomplete.
- **Market-screen descriptors**: `api/market_screen/config.py` — canonical `UniverseSpec` /
  `UNIVERSES` / `ALLOWED_UNIVERSES` + cap tiers; FE mirror `src/config/marketUniverses.ts`.
- **Options conventions + analytics**: `api/options_conventions.py` — single owner of IV/near-band/
  GEX/coverage-floor/lot constants (consumers import, never restate); `api/options_analytics.py` —
  `GET /api/options/analytics/{underlying}` (3 default / 6 max expiries), mirrored by
  `src/config/optionsAnalytics.ts` on the FE.
- **Client wrapper**: `src/api/<feature>.ts` — typed functions over `fetchWithAuth` (exported from
  `src/state/auth.ts`); the schema tells you the shape, the client file tells you how the UI calls it.
- **Backend behaviour after the call shape is known**: `api/<feature>/router.py` for feature packages,
  or a flat `api/<name>.py` module.
- **Night work summary**: `docs/NIGHT_WORK_SUMMARY.md` — docs-only handoff (2026-11-17) recapping the night's plan-doc updates and test runs.
