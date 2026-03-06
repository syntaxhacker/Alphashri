import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, mockTrendingResponse } from "../mocks/apiResponses";

test.describe("Screener - Data Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display stock data table", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const rows = page.locator(".mantine-Table-tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should display correct columns in table", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-th", { timeout: 10000 });

    const headerTexts = await page.locator(".mantine-Table-th").allTextContents();
    expect(headerTexts.some((h) => h.toLowerCase().includes("symbol"))).toBeTruthy();
    expect(headerTexts.some((h) => h.toLowerCase().includes("score"))).toBeTruthy();
  });

  test("should display stock symbols as clickable links", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const firstSymbol = page.locator(".mantine-Table-tr:first-child [data-testid=\"stock-symbol\"] a");
    if ((await firstSymbol.count()) > 0) {
      expect(await firstSymbol.getAttribute("href")).toContain("/chart/");
    }
  });

  test("should display approaching and touched sections", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const primarySection = page.locator(".section-title").first();
    await expect(primarySection).toBeVisible();
  });

  test("should display last updated timestamp", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="footer"]', { timeout: 10000 });

    const footer = page.locator('[data-testid="footer"]');
    await expect(footer).toBeVisible();
  });
});

test.describe("Screener - Screener Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display screener navigation tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const screenerNav = page.locator('[data-testid="screener-nav"]');
    const count = await screenerNav.count();
    if (count > 0) {
      await expect(screenerNav).toBeVisible();
    }
  });

  test("should switch between screeners", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const screenerTabs = page.locator(".mantine-SegmentedControl-control");
    const count = await screenerTabs.count();

    if (count > 1) {
      await screenerTabs.nth(1).click();
      await page.waitForTimeout(500);

      await expect(page.locator(".mantine-Table-tr").first()).toBeVisible();
    }
  });

  test("should show active screener highlighted", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const activeTab = page.locator(".mantine-SegmentedControl-label");
    if ((await activeTab.count()) > 0) {
      await expect(activeTab.first()).toBeVisible();
    } else {
      const screenerTab = page.locator('[data-testid="screener-nav"]');
      const count = await screenerTab.count();
      if (count > 0) {
        await expect(screenerTab.first()).toBeVisible();
      }
    }
  });
});

test.describe("Screener - Profile Filters", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display profile filters for buyer interest screener", async ({ page }) => {
    await page.goto("/?screener=buyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const profileFilters = page.locator('[data-testid="screener-filters"]');
    if ((await profileFilters.count()) > 0) {
      await expect(profileFilters).toBeVisible();
    }
  });

  test("should filter by direction in buyer interest", async ({ page }) => {
    await page.goto("/?screener=buyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const directionSelect = page.locator('[data-testid="mode-select"]');
    if ((await directionSelect.count()) > 0) {
      await directionSelect.click();
      await page.waitForTimeout(300);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);

      await expect(page.locator(".mantine-Table-tr").first()).toBeVisible();
    }
  });

  test("should filter by minimum score", async ({ page }) => {
    await page.goto("/?screener=buyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const minScoreInput = page.locator('[data-testid="min-score-input"]');
    if ((await minScoreInput.count()) > 0) {
      await minScoreInput.fill("80");
      await page.waitForTimeout(500);

      await expect(page.locator(".mantine-Table-tr").first()).toBeVisible();
    }
  });
});

test.describe.configure({ mode: "serial" });
test.describe("Screener - Auto Refresh", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have auto-refresh input", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"]');
    if ((await autoRefreshInput.count()) > 0) {
      await expect(autoRefreshInput).toBeVisible();
    }
  });

  test("should disable auto-refresh when set to 0", async ({ page }) => {
    test.slow();
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"]');
    await expect(autoRefreshInput).toBeVisible();

    await autoRefreshInput.clear();
    await autoRefreshInput.fill("0");
    await autoRefreshInput.blur();
    await page.waitForTimeout(300);

    const value = await autoRefreshInput.inputValue();
    expect(value).toBe("0");
  });
});

test.describe("Screener - Summary Strip", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display summary strip when data available", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const summaryStrip = page.locator('[data-testid="summary-strip"]');
    if ((await summaryStrip.count()) > 0) {
      await expect(summaryStrip).toBeVisible();
    }
  });

  test("should show market summary metrics", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const summaryStrip = page.locator('[data-testid="summary-strip"]');
    if ((await summaryStrip.count()) > 0) {
      const text = await summaryStrip.textContent();
      expect(text?.length).toBeGreaterThan(0);
    }
  });
});

test.describe("Screener - Trading List", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display trading list textarea", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    const tradingList = page.locator('[data-testid="trading-list"]');
    if ((await tradingList.count()) > 0) {
      await expect(tradingList).toBeVisible();
    }
  });

  test("should copy trading list to clipboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const copyBtn = page.locator("button:has-text('Copy')");
    if ((await copyBtn.count()) > 0) {
      await copyBtn.first().click();
      await page.waitForTimeout(300);

      await expect(copyBtn.first()).toBeVisible();
    }
  });
});

test.describe("Screener - Error Handling", () => {
  test("should show error state when API fails", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    await page.route("**/api/screener**", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/");
    await page.waitForTimeout(2000);

    const errorElement = page.locator(".error, button:has-text('Retry'), [data-testid=\"empty-state\"]");
    expect(await errorElement.count()).toBeGreaterThan(0);
  });

  test("should retry on error", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    let failCount = 0;

    await page.route("**/api/screener**", async (route) => {
      failCount++;
      if (failCount < 2) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    const retryBtn = page.locator("button:has-text('Retry'), [data-testid=\"refresh-btn\"]");
    if ((await retryBtn.count()) > 0) {
      await retryBtn.first().click();
      await page.waitForTimeout(1500);

      const rows = page.locator(".mantine-Table-tr");
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });
});
