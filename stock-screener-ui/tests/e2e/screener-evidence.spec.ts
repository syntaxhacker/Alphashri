/**
 * Route-level visual evidence for the Screener tab at 1600 and 390.
 *
 * This drives the real `/screener/screener` route with the shared API mocks plus
 * the screener-specific groups/snapshot/table-pref fixtures in
 * `../mocks/screenerEvidence.ts` — not a Storybook substitute. Screenshots are
 * written only when SCREENSHOT_EVIDENCE=1 so normal runs leave the tree clean.
 *
 * The 390 arm refuses to capture when the sideways-scroll cue is missing: a
 * clipped table with no scroll affordance would be a misleading evidence image.
 */
import { test, expect } from "@playwright/test";
import { loginAsTestUser, setupApiMocks } from "../mocks/apiResponses";
import {
  SCREENER_EVIDENCE_PATH,
  setupScreenerEvidenceMocks,
} from "../mocks/screenerEvidence";
import { collectConsoleErrors } from "./helpers/flowsB";

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

    // GROUPS and the table must both be real, not error shells.
    await expect(page.getByTestId("group-performance-panel")).toBeVisible();
    await expect(page.getByTestId("group-performance-error")).toHaveCount(0);
    await expect(page.getByTestId("screener-error-container")).toHaveCount(0);
    expect(consoleErrors.filter((text) => text.includes("Failed to fetch"))).toEqual([]);

    if (width === 390) {
      // Below `sm` the table scrolls sideways; the cue is the only affordance.
      // Missing cue => fail before writing the PNG rather than commit a clipped,
      // misleading 390 capture.
      // The approaching/touched panels each mount their own table cue; either
      // one visible proves the 390 scroll affordance rendered.
      await expect(page.getByTestId("screener-table-scroll-cue").first()).toBeVisible();
    }

    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: `docs/screenshots/app/screener-${width}.png`,
      fullPage: true,
    });
  });
}
