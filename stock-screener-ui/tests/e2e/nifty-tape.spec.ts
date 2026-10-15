import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupNiftyTapeMocks,
  mockNiftyTape,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

test.describe("Nifty Report - OI tape panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyTapeMocks(page);
    await page.goto("/report/nifty");
    await page.waitForSelector('[data-testid="nifty-tape-panel"]', { timeout: 10000 });
  });

  test("@smoke tape panel renders header stats", async ({ page }) => {
    const panel = page.locator('[data-testid="nifty-tape-panel"]');
    await expect(panel).toBeVisible({ timeout: 10000 });

    const head = panel.locator('[data-testid="nifty-tape-head"]');
    // Labels sit on the field wrappers (nifty-tape-<field>); the -head-* spans
    // carry only the value. Assert each label where it actually is. Regexes are
    // case-insensitive because the labels are uppercased via CSS text-transform,
    // which text assertions may or may not reflect.
    await expect(head.locator('[data-testid="nifty-tape-pcr"]')).toContainText(/PCR OI/i);
    await expect(head.locator('[data-testid="nifty-tape-max-pain"]')).toContainText(/MAX PAIN/i);
    await expect(head.locator('[data-testid="nifty-tape-flip"]')).toContainText(/FLIP/i);
    await expect(head.locator('[data-testid="nifty-tape-walls"]')).toContainText(/WALLS/i);
    // Spot-check values derived from the last chronological fixture row (09:19).
    await expect(head.locator('[data-testid="nifty-tape-head-pcr-oi"]')).toContainText("0.62");
    await expect(head.locator('[data-testid="nifty-tape-head-max-pain"]')).toContainText(
      "22,400",
    );
    await expect(head.locator('[data-testid="nifty-tape-head-flip"]')).toContainText("22,350");
    await expect(head.locator('[data-testid="nifty-tape-head-walls"]')).toContainText(
      "22,500 / 22,200",
    );
  });

  test("tape rows render latest-first", async ({ page }) => {
    const table = page.locator('[data-testid="nifty-tape-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.getByTestId("nifty-tape-row");
    await expect(rows).toHaveCount(mockNiftyTape.rows.length, { timeout: 10000 });
    // Fixture is served chronological (09:16 first); the panel sorts latest-first.
    // Row testids carry no time suffix (NiftyTapeTable getRowTestId is constant),
    // so ordering is asserted via each row's IST time cell instead.
    await expect(rows.first().getByTestId("nifty-tape-time")).toContainText("09:19");
    await expect(rows.last().getByTestId("nifty-tape-time")).toContainText("09:16");
  });
});

test.describe("Nifty Report - OI tape empty state", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyTapeMocks(page);
    // Override the tape endpoint with an empty payload AFTER the base mocks
    // (later handlers take priority in Playwright).
    await page.route(apiRoute("reports/nifty/tape"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rows: [] }),
      });
    });
    await page.goto("/report/nifty");
    await page.waitForSelector('[data-testid="nifty-tape-panel"]', { timeout: 10000 });
  });

  test("empty tape shows empty state with no table", async ({ page }) => {
    await expect(page.locator('[data-testid="nifty-tape-empty"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="nifty-tape-table"]')).toHaveCount(0);
  });
});

test.describe("Nifty Report - OI tape auto-refresh", () => {
  test("live auto-refresh refetches tape", async ({ page }) => {
    let tapeHits = 0;
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyTapeMocks(page);
    // Counting override registered last so it wins; still serves the fixture.
    // The panel fetches the tape with every live report load, so the 30s live
    // poll loop refetches it without any manual refresh.
    await page.route(apiRoute("reports/nifty/tape"), async (route) => {
      tapeHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockNiftyTape),
      });
    });
    await page.goto("/report/nifty");
    await page.waitForSelector('[data-testid="nifty-tape-panel"]', { timeout: 10000 });

    // No sleeps: poll the request counter until the live loop refetches.
    // Timeout covers the panel's live poll cadence (30s) plus margin.
    await expect.poll(async () => tapeHits, { timeout: 45000 }).toBeGreaterThanOrEqual(2);
  });
});
