import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { mockSymbolSearch, mockBacktestRun, mockBacktestChart } from "./helpers/backtestHelpers";
import LZString from "lz-string";

const ALL_STRATEGY_VARIATIONS = [
  {
    id: "default",
    name: "Default ORB",
    strategy_type: "orb",
    is_template: true,
    is_default: true,
    sl_pct: 0.4,
    tp_pct: 1.2,
    or_minutes: 45,
  },
  {
    id: "conservative",
    name: "Conservative ORB",
    strategy_type: "orb",
    is_template: false,
    is_default: false,
    sl_pct: 0.6,
    tp_pct: 1.0,
    or_minutes: 45,
  },
  {
    id: "sr-breakout-tpl",
    name: "SR Breakout Default",
    strategy_type: "sr_breakout",
    is_template: true,
    is_default: true,
    sl_pct: 0.8,
    tp_pct: 1.5,
    breakout_buffer_pct: 0.3,
  },
  {
    id: "ema-cross-tpl",
    name: "EMA Cross Default",
    strategy_type: "ema_cross",
    is_template: true,
    is_default: true,
    sl_pct: 0.7,
    tp_pct: 1.3,
    ema_fast_period: 9,
    ema_slow_period: 21,
  },
  {
    id: "52w-chaser-tpl",
    name: "52W Chaser Default",
    strategy_type: "52w_chaser",
    is_template: true,
    is_default: true,
    entry_threshold_pct: 2.0,
    max_holding_days: 10,
    cooldown_days: 3,
  },
  {
    id: "52w-target-tpl",
    name: "52W Target Default",
    strategy_type: "52w_target",
    is_template: true,
    is_default: true,
    entry_threshold_pct: 3.0,
    max_holding_days: 15,
    cooldown_days: 5,
  },
];

function encodePayload(payload: object): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(payload));
}

function decodePayload(encoded: string): Record<string, unknown> | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

async function getUrlPayload(page: Page): Promise<Record<string, unknown> | null> {
  const url = page.url();
  try {
    const urlObj = new URL(url);
    const encoded = urlObj.searchParams.get("p");
    if (!encoded) return null;
    return decodePayload(encoded);
  } catch {
    return null;
  }
}

async function mockVariationsWithAllStrategies(page: Page) {
  await page.route(apiRoute("strategies/variations"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ALL_STRATEGY_VARIATIONS),
    });
  });
}

async function setupUrlParamMocks(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await page.route(apiRoute("backtest/strategies"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          { id: "orb", name: "ORB Strategy", type: "orb", params: [] },
          { id: "52w_chaser", name: "52W Chaser", type: "52w_chaser", params: [] },
          { id: "52w_target", name: "52W Target", type: "52w_target", params: [] },
          { id: "sr_breakout", name: "SR Breakout", type: "sr_breakout", params: [] },
          { id: "ema_cross", name: "EMA Cross", type: "ema_cross", params: [] },
        ],
      }),
    });
  });
  await mockVariationsWithAllStrategies(page);
  await page.route(apiRoute("backtest/costs"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        costs: {
          brokerage_pct: 0.0003,
          min_brokerage: 20,
          stt_pct: 0.00025,
          exchange_pct: 0.0000297,
          sebi_pct: 0.000001,
          stamp_pct: 0.00003,
          gst_pct: 0.18,
        },
      }),
    });
  });
  await mockSymbolSearch(page);
  await mockBacktestRun(page);
  await mockBacktestChart(page);
}

async function gotoBacktestWithParams(page: Page, payload: object) {
  const encoded = encodePayload(payload);
  await page.goto(`/backtest?p=${encoded}`);
  await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });
  await page.waitForLoadState("networkidle");
}

test.describe("Backtest - URL Query Params", () => {
  test.beforeEach(async ({ page }) => {
    await setupUrlParamMocks(page);
  });

  test("should load strategy and symbols from URL params", async ({ page }) => {
    await gotoBacktestWithParams(page, { s: "orb", y: ["RELIANCE"] });

    await expect(page.locator('[data-testid="chip-RELIANCE"]')).toBeVisible({ timeout: 10000 });

    const variationSelect = page.locator('[data-testid="variation-select"]');
    await expect(variationSelect).toBeVisible();

    const urlPayload = await getUrlPayload(page);
    expect(urlPayload).not.toBeNull();
    expect((urlPayload as any).y).toContain("RELIANCE");
  });

  test("should load 52W target strategy from URL params", async ({ page }) => {
    await gotoBacktestWithParams(page, { s: "52w_target", y: ["BHEL"] });

    await expect(page.locator('[data-testid="chip-BHEL"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="variation-select"]')).toHaveValue(/52[Ww]/i, {
      timeout: 5000,
    });
  });

  test("should load variation by ID from URL params", async ({ page }) => {
    await gotoBacktestWithParams(page, { v: "conservative", y: ["TCS"] });

    await expect(page.locator('[data-testid="chip-TCS"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="variation-select"]')).toHaveValue(/Conservative/i, {
      timeout: 5000,
    });
  });

  test("should load custom params from URL params", async ({ page }) => {
    await gotoBacktestWithParams(page, { s: "orb", y: ["RELIANCE"], r: { sl: 1.0, tp: 2.0 } });

    await expect(page.locator('[data-testid="chip-RELIANCE"]')).toBeVisible({ timeout: 10000 });

    const urlPayload = await getUrlPayload(page);
    expect(urlPayload).not.toBeNull();
    const params = (urlPayload as any).r;
    expect(params).toBeDefined();
    expect(params.sl).toBe(1.0);
    expect(params.tp).toBe(2.0);
  });

  test("should update URL when user changes strategy", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    const variationSelect = page.locator('[data-testid="variation-select"]');
    await variationSelect.click({ force: true });
    await page.waitForTimeout(300);

    const targetOption = page
      .locator(".mantine-Select-option")
      .filter({ hasText: /52[Ww] Target/i });
    await expect(targetOption.first()).toBeVisible({ timeout: 5000 });
    await targetOption.first().click();
    await page.waitForTimeout(500);

    await page.waitForFunction(
      () => {
        const sp = new URLSearchParams(window.location.search);
        return sp.has("p");
      },
      { timeout: 5000 },
    );

    const urlPayload = await getUrlPayload(page);
    expect(urlPayload).not.toBeNull();
    const strategy = (urlPayload as any).s;
    expect(strategy).toBe("52w_target");
  });

  test("should update URL when user adds symbol", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click({ force: true });
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
      timeout: 5000,
    });
    await page.locator(".mantine-MultiSelect-option").first().click();
    await page.waitForTimeout(500);

    await page.waitForFunction(
      () => {
        const sp = new URLSearchParams(window.location.search);
        return sp.has("p");
      },
      { timeout: 5000 },
    );

    const urlPayload = await getUrlPayload(page);
    expect(urlPayload).not.toBeNull();
    const symbols = (urlPayload as any).y;
    expect(Array.isArray(symbols)).toBe(true);
    expect(symbols).toContain("RELIANCE");
  });

  test("should preserve URL params on navigation away and back", async ({ page }) => {
    await gotoBacktestWithParams(page, { s: "orb", y: ["RELIANCE"] });

    await expect(page.locator('[data-testid="chip-RELIANCE"]')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Screener")');
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator('[data-testid="screener-view"], [data-testid="screener-page"]'),
    ).toBeVisible({
      timeout: 10000,
    });

    await page.click('button:has-text("Backtest")');
    await page.waitForLoadState("networkidle");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="chip-RELIANCE"]')).toBeVisible({ timeout: 10000 });
  });
});
