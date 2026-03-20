import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
  setupOptionsMocks,
  setupSectorMocks,
  testUser,
} from "../mocks/apiResponses";

test.describe("Navigation V2 - All Nav Items Visible", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
    await setupOptionsMocks(page);
    await setupSectorMocks(page);
  });

  test("@smoke should display all 9 non-admin nav items", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="nav-screener"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-news"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-backtest"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-paper"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-sector"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-strategies"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-bots"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-options"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-settings"]')).toBeVisible();
  });

  test("should not display admin nav item for non-admin user", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="nav-admin"]')).not.toBeVisible();
  });

  test("should display admin nav item for admin user", async ({ page }) => {
    const adminUser = { ...testUser, is_admin: true };

    await page.addInitScript((user) => {
      localStorage.setItem("alphashri_token", "test_access_token_12345");
      localStorage.setItem("alphashri_refresh_token", "test_refresh_token_12345");
      localStorage.setItem("alphashri_user", JSON.stringify(user));
    }, adminUser);

    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(adminUser),
      });
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="nav-admin"]')).toBeVisible();
  });
});

test.describe("Navigation V2 - Navigation Clicks", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
    await setupOptionsMocks(page);
    await setupSectorMocks(page);
  });

  test("click nav-screener -> URL becomes /, screener content visible", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-screener"]').click();

    expect(page.url()).toContain("/");
    expect(page.url()).not.toContain("/paper");
    await expect(page.locator('[data-testid="screener-page"]')).toBeVisible({ timeout: 15000 });
  });

  test("click nav-news -> URL becomes /news, news content visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-news"]').click();

    expect(page.url()).toContain("/news");
    await expect(page.locator('[data-testid="news-page"]')).toBeVisible({ timeout: 15000 });
  });

  test("click nav-backtest -> URL becomes /backtest, backtest view visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-backtest"]').click();

    expect(page.url()).toContain("/backtest");
    await expect(page.locator('[data-testid="backtest-view"]')).toBeVisible({ timeout: 15000 });
  });

  test("click nav-paper -> URL becomes /paper, paper trading view visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-paper"]').click();

    expect(page.url()).toContain("/paper");
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("click nav-sector -> URL becomes /sector, sector view visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-sector"]').click();

    expect(page.url()).toContain("/sector");
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test("click nav-strategies -> URL becomes /strategies, strategies view visible", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-strategies"]').click();

    expect(page.url()).toContain("/strategies");
    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible({ timeout: 15000 });
  });

  test("click nav-bots -> URL becomes /bots, bots view visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-bots"]').click();

    expect(page.url()).toContain("/bots");
    await expect(page.locator('[data-testid="bots-view"]')).toBeVisible({ timeout: 10000 });
  });

  test("click nav-options -> URL becomes /options, options view visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-options"]').click();

    expect(page.url()).toContain("/options");
    await expect(page.locator('[data-testid="options-view"]')).toBeVisible({ timeout: 15000 });
  });

  test("click nav-settings -> URL becomes /settings, settings page visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-settings"]').click();

    expect(page.url()).toContain("/settings");
    await expect(page.locator('[data-testid="settings-page"]')).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Navigation V2 - Active State", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
    await setupOptionsMocks(page);
    await setupSectorMocks(page);
  });

  test("default active state on screener", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="nav-screener"]')).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("active state updates after clicking nav-news", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-news"]').click();
    await page.waitForURL("**/news");

    await expect(page.locator('[data-testid="nav-news"]')).toHaveAttribute("data-active", "true");
  });

  test("active state updates after clicking nav-paper", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-paper"]').click();
    await page.waitForURL("**/paper");

    await expect(page.locator('[data-testid="nav-paper"]')).toHaveAttribute("data-active", "true");
  });

  test("active state updates after clicking nav-bots", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-bots"]').click();
    await page.waitForURL("**/bots");

    await expect(page.locator('[data-testid="nav-bots"]')).toHaveAttribute("data-active", "true");
  });

  test("active state updates after clicking nav-settings", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-settings"]').click();
    await page.waitForURL("**/settings");

    await expect(page.locator('[data-testid="nav-settings"]')).toHaveAttribute(
      "data-active",
      "true",
    );
  });
});

test.describe("Navigation V2 - URL Deep Linking", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
    await setupOptionsMocks(page);
    await setupSectorMocks(page);
  });

  test("navigate directly to /paper -> paper trading view loads", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("navigate directly to /strategies -> strategies view loads", async ({ page }) => {
    await page.goto("/strategies");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible({ timeout: 15000 });
  });

  test("navigate directly to /options -> options view loads", async ({ page }) => {
    await page.goto("/options");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="options-view"]')).toBeVisible({ timeout: 15000 });
  });

  test("navigate directly to /settings -> settings page loads", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="settings-page"]')).toBeVisible({ timeout: 15000 });
  });

  test("navigate directly to /news -> news page loads", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="news-page"]')).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Navigation V2 - Browser Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
    await setupOptionsMocks(page);
    await setupSectorMocks(page);
  });

  test("click nav-strategies, then browser back -> returns to screener", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-strategies"]').click();
    await page.waitForURL("**/strategies");
    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible({ timeout: 15000 });

    await page.goBack();
    await page.waitForURL("**/");

    expect(page.url()).not.toContain("/strategies");
    await expect(page.locator('[data-testid="screener-page"]')).toBeVisible({ timeout: 15000 });
  });

  test("click nav-options, then browser forward -> returns to options", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-options"]').click();
    await page.waitForURL("**/options");
    await expect(page.locator('[data-testid="options-view"]')).toBeVisible({ timeout: 15000 });

    await page.goBack();
    await page.waitForURL("**/");

    await page.goForward();
    await page.waitForURL("**/options");

    expect(page.url()).toContain("/options");
    await expect(page.locator('[data-testid="options-view"]')).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Navigation V2 - Unknown Route", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
    await setupOptionsMocks(page);
    await setupSectorMocks(page);
  });

  test("navigate to /unknown-page -> redirects to screener", async ({ page }) => {
    await page.goto("/unknown-page");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    expect(page.url()).not.toContain("/unknown-page");
    await expect(page.locator('[data-testid="screener-page"]')).toBeVisible({ timeout: 15000 });
  });
});
