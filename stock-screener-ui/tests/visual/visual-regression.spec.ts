/**
 * Automated 1600/390 pixel baseline for the design-system A+ gate.
 *
 * Companion to scripts/storybook-showcase.mjs (which only writes evidence
 * screenshots). This spec asserts pixels against committed baselines in
 * tests/visual/__screenshots__/ so a visual change fails a run.
 *
 * Run through `node scripts/visual-regression.mjs`, which validates the static
 * build and the baselines before handing off to playwright.visual.config.ts.
 */
import { expect, test } from "@playwright/test";

const STORIES = [
  { name: "typography-landing", id: "design-system-typography--landing" },
  { name: "overview", id: "design-system-overview--overview" },
  { name: "inputs-landing", id: "design-system-inputs--landing" },
  { name: "data-display-landing", id: "design-system-data-display--family-landing" },
  { name: "overlay-landing", id: "design-system-overlay--family-landing" },
  { name: "foundations-landing", id: "design-system-foundations--landing" },
] as const;

// Small diff budget: ~10% per-pixel colour tolerance and at most 100 pixels
// that still differ. Anything beyond that is a real visual change.
const SCREENSHOT_OPTIONS = {
  fullPage: true,
  animations: "disabled",
  caret: "hide",
  threshold: 0.1,
  maxDiffPixels: 100,
} as const;

for (const story of STORIES) {
  test(`${story.name} at both breakpoints`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, {
      waitUntil: "networkidle",
    });
    await page.locator("#storybook-root").waitFor({ state: "visible" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(250);

    await expect(page).toHaveScreenshot(story.name, SCREENSHOT_OPTIONS);
  });
}
