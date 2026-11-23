/**
 * Route-level visual evidence for the design-system review.
 *
 * Screenshots are written only when SCREENSHOT_EVIDENCE=1 so normal CI runs
 * leave the tree untouched. These are real app routes with the shared API mocks,
 * not Storybook substitutes: the review gate needs both.
 *
 * Index Report, Sector, Options and Home are verified: their shared mocks
 * render honestly. The bare `/screener` and `/patterns` routes remain
 * unverified unless another agent adds them — their shared mocks are incomplete
 * and render errors or broken layouts, so they are absent until honest mocks
 * exist.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupHomeDeskMocks,
  setupNiftyReportMocks,
  setupOptionsMocks,
  setupSectorMocks,
} from "../mocks/apiResponses";
import { collectConsoleErrors } from "./helpers/flowsB";
import { setupNewsMocks } from "./helpers/newsHelpers";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";

type EvidenceRoute = {
  name: string;
  path: string;
  ready?: string;
  setup?: (page: Page) => Promise<void>;
  afterGoto?: (page: Page) => Promise<void>;
  verify?: (page: Page) => Promise<void>;
  waitForNetworkIdle?: boolean;
};

const homeConsoleErrors = new WeakMap<Page, string[]>();

const ROUTES: readonly EvidenceRoute[] = [
  {
    name: "report",
    path: "/report/index",
    setup: (page) => setupNiftyReportMocks(page),
  },
  {
    name: "sector",
    path: "/sector",
    ready: '[data-testid="sector-analysis-view"]',
    setup: (page) => setupSectorMocks(page),
  },
  {
    name: "options",
    path: "/options",
    ready: '[data-testid="options-chain-panel"]',
    setup: (page) => setupOptionsMocks(page),
  },
  {
    name: "home",
    path: "/home",
    ready: '[data-testid="window-manager-canvas"]',
    // The desk's seeded panels poll every 5s, so networkidle is not a stable
    // readiness signal; the desk root plus the panel assertions below are.
    waitForNetworkIdle: false,
    setup: async (page) => {
      homeConsoleErrors.set(page, collectConsoleErrors(page));
      // Same order as home-desk.spec.ts: Playwright gives later routes priority.
      await setupNewsMocks(page);
      await setupHomeDeskMocks(page);
    },
    // The rail is behind a drawer below 900px, so `nav-home` is not clickable
    // at 390. Load the real route directly, then switch it to the desk view.
    afterGoto: async (page) => {
      await expect(page).toHaveURL(/\/home$/);
      await expect(page.getByTestId("home-page")).toBeVisible();
      await page.getByTestId("home-view-desk").click();
    },
    verify: async (page) => {
      await expect(page.getByTestId("market-heatmap-panel")).toHaveCount(1);
      await expect(page.getByTestId("market-heatmap-loading")).toHaveCount(0);
      await expect(page.getByTestId("market-heatmap-error")).toHaveCount(0);
      await expect(page.getByTestId("options-chain-window")).toHaveCount(1);
      await expect(page.getByTestId("options-chain-loading")).toHaveCount(0);
      await expect(page.getByTestId("options-chain-empty")).toHaveCount(0);
      await expect(page.getByTestId("options-chain-error")).toHaveCount(0);
      expect(homeConsoleErrors.get(page)).toEqual([]);
    },
  },
];

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
      await route.setup?.(page);
      await page.goto(route.path);
      await route.afterGoto?.(page);
      if (route.ready) await page.waitForSelector(route.ready, { timeout: 20000 });
      if (route.waitForNetworkIdle !== false) await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await route.verify?.(page);
      await page.screenshot({
        path: `docs/screenshots/app/${route.name}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
