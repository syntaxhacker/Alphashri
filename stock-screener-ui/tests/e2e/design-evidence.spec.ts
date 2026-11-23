/**
 * Route-level visual evidence for the design-system review.
 *
 * Screenshots are written only when SCREENSHOT_EVIDENCE=1 so normal CI runs
 * leave the tree untouched. These are real app routes with the shared API mocks,
 * not Storybook substitutes: the review gate needs both.
 *
 * Index Report, Sector and Home are verified: their shared mocks render
 * honestly. The `/options` route is explicitly out of scope for the
 * design-system evidence wave (it has its own feature spec) — not an
 * unverified gap. Bare `/screener` and `/patterns` have their own capture specs;
 * they stay pending until their PNGs are committed.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupHomeDeskMocks,
  setupNiftyTapeMocks,
  setupSectorMocks,
} from "../mocks/apiResponses";
import { collectConsoleErrors } from "./helpers/flowsB";
import { setupNewsMocks } from "./helpers/newsHelpers";
import { apiRoute } from "../mocks/routeHelper";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";

const EVIDENCE_STRIKES = [22_100, 22_200, 22_300, 22_400, 22_500];

function evidenceTape() {
  const rows = Array.from({ length: 46 }, (_, i) => {
    const minute = 15 + i;
    const t = `${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const spot = 22_300 + i * 1.4;
    const chain = Object.fromEntries(
      EVIDENCE_STRIKES.map((strike, k) => {
        const distance = Math.abs(strike - spot) / 50;
        const ceOi = 1_500 + i * 18 + k * 90;
        const peOi = 2_000 + i * 12 + (4 - k) * 110 + distance * 40;
        return [
          String(strike),
          [Math.max(8, 180 - Math.abs(strike - spot) * 0.5), Math.max(8, 170 - Math.abs(strike - spot) * 0.45), ceOi, peOi, 400 + i * 3, 500 + i * 2],
        ];
      }),
    );
    return {
      t,
      spot,
      atm_strike: 22_400,
      max_pain: 22_400,
      flip: 22_350,
      walls: { call: 22_500, put: 22_200 },
      chain,
    };
  });
  return { date: "2026-10-12", interval_sec: 60, rows };
}

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
    setup: async (page) => {
      await setupNiftyTapeMocks(page);
      // The shared tape fixture has no per-strike chain, so the heatmap would
      // honestly render an empty panel. Give the evidence route a full minute
      // chain so the captured A++ composition shows the surface working.
      await page.route(apiRoute("reports/nifty/tape"), (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(evidenceTape()),
        }),
      );
    },
  },
  {
    name: "sector",
    path: "/sector",
    ready: '[data-testid="sector-analysis-view"]',
    setup: (page) => setupSectorMocks(page),
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
