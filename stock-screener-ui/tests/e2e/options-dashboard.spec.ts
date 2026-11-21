import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * Full-screen Options Analytics dashboard (4 chart pillars).
 *
 * Everything is mocked: one analytics request on open, the four pillar tabs
 * switch the same payload, and every pillar renders aria-labelled 2D charts.
 * Each engine block carries the RAW parallel arrays the fixed DTO projects
 * into chart-ready series — an aggregate-only payload renders 7 fail-soft
 * overlays instead of charts.
 */

const STRIKES = [1380, 1400, 1420, 1440, 1460];
const DATES = ["2026-11-26", "2026-12-31"];

/** Pillar tab → chart test ids it renders. 14 charts across all four pillars. */
const PILLARS = [
  { key: "positioning", charts: ["oi-strike-chart", "doi-volume-chart", "max-pain-chart", "pcr-strike-chart"] },
  { key: "dealer", charts: ["gex-profile-chart", "dex-profile-chart", "vanna-charm-chart", "theta-decay-chart"] },
  { key: "liquidity", charts: ["spread-heatmap-chart", "vol-oi-chart"] },
  { key: "volatility", charts: ["iv-smile-chart", "term-structure-chart", "rnd-density-chart", "iv-rv-cone-chart"] },
] as const;

const TOTAL_CHARTS = PILLARS.reduce((sum, pillar) => sum + pillar.charts.length, 0);

function density() {
  return STRIKES.map((strike, i) => ({
    spot: strike,
    prob: 0.04 + Math.exp(-Math.pow(i - 2, 2)) * 0.09,
  }));
}

function wire() {
  const levels = {
    call_wall: { strike: 1460, side: "above", strength: 0.8 },
    put_wall: { strike: 1380, side: "below", strength: 0.7 },
    max_pain: { strike: 1420, side: "at", strength: 0.55 },
    gex: {
      support: { strike: 1400, side: "below", strength: 0.5 },
      resistance: { strike: 1440, side: "above", strength: 0.6 },
    },
  };
  const expiries = DATES.map((date, index) => ({
    date,
    dteDays: 9 + index * 25,
    spot: 1420,
    atmIv: 22.4 - index * 0.9,
    metrics: { rr25: 0.8, fly25: 0.6, slope: -0.02, r2: 0.94, n: STRIKES.length * 2 },
    iv: STRIKES.map((strike, i) => {
      const iv = 22 + Math.abs(strike - 1420) * 0.02;
      return {
        strike,
        ceIv: i === 0 && index === 0 ? null : Number((iv + 0.15).toFixed(2)),
        peIv: Number((iv - 0.15).toFixed(2)),
        ceDelta: Number((0.9 - i * 0.18).toFixed(2)),
        peDelta: Number((-(0.9 - i * 0.18)).toFixed(2)),
        ceOi: 20_000 + i * 3_000,
        peOi: 18_000 + i * 2_000,
      };
    }),
    levels: index === 0 ? levels : undefined,
    // Raw api/options_positioning arrays, parallel to `strikes`.
    positioning: {
      netDealerDelta: 1_200,
      netClientDelta: -900,
      callWriterOi: 34_000,
      putWriterOi: 26_000,
      pcr: 1.05,
      pcrVolume: 0.98,
      initiativeRatio: 0.6,
      topStrikes: STRIKES.map((strike) => ({ strike, netDelta: 400, oiChange: 1_200 })),
      strikes: STRIKES,
      ceOi: [22_000, 25_000, 28_000, 31_000, 34_000],
      peOi: [18_000, 20_000, 22_000, 24_000, 26_000],
      ceOiChange: [1_200, -800, 1_500, -400, 900],
      peOiChange: [-1_000, 700, -1_100, 600, -500],
      ceVolume: [4_000, 3_700, 3_400, 3_100, 2_800],
      peVolume: [3_500, 3_300, 3_100, 2_900, 2_700],
      pcrByStrike: [0.8, 0.9, 1.0, 1.1, 1.2],
      pcrVolumeByStrike: [0.9, 0.95, 1.0, 1.05, 1.1],
      maxPainCurve: STRIKES.map((strike, i) => ({ strike, payout: 1_000 - i * 100 })),
      maxPain: 1420,
      walls: { callWall: { strike: 1460 }, putWall: { strike: 1380 } },
      totals: { ceOi: 140_000, peOi: 110_000, ceVolume: 16_000, peVolume: 15_000 },
    },
    // Raw api/options_dealer per-strike greeks + theta-by-tenor.
    dealer: {
      netGex: 2_400,
      netDex: 900,
      vanna: 40,
      charm: -25,
      theta: -12,
      gammaFlip: { level: 1420, regime: "positive", flipped: false },
      regime: "positive",
      support: 1400,
      resistance: 1440,
      fuelUp: null,
      fuelDown: null,
      degraded: false,
      zeroGamma: 1420,
      strikes: STRIKES.map((strike, i) => ({
        strike,
        netGex: i < 2 ? -1_200 : 1_500 + i * 100,
        netDex: i < 2 ? -800 : 900,
        vanna: 40,
        charm: -25,
        theta: -12 - i * 2,
        ceOi: 20_000 + i * 3_000,
        peOi: 18_000 + i * 2_000,
        ceIv: 22,
        peIv: 22,
      })),
      thetaByDte: DATES.map((_, i) => ({ dteDays: 9 + i * 25, theta: -12 - i * 2 })),
    },
    // Raw api/options_liquidity arrays, parallel to `strikes`.
    liquidity: {
      totalOi: 100_000,
      totalVolume: 30_000,
      avgSpreadPct: 0.3,
      medianSpreadPct: 0.25,
      liquidStrikes: 8,
      maxOiStrike: 1460,
      thin: false,
      strikes: STRIKES,
      // Front expiry's first strike has no two-sided quote -> a null cell.
      ceSpreadPct: index === 0 ? [null, 0.15, 0.2, 0.25, 0.3] : [0.28, 0.32, 0.35, 0.4, 0.45],
      peSpreadPct: index === 0 ? [null, 0.15, 0.2, 0.25, 0.3] : [0.28, 0.32, 0.35, 0.4, 0.45],
      ceSpreadAbs: [0.5, 0.6, 0.7, 0.8, 0.9],
      peSpreadAbs: [0.5, 0.6, 0.7, 0.8, 0.9],
      ceVolOi: [0.36, 0.44, 0.52, 0.6, 0.68],
      peVolOi: [0.4, 0.48, 0.56, 0.64, 0.76],
    },
    // Raw api/options_rnd arrays; numeric density is zipped with `strikes`.
    rnd: {
      model: "rnd-svi",
      mean: 1420,
      stdDev: 39,
      skew: -0.2,
      kurtosis: 0.4,
      expectedMove: 24,
      strikes: STRIKES,
      density: density(),
      cdf: [0.02, 0.1, 0.5, 0.9, 0.98],
      forward: 1421,
    },
  }));

  return {
    symbol: "AAPL",
    spot: 1420,
    asOf: "2026-11-17T11:20:00+05:30",
    marketState: "open",
    quotesLive: true,
    sessionDate: "2026-11-17",
    warnings: [],
    expiries,
    term: DATES.map((_, index) => ({ dte: 9 + index * 25, atmIv: 22.4 - index * 0.9, rr25: 0.8, bf25: 0.6 })),
    surface: {
      strikes: STRIKES,
      expiries: DATES,
      iv: DATES.map(() => STRIKES.map((strike) => 22 + Math.abs(strike - 1420) * 0.02)),
      missing: DATES.map(() => STRIKES.map(() => false)),
    },
    probability: {
      model: "rnd-svi",
      flatPop: 0.61,
      skewPop: 0.58,
      expectedPnl: -268,
      sigma: 39,
      density: [],
      quantiles: { p05: 1360, p25: 1400, p50: 1420, p75: 1440, p95: 1480 },
      cone: DATES.map((_, index) => ({
        dte: 9 + index * 25,
        p05: 1360 - index * 5,
        p25: 1400,
        p50: 1420,
        p75: 1440 + index * 5,
        p95: 1480 + index * 10,
      })),
    },
    // RV cone + IV-vs-RV history. Four tenors keep RV BANDS === "4".
    rv: {
      current: 18.2,
      rv5: 17.4,
      rv10: 17.8,
      rv20: 18.1,
      rv30: 18.4,
      source: "daily",
      cone: {
        symbol: "AAPL",
        asOf: "2026-11-17",
        tenors: [5, 10, 20, 30].map((days, i) => {
          const current = [17.4, 17.8, 18.1, 18.4][i];
          return {
            days,
            current,
            p10: 14,
            p25: 16,
            p50: current,
            p75: 20,
            p90: 24,
            rankPct: 0.4,
          };
        }),
        warnings: [],
      },
      ivVsRv: {
        rows: DATES.map((date, i) => ({
          date,
          dte: 9 + i * 25,
          atmIv: 22.4 - i * 0.9,
          tenorDays: 9 + i * 25,
          rvP50: 17.4 + i,
          ivMinusRv: 5 - i,
          ivRankInCone: 0.6 - i * 0.1,
        })),
        warnings: [],
      },
    },
  };
}

interface DashboardMocks {
  requests: number;
}

async function setupDashboardMock(page: Page): Promise<DashboardMocks> {
  const mocks = { requests: 0 };
  await page.route(apiRoute("options/analytics/**"), async (route) => {
    mocks.requests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wire()) });
  });
  // App-shell noise: the always-mounted news rail fetches these on every route.
  await page.route(apiRoute("news"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  // Registered last so LIFO matching sends /news/sources to the array shape.
  await page.route(apiRoute("news/sources"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  return mocks;
}

async function expectCanvasPainted(page: Page, testId: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const host = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
          const canvas = host?.querySelector("canvas") as HTMLCanvasElement | null;
          return !!host && !!canvas && host.clientWidth > 0 && canvas.clientWidth > 0;
        }, testId),
      { timeout: 10000, intervals: [150] },
    )
    .toBe(true);
}

/**
 * A chart is "non-empty" only when its canvas is painted AND the fail-soft
 * `-empty` overlay is absent. The overlay is Solid's signal that the panel
 * computed a real series from the raw arrays — so its absence is the check.
 */
async function expectPillarCharts(page: Page, charts: readonly string[]): Promise<number> {
  let nonEmpty = 0;
  for (const chart of charts) {
    await expect(page.getByTestId(`${chart}-frame`)).toHaveAttribute("role", "img");
    await expect(page.getByTestId(`${chart}-frame`)).toHaveAttribute("aria-label", /.+/);
    await expectCanvasPainted(page, chart);
    expect(await page.getByTestId(`${chart}-empty`).count()).toBe(0);
    nonEmpty += 1;
  }
  return nonEmpty;
}

test.describe("Options Analytics dashboard", () => {
  const consoleErrors: string[] = [];
  /** The 401 test deliberately triggers a failed fetch — Chromium logs an
   * unsuppressable "Failed to load resource" for it. Only that test may waive it. */
  let allowResourceErrors = false;
  let mocks: DashboardMocks;

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    allowResourceErrors = false;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await setupApiMocks(page);
    await loginAsTestUser(page);
    mocks = await setupDashboardMock(page);
  });

  test.afterEach(() => {
    const unexpected = allowResourceErrors
      ? consoleErrors.filter((text) => !text.includes("Failed to load resource"))
      : consoleErrors;
    expect(unexpected).toEqual([]);
  });

  test("opens with one request and all four pillars render real, non fail-soft charts", async ({ page }) => {
    await page.goto("/options/analytics/AAPL");
    await expect(page.getByTestId("options-analytics-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("analytics-pillar-tab-volatility")).toBeVisible();
    await expect(page.getByTestId("pillar-volatility")).toBeVisible({ timeout: 15000 });
    // One effect owns the mount read: exactly one request, even though the
    // route-param effect may re-run. Panels and pillar switches never refetch.
    const baseline = mocks.requests;
    expect(baseline).toBe(1);

    let totalNonEmpty = 0;
    for (const { key, charts } of PILLARS) {
      await page.getByTestId(`analytics-pillar-tab-${key}`).click();
      await expect(page.getByTestId(`pillar-${key}`)).toBeVisible();
      const nonEmpty = await expectPillarCharts(page, charts);
      // Each pillar has at least one chart with real data; with the raw-array
      // mock every chart in the pillar is non-empty (no `-empty` overlay).
      expect(nonEmpty).toBeGreaterThanOrEqual(1);
      expect(nonEmpty).toBe(charts.length);
      totalNonEmpty += nonEmpty;
      expect(mocks.requests).toBe(baseline);
    }
    expect(totalNonEmpty).toBe(TOTAL_CHARTS);
    console.log(`NON_EMPTY_CHARTS_TOTAL=${totalNonEmpty}/${TOTAL_CHARTS}`);
  });

  test("each chart frame is keyboard-focusable and the metric band has real values", async ({ page }) => {
    await page.goto("/options/analytics/AAPL");
    await expect(page.getByTestId("pillar-volatility")).toBeVisible({ timeout: 15000 });

    const frame = page.getByTestId("iv-smile-chart-frame");
    await frame.focus();
    await expect(frame).toBeFocused();
    await expect(page.getByTestId("iv-smile-chart-desc")).toContainText("implied volatility");
    await expect(page.getByTestId("vol-metric-atm-value")).toHaveText("22.4");
    await expect(page.getByTestId("vol-metric-rv-value")).toHaveText("4");
  });

  test("switches expiry without another request and adapts the panel", async ({ page }) => {
    await page.goto("/options/analytics/AAPL");
    await expect(page.getByTestId("pillar-volatility")).toBeVisible({ timeout: 15000 });
    const baseline = mocks.requests;

    await page.getByTestId("volatility-expiry-2026-12-31").click();
    await expect(page.getByTestId("volatility-expiry-2026-12-31")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("volatility-caption")).toContainText("31 DEC");
    expect(mocks.requests).toBe(baseline);
  });

  test("390px and 1600px: charts carry real data and stay in the viewport without horizontal overflow", async ({ page }) => {
    await page.goto("/options/analytics/AAPL");
    await expect(page.getByTestId("pillar-volatility")).toBeVisible({ timeout: 15000 });
    const byWidth: Record<number, number> = {};
    for (const width of [390, 1600]) {
      await page.setViewportSize({ width, height: 844 });
      let nonEmpty = 0;
      for (const { key, charts } of PILLARS) {
        await page.getByTestId(`analytics-pillar-tab-${key}`).click();
        await expect(page.getByTestId(`pillar-${key}`)).toBeVisible();
        nonEmpty += await expectPillarCharts(page, charts);
      }
      byWidth[width] = nonEmpty;
      expect(nonEmpty).toBe(TOTAL_CHARTS);
      // The loop ends on volatility — its frames are still visible after the resize.
      for (const chart of ["iv-smile-chart", "term-structure-chart", "rnd-density-chart", "iv-rv-cone-chart"]) {
        await expect(page.getByTestId(`${chart}-frame`)).toBeVisible();
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
    }
    console.log(`NON_EMPTY_CHARTS_BY_WIDTH 390=${byWidth[390]} 1600=${byWidth[1600]}`);
    expect(byWidth[390]).toBeGreaterThan(0);
    expect(byWidth[1600]).toBeGreaterThan(0);
  });

  test("390×844 keyboard: pillar tabs, expiry chips, no trap/overflow, one request", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/options/analytics/NIFTY");
    await expect(page.getByTestId("options-analytics-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("pillar-volatility")).toBeVisible({ timeout: 15000 });
    expect(mocks.requests).toBe(1);

    const list = page.getByTestId("analytics-pillar-list");
    await expect(list).toHaveAttribute("role", "tablist");
    const tab = (key: string) => page.getByTestId(`analytics-pillar-tab-${key}`);
    const selected = () => list.locator('[role="tab"][aria-selected="true"]');

    await tab("volatility").focus();
    await expect(tab("volatility")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("pillar-positioning")).toBeVisible();
    await expect(tab("positioning")).toHaveAttribute("aria-selected", "true");
    await expect(selected()).toHaveAttribute("data-testid", "analytics-pillar-tab-positioning");
    await expect(tab("positioning")).toBeFocused();

    await page.keyboard.press("End");
    await expect(page.getByTestId("pillar-liquidity")).toBeVisible();
    await expect(selected()).toHaveAttribute("data-testid", "analytics-pillar-tab-liquidity");
    await expect(tab("liquidity")).toBeFocused();

    await page.keyboard.press("Home");
    await expect(page.getByTestId("pillar-volatility")).toBeVisible();
    await expect(selected()).toHaveAttribute("data-testid", "analytics-pillar-tab-volatility");
    await expect(tab("volatility")).toBeFocused();
    expect(mocks.requests).toBe(1);

    // Tab forward from the active tab into the volatility expiry chip group.
    const first = page.getByTestId("volatility-expiry-2026-11-26");
    const second = page.getByTestId("volatility-expiry-2026-12-31");
    let reached = false;
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() =>
        (document.activeElement?.getAttribute("data-testid") ?? "").startsWith("volatility-expiry-"),
      );
      if (reached) break;
    }
    expect(reached).toBe(true);
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(second).toHaveAttribute("aria-pressed", "false");

    // Arrow keys move focus without selecting; Enter commits the selection.
    await page.keyboard.press("ArrowRight");
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("ArrowLeft");
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("analytics-expiry-2026-12-31")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("volatility-caption")).toContainText("31 DEC");
    expect(mocks.requests).toBe(1);

    // No focus trap: Tab leaves the chip group; no horizontal overflow at 390px.
    await page.keyboard.press("Tab");
    const escaped = await page.evaluate(() =>
      !(document.activeElement?.getAttribute("data-testid") ?? "").startsWith("volatility-expiry-"),
    );
    expect(escaped).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    for (const chart of ["iv-smile-chart", "term-structure-chart", "rnd-density-chart", "iv-rv-cone-chart"]) {
      await expect(page.getByTestId(`${chart}-frame`)).toBeVisible();
      await expectCanvasPainted(page, chart);
    }
    expect(mocks.requests).toBe(1);
    console.log(`KEYBOARD_390_REQUESTS=${mocks.requests}`);
  });

  test("401 upstox_auth_required: page stays painted, shows Reconnect Upstox + Retry, and Retry recovers", async ({ page }) => {
    // The 401s below make Chromium log a benign "Failed to load resource" — waive
    // only that noise; any real JS console error still fails afterEach.
    allowResourceErrors = true;
    // Last-registered route wins over the beforeEach 200 mock. A broker-token
    // miss is a plain 401; kind "auth" is not retryable on the wire, so one read.
    let status = 401;
    await page.route(apiRoute("options/analytics/**"), async (route) => {
      if (status === 401) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: { code: "upstox_auth_required" } }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wire()) });
    });

    await page.goto("/options/analytics/NIFTY");

    // The shell stays mounted — no blank screen / crash on the 401.
    await expect(page.getByTestId("options-analytics-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("analytics-symbol")).toHaveText("NIFTY");

    // The error band carries the shared broker-auth message (single source:
    // BROKER_AUTH_MESSAGE), a link into Settings, and a Retry action. The
    // action is labelled "Open Settings" since the notice consolidated.
    const band = page.getByTestId("analytics-error");
    await expect(band).toBeVisible();
    await expect(band).toContainText(/reconnect in Settings/i);
    const reconnect = page.getByTestId("analytics-reconnect");
    await expect(reconnect).toBeVisible();
    await expect(reconnect).toHaveText(/open settings/i);
    await expect(reconnect).toHaveAttribute("href", "/settings");
    const retry = page.getByTestId("analytics-retry");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveText("Retry");

    // The body falls back to a readable empty state, not a dead canvas.
    await expect(page.getByTestId("analytics-empty")).toContainText(
      "No options analytics available for NIFTY",
    );

    // No unhandled console error is asserted by afterEach (consoleErrors === []).

    // Retry re-issues the read; a healthy response clears the band and paints a pillar.
    status = 200;
    await retry.click();
    await expect(band).toBeHidden();
    await expect(page.getByTestId("pillar-volatility")).toBeVisible({ timeout: 15000 });
  });
});
