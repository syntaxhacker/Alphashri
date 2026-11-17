import { test, expect, type Page } from "@playwright/test";
import { setupScreenerApp, openScreenerTable } from "./helpers/flowsB";

/**
 * Reads band + table geometry in one round-trip. `region` (the section wrapper
 * immediately below the inline band) is the stable "table region" top: a band
 * that grew past 24px would push it down. The inner <table> top must also stay
 * put across screener definitions — the section header reserves its description
 * line for every profile, so a definition without section_descriptions cannot
 * pull the table up by one text-line height.
 */
async function measureInlineFilterBand(page: Page) {
  return page.evaluate(() => {
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    const band = q("screener-inline-filters");
    const region = q("screener-approaching-section");
    const table = q("screener-table-approaching");
    const cs = band ? getComputedStyle(band) : null;
    return {
      bandTop: band ? band.getBoundingClientRect().top : null,
      bandHeight: band ? band.getBoundingClientRect().height : null,
      regionTop: region ? region.getBoundingClientRect().top : null,
      tableTop: table ? table.getBoundingClientRect().top : null,
      flexWrap: cs?.flexWrap ?? null,
      whiteSpace: cs?.whiteSpace ?? null,
      overflow: cs?.overflow ?? null,
      chipCount: document.querySelectorAll('[data-testid^="filter-chip-"]').length,
      placeholder: !!q("screener-inline-filters-empty"),
    };
  });
}

/**
 * Locks `ScreenerInlineFilters`: always mounted at a fixed 24px so gaining or
 * losing filter content can never shift the table region below it. Uses the
 * existing screener mocks/setup from flowsB — no new fixture stack.
 */
test.describe("Screener - Inline filter band geometry", () => {
  test.beforeEach(async ({ page }) => {
    await setupScreenerApp(page);
  });

  test("stays mounted at 24px with zero filters and never shifts the table region", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openScreenerTable(page, 15000);

    const band = page.getByTestId("screener-inline-filters");
    const region = page.getByTestId("screener-approaching-section");
    await expect(region).toBeVisible();
    await expect(band).toBeVisible();

    // Tag the live node: if the band ever remounts, this marker disappears.
    await band.evaluate((el) => el.setAttribute("data-e2e-band-probe", "kept"));

    // Zero filters (trending profile has none). The band is still mounted,
    // pinned to 24px and single-line; its empty state is "no filter chips".
    // NOTE: the literal "No filters" placeholder node is shadowed in production
    // by the always-present status text ("3 stocks") in the same row.
    const zero = await measureInlineFilterBand(page);
    expect(zero.bandHeight).toBe(24);
    expect(zero.flexWrap).toBe("nowrap");
    expect(zero.whiteSpace).toBe("nowrap");
    expect(zero.chipCount).toBe(0);
    expect(zero.regionTop).not.toBeNull();

    // Apply a real filter via the existing screener-select control: switching
    // to Buyer Interest+ adds three defined filters to the band and fires a
    // filtered fetch. Wait for the response AND the DOM (web-first).
    const filteredResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/screener") &&
        res.url().includes("buyer_interest_enhanced") &&
        res.ok(),
    );
    await page.getByTestId("screener-select").locator("select").selectOption("buyer_interest_enhanced");
    await filteredResponse;
    await expect(page.locator('[data-testid="filter-chip-direction"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-chip-min_score"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-chip-min_vol_surge"]')).toBeVisible();
    await expect(page.getByTestId("screener-status")).toHaveText("5 stocks");
    await expect(page.locator('[data-testid="screener-table-approaching"] tbody tr')).toHaveCount(5);

    const applied = await measureInlineFilterBand(page);
    expect(applied.bandHeight).toBe(zero.bandHeight);
    await expect
      .poll(async () => {
        const m = await measureInlineFilterBand(page);
        return m.regionTop === null || zero.regionTop === null
          ? Infinity
          : Math.abs(m.regionTop - zero.regionTop);
      })
      .toBeLessThanOrEqual(1);
    // Switching to Buyer Interest+ (no section_descriptions) must not move the
    // inner table by the 8px description-line height.
    await expect
      .poll(async () => {
        const m = await measureInlineFilterBand(page);
        return m.tableTop === null || zero.tableTop === null
          ? Infinity
          : Math.abs(m.tableTop - zero.tableTop);
      })
      .toBeLessThanOrEqual(1);

    // Remove the filter via the same control: band height and region top must
    // return to the exact zero-filter geometry, and the node must be the same.
    const unfilteredResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/screener") &&
        !res.url().includes("buyer_interest") &&
        res.ok(),
    );
    await page.getByTestId("screener-select").locator("select").selectOption("trending");
    await unfilteredResponse;
    await expect(page.locator('[data-testid="filter-chip-direction"]')).toHaveCount(0);
    await expect(page.getByTestId("screener-status")).toHaveText("3 stocks");
    // Trending's 3 stocks are 2 approaching + 1 touched.
    await expect(page.locator('[data-testid="screener-table-approaching"] tbody tr')).toHaveCount(2);

    const removed = await measureInlineFilterBand(page);
    expect(removed.bandHeight).toBe(zero.bandHeight);
    expect(removed.chipCount).toBe(0);
    await expect
      .poll(async () => {
        const m = await measureInlineFilterBand(page);
        return m.regionTop === null || zero.regionTop === null
          ? Infinity
          : Math.abs(m.regionTop - zero.regionTop);
      })
      .toBeLessThanOrEqual(1);
    // Back to trending: the inner table returns to the exact same top.
    await expect
      .poll(async () => {
        const m = await measureInlineFilterBand(page);
        return m.tableTop === null || zero.tableTop === null
          ? Infinity
          : Math.abs(m.tableTop - zero.tableTop);
      })
      .toBeLessThanOrEqual(1);
    await expect(band).toHaveAttribute("data-e2e-band-probe", "kept");
  });

  test("keeps the inner table top stable across definitions at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScreenerTable(page, 15000);

    const region = page.getByTestId("screener-approaching-section");
    await expect(region).toBeVisible();

    const zero = await measureInlineFilterBand(page);
    expect(zero.tableTop).not.toBeNull();
    expect(zero.bandHeight).toBe(24);

    // Switch to Buyer Interest+. At 390px the narrow section column made the
    // two titles wrap to different line counts (and long descriptions wrap),
    // so the header must collapse to a single title-only line for both. The
    // inner table top must not move.
    const toBuyer = page.waitForResponse(
      (res) =>
        res.url().includes("/api/screener") &&
        res.url().includes("buyer_interest_enhanced") &&
        res.ok(),
    );
    await page.getByTestId("screener-select").locator("select").selectOption("buyer_interest_enhanced");
    await toBuyer;
    await expect(page.locator('[data-testid="screener-table-approaching"] tbody tr')).toHaveCount(5);

    await expect
      .poll(async () => {
        const m = await measureInlineFilterBand(page);
        return m.tableTop === null || zero.tableTop === null
          ? Infinity
          : Math.abs(m.tableTop - zero.tableTop);
      })
      .toBeLessThanOrEqual(1);

    // Switch back to trending: the inner table returns to the exact same top.
    const toTrending = page.waitForResponse(
      (res) =>
        res.url().includes("/api/screener") &&
        !res.url().includes("buyer_interest") &&
        res.ok(),
    );
    await page.getByTestId("screener-select").locator("select").selectOption("trending");
    await toTrending;
    await expect(page.locator('[data-testid="screener-table-approaching"] tbody tr')).toHaveCount(2);

    await expect
      .poll(async () => {
        const m = await measureInlineFilterBand(page);
        return m.tableTop === null || zero.tableTop === null
          ? Infinity
          : Math.abs(m.tableTop - zero.tableTop);
      })
      .toBeLessThanOrEqual(1);
  });
});
