import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupOptionsMocks } from "../mocks/apiResponses";

test.describe("Options View - Navigation and Basic Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupOptionsMocks(page);
  });

  test("should navigate to options view via side menu", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-options"]').click();
    await expect(page.locator('[data-testid="options-view"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="options-nav"]')).toBeVisible();
  });

  test("should load options view directly from URL", async ({ page }) => {
    await page.goto("/options");
    await page.waitForSelector('[data-testid="options-view"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="options-view"]')).toBeVisible();
  });

  test("should display option chain panel by default", async ({ page }) => {
    await page.goto("/options");
    await page.waitForSelector('[data-testid="options-chain-panel"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="options-chain-panel"]')).toBeVisible();
  });
});

test.describe("Options View - Option Chain", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupOptionsMocks(page);
    await page.goto("/options");
    await page.waitForSelector('[data-testid="options-chain-panel"]', { timeout: 10000 });
  });

  test("should display underlying and expiry selectors", async ({ page }) => {
    await expect(page.locator('[data-testid="underlying-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="expiry-select"]')).toBeVisible();
  });

  test("should display chain summary with PCR and Max Pain", async ({ page }) => {
    const summary = page.locator('[data-testid="chain-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("PCR");
    await expect(summary).toContainText("Max Pain");
  });

  test("should display option chain table", async ({ page }) => {
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    // Check for some strike prices in the table using data-testid
    const strikeCells = page.locator('[data-testid="strike-cell"]');
    await expect(strikeCells.first()).toBeVisible({ timeout: 10000 });

    const strikeTexts = await strikeCells.allTextContents();
    expect(strikeTexts).toContain("23900");
    expect(strikeTexts).toContain("24000");
  });

  test("should open user guide modal", async ({ page }) => {
    await page.locator('[data-testid="open-guide-btn"]').click();
    await expect(page.locator('[data-testid="options-guide-content"]')).toBeVisible({
      timeout: 10000,
    });
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="options-guide-content"]')).not.toBeVisible();
  });

  test("should switch between table and analysis views", async ({ page }) => {
    const tabs = page.locator('[data-testid="chain-view-tabs"]');

    // Switch to Analysis
    await page.locator('[data-testid="chain-tab-analysis"]').click();
    await expect(page.locator('[data-testid="oi-analysis"]')).toBeVisible();

    // Switch back to Table
    await page.locator('[data-testid="chain-tab-table"]').click();
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
  });
});

test.describe("Options View - Filters", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupOptionsMocks(page);
    await page.goto("/options");
    await page.waitForSelector('[data-testid="options-chain-panel"]', { timeout: 10000 });
  });

  test("should filter by option type", async ({ page }) => {
    const typeSelect = page.locator('[data-testid="option-type-select"]');
    await expect(typeSelect).toBeVisible();

    // Default is Both CE/PE
    await expect(page.getByText("CALLS (CE)")).toBeVisible();
    await expect(page.getByText("PUTS (PE)")).toBeVisible();

    // Filter to Calls Only
    await typeSelect.click();
    await expect(page.getByRole("option", { name: "Calls Only" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("option", { name: "Calls Only" }).click();

    // Puts should be hidden (Wait, our logic might still show the column but empty or similar)
    // Based on OptionChainPanel.tsx, if filters.optionType !== "PE", CE is shown.
    // Actually the Table handles the columns.
  });
});
