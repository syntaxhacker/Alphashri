import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Screener - Market movers view (dashboard folded into Market)", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("renders dashboard sections inside the Market workspace, hides filter rail and search, dock absent before click", async ({ page }) => {
    await page.goto("/screener?tab=market&view=movers");

    await expect(page.getByTestId("screener-dashboard")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("dashboard-section-movers")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("dashboard-section-unusual")).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("market-filter-rail")).toHaveCount(0);
    await expect(page.getByTestId("market-search")).toHaveCount(0);
    await expect(page.getByTestId("symbol-dock")).toHaveCount(0);
  });

  test("clicking a dashboard row opens the in-flow symbol dock, not /chart/:symbol", async ({
    page,
  }) => {
    await page.goto("/screener?tab=market&view=movers");

    await expect(page.getByTestId("dashboard-section-movers")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("dashboard-row-gainers-INDIAGLYCO")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("dashboard-row-gainers-INDIAGLYCO").click();

    await expect(page.getByTestId("symbol-dock")).toBeVisible({ timeout: 10000 });
  });

  test("tab=dashboard redirects to market view=movers", async ({ page }) => {
    await page.goto("/screener?tab=dashboard");

    await expect(page.getByTestId("screener-dashboard")).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(
      /screener(\/market)?\?view=movers/,
      { timeout: 10000 },
    );
  });

  test("the Dashboard tab button no longer exists", async ({ page }) => {
    await page.goto("/screener?tab=market&view=movers");

    await expect(page.getByTestId("tab-dashboard")).toHaveCount(0);
  });
});
