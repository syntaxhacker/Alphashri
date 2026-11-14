# MAP — where to go to do X

One screen. Every path below was checked to exist. Read this before grepping the tree.

## Stack (verified in `package.json`)

SolidJS `1.9.19` · Vite `8` · Tailwind `4.3.5` (`@tailwindcss/vite`) · TypeScript `5.7.3` ·
`@solidjs/router 1.0.3` · `@tanstack/solid-table 9.3.1` · vitest 4 · Playwright 1.58.
No React, no Redux, no MUI/Mantine — `src/test/no-react.test.ts` fails the build if a React-era import
reappears (`react` in `bun.lock` is only a transitive peer of `@storybook/icons` / `use-sync-external-store`).

## Task → location

| I want to… | Go to |
| --- | --- |
| Add/change a route | `src/App.tsx` — routes registered inside `<Router>`; pages are `lazy()`-loaded (20 from `./pages/`, 7 from `./components/`) |
| Page entry | `src/pages/<feature>/` — **exception:** 7 routes live in `src/components/` (list below) |
| Render a table | `src/components/common/TanStackTable.tsx` (sticky header, dense rows, `TableColumnDef`) |
| Column definitions | `src/components/table/columns/index.tsx` (`symbolColumn` / `numColumn` / `textColumn` / `badgeColumn` / `sparkColumn`); screener variants in `src/components/screener/columns/`; otherwise inline `TableColumnDef[]` beside the consumer |
| Cells (number/text/symbol/badge) | `src/components/common/tableCells.tsx` (`NumCell`, `TextCell`, `SymbolCell`, `BadgeCell`) |
| Panels / stats | `src/components/common/compact.tsx` (`CompactPanel`, `CompactStat`, `CompactStatGrid`) |
| Design tokens / colours | `src/ui/palette.ts` — single source; mirrored into `src/tailwind.css` `@theme` (guard: `src/test/theme-single-source.test.ts`). Never a raw hex |
| UI primitives | `src/ui/` (barrel `src/ui/index.ts`): `Box/Flex/Stack/Group/Grid/Paper/Card/...`, `inputs/`, `layout/` |
| API call | `src/api/*.ts` — one file per feature (48 non-test files) |
| Global state | `src/state/*.ts` via `src/state/createSubscriber.ts` + `src/hooks/useStoreSubscription.ts` |
| "Redux" slices | `src/state/store/` — Solid `createStore`, *not* Redux (no `react-redux`) |
| Shared hook | `src/hooks/` |
| Pure helper | `src/utils/` |
| Type | `src/types/` |
| Feature component | `src/components/<feature>/` |
| Test | co-located `*.test.ts(x)`; E2E in `tests/e2e/*.spec.ts` (45 specs) |

**Routes whose entry component lives under `src/components/`** (from `src/App.tsx`):
`/sector` → `components/sector/SectorPage2` · `/backtest` → `components/backtest` · `/experiments` →
`components/experiments/ExperimentsPage` · `/paper` → `components/paper-trading` · `/replay` →
`components/replay` · `/strategy-runner` → `components/strategy-runner` · `/bots` → `components/bots/components`.
Everything else (`/`, `/options`, `/report/*`, `/settings`, `/news`, `/admin`, `/agri`,
`/orderflow`, `/patterns`, `/chart/:symbol?`, `/poc/*`) resolves under `src/pages/`.

## Disambiguation — three things named "patterns"

| Path | What it actually is |
| --- | --- |
| `src/patterns/` | **Textbook GoF demos** — `adapter builder command decorator facade factory iterator observer proxy singleton state strategy` + `index.ts` barrel. Alias `@/patterns` resolves here. |
| `src/patterns/icons.tsx` | Inline-SVG **Tabler icon re-implementations** as Solid components (the React build used `forwardRef`, which Solid cannot call). |
| `src/patterns/solidUiMock.tsx` | **Test-only** stand-in for `@/ui`, imported by 60 `*.test.tsx`. Not product UI. |
| `src/components/patterns/` | The **chart-pattern feature UI** (`PatternListView`, `PatternGrid`, `PatternChartBody`, `PatternFullscreenView`, …). |
| `src/pages/patterns/` | The **chart-pattern route** (`PatternsContainer.tsx`, `PatternsPage.tsx`, `patternsFullscreen.ts`). |

`@/patterns/icons` is **not** the chart-pattern feature. `solidUiMock` is **not** product UI — never import it from non-test code.

## Known traps

- **`2` suffix, no v1.** 11 files end in `2` and no un-suffixed sibling exists:
  `AuthProvider2`, `LoginForm2` (`components/auth`), `SectorPage2` (`components/sector`),
  `PaperTradingView2`, `PaperChart2`, `PaperHistoryTable2`, `PaperPositionsTable2`, `WatchlistScan2`
  (`components/paper-trading`), `BotConfigModal2`, `BotStatusPanel2` (`components/bots`),
  `NewsPanel2` (`components/news`). The `2` is historical — do not create a v1 sibling, and don't
  "fix" the name; barrels such as `components/paper-trading/index.ts` re-export it under the clean name.
- **Layering inversion.** `src/components/**` importing `src/pages/**` already happens in
  `StrategyRunnerTabs.tsx`, `PatternListView.tsx`, `SymbolDockProvider.tsx`, `MarketMapView.tsx`
  (plus tests). Do not add more — move the helper down into `src/utils/` instead.
- **`AGENTS.md` is 637 lines** and mostly backend/strategy lore. UI rules live separately:
  `UI_RULES.md` (81), `UI_CHECKLIST.md`, `LAYOUT_CONTRACT.md` (84), `SUBAGENT_RULES.md` (350),
  `TEST_RULES.md` (687).
- **No `*.columns.ts` files.** Columns are factories (`components/table/columns`) or inline arrays;
  don't hunt for a `*.columns.ts` beside the consumer.
- **Two icon modules, 20 identical export names.** `src/components/common/Icons.tsx` (25 KB, 78
  importers, generic `<Icon name="…" />` registry) is the canonical set — import from here. 
  `src/patterns/icons.tsx` (5.5 KB, 18 importers, `makeIcon` factory) is a partial duplicate that
  lives in the GoF demo folder; `IconActivity`, `IconAlertCircle`, `IconBolt`, `IconX` and 16 others
  exist in both. Do not add a third copy, and do not assume the `patterns/` one is the product set.
- **`components/bots` barrel is `components.ts`,** not `index.ts`.

## Read the minimum

- **Route inventory + the `*2` rename plan**: `docs/ROUTE_SURFACE_AUDIT.md` (current routes, where
  each page component lives, and the 49-edit rename plan) — read it before moving or renaming a page.
- **API shape**: `openapi.yaml` at the repo root (12.7k lines, generated — never hand-edit) or live
  `/openapi.json`. Do not read `api/**/*.py` routers to discover endpoints; only open one when the
  schema is incomplete.
- **Client wrapper**: `src/api/<feature>.ts` — typed functions over `fetchWithAuth` (exported from
  `src/state/auth.ts`); the schema tells you the shape, the client file tells you how the UI calls it.
- **Backend behaviour after the call shape is known**: `api/<feature>/router.py` for feature packages,
  or a flat `api/<name>.py` module.
