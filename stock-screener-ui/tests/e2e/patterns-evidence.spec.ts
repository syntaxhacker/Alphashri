/**
 * Route-level visual evidence for the Chart Patterns page at 1600 and 390.
 *
 * This drives the real `/patterns` route with the shared API mocks, the
 * chart-patterns mocks from the home desk, and the result/matrix/summary
 * fixtures in `../mocks/patternEvidence.ts` — not a Storybook substitute.
 * Screenshots are written only when SCREENSHOT_EVIDENCE=1 so normal runs leave
 * the tree clean.
 *
 * The capture is gated on an honest frame: no "Failed to fetch" console noise,
 * no visible error alert, and at least one real result row. The 390 arm also
 * refuses to capture a clipped grid that offers no sideways-scroll cue.
 */
import { test, expect } from "@playwright/test";
import { loginAsTestUser, setupApiMocks } from "../mocks/apiResponses";
import { setupHomePatternMocks } from "../mocks/homeDeskFixtures";
import {
  PATTERNS_EVIDENCE_PATH,
  PATTERNS_EVIDENCE_RESULTS,
  PATTERNS_EVIDENCE_SCROLL_CUE,
  PATTERNS_EVIDENCE_SCROLL_REGION,
  setupPatternEvidenceMocks,
} from "../mocks/patternEvidence";
import { collectConsoleErrors } from "./helpers/flowsB";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  test(`captures patterns at ${width}`, async ({ page }) => {
    test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
    await page.setViewportSize({ width, height });

    const consoleErrors = collectConsoleErrors(page);
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupHomePatternMocks(page);
    await setupPatternEvidenceMocks(page);

    await page.goto(PATTERNS_EVIDENCE_PATH);

    // Wait for a settled result row, not a loading/skeleton or error shell.
    await page.waitForSelector(PATTERNS_EVIDENCE_RESULTS, { timeout: 20000 });
    const rows = page.locator(PATTERNS_EVIDENCE_RESULTS);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), "expected at least one rendered result row").toBeGreaterThan(0);

    await expect(page.getByTestId("patterns-page")).toBeVisible();
    await expect(page.getByTestId("patterns-error")).toHaveCount(0);
    await expect(page.getByTestId("patterns-matrix-error")).toHaveCount(0);
    await expect(page.getByTestId("patterns-refreshing")).toHaveCount(0);
    expect(consoleErrors.filter((text) => text.includes("Failed to fetch"))).toEqual([]);

    if (width === 390) {
      const scrollRegion = page.getByTestId(PATTERNS_EVIDENCE_SCROLL_REGION);
      await expect(scrollRegion).toBeVisible();
      // The table owns a nested scrollport; either one overflowing means the
      // narrow frame needs its scroll affordance to be honest evidence.
      const clipped = await scrollRegion.evaluate((el) => {
        const inner = el.querySelector<HTMLElement>(".paper-tanstack-scroll");
        return [el, inner].some(
          (node) => node != null && node.scrollWidth > node.clientWidth + 1,
        );
      });
      await expect(
        page.getByTestId(PATTERNS_EVIDENCE_SCROLL_CUE),
        clipped
          ? "390 patterns grid clips without a scroll cue — refusing to capture"
          : "390 patterns view must expose its sideways-scroll cue",
      ).toBeVisible();
    }

    await page.screenshot({
      path: `docs/screenshots/app/patterns-${width}.png`,
      fullPage: true,
    });
  });
}
