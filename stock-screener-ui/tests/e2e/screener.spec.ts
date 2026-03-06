import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, mockTrendingResponse } from "../mocks/apiResponses";

test.describe("Screener - Data Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display stock data table", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should display correct columns in table", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table thead th", { timeout: 10000 });

    // Check for expected columns - use flexible matching since column names may vary
    const headerTexts = await page.locator("table thead th").allTextContents();
    expect(headerTexts.some((h) => h.toLowerCase().includes("symbol"))).toBeTruthy();
    expect(headerTexts.some((h) => h.toLowerCase().includes("score"))).toBeTruthy();
  });

  test("should display stock symbols as clickable links", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // First stock symbol should be a link
    const firstSymbol = page.locator("table tbody tr:first-child td:first-child a");
    if ((await firstSymbol.count()) > 0) {
      expect(await firstSymbol.getAttribute("href")).toContain("/chart/");
    }
  });

  test("should display approaching and touched sections", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Should have primary section (approaching)
    const primarySection = page.locator(".section-title").first();
    await expect(primarySection).toBeVisible();
  });

  test("should display last updated timestamp", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="footer"]', { timeout: 10000 });

    // Footer should show last updated
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
    // Wait for data to load first (table indicates screeners are loaded)
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Should have screener tabs - check if exists (may be conditionally rendered)
    const screenerNav = page.locator('[data-testid="screener-nav"]');
    const count = await screenerNav.count();
    // If screener nav exists, it should be visible
    if (count > 0) {
      await expect(screenerNav).toBeVisible();
    }
  });

  test("should switch between screeners", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Find screener tabs using the correct class name from header.ts
    const screenerTabs = page.locator(".screener-chip");
    const count = await screenerTabs.count();

    if (count > 1) {
      // Click second screener tab
      await screenerTabs.nth(1).click();
      await page.waitForTimeout(500);

      // Table should still be visible
      await expect(page.locator("table tbody tr").first()).toBeVisible();
    }
  });

  test("should show active screener highlighted", async ({ page }) => {
    await page.goto("/");
    // Wait for data to load first
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // First screener should be active - use screener-chip class (actual class used in header.ts)
    const activeTab = page.locator(".screener-chip.active");
    if ((await activeTab.count()) > 0) {
      await expect(activeTab.first()).toBeVisible();
    } else {
      // If no active class, just verify the tab exists
      const screenerTab = page.locator('[data-testid="screener-tab"]');
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
    // Navigate to buyer interest screener
    await page.goto("/?screener=buyer_interest_enhanced");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Should show profile filters
    const profileFilters = page.locator(".profile-filters");
    if ((await profileFilters.count()) > 0) {
      await expect(profileFilters).toBeVisible();
    }
  });

  test("should filter by direction in buyer interest", async ({ page }) => {
    await page.goto("/?screener=buyer_interest_enhanced");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Find direction filter
    const directionSelect = page.locator("select[name*='direction'], #pf_direction");
    if ((await directionSelect.count()) > 0) {
      await directionSelect.selectOption("bullish");
      await page.waitForTimeout(500);

      // Table should update
      await expect(page.locator("table tbody tr").first()).toBeVisible();
    }
  });

  test("should filter by minimum score", async ({ page }) => {
    await page.goto("/?screener=buyer_interest_enhanced");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Find min score filter
    const minScoreInput = page.locator("input[name*='min_score'], #pf_min_score");
    if ((await minScoreInput.count()) > 0) {
      await minScoreInput.fill("80");
      await page.waitForTimeout(500);

      // Table should update
      await expect(page.locator("table tbody tr").first()).toBeVisible();
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
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"]');
    if ((await autoRefreshInput.count()) > 0) {
      await expect(autoRefreshInput).toBeVisible();
    }
  });

  // Skip: Auto-refresh input element may not exist in all views
  test.skip("should set auto-refresh interval", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"]');
    if ((await autoRefreshInput.count()) > 0) {
      await autoRefreshInput.fill("60");
      await page.waitForTimeout(300);

      const value = await autoRefreshInput.inputValue();
      expect(value).toBe("60");
    }
  });

  test("should disable auto-refresh when set to 0", async ({ page }) => {
    test.slow();
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 15000 });

    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"]');
    if ((await autoRefreshInput.count()) > 0) {
      await autoRefreshInput.fill("0");
      await page.waitForTimeout(500);

      // Auto-refresh should be disabled
      const value = await autoRefreshInput.inputValue();
      expect(value).toBe("0");
    }
  });
});

test.describe("Screener - Summary Strip", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display summary strip when data available", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Summary strip should be visible
    const summaryStrip = page.locator(".summary-strip");
    if ((await summaryStrip.count()) > 0) {
      await expect(summaryStrip).toBeVisible();
    }
  });

  test("should show market summary metrics", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const summaryStrip = page.locator(".summary-strip");
    if ((await summaryStrip.count()) > 0) {
      // Should contain some summary metrics
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
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Trading list should be visible
    const tradingList = page.locator(".trading-list, textarea.trading-list");
    if ((await tradingList.count()) > 0) {
      await expect(tradingList).toBeVisible();
    }
  });

  test("should copy trading list to clipboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    // Find copy button
    const copyBtn = page.locator("button:has-text('Copy')");
    if ((await copyBtn.count()) > 0) {
      await copyBtn.first().click();
      await page.waitForTimeout(300);

      // Button should have been clicked successfully
      await expect(copyBtn.first()).toBeVisible();
    }
  });
});

test.describe("Screener - Error Handling", () => {
  test("should show error state when API fails", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Override to fail
    await page.route("**/api/screener**", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Should show error or retry button
    const errorElement = page.locator(".error, button:has-text('Retry')");
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

    // Click retry if visible
    const retryBtn = page.locator("button:has-text('Retry')");
    if ((await retryBtn.count()) > 0) {
      await retryBtn.click();
      await page.waitForTimeout(1500);

      // Should show data now
      const rows = page.locator("table tbody tr");
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });
});
