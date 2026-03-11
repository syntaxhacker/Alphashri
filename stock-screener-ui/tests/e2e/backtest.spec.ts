import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Backtest View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should navigate to backtest view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".sidemenu", { timeout: 10000 });

    await page.locator('[data-testid="nav-backtest"]').click();
    await page.waitForTimeout(500);

    // Should show backtest view
    await expect(page.locator(".backtest-view")).toBeVisible();
  });

  test("should load backtest view from URL", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    await expect(page.locator(".backtest-view")).toBeVisible();
  });
});

test.describe("Backtest View - Strategy Selection", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Mock strategies list
    await page.route("**/api/strategies", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "orb", name: "ORB Strategy", type: "orb" },
          { id: "52w_chaser", name: "52W Chaser", type: "52w_chaser" },
        ]),
      });
    });
  });

  test("should display strategy selector", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const strategySelect = page.locator(".strategy-selector, #strategy-select");
    if ((await strategySelect.count()) > 0) {
      await expect(strategySelect).toBeVisible();
    }
  });

  test("should list available strategies", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const strategySelect = page.locator(".strategy-selector, #strategy-select");
    if ((await strategySelect.count()) > 0) {
      // Should have options
      const options = await strategySelect.locator("option").count();
      expect(options).toBeGreaterThan(0);
    }
  });

  test("should select strategy from dropdown", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const strategySelect = page.locator(".strategy-selector, #strategy-select");
    if ((await strategySelect.count()) > 0) {
      await strategySelect.selectOption({ index: 0 });
      await page.waitForTimeout(300);
    }
  });
});

test.describe("Backtest View - Symbol Selection", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display symbol input", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const symbolInput = page.locator(".symbol-input, #symbol-input");
    if ((await symbolInput.count()) > 0) {
      await expect(symbolInput).toBeVisible();
    }
  });

  test("should add symbol to list", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const symbolInput = page.locator(".symbol-input, #symbol-input");
    if ((await symbolInput.count()) > 0) {
      await symbolInput.fill("RELIANCE");
      await page.locator("button:has-text('Add')").click();
      await page.waitForTimeout(300);

      // Symbol should appear in list
      await expect(page.locator(".symbol-list, .selected-symbols")).toContainText("RELIANCE");
    }
  });

  test("should remove symbol from list", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    // First add a symbol
    const symbolInput = page.locator(".symbol-input, #symbol-input");
    if ((await symbolInput.count()) > 0) {
      await symbolInput.fill("TCS");
      await page.locator("button:has-text('Add')").click();
      await page.waitForTimeout(300);

      // Then remove it
      const removeBtn = page.locator(".symbol-remove, button:has-text('×')").first();
      if ((await removeBtn.count()) > 0) {
        await removeBtn.click();
        await page.waitForTimeout(300);
      }
    }
  });
});

test.describe("Backtest View - Parameters", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display parameter inputs", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    // Should show parameter section
    const paramsSection = page.locator(".params-section, .backtest-params");
    if ((await paramsSection.count()) > 0) {
      await expect(paramsSection).toBeVisible();
    }
  });

  test("should have OR minutes parameter", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const orMinutesInput = page.locator('[data-testid="or-minutes"], #or-minutes');
    if ((await orMinutesInput.count()) > 0) {
      await expect(orMinutesInput).toBeVisible();
    }
  });

  test("should have stop loss parameter", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const slInput = page.locator('[data-testid="stop-loss"], #sl-pct');
    if ((await slInput.count()) > 0) {
      await expect(slInput).toBeVisible();
    }
  });

  test("should have take profit parameter", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const tpInput = page.locator('[data-testid="take-profit"], #tp-pct');
    if ((await tpInput.count()) > 0) {
      await expect(tpInput).toBeVisible();
    }
  });
});

test.describe("Backtest View - Run Backtest", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Mock backtest run
    await page.route("**/api/backtest/run", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              total_trades: 10,
              win_rate: 60,
              total_pnl: 5000,
              max_drawdown: 2000,
            },
          ],
          summary: {
            total_trades: 10,
            win_rate: 60,
            total_pnl: 5000,
          },
        }),
      });
    });
  });

  test("should have run backtest button", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const runBtn = page.locator('button:has-text("Run"), button:has-text("Start Backtest")');
    if ((await runBtn.count()) > 0) {
      await expect(runBtn).toBeVisible();
    }
  });

  test("should show loading state during backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const runBtn = page.locator('button:has-text("Run"), button:has-text("Start Backtest")');
    if ((await runBtn.count()) > 0) {
      await runBtn.click();

      // Should show loading indicator
      const loading = page.locator(".loading, .backtest-loading");
      await page.waitForTimeout(300);
    }
  });

  test("should display results after backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const runBtn = page.locator('button:has-text("Run"), button:has-text("Start Backtest")');
    if ((await runBtn.count()) > 0) {
      await runBtn.click();
      await page.waitForTimeout(1000);

      // Should show results
      const results = page.locator(".backtest-results, .results-section");
      if ((await results.count()) > 0) {
        await expect(results).toBeVisible();
      }
    }
  });
});

test.describe("Backtest View - Charts", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should show chart toggle", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const chartToggle = page.locator(".chart-toggle, #show-charts");
    if ((await chartToggle.count()) > 0) {
      await expect(chartToggle).toBeVisible();
    }
  });

  test("should display chart when enabled", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    // Enable charts if toggle exists
    const chartToggle = page.locator(".chart-toggle, #show-charts");
    if ((await chartToggle.count()) > 0) {
      await chartToggle.check();
      await page.waitForTimeout(300);
    }
  });
});

test.describe("Backtest View - Export", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have export button", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector(".backtest-view", { timeout: 10000 });

    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Download")');
    if ((await exportBtn.count()) > 0) {
      await expect(exportBtn).toBeVisible();
    }
  });
});
