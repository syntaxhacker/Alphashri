import { test, expect, type Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupUserConfigMocks,
  setupValueScanMocks,
  type UserConfigMockHandle,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";

/**
 * Saved screen state (`/api/user-configs/market.filters`) — plan §2.5 / §5.3.
 *
 * The mock keeps its state in the test's closure, so a `page.reload()` re-reads
 * exactly what the previous mount wrote: "restore" is proved end to end rather
 * than inferred from a request spy.
 *
 * Fixture universe (same rows as market-screener.spec, chosen so every filter
 * has one unambiguous answer):
 *   IT      : TCS · PERSISTENT · COFORGE · KPITTECH
 *   Energy  : RELIANCE        Banks: HDFCBANK     Services: MICROCO
 *   ETF     : NIFTYBEES · LIQUIDBEES  (class tier, null cap → sorted last)
 */
const SNAPSHOT_PATH = "/?tab=market";

const MOCK_ROWS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banks", close: 1712.3, change: 0.6, relative_volume: 0.9, market_cap_cr: 1300000, cap_tier: "large", rsi: 55, adx: 25, pos_52w: 0.74, fno: false, etf: false },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT", close: 5120.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 78000, cap_tier: "mid", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  { symbol: "COFORGE", name: "Coforge", sector: "IT", close: 6890.5, change: -1.3, relative_volume: 1.5, market_cap_cr: 41000, cap_tier: "mid", rsi: 38, adx: 19, pos_52w: 0.42, fno: false, etf: false },
  { symbol: "KPITTECH", name: "KPIT Technologies", sector: "IT", close: 1834.75, change: 0.9, relative_volume: 1.3, market_cap_cr: 32000, cap_tier: "small", rsi: 52, adx: 24, pos_52w: 0.66, fno: false, etf: false },
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", sector: "ETF", close: 264.1, change: 0.5, relative_volume: 0.7, market_cap_cr: null, cap_tier: "etf", rsi: 48, adx: 18, pos_52w: 0.57, fno: false, etf: true },
  { symbol: "MICROCO", name: "Micro Co", sector: "Services", close: 87.6, change: -2.2, relative_volume: 3.1, market_cap_cr: 900, cap_tier: "micro", rsi: 22, adx: 33, pos_52w: 0.18, fno: false, etf: false },
  { symbol: "LIQUIDBEES", name: "Nippon India ETF Liquid BeES", sector: "ETF", close: 1130.2, change: 0.01, relative_volume: 0.3, market_cap_cr: null, cap_tier: "etf", rsi: 50, adx: 12, pos_52w: 0.51, fno: false, etf: true },
];

/** IT rows in the panel's default `mcap_desc` order — the sort must survive a reload. */
const IT_ROW_IDS = ["TCS", "PERSISTENT", "COFORGE", "KPITTECH"].map((s) => `market-row-${s}`);
/**
 * Every row, `mcap_desc` — the panel's default sort, spelled out rather than
 * implied by fixture order. Null caps map to -∞, so the ETF class rows land
 * after MICROCO (the smallest capped equity).
 */
const ALL_ROW_IDS = [
  "RELIANCE", "HDFCBANK", "TCS", "PERSISTENT", "COFORGE", "KPITTECH", "MICROCO", "NIFTYBEES", "LIQUIDBEES",
].map((s) => `market-row-${s}`);
const LARGE_ROW_IDS = ["RELIANCE", "HDFCBANK", "TCS"].map((s) => `market-row-${s}`);

const GRID_HEADERS = '[data-testid="market-grid"] th';
const SECTOR_CHIP_IT = '[data-testid="market-filter-chip-sector:IT"]';
const UNIVERSE_COMBO = '[data-testid="market-universe-select"] [role="combobox"]';
const SECTOR_COMBO = '[data-testid="market-filter-sector"] [role="combobox"]';

async function mockMarketSnapshot(page: Page) {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        universe: "all_equity",
        total: MOCK_ROWS.length,
        update_mode: "streaming",
        rows: MOCK_ROWS,
      }),
    });
  });
}

/** Row test ids in DOM order — the rendered set *and* the rendered sort. */
async function renderedRowIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="market-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
}

/**
 * What the mock actually persisted — a state assertion, not a request spy.
 * The wire payload is flat (`useMarketConfig.serializeMarketConfig`), so the
 * readers look at top-level keys; there is no `filters` object to descend into.
 */
function persistedStrings(mock: UserConfigMockHandle, key: string): string[] {
  const value = mock.stored()?.[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

function persisted(mock: UserConfigMockHandle, key: string): unknown {
  return mock.stored()?.[key];
}

/** Wait for the debounced write to land in the store before reloading. */
async function waitForPersisted(
  mock: UserConfigMockHandle,
  predicate: (mock: UserConfigMockHandle) => boolean,
) {
  await expect.poll(() => predicate(mock), { timeout: 12000 }).toBe(true);
}

async function pickSector(page: Page, name: string) {
  await page.locator(SECTOR_COMBO).click();
  await page.getByRole("option", { name, exact: true }).getByRole("checkbox").click();
  // Focus returns to the field and Escape closes the portalled listbox; leaving
  // it open would let a 1300-z-index menu swallow the chip click.
  await page.locator(SECTOR_COMBO).press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function pickUniverse(page: Page, label: string) {
  await page.locator(UNIVERSE_COMBO).click();
  await page.getByRole("option", { name: label }).click();
}

async function openMarketTab(page: Page, path = SNAPSHOT_PATH) {
  await page.goto(path);
  await expect(page.locator('[data-testid="market-screener"]')).toBeVisible();
  // Wait for the snapshot to paint, without assuming which rows survive the
  // active filters — a restored sector can legitimately hide any given symbol.
  await expect(page.locator('[data-testid="market-result-count"]')).toBeVisible();
  await expect(page.locator('[data-testid^="market-row-"]').first()).toBeVisible();
}

test.describe("Saved screen state — market.filters", () => {
  const consoleErrors: string[] = [];
  /** The failed-PUT test deliberately triggers a failed fetch. Chromium logs an
   * unsuppressable "Failed to load resource" for it, and an implementation may
   * legitimately `console.error` the save failure — that test asserts the chip,
   * so it waives console noise entirely. The other three stay strict. */
  let allowConsoleNoise = false;

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    allowConsoleNoise = false;
    collectConsoleErrors(page);
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await mockMarketSnapshot(page);
  });

  test.afterEach(() => {
    if (allowConsoleNoise) return;
    expect(consoleErrors).toEqual([]);
  });

  test("sector + universe survive a reload, and SECTOR stays hidden", async ({ page }) => {
    const config = await setupUserConfigMocks(page);
    await openMarketTab(page);

    await pickUniverse(page, "Nifty 500");
    await pickSector(page, "IT");

    await expect(page.locator(SECTOR_CHIP_IT)).toBeVisible();
    await expect(page.locator(UNIVERSE_COMBO)).toHaveValue("Nifty 500");
    // A pinned sector makes the column constant; it must stay hidden after the
    // reload too (a restored sector that forgot to hide SECTOR is the bug).
    await expect(page.locator(GRID_HEADERS).filter({ hasText: "SECTOR" })).toHaveCount(0);
    await expect.poll(() => renderedRowIds(page)).toEqual(IT_ROW_IDS);

    // Universe + sector must land in one write: a universe change resets filters,
    // so a broken hydration would persist the sector but lose the universe.
    await waitForPersisted(
      config,
      (m) => persistedStrings(m, "sectors").includes("IT") && persisted(m, "universe") === "nifty500",
    );

    await page.reload();

    await expect(page.locator(SECTOR_CHIP_IT)).toBeVisible();
    await expect(page.locator(UNIVERSE_COMBO)).toHaveValue("Nifty 500");
    await expect(page.locator(GRID_HEADERS).filter({ hasText: "SECTOR" })).toHaveCount(0);
    await expect.poll(() => renderedRowIds(page)).toEqual(IT_ROW_IDS);
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${IT_ROW_IDS.length} / ${MOCK_ROWS.length}`,
    );
  });

  test("a URL view wins over the saved one; the other saved fields still apply", async ({ page }) => {
    await setupUserConfigMocks(page, {
      universe: "nifty500",
      view: "table",
      sectors: ["IT"],
    });

    await page.goto("/screener?tab=market&view=map");

    // URL owns the layout …
    await expect(page.locator('[data-testid="market-map-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-grid"]')).toBeHidden();
    // … while the saved universe and sector still land.
    await expect(page.locator(SECTOR_CHIP_IT)).toBeVisible();
    await expect(page.locator(UNIVERSE_COMBO)).toHaveValue("Nifty 500");
    // Legacy `?view=map` normalises to the canonical `vis`, which is what gets
    // written back — the URL still owns the layout instead of the saved `table`.
    await expect(page).toHaveURL(/view=vis/);
  });

  test("a cleared sector does not resurrect after a reload", async ({ page }) => {
    // Seed a saved sector so this is not vacuous: with nothing stored, "cleared"
    // and "never saved" are indistinguishable.
    const config = await setupUserConfigMocks(page, { sectors: ["IT"] });
    await openMarketTab(page);

    await expect(page.locator(SECTOR_CHIP_IT)).toBeVisible();
    await expect.poll(() => renderedRowIds(page)).toEqual(IT_ROW_IDS);

    await page.locator(SECTOR_CHIP_IT).click();
    await expect(page.locator(SECTOR_CHIP_IT)).toHaveCount(0);
    await expect(page.locator(GRID_HEADERS).filter({ hasText: "SECTOR" })).toHaveCount(1);
    await expect.poll(() => renderedRowIds(page)).toEqual(ALL_ROW_IDS);
    await waitForPersisted(config, (m) => persistedStrings(m, "sectors").length === 0);

    await page.reload();

    // The clear was written and the read must not bring the old sector back.
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-filter-chip-sector:IT"]')).toHaveCount(0);
    await expect(page.locator(GRID_HEADERS).filter({ hasText: "SECTOR" })).toHaveCount(1);
    await expect.poll(() => renderedRowIds(page)).toEqual(ALL_ROW_IDS);
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${MOCK_ROWS.length} / ${MOCK_ROWS.length}`,
    );
  });

  test("a failed save shows the not-saved chip and keeps the change", async ({ page }) => {
    allowConsoleNoise = true;
    const config = await setupUserConfigMocks(page);
    config.setPutStatus(500);
    await openMarketTab(page);

    await page.locator('[data-testid="market-cap-large"]').click();

    const chip = page.locator('[data-testid="saved-config-error"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/^Filters not saved/);
    await expect(page.locator('[data-testid="saved-config-retry"]')).toBeVisible();

    // Deliberate: a failed write does not yank the live controls back.
    await expect(page.locator('[data-testid="market-filter-chip-capTier:large"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `3 / ${MOCK_ROWS.length}`,
    );
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    const visiblyApplied = await renderedRowIds(page);
    expect(visiblyApplied).toEqual(LARGE_ROW_IDS);

    // Retry against a healthy server clears the chip and persists the change.
    config.setPutStatus(null);
    await page.locator('[data-testid="saved-config-retry"]').click();
    await expect(chip).toHaveCount(0);
    await waitForPersisted(config, (m) => persistedStrings(m, "capTiers").join() === "large");
    expect(await renderedRowIds(page)).toEqual(visiblyApplied);
  });

  test("switching to Value writes view:'value' on PUT and restores it after a reload", async ({ page }) => {
    await setupValueScanMocks(page);
    const config = await setupUserConfigMocks(page);

    // Stand in for the backend's view validation: `value` must be an accepted
    // token. A regression that serialises anything else (or drops the field)
    // gets a 422, so the 200 assertion below is a real contract check.
    await page.route(apiRoute("user-configs/[^/]+"), async (route) => {
      const request = route.request();
      const scope = new URL(request.url()).pathname.split("/").pop();
      if (request.method() === "PUT" && scope === "market.filters") {
        let view: unknown;
        try {
          const body = JSON.parse(request.postData() || "{}") as {
            config?: { view?: unknown };
          };
          view = body.config?.view;
        } catch {
          view = undefined;
        }
        if (view !== "value" && view !== "table") {
          await route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({ detail: "invalid_view" }),
          });
          return;
        }
      }
      await route.fallback();
    });

    // Registered before the click: the first PUT carrying `view:"value"` is the
    // one that must be accepted by the (validating) mock.
    const valuePut = page.waitForResponse(
      (res) =>
        res.url().includes("/api/user-configs/market.filters") &&
        res.request().method() === "PUT" &&
        (res.request().postData() ?? "").includes('"view":"value"'),
      { timeout: 12000 },
    );

    await openMarketTab(page);
    await page.getByTestId("market-view-toggle").getByText("Value", { exact: true }).click();
    await expect(page.getByTestId("market-value-region")).toBeVisible();

    expect((await valuePut).status()).toBe(200);
    const afterView = config.puts();
    expect(
      afterView.some(
        (body) => (body.config as Record<string, unknown> | undefined)?.view === "value",
      ),
    ).toBe(true);

    // Changing the universe from inside Value must keep `view:"value"` in the
    // write — the persisted layout and the snapshot filter travel together.
    await pickUniverse(page, "Nifty 500");
    await waitForPersisted(config, (m) => persisted(m, "universe") === "nifty500");
    const puts = config.puts();
    const latest = puts[puts.length - 1];
    expect((latest?.config as Record<string, unknown> | undefined)?.view).toBe("value");

    await page.reload();

    await expect(page.getByTestId("market-value-region")).toBeVisible();
    await expect(page).toHaveURL(/[?&]view=value/);
    await expect(page.locator(UNIVERSE_COMBO)).toHaveValue("Nifty 500");
  });
});
