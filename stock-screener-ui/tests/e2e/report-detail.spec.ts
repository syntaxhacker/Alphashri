/**
 * Report B-fix evidence: GEX/readout labelling and the 390px chart edge.
 * Runs the real route with the same chain-backed tape fixture the design
 * evidence uses, so the heatmap readout has real CE/PE walls to label.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  mockNiftyReport,
  setupApiMocks,
  setupNiftyReportMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const STAGE = process.env.REPORT_FIX_STAGE ?? "after";
const ARTIFACTS = "/workspaces/react/.agent-artifacts/ui-a-plus/fixes";
const STRIKES = [22_100, 22_200, 22_300, 22_400, 22_500];

function tapeFixture() {
  const rows = Array.from({ length: 46 }, (_, i) => {
    const minute = 15 + i;
    const t = `${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const spot = 22_300 + i * 1.4;
    const chain = Object.fromEntries(
      STRIKES.map((strike, k) => {
        const distance = Math.abs(strike - spot) / 50;
        const wave = Math.round(Math.sin((i + k) / 2.2) * 420);
        return [
          String(strike),
          [
            Math.max(8, 180 - Math.abs(strike - spot) * 0.5),
            Math.max(8, 170 - Math.abs(strike - spot) * 0.45),
            1_600 + i * 16 + k * 90 + wave,
            2_100 + i * 10 + (4 - k) * 110 + distance * 40 - wave,
            400 + i * 3,
            500 + i * 2,
          ],
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

function reportFixture() {
  return {
    ...mockNiftyReport,
    wallsNear: {
      calls: [{ strike: 22_450, oi: 4_200 }],
      puts: [{ strike: 22_350, oi: 4_800 }],
    },
    strikes: mockNiftyReport.strikes.map((strike, i) => ({
      ...strike,
      ce: {
        ...strike.ce,
        oi: 1_800 + i * 120 + [220, -160, 310, -240, 140][i],
        prev_oi: 1_800 + i * 120,
        oi_change: [220, -160, 310, -240, 140][i],
        sentiment: i % 2 === 0 ? "Bullish" : "Bearish",
      },
      pe: {
        ...strike.pe,
        oi: 2_200 + (4 - i) * 110 + [-90, 180, -220, 260, -130][i],
        prev_oi: 2_200 + (4 - i) * 110,
        oi_change: [-90, 180, -220, 260, -130][i],
        sentiment: i % 2 === 0 ? "Bearish" : "Bullish",
      },
    })),
  };
}

function wallsFixture() {
  return {
    symbol: "NIFTY", date: "2026-10-12", expiry: "2026-10-14", dte: 2,
    spot: 22_363.35, max_pain: 22_400, max_pain_drift: 0, atm: 22_400,
    net_gex: null, flip: 22_350, gex_degraded: false,
    pin_distance_pts: 36.65, pin_distance_pct: 0.16, state: "QUIET",
    expiry_day: false, alert_eligible: false, alert: null, reasons: [],
    call_wall: { strike: 22_500, oi: 5_000 },
    put_wall: { strike: 22_200, oi: 6_000 },
    tracked_call_erosion_30m: null, tracked_call_erosion_5m: null,
    tracked_put_build_30m: null, near: true, cross: false,
    calls: [{ strike: 22_500, oi: 5_000, oi_open: 4_800, new_oi: 200, new_oi_pct: 0.04, distance_pct: 0.61 }],
    puts: [{ strike: 22_200, oi: 6_000, oi_open: 6_100, new_oi: -100, new_oi_pct: -0.02, distance_pct: -0.73 }],
    events: [],
    history: [
      { t: "2026-10-12T09:59:00+05:30", spot: 22_360, max_pain: 22_400, call_oi: 4_800, put_oi: 6_100 },
      { t: "2026-10-12T10:00:00+05:30", spot: 22_363.35, max_pain: 22_400, call_oi: 5_000, put_oi: 6_000 },
    ],
    freshness: { last_t: "2026-10-12T10:00:00+05:30", age_sec: 60, stale: false, rows: 46, gaps: [] },
    window_min: 60, top: 3, read: "call wall 22,500 · put wall 22,200",
  };
}

async function setup(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNiftyReportMocks(page);
  await page.route(apiRoute("reports/nifty/tape"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tapeFixture()),
    }),
  );
  await page.route(apiRoute("reports/nifty/live"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reportFixture()),
    }),
  );
  await page.route(apiRoute("reports/options/NIFTY/walls"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(wallsFixture()),
    }),
  );
  // The shared dev server binds IPv4 only; `localhost` resolves to ::1 here.
  await page.goto("http://127.0.0.1:5173/report/index");
  await expect(page.getByTestId("nifty-report-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("nifty-chart-wrap")).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
}

async function lines(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) };
  });
}

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  test(`report readout + chart edge at ${width}`, async ({ page }) => {
    await setup(page, width, height);
    const shot = `${ARTIFACTS}/report-${STAGE}-${width}.png`;
    await page.screenshot({ path: shot });

    const wrap = await page.getByTestId("nifty-chart-wrap").evaluate((el) => ({
      left: Math.round(el.getBoundingClientRect().left),
      paddingLeft: getComputedStyle(el).paddingLeft,
      gutter: el.getAttribute("data-mobile-left-gutter"),
      candles: el.getAttribute("data-pinned-candles"),
    }));
    expect.soft(page.getByTestId("nifty-chain-signal-key")).toBeVisible();
    const boundaryLabel = await page
      .getByTestId("nifty-chart-last-data-boundary")
      .locator("span")
      .last()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), right: Math.round(r.right) };
      });
    expect.soft(boundaryLabel.x).toBeGreaterThanOrEqual(0);
    expect.soft(boundaryLabel.right).toBeLessThanOrEqual(width);
    if (width === 390) {
      await expect
        .soft(page.getByTestId("nifty-mobile-walls-read"))
        .toContainText(/CE\s*[\d,]+\s*·\s*PE\s*[\d,]+/);
      await page.getByTestId("nifty-side-tab-heatmap").click();
      await page
        .getByTestId("nifty-heatmap-mobile-disclosure")
        .getByTestId("nifty-live-tape-toggle")
        .click();
      await page.getByTestId("nifty-heatmap-expand").first().click();
    }
    await expect(page.getByTestId("nifty-heatmap-read")).toBeVisible();
    const ce = await lines(page, "nifty-heatmap-read-ce");
    const pe = await lines(page, "nifty-heatmap-read-pe");
    console.log(JSON.stringify({ width, ce, pe, wrap, shot }));

    expect.soft(page.getByTestId("nifty-heatmap-spot-key")).toBeVisible();
    // CE and PE must either share a line or be two explicitly labelled lines;
    // never one labelled value plus an orphan on the next line.
    const wallGroup = await page
      .getByTestId("nifty-heatmap-read-ce")
      .evaluate((el) => el.parentElement?.getAttribute("data-testid"));
    expect.soft(wallGroup).toBe("nifty-heatmap-read-walls");
    if (width === 390) {
      expect.soft(wrap.paddingLeft).toBe("12px");
      expect.soft(wrap.gutter).toBe("12");
      const firstTick = page.getByTestId("nifty-chart-first-time-tick");
      await expect.soft(firstTick).toBeVisible();
      expect.soft(await firstTick.textContent()).toBe("09:15");
    }
  });
}

