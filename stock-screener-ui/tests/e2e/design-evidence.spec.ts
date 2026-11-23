/**
 * Route-level visual evidence for the design-system review.
 *
 * Screenshots are written only when SCREENSHOT_EVIDENCE=1 so normal CI runs
 * leave the tree untouched. These are real app routes with the shared API mocks,
 * not Storybook substitutes: the review gate needs both.
 */
import { test } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupNiftyReportMocks,
} from "../mocks/apiResponses";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";
const ROUTES = [{ name: "report", path: "/report/index" }] as const;

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  for (const route of ROUTES) {
    test(`captures ${route.name} at ${width}`, async ({ page }) => {
      test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
      await page.setViewportSize({ width, height });
      await setupApiMocks(page);
      await loginAsTestUser(page);
      if (route.name === "report") await setupNiftyReportMocks(page);
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `docs/screenshots/app/${route.name}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
