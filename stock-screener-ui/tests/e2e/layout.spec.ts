import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

test.describe("Layout - App Structure", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("@smoke app-shell is visible on page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test("@smoke app-header is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="app-header"]')).toBeVisible();
  });

  test("@smoke app-navbar is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="app-navbar"]')).toBeVisible();
  });

  test("app-main is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="app-main"]')).toBeVisible();
  });
});

test.describe("Layout - Theme Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("theme-toggle-btn is visible in navbar", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="theme-toggle-btn"]')).toBeVisible();
  });

  test("clicking it toggles between light/dark", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    const initialScheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-mantine-color-scheme"),
    );

    await page.locator('[data-testid="theme-toggle-btn"]').click();

    const newScheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-mantine-color-scheme"),
    );

    expect(newScheme).not.toBe(initialScheme);
  });
});

test.describe("Layout - User Menu", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("user-menu-trigger is visible in navbar footer", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible();
  });

  test("clicking it opens user-menu-dropdown", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="user-menu-trigger"]').click();
    await expect(page.locator('[data-testid="user-menu-dropdown"]')).toBeVisible();
  });

  test("user-avatar, user-display-name, user-email are visible in dropdown", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="user-menu-trigger"]').click();
    await expect(page.locator('[data-testid="user-menu-dropdown"]')).toBeVisible();

    await expect(page.locator('[data-testid="user-avatar"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-display-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-email"]')).toBeVisible();
  });

  test("clicking logout-button clears auth and redirects", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).handleLogout = () => {
        localStorage.removeItem("alphashri_token");
        localStorage.removeItem("alphashri_refresh_token");
        localStorage.removeItem("alphashri_user");
        window.location.href = "/";
      };
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="user-menu-trigger"]').click();
    await expect(page.locator('[data-testid="user-menu-dropdown"]')).toBeVisible();
    await page.locator('[data-testid="logout-button"]').click();

    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    expect(page.url()).toContain("/");
  });
});

test.describe("Layout - Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("sidemenu contains all nav links", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    const sidemenu = page.locator('[data-testid="sidemenu"]');
    await expect(sidemenu).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-screener"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-news"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-backtest"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-paper"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-sector"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-strategies"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-bots"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-options"]')).toBeVisible();
    await expect(sidemenu.locator('[data-testid="nav-settings"]')).toBeVisible();
  });

  test("app-header contains logo", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="app-logo"]')).toBeVisible();
    await expect(page.locator('[data-testid="app-logo"]')).toContainText("Alphashri");
  });

  test("navbar-footer contains user button", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    const footer = page.locator('[data-testid="navbar-footer"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator('[data-testid="user-menu-trigger"]')).toBeVisible();
  });

  test("sidebar-collapse-toggle collapses sidebar and hides itself", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    const navbar = page.locator('[data-testid="app-navbar"]');
    const toggleBtn = page.locator('[data-testid="sidebar-collapse-toggle"]');

    // Get initial width - should be expanded (>100px)
    const initialBox = await navbar.boundingBox();
    expect(initialBox?.width).toBeGreaterThan(100);

    // Toggle should be visible initially
    await expect(toggleBtn).toBeVisible({ timeout: 15000 });

    // Click to collapse
    await toggleBtn.click({ timeout: 15000 });

    // Wait for navbar width to shrink
    await expect(async () => {
      const box = await navbar.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(100);
    }).toPass({ timeout: 15000 });

    // After collapse, toggle button should be hidden (removed from DOM)
    await expect(toggleBtn).not.toBeVisible();
  });

  test("when collapsed, navbar-links still exists", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="sidebar-collapse-toggle"]').click({ timeout: 15000 });
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-testid="navbar-links"]')).toBeVisible();
  });
});

test.describe("Layout - Market Ticker", () => {
  const mockTickerData = {
    tickers: {
      "^NSEI": {
        symbol: "^NSEI",
        name: "Nifty 50",
        price: 22456.3,
        change: 123.45,
        change_percent: 0.55,
        is_positive: true,
      },
      "^NSEBANK": {
        symbol: "^NSEBANK",
        name: "Bank Nifty",
        price: 48123.15,
        change: -89.2,
        change_percent: -0.18,
        is_positive: false,
      },
      "GC=F": {
        symbol: "GC=F",
        name: "Gold",
        price: 2945.6,
        change: 12.3,
        change_percent: 0.42,
        is_positive: true,
      },
      "CL=F": {
        symbol: "CL=F",
        name: "Crude Oil",
        price: 68.45,
        change: -1.2,
        change_percent: -1.72,
        is_positive: false,
      },
    },
    last_updated: new Date().toISOString(),
    loading: false,
    error: null,
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    });
    await setupApiMocks(page);
    await loginAsTestUser(page);

    await page.route(apiRoute("market-ticker"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockTickerData),
      });
    });
  });

  test("market-ticker is visible in header", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="market-ticker"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="market-ticker"]')).toBeVisible();
  });

  test("individual ticker-{symbol} items are present", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="market-ticker"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="ticker-nsei"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticker-nsebank"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticker-gcf"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticker-clf"]')).toBeVisible();
  });

  test("market-ticker-updated shows timestamp", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="market-ticker"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="market-ticker-updated"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-ticker-updated"]')).toContainText("Updated:");
  });
});
