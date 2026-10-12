import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupNiftyReportMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

test.describe("Nifty Report - Live mode", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyReportMocks(page);
    await page.goto("/report/nifty");
    await page.waitForSelector('[data-testid="nifty-report-panel"]', { timeout: 10000 });
  });

  test("@smoke live mode renders stat strip + chart + OI rows from mock", async ({ page }) => {
    const strip = page.locator('[data-testid="nifty-stat-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="nifty-stat-spot"]')).toContainText("22,363.35");
    await expect(page.locator('[data-testid="nifty-stat-pcr-oi"]')).toContainText("0.60");
    await expect(page.locator('[data-testid="nifty-stat-pcr-vol"]')).toContainText("1.21");
    await expect(page.locator('[data-testid="nifty-stat-max-pain"]')).toContainText("22,400");

    await expect(page.locator('[data-testid="nifty-chart-wrap"]')).toBeVisible();

    const oiTable = page.locator('[data-testid="nifty-oi-table"]');
    await expect(oiTable).toBeVisible();
    for (const strike of ["22,100", "22,200", "22,300", "22,400", "22,500"]) {
      await expect(oiTable).toContainText(strike);
    }
    await expect(oiTable).toContainText("Bullish");
    await expect(oiTable).toContainText("Bearish");
  });
});

test.describe("Nifty Report - EOD mode", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyReportMocks(page);
    await page.goto("/report/nifty");
    await page.waitForSelector('[data-testid="nifty-report-panel"]', { timeout: 10000 });
  });

  test("EOD mode: pick date via fill shows timeline events", async ({ page }) => {
    await expect(page.locator('[data-testid="nifty-stat-strip"]')).toBeVisible({
      timeout: 10000,
    });

    await page.locator('[data-testid="nifty-mode-toggle"]').getByText("EOD").click();
    const dateInput = page.locator('[data-testid="nifty-date-input"]');
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-10-10");

    const timeline = page.locator('[data-testid="nifty-timeline"]');
    await expect(timeline).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="nifty-timeline-item-0"]')).toContainText(
      "EOD Open",
    );
    await expect(page.locator('[data-testid="nifty-timeline-item-1"]')).toContainText(
      "EOD Midday",
    );
    await expect(page.locator('[data-testid="nifty-timeline-item-2"]')).toContainText(
      "EOD Close",
    );
  });

  test("missing-date EOD shows error state", async ({ page }) => {
    // Override the EOD endpoint with a 404 non-trading-day AFTER the base mocks
    // (later handlers take priority in Playwright).
    await page.route(apiRoute("reports/nifty"), async (route) => {
      const url = route.request().url();
      const path = new URL(url).pathname;
      if (path === "/api/reports/nifty" && url.includes("date=")) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ is_trading_day: false }),
        });
      } else {
        await route.fallback();
      }
    });

    await expect(page.locator('[data-testid="nifty-stat-strip"]')).toBeVisible({
      timeout: 10000,
    });

    await page.locator('[data-testid="nifty-mode-toggle"]').getByText("EOD").click();
    const dateInput = page.locator('[data-testid="nifty-date-input"]');
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-10-11");

    await expect(page.locator('[data-testid="nifty-error"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Nifty Report - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyReportMocks(page);
  });

  test("sidemenu nav-nifty-report navigates to the page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-nifty-report"]').click();
    await expect(page.locator('[data-testid="nifty-report-panel"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page).toHaveURL(/\/report\/nifty/);
  });
});
