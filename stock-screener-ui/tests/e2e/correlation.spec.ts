import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupCorrelationMocks } from "../mocks/apiResponses";

test.describe("Correlation - UI", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleErrors.push(msg.text());
      }
    });
    await setupApiMocks(page);
    await setupCorrelationMocks(page);
    await loginAsTestUser(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("should show correlation tab on screener page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    const correlationTab = page.locator('[data-testid="tab-correlation"]');
    await expect(correlationTab).toBeVisible();
    await expect(correlationTab).toHaveText("Correlation");
  });

  test("should switch to correlation tab and show controls", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();
    await expect(page.locator('[data-testid="correlation-tab"]')).toBeVisible();
    await expect(page.locator("button:has-text('Calculate')")).toBeVisible();
  });

  test("should disable calculate button with fewer than 2 symbols", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();
    const calcBtn = page.locator("button:has-text('Calculate')");
    await expect(calcBtn).toBeDisabled();
  });

  test("should show timeframe and period controls", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();

    const timeframeControl = page.locator(
      '[data-testid="correlation-tab"] .mantine-SegmentedControl',
    );
    await expect(timeframeControl).toBeVisible();

    const periodSelect = page.locator('[data-testid="correlation-tab"] .mantine-Select');
    await expect(periodSelect).toBeVisible();
  });

  test("should switch between daily and intraday timeframe", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();

    const intradayOption = page.locator(
      '[data-testid="correlation-tab"] .mantine-SegmentedControl-control:has-text("Intraday")',
    );
    await intradayOption.click();

    const dailyOption = page.locator(
      '[data-testid="correlation-tab"] .mantine-SegmentedControl-control:has-text("Daily")',
    );
    await dailyOption.click();
  });

  test("should switch between period options", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();

    const periodSelect = page.locator('[data-testid="correlation-tab"] .mantine-Select');
    await periodSelect.click();

    const periodDropdown = page.locator(".mantine-Select-dropdown");
    await expect(periodDropdown).toBeVisible();
  });

  test("should show correlation data after calculate", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();

    const calcBtn = page.locator("button:has-text('Calculate')");
    await expect(calcBtn).toBeDisabled();

    await page.locator('[data-testid="correlation-tab"] .mantine-MultiSelect-input').click();
    const symbolOption = page.locator(".mantine-MultiSelect-option:has-text('TCS')");
    if (await symbolOption.isVisible()) {
      await symbolOption.click();
    }
    await page.locator(".mantine-MultiSelect-input").click();
    const symbolOption2 = page.locator(".mantine-MultiSelect-option:has-text('INFY')");
    if (await symbolOption2.isVisible()) {
      await symbolOption2.click();
    }

    await page.waitForTimeout(500);

    await expect(calcBtn).toBeEnabled();
    await calcBtn.click();

    await expect(page.locator('[data-testid="correlation-matrix"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="correlation-chart"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show meta stats after correlation data loads", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    await page.locator('[data-testid="tab-correlation"]').click();

    await page.locator('[data-testid="correlation-tab"] .mantine-MultiSelect-input').click();
    const option = page.locator(".mantine-MultiSelect-option:has-text('TCS')");
    if (await option.isVisible()) {
      await option.click();
    }
    await page.locator(".mantine-MultiSelect-input").click();
    const option2 = page.locator(".mantine-MultiSelect-option:has-text('INFY')");
    if (await option2.isVisible()) {
      await option2.click();
    }
    await page.waitForTimeout(500);

    await page.locator("button:has-text('Calculate')").click();

    const stats = page.locator('[data-testid="compact-stat-grid"]');
    await expect(stats).toBeVisible({ timeout: 10000 });
    await expect(stats).toContainText("Date Range");
    await expect(stats).toContainText("Symbols");
    await expect(stats).toContainText("Data Points");
  });
});
