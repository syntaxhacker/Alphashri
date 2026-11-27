import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupNiftyReportMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const wallPayload = {
  symbol: "NIFTY",
  date: "2026-11-09",
  expiry: "2026-11-17",
  dte: 8,
  spot: 24928.55,
  max_pain: 24800,
  max_pain_drift: 0,
  atm: 25000,
  net_gex: 0,
  flip: 25700,
  regime: "SHORT",
  gex_degraded: false,
  pin_distance_pts: 128.55,
  pin_distance_pct: 0.52,
  state: "WALL_WATCH",
  expiry_day: false,
  alert_eligible: false,
  alert: null,
  reasons: [],
  call_wall: { strike: 25000, oi: 4_440_000 },
  put_wall: { strike: 24000, oi: 4_540_000 },
  tracked_call_erosion_30m: -0.015,
  tracked_call_erosion_5m: 0.006,
  tracked_put_build_30m: 0.02,
  near: true,
  cross: false,
  calls: [
    {
      strike: 25000,
      oi: 4_440_000,
      oi_open: 3_040_000,
      ltp: 180,
      erosion_5m: 0.006,
      erosion_15m: 0.012,
      erosion_30m: -0.015,
      prem_chg_5m: 0.044,
      prem_chg_15m: 0.104,
      prem_chg_30m: 0.104,
      flow: "WRITERS_COVERING",
      status: "STABLE",
      fuel_score: 44,
      distance_pts: 71.5,
      oi_history: [4_500_000, 4_480_000, 4_440_000],
      ltp_history: [160, 170, 180],
    },
  ],
  puts: [
    {
      strike: 24000,
      oi: 4_540_000,
      oi_open: 2_780_000,
      ltp: 220,
      erosion_5m: 0.01,
      erosion_15m: 0.03,
      erosion_30m: 0.02,
      prem_chg_5m: -0.086,
      prem_chg_15m: -0.121,
      prem_chg_30m: -0.121,
      flow: "WRITERS_ADDING",
      status: "BUILDING",
      fuel_score: 22,
      distance_pts: -928.55,
      oi_history: [4_500_000, 4_520_000, 4_540_000],
      ltp_history: [240, 230, 220],
    },
  ],
  events: [],
  history: [],
  freshness: {
    last_t: "2026-11-09T13:57:00+05:30",
    age_sec: 0,
    stale: false,
    rows: 30,
    gaps: [],
  },
  window_min: 60,
  top: 3,
};

async function openReport(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNiftyReportMocks(page);
  await page.route(apiRoute("reports/options/NIFTY/walls"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(wallPayload),
    });
  });
  await page.goto("/report/index");
  await page.waitForSelector('[data-testid="nifty-report-panel"]', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="nifty-walls-desk"]', { timeout: 10_000 });
}

test.describe("Index Report - pressure desk", () => {
  test("opens the desk, reads the selected wall and switches rows", async ({ page }) => {
    await openReport(page);

    await page.getByTestId("nifty-walls-desk").click();

    const desk = page.getByTestId("pressure-desk");
    await expect(desk).toBeVisible();
    await expect(page.getByText("PRESSURE DESK")).toBeVisible();
    await expect(page.getByTestId("pressure-desk-table")).toBeVisible();
    await expect(page.getByTestId("pressure-read-name")).toHaveText("25,000 CE");
    await expect(page.getByText("Sellers are covering: OI falling, premium up.")).toBeVisible();

    await page.getByTestId("pressure-row-PUT-24000").click();
    await expect(page.getByTestId("pressure-read-name")).toHaveText("24,000 PE");
    await expect(page.getByText("Writers are adding; a break needs real absorption.")).toBeVisible();
  });
});
