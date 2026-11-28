/**
 * Visual evidence for PR #425 — the Market Vis `VisFrame`/`visScale` extraction
 * across Money flow, 52W range, Relative volume, RSI × ADX and Sector 52W.
 *
 * Every frame is a real `/screener?view=vis` render driven by a mocked QA login
 * and a deterministic NSE-shaped `/api/market/snapshot` fixture. Only the two
 * empty frames use a degraded fixture; every other frame uses the full one.
 *
 * Run:
 *   EVIDENCE_BASE_URL=http://127.0.0.1:5174 \
 *     npx playwright test tests/e2e/viz-market-vis-evidence.spec.ts \
 *     -c playwright.evidence.config.ts --workers=1
 */
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupUserConfigMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";
import { waitForSettled } from "./helpers/evidenceFast";

const SHOT_DIR = process.env.SCREENSHOT_EVIDENCE_DIR ?? "docs/screenshots/viz-market-vis";
const MARKET_VIS_PATH = "/screener?view=vis";

const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

interface ModeSpec {
  /** Exact `data-value` on the Vis segmented control (VIS_OPTIONS in MarketMapView). */
  value: string;
  /** Exact visible tab label. */
  label: string;
  slug: string;
  rootTestId: string;
  primaryTestId: string;
}

const MODES: ModeSpec[] = [
  {
    value: "flow",
    label: "Money flow",
    slug: "money-flow",
    rootTestId: "market-flow-view",
    primaryTestId: "market-flow-svg",
  },
  {
    value: "range52",
    label: "52W range",
    slug: "range-52",
    rootTestId: "range52-view",
    primaryTestId: "range52-list",
  },
  {
    value: "relvol",
    label: "Relative volume",
    slug: "rel-vol",
    rootTestId: "relvol-view",
    primaryTestId: "relvol-list",
  },
  {
    value: "rsiadx",
    label: "RSI × ADX",
    slug: "rsi-adx",
    rootTestId: "rsi-adx-view",
    primaryTestId: "rsi-adx-canvas",
  },
  {
    value: "sector52",
    label: "Sector 52W",
    slug: "sector-52-breadth",
    rootTestId: "sector-52w-breadth-view",
    primaryTestId: "sector-52w-breadth",
  },
];

const EMPTY_MODES = [
  {
    slug: "money-flow-empty",
    value: "flow",
    label: "Money flow",
    rootTestId: "market-flow-view",
    emptyTestId: "market-flow-empty",
    fixture: "no-flow" as const,
  },
  {
    slug: "rel-vol-empty",
    value: "relvol",
    label: "Relative volume",
    rootTestId: "relvol-view",
    emptyTestId: "relvol-empty",
    fixture: "no-relvol" as const,
  },
];

type FixtureKind = "full" | (typeof EMPTY_MODES)[number]["fixture"];

/** NSE large-caps with plausible, varied values for every Vis scale. */
const NSE_ROWS = [
  { symbol: "RELIANCE", name: "Reliance Industries Ltd", sector: "Energy", close: 2956.4, change: 1.82, high: 3100, low: 2201, pos: 84.1, toHigh: -4.6, fromLow: 34.4, rsi: 62.4, adx: 31.2, relVol: 2.8, cap: 1994300, perfW: 2.4, perf1m: 6.1, sma20: 2921, sma50: 2860, sma200: 2610, volume: 18_400_000, traded: 54_300_000_000 },
  { symbol: "HDFCBANK", name: "HDFC Bank Ltd", sector: "Financials", close: 1712.3, change: -0.74, high: 1792, low: 1421, pos: 76.8, toHigh: -4.5, fromLow: 20.5, rsi: 55.1, adx: 24.8, relVol: 1.7, cap: 1301200, perfW: -0.9, perf1m: 3.2, sma20: 1724, sma50: 1690, sma200: 1580, volume: 21_200_000, traded: 36_300_000_000 },
  { symbol: "TCS", name: "Tata Consultancy Services Ltd", sector: "Technology", close: 4128.6, change: 0.93, high: 4295, low: 3350, pos: 81.8, toHigh: -3.9, fromLow: 23.2, rsi: 58.7, adx: 28.4, relVol: 1.3, cap: 1496000, perfW: 1.6, perf1m: 4.8, sma20: 4088, sma50: 4010, sma200: 3720, volume: 5_600_000, traded: 23_100_000_000 },
  { symbol: "INFY", name: "Infosys Ltd", sector: "Technology", close: 1876.5, change: 2.41, high: 1923, low: 1412, pos: 91.3, toHigh: -2.4, fromLow: 9.1, rsi: 71.2, adx: 38.6, relVol: 3.9, cap: 778400, perfW: 4.1, perf1m: 8.7, sma20: 1832, sma50: 1775, sma200: 1620, volume: 14_800_000, traded: 27_700_000_000 },
  { symbol: "SBIN", name: "State Bank of India", sector: "Financials", close: 812.45, change: -1.26, high: 921, low: 566, pos: 70.1, toHigh: -11.8, fromLow: 43.4, rsi: 47.8, adx: 19.6, relVol: 2.2, cap: 724600, perfW: -2.3, perf1m: -1.4, sma20: 821, sma50: 833, sma200: 764, volume: 26_400_000, traded: 21_500_000_000 },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd", sector: "Financials", close: 1284.7, change: 0.58, high: 1326, low: 938, pos: 90.1, toHigh: -3.1, fromLow: 11.9, rsi: 66.3, adx: 33.5, relVol: 1.9, cap: 913200, perfW: 1.2, perf1m: 3.9, sma20: 1261, sma50: 1230, sma200: 1120, volume: 19_100_000, traded: 24_500_000_000 },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank Ltd", sector: "Financials", close: 1782.9, change: -2.08, high: 1988, low: 1544, pos: 53.9, toHigh: -10.3, fromLow: 17.7, rsi: 41.6, adx: 26.1, relVol: 3.2, cap: 354200, perfW: -3.4, perf1m: -5.2, sma20: 1811, sma50: 1846, sma200: 1763, volume: 8_900_000, traded: 15_900_000_000 },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever Ltd", sector: "FMCG", close: 2418.1, change: 0.34, high: 2589, low: 2103, pos: 65.4, toHigh: -6.6, fromLow: 15.0, rsi: 52.4, adx: 17.8, relVol: 0.9, cap: 568100, perfW: 0.5, perf1m: 1.8, sma20: 2402, sma50: 2391, sma200: 2340, volume: 3_700_000, traded: 8_900_000_000 },
  { symbol: "ITC", name: "ITC Ltd", sector: "FMCG", close: 462.85, change: 1.12, high: 484, low: 392, pos: 77.0, toHigh: -4.4, fromLow: 18.0, rsi: 59.8, adx: 22.3, relVol: 2.5, cap: 578400, perfW: 1.9, perf1m: 2.6, sma20: 457, sma50: 450, sma200: 438, volume: 32_100_000, traded: 14_800_000_000 },
  { symbol: "LT", name: "Larsen & Toubro Ltd", sector: "Construction", close: 3642.5, change: -0.45, high: 3910, low: 2778, pos: 76.4, toHigh: -6.8, fromLow: 31.1, rsi: 54.2, adx: 20.7, relVol: 1.4, cap: 499700, perfW: -0.8, perf1m: 2.1, sma20: 3660, sma50: 3612, sma200: 3325, volume: 4_300_000, traded: 15_600_000_000 },
  { symbol: "ASIANPAINT", name: "Asian Paints Ltd", sector: "FMCG", close: 2874.2, change: -3.17, high: 3420, low: 2615, pos: 32.5, toHigh: -15.9, fromLow: 9.9, rsi: 36.9, adx: 29.8, relVol: 4.3, cap: 275300, perfW: -5.2, perf1m: -8.4, sma20: 2952, sma50: 3021, sma200: 3106, volume: 6_100_000, traded: 17_600_000_000 },
  { symbol: "MARUTI", name: "Maruti Suzuki India Ltd", sector: "Automobile", close: 12486.0, change: 1.76, high: 13130, low: 10112, pos: 78.9, toHigh: -4.9, fromLow: 23.5, rsi: 63.5, adx: 27.2, relVol: 1.6, cap: 392800, perfW: 2.8, perf1m: 5.4, sma20: 12284, sma50: 12010, sma200: 11420, volume: 1_100_000, traded: 13_700_000_000 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel Ltd", sector: "Telecom", close: 1634.8, change: 2.94, high: 1672, low: 1040, pos: 94.3, toHigh: -2.2, fromLow: 57.2, rsi: 74.1, adx: 41.7, relVol: 4.8, cap: 920400, perfW: 5.1, perf1m: 9.3, sma20: 1588, sma50: 1532, sma200: 1320, volume: 16_700_000, traded: 27_300_000_000 },
  { symbol: "BAJFINANCE", name: "Bajaj Finance Ltd", sector: "Financials", close: 6842.5, change: -1.54, high: 7589, low: 5510, pos: 63.8, toHigh: -9.8, fromLow: 24.2, rsi: 45.3, adx: 23.4, relVol: 2.1, cap: 425100, perfW: -2.1, perf1m: -3.8, sma20: 6912, sma50: 7010, sma200: 6605, volume: 2_300_000, traded: 15_800_000_000 },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries Ltd", sector: "Healthcare", close: 1783.6, change: 0.72, high: 1832, low: 1388, pos: 88.6, toHigh: -2.6, fromLow: 28.5, rsi: 64.8, adx: 30.1, relVol: 3.4, cap: 418200, perfW: 1.7, perf1m: 4.2, sma20: 1756, sma50: 1712, sma200: 1588, volume: 5_200_000, traded: 9_300_000_000 },
];

function snapshotRows(fixture: FixtureKind) {
  const rows = NSE_ROWS.map((stock, index) => ({
    symbol: stock.symbol,
    name: stock.name,
    sector: fixture === "no-flow" ? null : stock.sector,
    exchange: "NSE",
    currency: "INR",
    close: stock.close,
    change: fixture === "no-flow" ? null : stock.change,
    high_52w: stock.high,
    low_52w: stock.low,
    pos_52w: stock.pos,
    to_52w_high_pct: stock.toHigh,
    from_52w_low_pct: stock.fromLow,
    rsi: stock.rsi,
    adx: stock.adx,
    relative_volume: fixture === "no-relvol" ? null : stock.relVol,
    market_cap_cr: stock.cap,
    cap_tier: "large",
    perf_w: stock.perfW,
    perf_1m: stock.perf1m,
    sma20: stock.sma20,
    sma50: stock.sma50,
    sma200: stock.sma200,
    volume: stock.volume,
    avg_volume: Math.round(stock.volume / stock.relVol),
    value_traded: stock.traded,
    gap: index % 3 === 0 ? 0.4 : -0.2,
    atr: Number((stock.close * 0.018).toFixed(2)),
    high: Number((stock.close * 1.008).toFixed(2)),
    low: Number((stock.close * 0.991).toFixed(2)),
    fno: true,
    etf: false,
  }));
  return {
    as_of: "2026-11-28T09:15:00+05:30",
    universe: "all_equity",
    total: rows.length,
    update_mode: "intraday",
    rows,
  };
}

async function enterVis(page: Page, fixture: FixtureKind): Promise<void> {
  await setupApiMocks(page);
  await setupUserConfigMocks(page);
  await loginAsTestUser(page);
  await page.route(apiRoute("market/snapshot"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshotRows(fixture)),
    }),
  );

  await page.goto(MARKET_VIS_PATH);
  await expect(page.getByTestId("market-vis-selector")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await page.getByTestId("market-result-count").textContent()) ?? "", {
      timeout: 30_000,
      message: "mocked NSE snapshot never reached the Market panel",
    })
    .toMatch(/^\s*15\s*\/\s*15\s*$/);
}

async function selectMode(page: Page, mode: ModeSpec): Promise<void> {
  const tab = page.getByTestId("market-vis-selector").locator(`[data-value="${mode.value}"]`);
  await expect(tab, `Vis tab "${mode.label}" is missing`).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(mode.rootTestId)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(mode.primaryTestId)).toBeVisible({ timeout: 30_000 });
  await waitForSettled(page, `[data-testid="${mode.rootTestId}"]`);
}

async function assertModeRenders(page: Page, mode: ModeSpec): Promise<void> {
  if (mode.value === "flow") {
    expect(await page.locator('[data-testid^="market-flow-arc-"]').count()).toBeGreaterThan(0);
    await expect(page.getByTestId("market-flow-legend")).toBeVisible();
  } else if (mode.value === "range52") {
    expect(await page.locator('[data-testid^="range52-row-"]').count()).toBeGreaterThan(0);
    await expect(page.getByTestId("range52-count")).toContainText(/showing 15 of 15/i);
  } else if (mode.value === "relvol") {
    expect(await page.locator('[data-testid^="relvol-row-"]').count()).toBeGreaterThan(0);
    await expect(page.getByTestId("relvol-legend")).toBeVisible();
  } else if (mode.value === "rsiadx") {
    const canvas = page.getByTestId("rsi-adx-canvas").locator("canvas");
    await expect(canvas.first()).toBeVisible();
    await expect(page.getByTestId("rsi-adx-count")).toHaveAttribute(
      "title",
      /15 of 15 eligible rows plotted/,
    );
  } else {
    expect(await page.locator('[data-testid^="sector-52w-row-"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid^="sector-52w-bar-"]').count()).toBeGreaterThan(0);
  }
}

function reportConsoleErrors(label: string, errors: string[]): void {
  if (errors.length === 0) {
    console.log(`[console] ${label}: 0 errors`);
    return;
  }
  console.log(`[console] ${label}: ${errors.length} error(s)\n${errors.join("\n")}`);
}

for (const mode of MODES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${mode.slug} at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const consoleErrors = collectConsoleErrors(page);

      await enterVis(page, "full");
      await selectMode(page, mode);
      await assertModeRenders(page, mode);

      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const capture = `${mode.slug}-${viewport.width}.png`;
      await page.screenshot({ path: `${SHOT_DIR}/${capture}`, fullPage: false });

      reportConsoleErrors(capture, consoleErrors);
      expect(consoleErrors, `${capture}: browser logged console errors`).toEqual([]);
    });
  }
}

for (const state of EMPTY_MODES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${state.slug} at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const consoleErrors = collectConsoleErrors(page);

      await enterVis(page, state.fixture);
      const tab = page.getByTestId("market-vis-selector").locator(`[data-value="${state.value}"]`);
      await expect(tab, `Vis tab "${state.label}" is missing`).toBeVisible({ timeout: 30_000 });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      const empty = page.getByTestId(state.emptyTestId);
      await expect(empty).toBeVisible({ timeout: 30_000 });
      await waitForSettled(page, `[data-testid="${state.rootTestId}"]`);

      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const capture = `${state.slug}-${viewport.width}.png`;
      await page.screenshot({ path: `${SHOT_DIR}/${capture}`, fullPage: false });

      reportConsoleErrors(capture, consoleErrors);
      expect(consoleErrors, `${capture}: browser logged console errors`).toEqual([]);
    });
  }
}
