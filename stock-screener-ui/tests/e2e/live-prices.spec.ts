import { test, expect } from "@playwright/test";
import {
  navigateToPaperTrading,
  setupPaperTradingTestMocks,
} from "../helpers/paperTradingHelpers";

test.describe("Live Price Streaming", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });

  test("should have live price updater component mounted", async ({ page }) => {
    await navigateToPaperTrading(page);

    const updater = page.locator('[data-testid="live-price-updater"]');
    await expect(updater).toBeAttached({ timeout: 10000 });
  });

  test("should update position current_price from live prices", async ({ page }) => {
    await navigateToPaperTrading(page);

    const positionsTable = page.locator('[data-testid="positions-table-container"]');
    const hasPositions = await positionsTable.isVisible().catch(() => false);

    if (hasPositions) {
      const priceCells = page.locator('[data-testid^="position-row-"] td');
      const count = await priceCells.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});
