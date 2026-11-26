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
  setupPatternEvidenceMocks,
} from "../mocks/patternEvidence";

const NARROW_RESULTS = '[data-testid^="patterns-narrow-result-"]';
const NARROW_WIDTH = 390;
const NARROW_HEIGHT = 844;

import { collectConsoleErrors } from "./helpers/flowsB";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";
// Overridable so a fix can capture before/after frames outside the repo's
// committed evidence tree without dirtying it.
const EVIDENCE_DIR = process.env.PATTERNS_EVIDENCE_DIR ?? "docs/screenshots/app";
const EVIDENCE_NAME = process.env.PATTERNS_EVIDENCE_NAME ?? "patterns";

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
    // Desktop keeps the dense matrix; narrow widths use the single-column
    // result list so the pattern itself is visible without sideways hunting.
    const rowSelector = width === NARROW_WIDTH ? NARROW_RESULTS : PATTERNS_EVIDENCE_RESULTS;
    await page.waitForSelector(rowSelector, { timeout: 20000 });
    const rows = page.locator(rowSelector);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), "expected at least one rendered result row").toBeGreaterThan(0);

    await expect(page.getByTestId("patterns-page")).toBeVisible();
    await expect(page.getByTestId("patterns-error")).toHaveCount(0);
    await expect(page.getByTestId("patterns-matrix-error")).toHaveCount(0);
    await expect(page.getByTestId("patterns-refreshing")).toHaveCount(0);
    expect(consoleErrors.filter((text) => text.includes("Failed to fetch"))).toEqual([]);

    if (width === NARROW_WIDTH) {
      // Every critical stat must be laid out inside the viewport, not parked at
      // the far end of a horizontally clipped strip.
      for (const key of ["scanned", "in_view", "data_through", "last_scan"]) {
        const stat = page.getByTestId(`patterns-stat-${key}`);
        await expect(stat, `${key} stat missing`).toBeVisible();
        const box = await stat.boundingBox();
        expect(box, `${key} stat has no layout box`).not.toBeNull();
        expect(box!.x, `${key} stat starts off-screen`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${key} stat is clipped`).toBeLessThanOrEqual(NARROW_WIDTH);
      }

      // The BARS/history control must fit on screen with a readable label.
      const lookback = page.getByTestId("patterns-lookback-select");
      await expect(lookback).toBeVisible();
      await expect(lookback, "BARS must stay identifiable, not collapse to 'B'").toContainText(
        /bars/i,
      );
      const barsBox = await lookback.boundingBox();
      expect(barsBox, "BARS control has no layout box").not.toBeNull();
      expect(barsBox!.x, "BARS control starts off-screen").toBeGreaterThanOrEqual(0);
      expect(barsBox!.x + barsBox!.width, "BARS control is clipped").toBeLessThanOrEqual(
        NARROW_WIDTH,
      );

      // The actual pattern result (badge + the three primary metrics) must be
      // inside the first screen, not hidden past a sideways scroll.
      const first = rows.first();
      await expect(first).toContainText("Falling Wedge");
      await expect(first.locator('[data-testid^="patterns-narrow-pattern-"]')).toBeVisible();
      for (const metric of ["score", "pos", "chg"]) {
        const cell = first.locator(`[data-testid^="patterns-narrow-${metric}-"]`);
        await expect(cell, `${metric} missing from the narrow result`).toBeVisible();
        const box = await cell.boundingBox();
        expect(box, `${metric} has no layout box`).not.toBeNull();
        expect(box!.x, `${metric} starts off-screen`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${metric} is clipped`).toBeLessThanOrEqual(NARROW_WIDTH);
        expect(box!.y + box!.height, `${metric} is below the fold`).toBeLessThan(NARROW_HEIGHT);
      }

      // The narrow list does not scroll sideways, so a stranded sideways cue
      // would be a lie. The dense table's own header hint covers desktop.
      await expect(page.getByTestId(PATTERNS_EVIDENCE_SCROLL_CUE)).toHaveCount(0);
      await expect(page.getByTestId("patterns-results-toolbar-scroll-cue")).toHaveCount(0);
    } else {
      // 1600 must keep the dense matrix and its aligned numeric columns.
      await expect(page.getByTestId("patterns-symbol-matrix")).toBeVisible();
      const scoreHeader = page.locator('[id^="paper-tanstack-header-score"]');
      await expect(scoreHeader).toBeVisible();
      await expect(page.locator('[id^="paper-tanstack-cell-score-"]').first()).toBeVisible();
    }

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${EVIDENCE_NAME}-${width}.png`,
      fullPage: true,
    });
  });
}
