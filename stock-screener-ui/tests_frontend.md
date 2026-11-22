# Frontend Testing Patterns & Conventions

This document outlines the established patterns for writing frontend tests in the Alphashri project, covering both End-to-End (E2E) and Unit testing.

## 1. Tooling & Frameworks
- **E2E Testing:** [Playwright](https://playwright.dev/)
- **Unit Testing:** [Vitest](https://vitest.dev/)
- **Component Testing:** Integrated with Storybook and Vitest.
- **Mocking:** custom route interception using Playwright's `page.route`.

## 2. Directory Structure
- `tests/e2e/`: End-to-end test files (`*.spec.ts`).
- `tests/e2e/helpers/`: **The only TypeScript E2E helper location.** Reusable page objects, navigation and route-mock builders (`botHelpers.ts`, `multiStrategyHelpers.ts`, `paperTradingHelpers.ts`, `tradeHistoryHelpers.ts`, …). Mock payloads and single composed fixtures use the `Mocks`/`Fixture` suffix (`agriMocks.ts`, `premiumFixture.ts`). Ownership and naming rules live in `tests/e2e/helpers/README.md`.
- `tests/mocks/`: Centralized API mock data and setup functions (`apiResponses.ts`, `routeHelper.ts`). Imported from helpers as `../../mocks/...`.
- `tests/helpers/`: Python-only test helpers (`db.py`). No TypeScript E2E helpers live here.
- `src/**/*.test.ts`: Unit tests for utilities and business logic.

E2E specs import helpers from `./helpers/<name>`. Importing `../helpers/*.ts` is forbidden — that path points at the Python helper directory and is how a duplicate helper tree survived.

## 3. End-to-End (E2E) Patterns

### A. Test Selection (data-testid)
Always use `data-testid` attributes for targeting elements to ensure tests are resilient to styling changes.
```html
<button data-testid="refresh-chain-btn">Refresh</button>
```
In tests:
```typescript
await page.locator('[data-testid="refresh-chain-btn"]').click();
```

### B. Mocking API Responses
We use a centralized mock system in `tests/mocks/apiResponses.ts`. Every E2E test should start by setting up these mocks to avoid hitting the real backend.
```typescript
test.beforeEach(async ({ page }) => {
  await setupApiMocks(page);      // Base mocks (auth, screeners)
  await loginAsTestUser(page);    // Inject auth tokens into localStorage
  await setupOptionsMocks(page);  // Feature-specific mocks
});
```

### C. Organizing Tests
Use `test.describe` to group related scenarios and `test` for individual cases.
```typescript
test.describe("Options View", () => {
  test("should display option chain", async ({ page }) => {
    await page.goto("/options");
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
  });
});
```

## 4. Unit Testing Patterns

### A. Utility Logic
Pure functions (math, formatting, data transformation) should be tested using Vitest in the same directory as the source file.
- **Pattern:** `describe` -> `it` -> `expect`.
```typescript
describe("formatNumber", () => {
  it("should format millions correctly", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
  });
});
```

## 5. Execution Commands

### E2E Tests (Playwright)
```bash
# Run all E2E tests
bun run test

# Run a specific test file
bun run test tests/e2e/options.spec.ts

# Run in UI mode (interactive)
bun run test:ui

# Debug a specific test (headed mode)
bun run test:headed
```

### Unit Tests (Vitest)
```bash
# Run all unit tests
bun x vitest run

# Run vitest in watch mode
bun x vitest
```

## 6. Best Practices
1. **Isolated State:** Each test should start with a clean slate. Use `localStorage.clear()` if necessary, or rely on the `loginAsTestUser` helper which resets tokens.
2. **Deterministic Data:** Use the mock data in `apiResponses.ts` rather than random values to ensure tests are reproducible.
3. **Wait for Loaders:** When data is fetched, always wait for the specific container or check that the loader is hidden before asserting on data.
4. **Resilient Assertions:** Prefer `expect(locator).toBeVisible()` over checking for specific CSS classes.
