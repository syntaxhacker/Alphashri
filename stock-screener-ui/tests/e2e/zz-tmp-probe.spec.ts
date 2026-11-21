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

test("probe", async ({ page }) => {
  page.on("console", (m) => console.log("[console]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await openReport(page);

  const info = await page.evaluate(() => {
    const deskButtons = Array.from(document.querySelectorAll('[data-testid="nifty-walls-desk"]'));
    return {
      viewport: [window.innerWidth, window.innerHeight],
      deskMode: window.localStorage.getItem("nifty.deskMode"),
      deskButtonCount: deskButtons.length,
      deskButtonsIn: deskButtons.map((b) => {
        const card = b.closest('[data-testid]');
        const panel = b.closest('[data-testid="nifty-report-strips"]');
        const rail = b.closest('[data-testid="desk-insight-rail"]');
        return {
          cardTestId: card?.getAttribute("data-testid"),
          inStrips: !!panel,
          inRail: !!rail,
        };
      }),
      hasStrips: !!document.querySelector('[data-testid="nifty-report-strips"]'),
      hasDock: !!document.querySelector('[data-testid="desk-dock"]'),
      dockTabActive: document.querySelector('[data-testid="desk-dock"]')?.getAttribute("data-dock-open"),
      hasDockDrawer: !!document.querySelector('[data-testid="desk-dock-drawer"]'),
      contentOverflow: document.querySelector('[data-testid="nifty-report-content"]')
        ? getComputedStyle(document.querySelector('[data-testid="nifty-report-content"]')!).overflow
        : null,
      hasPressureDesk: !!document.querySelector('[data-testid="pressure-desk"]'),
      modeButton: document.querySelector('[data-testid="nifty-desk-mode"]')?.textContent ?? null,
    };
  });
  console.log("BEFORE", JSON.stringify(info, null, 2));

  await page.getByTestId("nifty-walls-desk").first().click();
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => ({
    hasPressureDesk: !!document.querySelector('[data-testid="pressure-desk"]'),
    hasPanelModal: !!document.querySelector('[data-testid="panel-modal"]'),
    panels: Array.from(document.querySelectorAll('[data-testid="panel-modal"]')).map((p) => ({
      variant: p.getAttribute("data-variant"),
      body: p.querySelector('[data-testid="panel-modal-title"]')?.textContent?.slice(0, 60),
    })),
    hasStrips: !!document.querySelector('[data-testid="nifty-report-strips"]'),
    dockDrawer: !!document.querySelector('[data-testid="desk-dock-drawer"]'),
    bodyScroll: document.body.innerText.includes("PRESSURE DESK"),
    dockText: document.querySelector('[data-testid="desk-dock"]')?.textContent,
  }));
  console.log("AFTER", JSON.stringify(after, null, 2));
  expect(true).toBe(true);
});
