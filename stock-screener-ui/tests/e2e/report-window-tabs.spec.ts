/**
 * A real mouse press inside a DESK frame raises focus before the browser
 * synthesises `click`. On a first desk visit that layout commit briefly drops
 * preset-only frames, so the pressed tab is replaced mid-press and the click is
 * swallowed. `fireEvent.click` in unit tests cannot catch this: they never run
 * the press → release → click sequence on the live desk.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupNiftyReportMocks,
} from "../mocks/apiResponses";

async function openDeskWithAnalytics(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNiftyReportMocks(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/report/index");
  await expect(page.getByTestId("nifty-report-panel")).toBeVisible();
  await page.getByTestId("nifty-report-view-desk").click();
  await expect(page.getByTestId("report-window-desk")).toBeVisible();
  await expect(page.getByTestId("window-manager-canvas")).toBeVisible();
  await expect(page.getByTestId("report-analytics-tabs")).toBeVisible();
}

const futures = (page: Page) => page.getByTestId("report-analytics-tab-futures");
const gex = (page: Page) => page.getByTestId("report-analytics-tab-gex");

test("@smoke the first real mouse click on GEX selects GEX", async ({ page }) => {
  await openDeskWithAnalytics(page);
  await expect(futures(page)).toHaveAttribute("aria-pressed", "true");
  await expect(gex(page)).toHaveAttribute("aria-pressed", "false");

  // A real mouse click: pointerdown, mousedown, mouseup, click in order. The
  // first frame must survive the press so the browser lands `click` on the tab.
  await gex(page).click();

  await expect(gex(page)).toHaveAttribute("aria-pressed", "true");
  await expect(futures(page)).toHaveAttribute("aria-pressed", "false");
});

test("a later click on another tab still works", async ({ page }) => {
  await openDeskWithAnalytics(page);
  await gex(page).click();
  await expect(gex(page)).toHaveAttribute("aria-pressed", "true");

  await futures(page).click();
  await expect(futures(page)).toHaveAttribute("aria-pressed", "true");
  await expect(gex(page)).toHaveAttribute("aria-pressed", "false");
});

test("minimize/restore keeps the panel's tab live for the first click", async ({ page }) => {
  await openDeskWithAnalytics(page);
  const analytics = page.locator('[data-window-id^="analytics-"]');
  await expect(analytics).toBeVisible();
  const minimize = analytics.locator('[data-testid^="window-minimize-"]');

  await minimize.click();
  await expect(analytics).toHaveAttribute("data-minimized", "true");
  await expect(page.getByTestId("report-analytics-tabs")).toHaveCount(0);

  await minimize.click();
  await expect(analytics).not.toHaveAttribute("data-minimized", "true");
  await expect(page.getByTestId("report-analytics-tabs")).toBeVisible();
  await expect(futures(page)).toHaveAttribute("aria-pressed", "true");

  await gex(page).click();
  await expect(gex(page)).toHaveAttribute("aria-pressed", "true");
  await expect(futures(page)).toHaveAttribute("aria-pressed", "false");
});
