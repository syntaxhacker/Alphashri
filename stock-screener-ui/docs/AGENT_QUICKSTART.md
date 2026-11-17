# Agent quickstart

Read this first. It replaces exploratory reading of the repo.

- **Repo map:** `docs/MAP.md`
- **Test rules:** `TEST_RULES.md`
- **UI rules:** `UI_RULES.md`, `../TABLE_CHECKLIST.md` (workspace root), `docs/COLOR_SEMANTICS.md`, `docs/LAYOUT_INVARIANTS.md`
- **API contract:** `openapi.yaml` (read this before opening `api/**/*.py`)
- **Night work summary:** `docs/NIGHT_WORK_SUMMARY.md` (docs-only handoff, 2026-11-17)

## 1. Commands

| Task | Command |
|---|---|
| Frontend unit (one file) | `npx vitest run src/path/File.test.tsx` |
| Frontend unit (touched only) | `npx vitest run --changed` |
| E2E (one/few specs) | `npx playwright test tests/e2e/foo.spec.ts --reporter=line --workers=2 --output=/tmp/opencode/pw-foo` |
| Backend (one/few files) | `source .venv/bin/activate && CI_MODE=1 python -m pytest tests/api/test_x.py -q` |
| Lint touched files | `npx oxlint <files>` |
| Full lint gate | `bun run lint` |
| Type baseline | `npx tsc --noEmit 2>&1 \| grep -c "error TS"` (322; must not rise) |
| Build (main agent) | `bun run build` |
| Contrast gate | `bun run contrast` |
| UI guards | `npx vitest run src/test/ui-guard.test.ts src/test/design-scale.test.ts src/test/theme-single-source.test.ts src/ui/inputs/inputs.w-h.test.tsx` |

Never run the full unit suite or the full E2E suite locally. CI owns those.

## 2. Folder map

```
src/
  api/          one client per feature (typed fetch wrappers)
  components/   feature UI; common/ holds shared widgets
  pages/        route entry points
  state/        subscriber stores / createStore slices
  hooks/        reusable hooks
  config/       constants, descriptors, palette-adjacent config
  ui/           local design system + palette.ts (single colour source)
  utils/        pure helpers
  test/         repo guards (edit rules carefully)
api/            FastAPI routers and services
tests/api/      backend API tests
tests/e2e/      Playwright specs
tests/e2e/helpers/  page flows (flowsB, backtestHelpers, tableHelpers, ...)
tests/mocks/    shared Playwright fixtures (apiResponses.ts, routeHelper.ts)
docs/           plans, contracts, this file
```

Find a route/page with `docs/MAP.md` + `rg "<route>" src`. Do not walk `src/pages` or `api/` end-to-end.

## 3. Unit tests

- Co-located: `src/**/*.test.ts(x)` beside the source, same basename.
- Render the **real** `@/ui`; mock only boundaries (`fetch`, auth, router, echarts).
- Assert one visible/observable thing: text, computed class/token, callback argument, URL, thrown error.
- Do not add `waitForTimeout`, `sleep`, or snapshot-the-whole-component tests.
- `bun test` lacks `vi.mock`; always use `npx vitest run`.

```tsx
render(() => <Component symbol="RELIANCE" />);
expect(await screen.findByTestId("thing")).toHaveTextContent("...");
```

## 4. E2E tests

Specs live in `tests/e2e/*.spec.ts`. Most are **fully mocked** — no backend needed.

```ts
import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

test("feature behaviour", async ({ page }) => {
  await loginAsTestUser(page);
  await setupApiMocks(page);
  await page.goto("/screener/market");
  await expect(page.getByTestId("market-row-RELIANCE")).toBeVisible();
});
```

Useful fixtures:

- `tests/mocks/apiResponses.ts`: `setupApiMocks`, `loginAsTestUser`, `setupOptionDockMocks`, `setupFnoScreenerMocks`, `setupUserConfigMocks`, `setupValueScanMocks`, `setupNiftyReportMocks`, …
- `tests/mocks/routeHelper.ts`: `apiRoute`.
- `tests/e2e/helpers/flowsB.ts`: `setupScreenerApp`, `openScreenerTable`, `runBacktest`, `collectConsoleErrors`.
- `tests/e2e/helpers/backtestHelpers.ts`, `tableHelpers.ts`, `chartHelpers.ts`, `botHelpers.ts`.
- Spec-local `mock*` functions are fine for one-off routes.

Rules:

- Prefer `data-testid` selectors; add one to source if missing (feature lane, not test-only lane).
- Wait on the app, not the clock: `expect.poll`, `waitForResponse`, `toBeVisible`; **no `waitForTimeout`**.
- E2E auth is seeded by `loginAsTestUser` (`addInitScript`), not a global setup.
- Always pass a file filter, `--workers=2` or `4`, and `--output=/tmp/opencode/pw-<name>`.
- `tests/e2e/backtest-features.spec.ts` and `all-strategies-backtest.spec.ts` have known stale-selector failures; do not chase them unless the task touches those screens.

## 5. Backend tests

- Location: `tests/api/` (or `tests/**/test_*.py`), pytest.
- Use `CI_MODE=1` for API app tests; never point at `db/alphashri.db`.
- In-memory SQLite via the `test_engine` fixture; never write the real DB.
- Target the files you touched; full backend suite is CI-only.
- If a route/schema changes, regenerate `openapi.yaml` and run the contract test:

```bash
.venv/bin/python scripts/export_openapi.py
source .venv/bin/activate && CI_MODE=1 python -m pytest tests/contract/test_openapi_sync.py -q
```

## 6. Task routing

| Ask | Start at |
|---|---|
| Add/fix an API endpoint | `openapi.yaml` → the tag’s router → its test |
| Add a page/route | `docs/MAP.md` → nearest `src/pages/<feature>` |
| Change a table | `../TABLE_CHECKLIST.md` → `TanStackTable` / `tableCells` |
| Change colours | `docs/COLOR_SEMANTICS.md` → `src/utils/contrast.ts` |
| Change layout height/spacing | `docs/LAYOUT_INVARIANTS.md` |
| Add a chart | nearest `components/<feature>` + `loadEcharts` mock in unit tests |
| Open the Options Analytics dashboard (`/options/analytics/:symbol`) | `docs/OPTIONS_ANALYTICS_PLAN.md` → `src/pages/options/OptionsAnalyticsPage.tsx` → pillar tabs in `src/components/options-dashboard/` |
| Chart a US symbol (`/chart/:symbol?market=usa`) | `src/pages/chart/ChartView.tsx` → `market=usa` feed selector in `src/api/chartPatterns.ts` |
| Change the Market Value view (`Table / Map / Movers / Value`) | `docs/market-screener.md` → `src/components/market/MarketMapView.tsx` → lazy `ValuePanel` in `src/components/value/` |
| Add E2E coverage | copy the closest `tests/e2e/*.spec.ts` + fixtures above |

## 7. Reading budget

- Read the target file, its test, and at most one shared helper.
- Use `rg`/`grep` to locate; do not read whole directories.
- Never inspect `app.routes` to discover endpoints — use `openapi.yaml`.
- If a helper already exists for the flow, use it; do not re-derive mocks.
- Return: files changed, exact test command, pass/fail counts, blockers.
