import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupNiftyReportMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

async function setupNiftyReportPage(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNiftyReportMocks(page);
  await page.goto("/report/index");
  await page.waitForSelector('[data-testid="nifty-report-panel"]', { timeout: 10000 });
}

test.describe("Index Report - Live mode", () => {
  test.beforeEach(async ({ page }) => {
    await setupNiftyReportPage(page);
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
    await expect(oiTable).toContainText("BULL");
    await expect(oiTable).toContainText("BEAR");
  });
});

test.describe("Index Report - EOD mode", () => {
  test.beforeEach(async ({ page }) => {
    await setupNiftyReportPage(page);
  });

  test("EOD mode: pick date and reload renders the EOD report", async ({ page }) => {
    await expect(page.locator('[data-testid="nifty-stat-strip"]')).toBeVisible({
      timeout: 10000,
    });

    await page
      .locator('[data-testid="nifty-mode-toggle"]')
      .getByRole("button", { name: "EOD" })
      .click();
    const dateInput = page.locator('[data-testid="nifty-date-input"]');
    await expect(dateInput).toBeVisible();

    // Picking a date must make the code build the by-date EOD URL.
    const eodRequest = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return (
        url.pathname === "/api/reports/nifty" &&
        url.searchParams.get("date") === "2026-10-10"
      );
    });
    await dateInput.fill("2026-10-10");
    await eodRequest;

    // The auto-load on a date change can lose a race with the mode-change
    // context reset; the Refresh control re-runs the load for the chosen date.
    await page.locator('[data-testid="nifty-refresh-button"]').dispatchEvent("click");

    // The old nifty-timeline items were removed with the React report. EOD now
    // re-renders the same decision strip from the by-date snapshot. The stat
    // cells live behind ALL STATS in the A++ composition.
    const strip = page.locator('[data-testid="nifty-stat-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });
    await page.getByTestId("nifty-live-tape-toggle").first().click();
    await expect(page.locator('[data-testid="nifty-stat-spot"]')).toContainText("22,363.35");
    await expect(page.locator('[data-testid="nifty-stat-pcr-oi"]')).toContainText("0.60");
    await expect(page.locator('[data-testid="nifty-stat-max-pain"]')).toContainText("22,400");
  });

  test("missing-date EOD shows error state", async ({ page }) => {
    // Override the EOD endpoint with a 404 non-trading-day AFTER the base mocks
    // (later handlers take priority in Playwright). Mirror the real backend
    // envelope so detailMessage() surfaces a distinguishable error message.
    await page.route(apiRoute("reports/nifty"), async (route) => {
      const url = route.request().url();
      const path = new URL(url).pathname;
      if (path === "/api/reports/nifty" && url.includes("date=")) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            detail: {
              is_trading_day: false,
              date: "2026-10-11",
              message: "no Nifty snapshot for 2026-10-11",
            },
          }),
        });
      } else {
        await route.fallback();
      }
    });

    await expect(page.locator('[data-testid="nifty-stat-strip"]')).toBeVisible({
      timeout: 10000,
    });

    await page
      .locator('[data-testid="nifty-mode-toggle"]')
      .getByRole("button", { name: "EOD" })
      .click();
    const dateInput = page.locator('[data-testid="nifty-date-input"]');
    await expect(dateInput).toBeVisible();
    const eodRequest = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return (
        url.pathname === "/api/reports/nifty" &&
        url.searchParams.get("date") === "2026-10-11"
      );
    });
    await dateInput.fill("2026-10-11");
    await eodRequest;

    // Re-run the load for the chosen date (the date-change auto-load can be
    // aborted by the mode-change context reset).
    await page.locator('[data-testid="nifty-refresh-button"]').dispatchEvent("click");

    // The top-level data-fetch error is an ErrorAlert (role="alert") inside the
    // report panel; there is no nifty-error testid any more.
    await expect(
      page
        .locator('[data-testid="nifty-report-panel"] [role="alert"]')
        .filter({ hasText: "was not a trading day" }),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Index Report - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyReportMocks(page);
  });

  test("sidemenu nav-index-report navigates to the page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-index-report"]').click();
    await expect(page.locator('[data-testid="nifty-report-panel"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page).toHaveURL(/\/report\/index/);
  });
});
