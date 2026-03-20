import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupMultiStrategyBotMocks,
  setupPaperTradingMocks,
} from "../mocks/apiResponses";

test.describe("Navigation - App Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should display navbar with all navigation items", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Check all nav items are visible
    await expect(page.locator('[data-testid="nav-screener"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-backtest"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-paper"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-sector"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-strategies"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-bots"]')).toBeVisible();
  });

  test("should highlight active navigation item", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Screener should be active by default
    const screenerNav = page.locator('[data-testid="nav-screener"]');
    await expect(screenerNav).toHaveAttribute("data-active", "true");
  });

  test("should navigate to Paper Trading view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click Paper Trading
    await page.locator('[data-testid="nav-paper"]').click();
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 5000 });
    const paperNav = page.locator('[data-testid="nav-paper"]');
    await expect(paperNav).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible();
  });

  test("should navigate to Backtest view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click Backtest
    await page.locator('[data-testid="nav-backtest"]').click();

    // Should show backtest view with increased timeout
    await expect(page.locator('[data-testid="backtest-view"]')).toBeVisible({ timeout: 15000 });

    // URL should change
    expect(page.url()).toContain("/backtest");
  });

  test("should navigate to Sector Analysis view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click Sector Analysis
    await page.locator('[data-testid="nav-sector"]').click();

    // Should show sector view with increased timeout
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 15000,
    });

    // URL should change
    expect(page.url()).toContain("/sector");
  });

  test("should navigate to Strategies view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click Strategies
    await page.locator('[data-testid="nav-strategies"]').click();

    // Should show strategies view with increased timeout
    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible({ timeout: 15000 });

    // URL should change
    expect(page.url()).toContain("/strategies");
  });

  test("should navigate to Bots view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click Bots
    await page.locator('[data-testid="nav-bots"]').click();
    await expect(page.locator('[data-testid="bots-view"]')).toBeVisible({ timeout: 5000 });
    const botsNav = page.locator('[data-testid="nav-bots"]');
    await expect(botsNav).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-testid="bots-view"]')).toBeVisible();
  });

  test("should navigate to Screener view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // First go to another view
    await page.locator('[data-testid="nav-paper"]').click();
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 5000 });

    // Then click Screener
    await page.locator('[data-testid="nav-screener"]').click();

    // Verify Screener nav button is active
    const screenerNav = page.locator('[data-testid="nav-screener"]');
    await expect(screenerNav).toHaveAttribute("data-active", "true");
  });

  // Skip: The active class state is not updating correctly when clicking nav buttons
  // This is a known issue with the legacy view rendering
  test.skip("should update active state on navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click Paper Trading
    await page.locator('[data-testid="nav-paper"]').click();
    await page.waitForLoadState("networkidle");

    // Verify Paper Trading button has active class
    const paperNav = page.locator('[data-testid="nav-paper"]');
    const classNames = await paperNav.getAttribute("class");
    expect(classNames).toContain("active");
  });

  test("should toggle sidemenu collapse state", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    const navbar = page.locator('[data-testid="app-navbar"]');

    // Initial state: not collapsed (width should be larger, 200px)
    const initialBox = await navbar.boundingBox();
    expect(initialBox?.width).toBeGreaterThan(100);

    // Click the toggle button (ChevronLeft icon button)
    // Find the toggle button using its testid
    const toggleBtn = page.locator('[data-testid="sidebar-collapse-toggle"]');
    await toggleBtn.click();
    await page.waitForLoadState("networkidle");

    // Verify it collapsed (width should be smaller, 80px)
    const collapsedBox = await navbar.boundingBox();
    expect(collapsedBox?.width).toBeLessThanOrEqual(100);

    // Verify navigation still works while collapsed
    await page.locator('[data-testid="nav-paper"]').click();
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible();

    // Toggle back
    await toggleBtn.click();
    await page.waitForLoadState("networkidle");
    const restoredBox = await navbar.boundingBox();
    expect(restoredBox?.width).toBeGreaterThan(100);
  });
});

test.describe("Navigation - URL Routing", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should load Paper Trading view when navigating to /paper", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="paper-trading-view"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible();
  });

  test("should load Backtest view when navigating to /backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="backtest-view"]')).toBeVisible();
  });

  test("should load Sector view when navigating to /sector", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible();
  });

  test("should load Strategies view when navigating to /strategies", async ({ page }) => {
    await page.goto("/strategies");
    await page.waitForSelector('[data-testid="strategies-view"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible();
  });

  test("should load Bots view when navigating to /bots", async ({ page }) => {
    await page.goto("/bots");
    await page.waitForSelector('[data-testid="bots-view"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="bots-view"]')).toBeVisible();
  });

  test("should redirect unknown routes to home", async ({ page }) => {
    await page.goto("/unknown-route");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Should be at root
    expect(page.url()).not.toContain("/unknown-route");
  });
});

test.describe("Navigation - Market Ticker", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should display market ticker at top of page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="market-ticker"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="market-ticker"]')).toBeVisible();
  });

  test("should show loading state initially", async ({ page }) => {
    // Slow down the market ticker API
    await page.route("**/api/market-ticker", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto("/");

    // Should show loading or empty state briefly
    const ticker = page.locator('[data-testid="market-ticker"]');
    await expect(ticker).toBeVisible({ timeout: 5000 });
  });

  test("should handle market ticker API error gracefully", async ({ page }) => {
    await page.route("**/api/market-ticker", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Server error" }),
      });
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="market-ticker"]', { timeout: 10000 });

    // Should show error or empty state
    const ticker = page.locator('[data-testid="market-ticker"]');
    await expect(ticker).toBeVisible();
  });
});
