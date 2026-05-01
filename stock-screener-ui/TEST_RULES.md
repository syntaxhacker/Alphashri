# Test Rules — stock-screener-ui

## Stack
- **Unit/component**: Vitest + `@testing-library/react` + happy-dom
- **E2E**: Playwright (`tests/e2e/`)
- **Backend**: pytest (`tests/`)

## Running Tests
- `bun test` — all vitest tests
- `bun test -- --run <file>` — single file (no watch)
- `bun test -- --run src/components/paper-trading/` — directory
- `bunx vitest run --dir src` — alternative direct invocation
- `bunx playwright test` — E2E tests (requires dev server running)

### Skip Test Environment Variables
Use environment variables to skip specific test suites during development (faster iteration):

```bash
# Skip Python tests
SKIP_PYTHON=1 git commit ...

# Skip frontend unit tests  
SKIP_UI=1 git commit ...

# Skip both (e.g., for doc-only commits)
SKIP_PYTHON=1 SKIP_UI=1 git commit ...
```

## File Conventions

### Unit Test Files
- Co-located with source: `src/**/*.test.ts` or `src/**/*.test.tsx`
- Same directory as the component/module they test
- Test file name matches source file name (e.g., `WatchlistScan.tsx` → `WatchlistScan.test.tsx`)

### E2E Test Files
- Located in `tests/e2e/`
- Named `*.spec.ts`
- Use Playwright's `page` fixture for browser interactions

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
// Wrapper for Mantine-dependent components
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
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

### Mocking Mantine Components
Some Mantine components require context (e.g., `Table.Tr`/`Table.Td` need a `Table` provider) or render in portals (e.g., `Tooltip`). For isolated unit tests, mock these components to simple HTML elements:

```typescript
// Mock at the top of your test file (before component imports)
vi.mock("@mantine/core", async (importOriginal) => {
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
- Spread `...actual` to keep other Mantine components (Provider, Text, etc.) intact
- Only override components that cause testing issues (context, portals)
- Preserve `data-testid` props so tests can still query elements
- For `SegmentedControl`/`RadioGroup`, expose `data-testid` on individual options if needed

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

Mantine Accordion panels are hidden via CSS `display: none` when collapsed (keepMounted defaults to true). happy-dom does not enforce CSS visibility, so clicks on collapsed elements succeed in tests but would fail in a real browser.

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
