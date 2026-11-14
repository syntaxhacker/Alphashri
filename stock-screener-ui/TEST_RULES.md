# Test Rules — stock-screener-ui

## Stack
- **Unit/component**: Vitest + `@solidjs/testing-library` + happy-dom (the React adapter is gone — see `SOLID_MIGRATION.md`)
- **E2E**: Playwright (`tests/e2e/`)
- **Backend**: pytest (`tests/`)

---

## 0. No weak tests — the rule that outranks everything else

A test earns its place only if it **can fail**. Before committing a test, ask: *what change
would break this?* If the answer is "nothing plausible", delete it.

### Forbidden (each was a real defect that survived the suite)

| Anti-pattern | Why it is weak | Do instead |
|---|---|---|
| `expect(el).toBeInTheDocument()` as the only assertion | proves mount, not behaviour | assert the value/colour/class that matters |
| asserting on an exact call count under fake timers | races; observes 2–4 instead of 1 | assert the settled state, or state the contract explicitly |
| `vi.mock("@/ui")` in a page/feature test | the stub drops `c`/`fw`/`tt`/`size`, so a colour or typography regression **cannot fail** | render the real `@/ui`; it is local, dependency-free and fast |
| a regression test that passes **before** the fix | proves nothing | prove it fails on the old code (revert via a `/tmp` copy, never `git checkout`) |
| `expect(fn).toHaveBeenCalled()` when the argument matters | ignores the payload that caused the bug | assert the argument (`mock.calls[0][0]`) |
| snapshot of an entire component | noisy, hides intent, breaks on styling | assert the specific invariants |
| `toHaveStyle({ color: "..." })` against a mocked primitive | the mock never applies it | assert `className` contains the palette token, or render the real primitive |
| "it renders" / "does not throw" | a blank page also does not throw | assert observable output |
| a mock that **ignores its argument** (`buildUrl: () => "/x?screener=test"`) | the parameter that caused the bug is unobservable, so "wrong screener" passes | reflect the argument: `(o) => \`/x?screener=${o.screener}\`` |
| a mock that **drops the distinguishing prop** (`c`/`fw`/`tt`/`size`/`style`) | the regression cannot fail, which is the only reason the test exists | forward the prop, or render the real primitive |
| pinning a **literal hex/value** that the source derives | the assertion breaks on a legitimate re-theme and passes while the derivation is wrong | assert the derivation: `expect(TINT).toBe(alpha(POSITIVE, 0.12))` |
| accepting a "known flake" as a fixture | 1-in-3 red trains everyone to re-run until green, which hides real failures | find the shared-state or over-specified assertion; a flake is a bug |

### Required shape

Every behaviour test asserts **one of**: rendered text, a computed class/token, an emitted
callback argument, a URL/param the code built, or a thrown error message. Nothing else counts.

### Deterministic, not merely tolerant

- No `waitFor` around something that is synchronous.
- No `sleep`/`setTimeout` in a test body.
- Fake timers: advance by an explicit duration, then assert the **settled** result.
- If a test only passes with `--no-file-parallelism`, it is broken — fix the shared state, do
  not serialise the runner.
- Proving determinism: run the file **10 consecutive times**; all 10 green.

### One assertion per concern

A test named "renders the table" may assert headers, row count and a cell value — but when it
fails the name must tell you which invariant broke. Split when the name stops being true.

---

## 1. What to mock, and what never to

**Mock the boundary, never the design system.**

| Mock | Verdict |
|---|---|
| `fetch` / `fetchWithAuth` / any HTTP | **yes** — a unit test must not hit the network |
| `@solidjs/router` (`useNavigate`, `useSearchParams`) | **yes** — routing is out of scope |
| auth / session / token refresh | **yes** |
| `echarts`, `lightweight-charts` (`@/utils/loadEcharts`) | **yes** — canvas is not inspectable in happy-dom |
| `@/ui` primitives, `components/common/*` | **NO** — render the real component |
| the module under test | **never** — you would be testing the mock |

When you mock `@/ui` you are asserting against a component that does not exist in
production. `src/pages/solidTestStubs.tsx` normalises `class`/`style`/`data-*` and **drops**
`c`, `fw`, `tt`, `size`, `truncate`. That is precisely how `tt="uppercase"` shipped broken on
34 labels and how `c="success"` stopped colouring after a `class=` override.

Existing `@/ui` mocks are debt: retire one when you touch the file. Do not add new ones.

---

## 2. Running tests

- `npx vitest run <file>` — single file. **Always prefer this.** (`bun test` lacks `vi.mock`.)
- `npx vitest run --changed` — touched files only, for a quick loop.
- `bun run test` — the whole suite. **CI only.** Locally it starves the API/tape writer during
  market hours and takes >15 min, which is how tests stop being run at all.
- Playwright: always pass a file filter. `--workers=4`, `--output=/tmp/...`.

### Skip-suite env vars (pre-commit hooks)

```bash
SKIP_PYTHON=1 git commit ...      # doc-only / frontend-only
SKIP_UI=1 git commit ...          # backend-only
SKIP_PYTHON=1 SKIP_UI=1 git commit ...
```

Never use these to hide a failure — only to skip suites your diff cannot affect.

---

## 3. File conventions

- Co-located: `src/**/*.test.ts(x)` beside the source, same basename.
- A pure helper's tests live beside the helper, not beside its consumer.
- E2E in `tests/e2e/*.spec.ts`.
- Backend in `tests/**/test_*.py`.

---

## 4. Guards that must stay green

These encode rules that are otherwise invisible in review. Fix the source, **never** the
guard, and never add an allowlist entry without deleting another.

```bash
npx vitest run src/test/style-keys.test.ts          # kebab-case style keys + px strings
npx vitest run src/test/no-props-destructure.test.ts # Solid props are getters
npx vitest run src/test/numeric-typography.test.ts   # mono + tabular on every number
npx vitest run src/test/table-structure.test.ts      # column-declaration baseline (shrinks)
npx vitest run src/test/ui-guard.test.ts             # no Mantine styles={{}}
npx vitest run src/test/theme-single-source.test.ts  # no hardcoded hex
npx vitest run src/test/design-scale.test.ts         # radius / control height / icon size / type floor / focus ring
npx vitest run src/ui/inputs/inputs.w-h.test.tsx     # w/h honoured
```

An allowlist entry is a **promise to remove it**. If you cannot say when, do not add it.


#### API Mock Pattern — Use `apiRoute()` for localhost:8765 endpoints

**NEVER use broad glob patterns like `**/api/...`** — they accidentally intercept Vite module requests for files in `src/api/`, causing blank white pages because the browser receives JSON instead of JavaScript.

**BAD:**
```typescript
await page.route("**/api/auth/me", handler)  // Matches src/api/auth.ts too! ❌
```

**GOOD:**
```typescript
import { apiRoute } from "../mocks/routeHelper";

await page.route(apiRoute("auth/me"), handler)  // Only matches localhost:8765/api/auth/me ✅
```

The `apiRoute()` helper (in `tests/mocks/routeHelper.ts`) generates a regex that matches **only** `localhost:8765` API routes, preventing the Vite module interception bug. It also supports wildcards:

```typescript
apiRoute("news/*/articles")     // matches /api/news/RELIANCE/articles
apiRoute("bots/[a-f0-9-]+/scan") // dynamic segments preserved as regex
```

All Playwright tests should use `apiRoute()` for every `localhost:8765` API endpoint mock.

## Import Conventions

```typescript
// Unit test header — always include these
// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

- **`@testing-library/jest-dom/vitest`** — required for `toBeInTheDocument()`, `toBeVisible()`, etc.
- **`userEvent`** — always use over `fireEvent` (it simulates real browser interactions)
- **`within`** — scope queries to a parent element to avoid false matches

## Setup Patterns

```typescript
// Wrapper for components that need the app shell
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// Render helper — keeps calls concise
function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

afterEach(() => {
  cleanup();
  // Reset any module-level mutable state
});
```

## Mock Patterns

### Mocking Store Modules
```typescript
let currentState: PaperTradingState = createMockState();

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => currentState),
  subscribe: vi.fn(() => vi.fn()),
  setSelectedSymbol: vi.fn(),
  // ...other exported functions
}));

function setState(overrides: Partial<PaperTradingState>) {
  currentState = createMockState(overrides);
}

function resetState() {
  currentState = createMockState();
}
```

### Mocking API Modules
```typescript
vi.mock("../../api/paperTrading", () => ({
  fetchPaperChart: vi.fn().mockResolvedValue(undefined),
  closePaperPosition: vi.fn().mockResolvedValue(undefined),
}));
```

### Mocking React Router
```typescript
vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useLocation: vi.fn(() => ({ pathname: "/" })),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
```

### Accessing Mock References in Tests
```typescript
// Use dynamic import to get the live mock function reference
test("clicking row calls setSelectedSymbol", async () => {
  const { setSelectedSymbol } = await import("../../state/paperTrading");
  await user.click(screen.getByTestId("scan-signal-RELIANCE"));
  expect(setSelectedSymbol).toHaveBeenCalledWith("RELIANCE");
});
```

### Overriding Mocks for Specific Tests
```typescript
import { fetchPaperChart } from "../../api/paperTrading";

// Inside a specific test:
vi.mocked(fetchPaperChart).mockRejectedValueOnce(new Error("Network error"));
```

### Mocking UI Components
Some UI components require context or render in portals. For isolated unit tests, mock these components to simple HTML elements (pattern below shows the shape — adapt the import path to the current `@/ui` wrapper):

```typescript
// Mock at the top of your test file (before component imports)
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Mock Table with context-free versions
    Table: ({ children }: any) => <table>{children}</table>,
    Table.Tr: ({ children, ...rest }: any) => <tr {...rest}>{children}</tr>,
    Table.Td: ({ children, 'data-testid': testId, ...rest }: any) => (
      <td data-testid={testId} {...rest}>{children}</td>
    ),
    // Mock SegmentedControl as radio group for easier event testing
    SegmentedControl: ({ value, onChange, data, 'data-testid': testId, ...rest }: any) => (
      <div data-testid={testId} role="radiogroup">
        {data.map((opt: any) => (
          <label key={opt.value}>
            <input
              type="radio"
              name={testId}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange?.(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    ),
    // Mock Select as native <select>
    Select: ({ value, onChange, data, 'data-testid': testId, ...rest }: any) => (
      <select data-testid={testId} value={value} onChange={(e) => onChange?.(e.target.value)} {...rest}>
        {data.map((opt: any) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    ),
    // Mock Tooltip to render label inline (no portal)
    Tooltip: ({ label, children, ...rest }: any) => (
      <div data-tooltip-label={label}>{children}</div>
    ),
  };
});
```

**Key principles:**
- Spread `...actual` to keep the rest of the `@/ui` exports intact
- Only override components that cause testing issues (context, portals)
- Preserve `data-testid` props so tests can still query elements
- For `SegmentedControl`/`RadioGroup`, expose `data-testid` on individual options if needed

## Chart Data Test Patterns

### Never store large candle arrays as JSON/inline data
Generate candle data programmatically instead. This keeps tests readable and avoids bloated mock files.

### Programmatic candle generation

Create a shared helper in `tests/helpers/` that both unit and E2E tests can use:

```typescript
// tests/helpers/chartTestHelpers.ts
import dayjs from "dayjs";

export function round(n: number, decimals: number): number {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function generateCandles(
  symbol: string,
  fromDate: string,
  toDate: string,
  intervalMin: number = 5,
): CandleData[] {
  const candles: CandleData[] = [];
  let price = 2500;
  let current = dayjs(fromDate);
  const end = dayjs(toDate);

  while (current.isBefore(end) || current.isSame(end, "day")) {
    const open = price;
    const close = open + (Math.random() - 0.48) * 10;
    const high = Math.max(open, close) + Math.random() * 5;
    const low = Math.min(open, close) - Math.random() * 5;
    candles.push({
      time: current.format("YYYY-MM-DDTHH:mm:ss"),
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      close: round(close, 2),
      volume: Math.floor(100000 + Math.random() * 500000),
    });
    price = close;
    current = current.add(intervalMin, "minute");
  }
  return candles;
}

export function mockPosition(overrides?: Partial<PaperPosition>): PaperPosition {
  return {
    symbol: "NESTLEIND",
    side: "BUY",
    quantity: 100,
    entry_price: 1437.70,
    current_price: 1467.50,
    entry_time: "2026-04-28T09:30:00",
    stop_loss: 1416.13,
    take_profit: 2875.40,
    pnl: 2980,
    pnl_pct: 2.07,
    margin_used: 143770,
    order_id: "ord-1",
    strategy_id: 1,
    strategy_name: "ORB Strategy",
    ...overrides,
  };
}
```

### Scenario presets

Export named scenarios for common test situations. Each scenario is a function that returns a full mock response:

```typescript
// tests/helpers/chartTestHelpers.ts
export const CHART_SCENARIOS = {
  oneDayNoPosition: () => ({
    symbol: "RELIANCE",
    date: "2026-04-29",
    candles: generateCandles("RELIANCE", "2026-04-29", "2026-04-29"),
    trades: [],
    current_position: null,
    orb_levels: null,
    week52_levels: null,
    pivot_levels: null,
  }),

  multiDayWithPosition: () => ({
    symbol: "NESTLEIND",
    date: "2026-04-28",
    candles: generateCandles("NESTLEIND", "2026-04-21", "2026-04-28"),
    trades: [
      {
        trade_id: "t1",
        symbol: "NESTLEIND",
        side: "BUY",
        entry_price: 1437.70,
        exit_price: 1467.50,
        entry_time: "2026-04-28T09:30:00",
        exit_time: "2026-04-28T15:00:00",
        quantity: 100,
        pnl: 2980,
        net_pnl: 2900,
        costs: 80,
        exit_reason: "TP",
        strategy_id: 1,
        strategy_name: "ORB Strategy",
      },
    ],
    current_position: {
      symbol: "NESTLEIND",
      side: "BUY",
      quantity: 100,
      entry_price: 1437.70,
      current_price: 1467.50,
      entry_time: "2026-04-28T09:30:00",
      stop_loss: 1416.13,
      take_profit: 2875.40,
      pnl: 2980,
      pnl_pct: 2.07,
      margin_used: 143770,
      order_id: "ord-1",
      strategy_id: 1,
      strategy_name: "ORB Strategy",
    },
    orb_levels: null,
    week52_levels: null,
    pivot_levels: null,
  }),

  tradeWithStopLossHit: () => ({
    symbol: "TATASTEEL",
    date: "2026-04-28",
    candles: generateCandles("TATASTEEL", "2026-04-28", "2026-04-28"),
    trades: [
      {
        trade_id: "t2",
        symbol: "TATASTEEL",
        side: "BUY",
        entry_price: 180,
        exit_price: 175,
        entry_time: "2026-04-28T09:30:00",
        exit_time: "2026-04-28T11:00:00",
        quantity: 500,
        pnl: -2500,
        net_pnl: -2550,
        costs: 50,
        exit_reason: "SL",
        strategy_id: 2,
        strategy_name: "52W Chaser",
      },
    ],
    current_position: null,
    orb_levels: null,
    week52_levels: { high_52w: 220, low_52w: 140, distance_to_high_pct: 18.2, distance_to_low_pct: 28.6, near_high: false },
    pivot_levels: null,
  }),
};
```

### Using scenarios in unit tests

```typescript
import { CHART_SCENARIOS, generateCandles } from "../helpers/chartTestHelpers";

test("chart shows entry marker for current position", () => {
  const mock = CHART_SCENARIOS.multiDayWithPosition();
  const input = normalizePaper(mock, false);
  expect(input.livePosition).toBeDefined();
  expect(input.livePosition!.entry_price).toBe(1437.70);
});
```

### Using scenarios in E2E tests

```typescript
import { CHART_SCENARIOS } from "../helpers/chartTestHelpers";

test("click position row shows chart with date range", async ({ page }) => {
  await page.route("**/api/paper/chart/NESTLEIND*", async (route) => {
    await route.fulfill({ json: CHART_SCENARIOS.multiDayWithPosition() });
  });

  await navigateToPaperTrading(page);
  await page.click('[data-testid="position-row-NESTLEIND"]');
  await expect(page.locator('[data-testid="paper-chart-header"]')).toBeVisible();
});
```

### When to add a new scenario

Add a new named scenario when any of these differ from existing ones:
- **Date span** (single day vs multi-day vs across weekends)
- **Position state** (open vs closed, entry within/outside visible range)
- **Trade outcome** (TP hit, SL hit, still open, force-closed)
- **Overlay data** (ORB/Pivot/52W levels present or absent)
- **Empty states** (no candles, no trades, no position)

### Key principle

Share the same helper functions (`generateCandles`, `mockPosition`, `CHART_SCENARIOS`) between:
- **Unit tests** (vitest in `src/`) — fast, no browser
- **E2E tests** (Playwright in `tests/e2e/`) — full page flow

This ensures the same test data is used everywhere, making failures consistent and reproducible.

## Assertion Rules

### DO: Use `toBeInTheDocument()` for DOM presence
```typescript
expect(screen.getByTestId("positions-table")).toBeInTheDocument();
```

### DO: Use `not.toBeInTheDocument()` for DOM absence
```typescript
expect(screen.queryByTestId("watchlist-scan-card")).not.toBeInTheDocument();
```

### DO: Use `toBeVisible()` when CSS visibility matters
```typescript
expect(screen.getByTestId("signals-table")).toBeVisible();
```

### DON'T: Use `toBeTruthy()` / `toBeFalsy()` for DOM queries
These silently pass when a DOM element exists but is hidden. Always use the jest-dom matchers instead.

### DON'T: Use `getByText()` with bare numbers or short strings globally
```typescript
// BAD — "3" could match ₹3,850, position count 3, etc.
expect(screen.getByText("3")).toBeInTheDocument();

// GOOD — scope the query
expect(
  within(screen.getByTestId("watchlist-scan-card")).getByText("3"),
).toBeInTheDocument();
```

## Accordion Interaction Patterns

Local Accordion panels are hidden when collapsed; happy-dom does not enforce CSS visibility, so test collapsed content explicitly instead of relying on visibility alone.

### ALWAYS expand collapsed accordions before clicking inside
```typescript
// Find the accordion control button (NOT getByRole("button") — that finds ClickableSymbol buttons too)
const accordionItem = screen.getByTestId("watchlist-scan-skipped");
const controlButton = accordionItem.querySelector('button[data-accordion-control="true"]');
await user.click(controlButton);

// Now the panel is expanded — safe to click rows inside
await user.click(screen.getByTestId("scan-skipped-INFY"));
```

### Use `aria-expanded` to verify accordion state
```typescript
expect(controlButton).toHaveAttribute("aria-expanded", "true"); // expanded
expect(controlButton).toHaveAttribute("aria-expanded", "false"); // collapsed
```

## `data-testid` Conventions

### Naming
- **Top-level panels**: `kebab-case` (e.g., `paper-trading-view`, `watchlist-scan-card`)
- **Config fields**: `config-{name}` (e.g., `config-brokerage`, `config-sl-pct`)
- **Dynamic elements**: `{entity}-{identifier}` (e.g., `position-row-RELIANCE`, `trade-row-42`, `day-group-2026-04-25`)
- **Buttons/Actions**: descriptive action names (e.g., `close-all-positions`, `save-settings-button`)
- **Tabs/Filters**: descriptive names (e.g., `strategy-tab-all`, `bot-filter-select`)
- **Chart controls**: descriptive names (e.g., `intraday-switch`, `show-orb-lines`)
- **Tables from DataTable component**: use `dataTestId` prop (e.g., `dataTestId="positions-table"`)

### Normalize dynamic names
When using strategy names or other user-generated text in test IDs, normalize them:
```typescript
data-testid={`strategy-tab-${displayName.replace(/\s+/g, '-').toLowerCase()}`}
```

### Never use bare `symbol` values as test IDs
Skip symbols can repeat across strategies. Always composite:
- `position-row-${symbol}` — OK (symbols are unique per positions list)
- `${strategy_id}-${symbol}` — better when same symbol can appear in multiple strategies

## What Every Test Should Cover

### Component Tests
1. **Happy path** — renders with expected data
2. **Empty state** — renders when data is null/empty
3. **Loading state** — shows loading indicator when applicable
4. **Error state** — handles API/action failures gracefully
5. **User interaction** — clicking, typing, toggling produces expected side effects
6. **Edge cases** — malformed data, boundary values, missing optional fields

### Utility Tests
1. **Normal input** — expected output for typical values
2. **Boundary values** — 0, empty, Infinity, NaN
3. **Null/undefined** — graceful handling of missing values
4. **Type invariants** — function preserves expected types

### E2E Tests
- Use `data-testid` selectors exclusively — never CSS classes or tag selectors
- Query by `data-testid` first, fall back to `getByRole`/`getByLabelText` for accessibility
- Never use `getByText` for assertions — it's fragile under internationalization
- Always scope selectors within the relevant container

## Coverage Requirements

Before committing:
- **All states** rendered: at minimum happy path + empty state for every component
- **All user interactions** clickable and wired: every `onClick`, `onSubmit`, `onChange` must be tested
- **All branches** of conditional rendering: every ternary, `&&`, or early return must have a test case
- **All API calls** mocked: never hit real endpoints in unit tests
- **All mocked functions** asserted: if you mock it, test that it's called with correct params

## Common Pitfalls

| Pitfall | Solution |
|---|---|
| `getByRole("button")` matches multiple elements | Use `querySelector` with a specific selector or scope with `within()` |
| Accordion click passes in test but fails in browser | Expand the accordion panel before clicking its contents |
| `toBeTruthy()` passes for hidden elements | Use `toBeInTheDocument()` or `toBeVisible()` |
| `getByText("3")` matches wrong element | Scope the query with `within()` |
| Dynamic mock import returns stale reference | Use `vi.mocked()` or re-import inside the test |
| `fireEvent.click()` doesn't trigger React state | Use `userEvent.click()` from `@testing-library/user-event` |
| Mutable module state leaks between tests | Reset state in `beforeEach` / `afterEach` |
| E2E text selector breaks on i18n | Always use `data-testid` in E2E tests |
| **Playwright `click({ force: true })` doesn't trigger React `onClick`** | **Use `page.evaluate(() => element.dispatchEvent(new MouseEvent('click')))` for React components** |
| **Transient highlight class removed by setTimeout** | **Check for CSS class immediately after click, not with `toBeVisible({ timeout })`** |

## Mutation Testing (Backend/Scientific Tests)

Mutation testing verifies that tests actually catch bugs by introducing controlled faults into the code and confirming tests fail.

### When to Use
- For high-value backend endpoints (portfolio, trading, risk calculations)
- Critical utility functions (position sizing, P&L, cache TTL)
- Complex branching logic (DB-first with journal fallback, resampling)

### How to Mutate

#### 1. Identify the behavior the test checks
Read the source code and find exactly what the test verifies (e.g., "ORB high > low", "pivot r1 > pp > s1")

#### 2. Make ONE targeted mutation
```python
# Example: Flip max() to min() in ORB calculation
or_high = max(c['high'] for c in or_candles)  # Original
or_high = min(c['high'] for c in or_candles)  # Mutation
```

#### 3. Run the test and verify it FAILS
```bash
pytest tests/api/test_paper_chart_extended.py::TestORBLevels::test_orb_levels_present -x -q
# Should FAIL with mutation, PASS without
```

#### 4. Revert the mutation immediately
Always revert after testing — mutations are for verification only.

### Common Mutation Patterns

| Category | Mutation | Example |
|----------|----------|---------|
| **Comparisons** | Flip `>=` to `>` | `age >= max_age_seconds` → `age > max_age_seconds` |
| **Formulas** | Invert calculation | `(exit - entry) * qty` → `(entry - exit) * qty` |
| **Logic** | Remove condition | Comment out TTL check |
| **Returns** | Wrong value | Return `0` instead of calculated value |
| **Branches** | Skip fallback | Remove Redis fallback block |

### Weak Test Indicators

A test is weak if it passes after mutation. Fix it by:

1. **Adding invariants**:
   ```python
   # Before: assert orb["or_high"] >= orb["or_low"]
   # After: assert orb["or_high"] > orb["or_low"]  # Must be strictly greater
   ```

2. **Comparing outputs**:
   ```python
   # Check BUY vs SELL produce same result
   assert result_buy['risk_pct'] == result_sell['risk_pct']
   ```

3. **Verifying calls**:
   ```python
   assert mock_save.called, "save_cached_candles must be called"
   ```

4. **Testing boundaries**:
   ```python
   # Use inputs that trigger edge cases
   min_trade_value_bump: trade_value = 20000 (below min)
   ```

### Test Coverage Metrics

- **Mutation Score**: % of mutations caught (target: 80%+)
- **Coverage Gaps**: Functions with zero tests
- **Edge Cases**: Boundary values, null, infinity, empty collections |
