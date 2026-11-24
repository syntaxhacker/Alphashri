/**
 * The decision strip must not overlap its own cells.
 *
 * Regression guard for a real defect: hand-tuned flex weights survived while
 * every cell grew, so PRICE was allotted 389px for five cells that needed 547
 * and `Regime`/`Max-OI call` collided by 68px on the same row. The strip's own
 * unit suite passed throughout because none of it looks at layout.
 *
 * Screenshots are written only when SCREENSHOT_EVIDENCE=1 so a CI run does not
 * touch the repo.
 */
import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupNiftyReportMocks } from "../mocks/apiResponses";

const CELL_IDS = [
  "nifty-hero-spot-read",
  "nifty-hero-change-read",
  "nifty-decision-state",
];

async function openReport(page: import("@playwright/test").Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNiftyReportMocks(page);
  await page.goto("/report/index");
  await page.waitForSelector('[data-testid="nifty-report-panel"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="nifty-decision-hero"]', { timeout: 10000 });
}

async function assertNoOverlap(page: import("@playwright/test").Page) {
  const boxes = await page.evaluate((ids) => {
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { id, x: r.x, right: r.right, y: Math.round(r.y) };
    });
  }, CELL_IDS);

  const present = boxes.filter((b): b is NonNullable<typeof b> => b !== null);
  expect(present.length, "no decision cells rendered").toBeGreaterThanOrEqual(2);

  const overlaps: string[] = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i];
      const b = present[j];
      if (a.y === b.y && a.x < b.right - 0.5 && b.x < a.right - 0.5) {
        overlaps.push(`${a.id} x ${b.id}`);
      }
    }
  }
  expect(overlaps, `cells overlapping on the same row: ${overlaps.join(", ")}`).toEqual([]);
}

test("@smoke the decision strip never overlaps its own cells", async ({ page }) => {
  await openReport(page);
  await assertNoOverlap(page);
});

for (const width of [1280, 1600, 390]) {
  test(`@smoke no overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openReport(page);
    await assertNoOverlap(page);
  });
}

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";

for (const [name, width, height] of [
  ["1600", 1600, 900],
  ["390", 390, 844],
] as const) {
  test(`captures the strip at ${name}`, async ({ page }) => {
    test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
    await page.setViewportSize({ width, height });
    await openReport(page);
    await page.screenshot({
      path: `docs/screenshots/report-strip-overlap/strip-${name}.png`,
      fullPage: false,
    });
  });
}
