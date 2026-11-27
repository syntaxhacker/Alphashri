/**
 * Route-level visual evidence for the Screener tab at 1600 and 390.
 *
 * This drives the real `/screener/screener` route with the shared API mocks plus
 * the screener-specific groups/snapshot/table-pref fixtures in
 * `../mocks/screenerEvidence.ts` — not a Storybook substitute. Screenshots are
 * written only when SCREENSHOT_EVIDENCE=1 so normal runs leave the tree clean.
 *
 * The 390 arm refuses to capture when the results do not fit the viewport: a
 * clipped table would be a misleading evidence image.
 */
import { test, expect } from "@playwright/test";
import { loginAsTestUser, setupApiMocks } from "../mocks/apiResponses";
import {
  SCREENER_EVIDENCE_PATH,
  setupScreenerEvidenceMocks,
} from "../mocks/screenerEvidence";
import { collectConsoleErrors } from "./helpers/flowsB";
import { waitForSettled } from "./helpers/evidenceFast";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";
const TABLE_ROWS = '[data-testid="screener-table"] tbody tr';

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  test(`captures screener at ${width}`, async ({ page }) => {
    test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
    await page.setViewportSize({ width, height });

    const consoleErrors = collectConsoleErrors(page);
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupScreenerEvidenceMocks(page);

    await page.goto(SCREENER_EVIDENCE_PATH);
    await page.waitForSelector(TABLE_ROWS, { timeout: 20000 });
    await expect(page.locator(TABLE_ROWS).first()).toBeVisible();

    // The table must be real, not an error shell.
    await expect(page.getByTestId("group-performance-error")).toHaveCount(0);
    await expect(page.getByTestId("screener-error-container")).toHaveCount(0);
    expect(consoleErrors.filter((text) => text.includes("Failed to fetch"))).toEqual([]);

    if (width === 1600) {
      await expect(page.getByTestId("group-performance-panel")).toBeVisible();
    } else {
      // Below 900 the GROUPS rail is visually removed and the results own the
      // row: symbol + primary metrics must be readable without a sideways hunt.
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panel: document.querySelector('[data-testid="screener-panel"]')?.getBoundingClientRect().width ?? 0,
        headers: [...document.querySelectorAll('[data-testid="screener-table"] thead th')]
          .filter((th) => {
            const r = th.getBoundingClientRect();
            return r.x >= 0 && r.right <= window.innerWidth + 1;
          })
          .map((th) => th.id.replace("paper-tanstack-header-", "")),
      }));
      expect(layout.overflow).toBeLessThanOrEqual(0);
      expect(layout.panel).toBeGreaterThan(350);
      expect(layout.headers).toContain("symbol");
      expect(layout.headers).toContain("sector");
    }

    await waitForSettled(page, TABLE_ROWS);
    await page.screenshot({
      path: `${process.env.SCREENER_EVIDENCE_DIR ?? "docs/screenshots/app"}/screener-${width}.png`,
      fullPage: true,
    });
  });
}
