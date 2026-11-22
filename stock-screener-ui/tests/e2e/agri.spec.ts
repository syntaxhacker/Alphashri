import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import {
  AGRI_GAP,
  agriPricesPayload,
  setupAgriMocks,
  type AgriMockHandle,
} from "./helpers/agriMocks";
import {
  formatAgriPrice,
  formatArrivals,
  formatChangePct,
} from "../../src/config/agri";
import {
  seasonality,
  summariseEda,
  type AgriEdaPoint,
} from "../../src/pages/agri/agriEda";

const REPORT_DIR = resolve(process.cwd(), "reports/agri/screenshots");
const MODES = [
  "band",
  "compare",
  "distribution",
  "supplyDemand",
  "heatmap",
  "rolling",
  "seasonality",
] as const;
const SCREENSHOT_MODES = [
  "band",
  "distribution",
  "supplyDemand",
  "heatmap",
  "rolling",
  "seasonality",
] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const COLUMNS = [
  "Commodity",
  "State",
  "District",
  "Market / Mandi",
  "Variety",
  "Min ₹/qtl",
  "Modal ₹/qtl",
  "Max ₹/qtl",
  "Arrivals qtl",
  "Date",
  "Status",
];

async function selectValue(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).locator("select").selectOption(value);
}

async function chooseMode(page: Page, mode: string, width: number) {
  if (width <= 640) {
    await selectValue(page, "agri-mode-select", mode);
    await expect(page.getByTestId("agri-mode-select").locator("select")).toHaveValue(mode);
    return;
  }
  await page.getByTestId(`agri-mode-${mode}`).click();
  await expect(page.getByTestId(`agri-mode-${mode}`)).toHaveClass(/font-semibold/);
}

async function openAgri(page: Page, query = "") {
  await page.goto(`/agri${query}`);
  await expect(page.getByTestId("agri-page")).toBeVisible();
  await expect(page.getByTestId("agri-chart")).toBeVisible();
  await expect(page.locator('[data-testid="agri-chart"] canvas')).toBeVisible();
}

async function expectEdaSummary(page: Page, params: Record<string, string> = {}) {
  const series = agriPricesPayload(params).series as AgriEdaPoint[];
  const summary = summariseEda(series);
  const months = seasonality(series).months;
  const best = months.length ? months.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const worst = months.length ? months.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

  const eda = page.getByTestId("agri-eda-summary");
  await expect(eda).toBeVisible();
  if (summary.trendPct != null) {
    await expect(eda).toContainText(formatChangePct(summary.trendPct));
  }
  if (summary.volatilityPct != null) {
    await expect(eda).toContainText(new RegExp(`${summary.volatilityPct.toFixed(1)}%`));
  }
  if (best) await expect(eda).toContainText(MONTHS[best.month - 1]);
  if (worst) await expect(eda).toContainText(MONTHS[worst.month - 1]);
  if (summary.arrivalsCorrelation != null) {
    await expect(eda).toContainText(summary.arrivalsCorrelation.toFixed(2));
  }
  await expect(eda).toContainText(new RegExp(`\\b${summary.outlierCount}\\b`));
  await expect(eda).toContainText("%");
}

test("agri fixture keeps the 173-day hole, null MSP and source strata", () => {
  const payload = agriPricesPayload({ commodity: "onion", range: "max" });
  const dates = new Set(payload.series.map((point) => point.date));

  expect(dates.has(AGRI_GAP.boundaryStart)).toBe(true);
  expect(dates.has(AGRI_GAP.firstMissing)).toBe(false);
  expect(dates.has(AGRI_GAP.lastMissing)).toBe(false);
  expect(dates.has(AGRI_GAP.boundaryEnd)).toBe(true);
  expect(payload.series[payload.series.length - 1]?.arrivals_qtl).toBeNull();
  expect(payload.kpis.msp).toBeNull();
  expect(payload.quotes_total).toBe(3_942);
  expect(payload.quotes[0]).toMatchObject({
    price_unit: "Rs./Quintal",
    source: "agmarknet_daily",
    product_form: "common",
  });
});

test.describe("Agri prices redesign", () => {
  let handle: AgriMockHandle;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    handle = await setupAgriMocks(page);
  });

  test("renders the page title, KPI values with units, chart canvas and quotes table", async ({
    page,
  }) => {
    await openAgri(page);

    await expect(page.getByTestId("agri-chart-panel")).toContainText("Modal price — Onion");
    await expect(page.getByTestId("agri-freshness")).toContainText("42 mandis");
    await expect(page.getByTestId("agri-kpi-head")).toContainText("Prices ₹/quintal · arrivals qtl");

    const kpis = agriPricesPayload({ commodity: "onion", range: "6m" }).kpis;
    await expect(page.getByTestId("agri-kpis")).toContainText("₹/quintal");
    await expect(page.getByTestId("agri-kpi-modal")).toContainText(formatAgriPrice(kpis.modal));
    await expect(page.getByTestId("agri-kpi-range")).toContainText(
      `${formatAgriPrice(kpis.min)}–${formatAgriPrice(kpis.max)}`,
    );
    await expect(page.getByTestId("agri-kpi-chg1w")).toContainText(formatChangePct(kpis.chg_1w_pct));
    await expect(page.getByTestId("agri-kpi-chg1m")).toContainText(formatChangePct(kpis.chg_1m_pct));
    await expect(page.getByTestId("agri-kpi-chg6m")).toContainText(formatChangePct(kpis.chg_6m_pct));
    await expect(page.getByTestId("agri-kpi-markets")).toContainText(String(kpis.market_count));
    await expect(page.getByTestId("agri-kpi-arrivals")).toContainText(formatArrivals(kpis.arrivals_qtl));
    // The official daily feed publishes no arrivals and no verified MSP.
    await expect(page.getByTestId("agri-kpi-arrivals")).toContainText("—");
    await expect(page.getByTestId("agri-kpi-msp")).toContainText(formatAgriPrice(kpis.msp));
    await expect(page.getByTestId("agri-kpi-msp")).toContainText("No MSP notified");

    await expect(page.getByTestId("agri-quotes-table")).toBeVisible();
    for (const column of COLUMNS) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
    await expect(page.locator('[data-testid^="agri-row-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="agri-row-"]').first()).toContainText("Lasalgaon");
    await expect(page.locator('[data-testid^="agri-row-"]').first()).toContainText(
      formatAgriPrice(kpis.modal),
    );
  });

  test("surfaces the collection-gap and partial-day warnings", async ({ page }) => {
    await openAgri(page);

    const warnings = page.getByTestId("agri-warnings");
    await expect(warnings).toContainText(`${AGRI_GAP.missingDays}-day gap`);
    await expect(warnings).toContainText(`${AGRI_GAP.firstMissing} → ${AGRI_GAP.lastMissing}`);
    await expect(warnings).toContainText("3,942 of 15,843");
    // 1W/1M anchors fall inside the hole, so the backend leaves them null.
    await expect(page.getByTestId("agri-kpi-chg1w")).toContainText("—");
    await expect(page.getByTestId("agri-kpi-chg1m")).toContainText("—");
  });

  test("shows EDA summary values and units from the active series", async ({ page }) => {
    await openAgri(page);
    await expectEdaSummary(page, { commodity: "onion", range: "6m" });
  });

  test("mode strip exposes only EDA modes", async ({ page }) => {
    await openAgri(page);

    await expect(page.getByTestId("agri-mode-strip").locator("button")).toHaveCount(MODES.length);
    for (const mode of MODES) {
      await expect(page.getByTestId(`agri-mode-${mode}`)).toBeVisible();
    }
    await expect(page.getByTestId("agri-mode-ohlc")).toHaveCount(0);
    await expect(page.getByTestId("agri-mode-arrivals")).toHaveCount(0);
  });

  test("390 mobile replaces the mode strip with a working mode select", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgri(page);

    await expect(page.getByTestId("agri-mode-strip")).toHaveCount(0);
    const select = page.getByTestId("agri-mode-select").locator("select");
    await expect(select).toHaveValue("band");
    await select.selectOption("heatmap");
    await expect(select).toHaveValue("heatmap");
    await expect(page.locator('[data-testid="agri-chart"] canvas')).toBeVisible();
  });

  test("compare always includes the active commodity", async ({ page }) => {
    await openAgri(page, "?mode=compare");
    await expect.poll(() => handle.pricesCalls.at(-1)?.params.compare).toContain("onion");
    await expect(page.getByTestId("agri-compare-active")).toContainText("Onion");
  });

  test("quotes panel discloses the total quote count", async ({ page }) => {
    await openAgri(page);
    await expect(page.getByTestId("agri-table-panel")).toContainText(/showing\s+2\s+of\s+3,?942/i);
  });

  test("switching group narrows the commodity list and reloads prices", async ({ page }) => {
    await openAgri(page);

    await selectValue(page, "agri-group-select", "vegetables");
    await expect(page.getByTestId("agri-commodity-select").locator("select")).toHaveValue("onion");
    await expect(page.getByTestId("agri-commodity-select").locator("option")).toHaveText(["Onion"]);

    await selectValue(page, "agri-group-select", "cereals");
    const commoditySelect = page.getByTestId("agri-commodity-select").locator("select");
    await expect(commoditySelect).toHaveValue("wheat");
    await expect(page.getByTestId("agri-commodity-select").locator("option")).toHaveText(["Wheat"]);
    await expect.poll(() => handle.pricesCalls.at(-1)?.params).toMatchObject({
      group: "cereals",
      commodity: "wheat",
    });
    await expect(page).toHaveURL(/[?&]group=cereals/);
    await expect(page.getByTestId("agri-chart-panel")).toContainText("Modal price — Wheat");
  });

  test("range presets 1M and 6M drive the request and the active button", async ({ page }) => {
    await openAgri(page);
    await expect(page.getByTestId("agri-range-6m")).toHaveClass(/font-semibold/);

    await page.getByTestId("agri-range-1m").click();
    await expect(page.getByTestId("agri-range-1m")).toHaveClass(/font-semibold/);
    await expect(page).toHaveURL(/[?&]range=1m/);
    await expect.poll(() => handle.pricesCalls.at(-1)?.params.range).toBe("1m");

    await page.getByTestId("agri-range-6m").click();
    await expect(page.getByTestId("agri-range-6m")).toHaveClass(/font-semibold/);
    await expect.poll(() => handle.pricesCalls.at(-1)?.params.range).toBe("6m");
  });

  test("switches between all EDA chart modes", async ({ page }) => {
    await openAgri(page);

    for (const mode of MODES) {
      await page.getByTestId(`agri-mode-${mode}`).click();
      await expect(page.getByTestId(`agri-mode-${mode}`)).toHaveClass(/font-semibold/);
      if (mode === "seasonality") {
        await expect(page.getByTestId("agri-seasonality-weak")).toBeVisible();
      } else {
        await expect(page.locator('[data-testid="agri-chart"] canvas')).toBeVisible();
      }
      if (mode === "compare") {
        await expect(page.getByTestId("agri-compare-strip")).toBeVisible();
        await expect.poll(() => handle.pricesCalls.at(-1)?.params.compare).toContain("wheat");
      } else {
        await expect(page.getByTestId("agri-compare-strip")).toHaveCount(0);
      }
    }
  });

  test("normalises the legacy ?mode=ohlc URL to band", async ({ page }) => {
    await openAgri(page, "?mode=ohlc");

    await expect(page.getByTestId("agri-mode-band")).toHaveClass(/font-semibold/);
    await expect(page.getByTestId("agri-mode-ohlc")).toHaveCount(0);
    await expect(page.locator('[data-testid="agri-chart"] canvas')).toBeVisible();
  });

  test("normalises the legacy ?mode=arrivals URL to supplyDemand", async ({ page }) => {
    await openAgri(page, "?mode=arrivals");

    await expect(page.getByTestId("agri-mode-supplyDemand")).toHaveClass(/font-semibold/);
    await expect(page.getByTestId("agri-mode-arrivals")).toHaveCount(0);
    await expect(page.locator('[data-testid="agri-chart"] canvas')).toBeVisible();
  });

  test("cascades state → district → market and echoes the selection", async ({ page }) => {
    await openAgri(page);
    await expect(page.getByTestId("agri-state-select").locator("select")).toHaveValue("");
    await expect(page.getByTestId("agri-district-select").locator("select")).toBeDisabled();

    await selectValue(page, "agri-state-select", "Maharashtra");
    await expect(page.getByTestId("agri-district-select").locator("select")).toBeEnabled();
    await expect(page.getByTestId("agri-district-select").locator("option")).toHaveText([
      "All districts",
      "Nashik",
    ]);

    await selectValue(page, "agri-district-select", "Nashik");
    await expect(page.getByTestId("agri-market-select").locator("select")).toBeEnabled();
    await expect(page.getByTestId("agri-market-select").locator("option")).toHaveText([
      "All mandis",
      "Lasalgaon",
    ]);

    await selectValue(page, "agri-market-select", "Lasalgaon");
    await expect.poll(() => handle.pricesCalls.at(-1)?.params).toMatchObject({
      state: "Maharashtra",
      district: "Nashik",
      market: "Lasalgaon",
    });
    await expect(page).toHaveURL(/[?&]state=Maharashtra/);
    await expect(page).toHaveURL(/[?&]district=Nashik/);
    await expect(page).toHaveURL(/[?&]market=Lasalgaon/);
    await expect(page.getByTestId("agri-quotes-table")).toContainText("Lasalgaon");
  });

  test("empty prices response renders the chart and table empty states", async ({ page }) => {
    handle.setScenario("empty");
    await page.goto("/agri");
    await expect(page.getByTestId("agri-page")).toBeVisible();
    await expect(page.getByTestId("agri-loading")).toHaveCount(0);

    await expect(page.getByTestId("agri-chart-empty")).toBeVisible();
    await expect(page.getByTestId("agri-table-empty")).toBeVisible();
    await expect(page.getByTestId("agri-chart")).toHaveCount(0);
    await expect(page.getByTestId("agri-quotes-table")).toHaveCount(0);
    await expect(page.getByTestId("agri-warnings")).toContainText("No rows in the cache");
  });

  test("500 shows an error alert and retry recovers the page", async ({ page }) => {
    handle.setScenario("error-once");
    await page.goto("/agri");
    await expect(page.getByTestId("agri-error")).toBeVisible();
    await expect(page.getByTestId("agri-error")).toContainText(/agri|500|fetch/i);

    const before = handle.pricesCalls.length;
    await page.getByTestId("agri-error-retry").click();
    await expect(page.getByTestId("agri-error")).toHaveCount(0);
    await expect(page.getByTestId("agri-quotes-table")).toBeVisible();
    expect(handle.pricesCalls.length).toBeGreaterThan(before);
  });

  test("commodity, range and mode round-trip through the URL", async ({ page }) => {
    await openAgri(page);
    await selectValue(page, "agri-commodity-select", "wheat");
    await page.getByTestId("agri-range-1m").click();
    await page.getByTestId("agri-mode-supplyDemand").click();

    await expect(page).toHaveURL(/[?&]commodity=wheat/);
    await expect(page).toHaveURL(/[?&]range=1m/);
    await expect(page).toHaveURL(/[?&]mode=supplyDemand/);
    const roundTripUrl = page.url();

    await page.goto(roundTripUrl);
    await expect(page.getByTestId("agri-page")).toBeVisible();
    await expect(page.getByTestId("agri-commodity-select").locator("select")).toHaveValue("wheat");
    await expect(page.getByTestId("agri-range-1m")).toHaveClass(/font-semibold/);
    await expect(page.getByTestId("agri-mode-supplyDemand")).toHaveClass(/font-semibold/);
    await expect(page.getByTestId("agri-chart-panel")).toContainText("Modal price — Wheat");
    await expect.poll(() => handle.pricesCalls.at(-1)?.params).toMatchObject({
      commodity: "wheat",
      range: "1m",
    });
  });
});

for (const viewport of [
  { label: "1600", width: 1600, height: 900 },
  { label: "390", width: 390, height: 844 },
]) {
  test(`captures EDA visual states at ${viewport.label}`, async ({ page }) => {
    mkdirSync(REPORT_DIR, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupAgriMocks(page);
    await openAgri(page);

    for (const mode of SCREENSHOT_MODES) {
      await chooseMode(page, mode, viewport.width);
      if (mode === "seasonality") {
        await expect(page.getByTestId("agri-seasonality-weak")).toBeVisible();
      } else {
        await expect(page.locator('[data-testid="agri-chart"] canvas')).toBeVisible();
      }
      const file = resolve(REPORT_DIR, `agri-${viewport.label}-${mode}.png`);
      await page.screenshot({ path: file });
      expect(statSync(file).size).toBeGreaterThan(40 * 1024);
    }
  });
}

test("captures the mobile full-page state", async ({ page }) => {
  mkdirSync(REPORT_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupAgriMocks(page);
  await openAgri(page);

  const file = resolve(REPORT_DIR, "agri-390-mobile.png");
  await page.screenshot({ path: file, fullPage: true });
  expect(statSync(file).size).toBeGreaterThan(40 * 1024);
});
