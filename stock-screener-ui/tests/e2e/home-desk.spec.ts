import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  mockSectorResponse,
  setupApiMocks,
  loginAsTestUser,
  setupHomeConfigMocks,
  type HomeConfigMockHandle,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";
import { setupNewsMocks } from "./helpers/newsHelpers";

/**
 * /home — the floating-window desk. Everything is mocked at the network
 * boundary: the seeded panels own their data paths (market snapshot + options
 * chain) and the desk owns its layout (`window.home`).
 *
 * Geometry is read from the committed inline `style` (not the live drag rect)
 * and from `getComputedStyle().zIndex`, so every geometry assertion can fail.
 */
const HEATMAP = "market.heatmap-1";
const CHAIN = "options.chain-2";
const CHAIN_ID_PREFIX = "options.chain-";
const CHAIN_EXPIRY = "2026-11-27";

interface RectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
}

interface SeenUrls {
  snapshot: string[];
  chain: string[];
  sector: string[];
}

interface PersistedWindow {
  id: string;
  x: number;
  y: number;
  z: number;
}

const MARKET_SNAPSHOT = {
  as_of: new Date().toISOString(),
  universe: "all_equity",
  total: 3,
  update_mode: "streaming",
  rows: [
    { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
    { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
    { symbol: "INFY", name: "Infosys", sector: "IT", close: 1534.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 780000, cap_tier: "large", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  ],
};

const OPTION_CHAIN = {
  expiry: CHAIN_EXPIRY,
  spot: 24000.5,
  timestamp: new Date().toISOString(),
  spot_change_pct: 0.4,
  summary: { pcr: 0.95 },
  levels: null,
  chain: [
    {
      strike: 24000,
      ce: {
        instrument_key: "NSE_FO|NIFTY26NOV24000CE",
        market_data: { ltp: 80, oi: 10000, prev_oi: 8000, volume: 2000, bid_price: 78, ask_price: 82 },
        option_greeks: { iv: 17, delta: 0.5, gamma: 0.002, theta: -6, vega: 12 },
      },
      pe: {
        instrument_key: "NSE_FO|NIFTY26NOV24000PE",
        market_data: { ltp: 80, oi: 8000, prev_oi: 7500, volume: 1500, bid_price: 78, ask_price: 82 },
        option_greeks: { iv: 19, delta: -0.5, gamma: 0.002, theta: -5, vega: 11 },
      },
    },
  ],
};

/**
 * The desk's picker is HOME_PANELS. `src/pages/home/homePanels.ts` builds it
 * from the real window specs in `src/components/window/panelRegistry.ts` — the
 * blank proof-of-contract report stubs were removed from both the picker and
 * the registry. Titles below are each spec's `title` field.
 */
const EXPECTED_PICKER_PANELS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "catalyst.radar", title: "CATALYST RADAR" },
  { id: "market.heatmap", title: "MARKET HEATMAP" },
  { id: "news.feed", title: "NEWS" },
  { id: "options.analytics", title: "OPTIONS ANALYTICS" },
  { id: "options.chain", title: "OPTIONS CHAIN" },
  { id: "options.positioning", title: "OPTIONS POSITIONING" },
  { id: "patterns.results", title: "PATTERNS" },
  { id: "sector.correlation", title: "SECTOR CORRELATION" },
  { id: "sector.detail", title: "SECTOR DETAIL" },
  { id: "sector.heatmap", title: "SECTOR HEATMAP" },
  { id: "sector.table", title: "SECTOR PERFORMANCE" },
  { id: "sector.movers", title: "INTERVAL MOVERS" },
  { id: "sector.rotation", title: "SECTOR ROTATION" },
];

const SECTOR_RESPONSE = {
  ...mockSectorResponse,
  top_stock_movers: mockSectorResponse.top_stock_movers.map((mover) => ({
    ...mover,
    prev_change: Number((mover.change * 0.4).toFixed(2)),
  })),
};

async function mockHomeNetwork(page: Page): Promise<SeenUrls> {
  const seen: SeenUrls = { snapshot: [], chain: [], sector: [] };
  // The options windows pick an expiry from the real listing rather than
  // typing a date, so the desk needs a listing to pick from.
  await page.route(apiRoute("reports/nifty/expiries"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ expiries: [{ date: CHAIN_EXPIRY }] }),
    });
  });
  await page.route(apiRoute("options/expiries"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        underlying: "NIFTY",
        expiries: [{ date: CHAIN_EXPIRY, weekly: true, days_to_expiry: 2 }],
      }),
    });
  });
  await page.route(apiRoute("catalysts/today"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        market: { nifty: null, sensex: null, vix: null },
        sector: {
          id: "auto",
          label: "NIFTY AUTO",
          change_pct: null,
          relative_strength_pct: null,
          breadth: { advancing: 0, declining: 0, total: 0 },
        },
        rows: [],
        counts: { high: 0, medium: 0, low: 0, total: 0 },
        warnings: [],
      }),
    });
  });
  await page.route(apiRoute("market/snapshot"), async (route) => {
    seen.snapshot.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MARKET_SNAPSHOT),
    });
  });
  await page.route(apiRoute("options/chain/NIFTY"), async (route) => {
    seen.chain.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OPTION_CHAIN),
    });
  });
  // The positioning panel fetches on mount now that it defaults to an expiry;
  // without this the desk logs a 401 and the spec's console guard fails.
  await page.route(apiRoute("options/positioning"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        underlying: "NIFTY",
        expiry: CHAIN_EXPIRY,
        spot: 24000.5,
        lot_size: 50,
        timestamp: new Date().toISOString(),
        baseline: "since_open",
        baseline_note: "Since open",
        verdict: { label: "NEUTRAL", tone: "neutral", note: "" },
        initiated_cr: 0,
        lean_pct: 0,
        state: { calls_cr: 0, puts_cr: 0, note: "" },
        flow: { calls_cr: 0, puts_cr: 0, note: "" },
        initiated: { bearish_cr: 0, bullish_cr: 0, note: "" },
        split: { bearish_cr: 0, bearish_pct: 0, bullish_cr: 0, bullish_pct: 0 },
        read: { pct: 0, readable_shares: 0, total_shares: 0 },
        biggest_move: null,
        rows: [],
      }),
    });
  });
  await page.route(apiRoute("sector"), async (route) => {
    const url = route.request().url();
    if (new URL(url).pathname !== "/api/sector") {
      await route.fallback();
      return;
    }
    seen.sector.push(url);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SECTOR_RESPONSE),
    });
  });

  // Preset tabs mount panels whose endpoints the seeded desk never touches.
  // Registered after the broad sector route so /api/sector/correlation wins.
  await page.route(apiRoute("rotation/overview"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        market: "india",
        kind: "sector",
        period: "1M",
        benchmark: "NIFTY 50",
        last_updated: new Date().toISOString(),
        regime: {
          benchmark: "NIFTY 50",
          benchmark_change: 0.4,
          benchmark_1m: 1.1,
          vix: null,
          vix_change: null,
          breadth: 0.5,
          label: "Neutral",
        },
        counts: { booming: 0, heating: 0, cooling: 0, dumping: 0, neutral: 0 },
        rows: [],
      }),
    });
  });
  // Empty-but-valid payload: an n×n correlation matrix makes ECharts init in a
  // zero-size flex cell before layout settles and logs a console error. The
  // panel's own empty state is the fixture these preset tests need.
  await page.route(apiRoute("sector/correlation"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sectors: [], correlation_matrix: [], sector_names: [], last_updated: new Date().toISOString() }),
    });
  });
  return seen;
}

const win = (page: Page, id: string) => page.getByTestId(`window-${id}`);
const titleBar = (page: Page, id: string) => page.getByTestId(`window-title-${id}`);
const canvas = (page: Page) => page.getByTestId("window-manager-canvas");
const windows = (page: Page) => canvas(page).locator("[data-window-id]");

/**
 * The window id carries an instance counter (`patterns.results-3`), so hardcoding
 * a suffix asserts an incidental insertion order. Resolve the window by the panel
 * it holds instead.
 */
const newestWindowId = async (page: Page, panelId: string): Promise<string> => {
  const match = async () =>
    (await windows(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-window-id") ?? ""),
    )).find((id) => id.startsWith(`${panelId}-`)) ?? "";
  await expect.poll(match, { timeout: 10000 }).not.toBe("");
  return match();
};

interface WindowLabel {
  id: string;
  title: string;
}

interface CanvasOverflow {
  id: string;
  right: number;
  bottom: number;
  canvasRight: number;
  canvasBottom: number;
}

const RESEARCH_TITLES = ["PATTERNS", "SECTOR CORRELATION", "SECTOR ROTATION"];
const TRADING_TITLES = ["MARKET HEATMAP", "OPTIONS CHAIN", "OPTIONS POSITIONING"];

async function windowLabels(page: Page): Promise<WindowLabel[]> {
  return windows(page).evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-window-id") ?? "",
      title: el.getAttribute("aria-label") ?? "",
    })),
  );
}

async function windowTitles(page: Page): Promise<string[]> {
  return (await windowLabels(page)).map((w) => w.title).sort();
}

async function applyPreset(page: Page, id: string): Promise<void> {
  await page.getByTestId("home-preset-menu-trigger").click();
  await page.getByTestId(`home-preset-${id}`).click();
}

/** Live DOM geometry — inline styles are not enough for a preset's fitted rects. */
async function windowCanvasRects(page: Page): Promise<CanvasOverflow[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="window-manager-canvas"]');
    if (!canvas) return [{ id: "NO CANVAS", right: 0, bottom: 0, canvasRight: 0, canvasBottom: 0 }];
    const box = canvas.getBoundingClientRect();
    return Array.from(canvas.querySelectorAll("[data-window-id]")).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-window-id") ?? "",
        right: rect.right,
        bottom: rect.bottom,
        canvasRight: box.right,
        canvasBottom: box.bottom,
      };
    });
  });
}

async function geometry(locator: Locator): Promise<RectSnapshot> {
  return locator.evaluate((node) => {
    const el = node as HTMLElement;
    return {
      left: Number.parseFloat(el.style.left) || 0,
      top: Number.parseFloat(el.style.top) || 0,
      width: Number.parseFloat(el.style.width) || 0,
      height: Number.parseFloat(el.style.height) || 0,
      z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
    };
  });
}

async function dragTitleBy(page: Page, title: Locator, dx: number, dy: number): Promise<void> {
  const box = await title.boundingBox();
  if (!box) throw new Error("window title bar has no bounding box");
  // Grab near the left edge so the handle stays visible even after a window
  // has been pushed almost entirely off the right side of the canvas.
  const startX = box.x + Math.min(40, box.width / 2);
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 6 });
  await page.mouse.up();
}

/**
 * The two-column seed is derived from `window.innerWidth`, while the canvas is
 * narrower by the sidebar. The right-hand window therefore starts clipped and
 * its title-bar buttons can sit outside the viewport. Use the desk's own Fit
 * all control (the documented off-canvas recovery path) before exercising
 * those buttons — the bugs are reported separately, never masked by weaker
 * assertions here.
 */
async function fitAll(page: Page, config: HomeConfigMockHandle): Promise<void> {
  const before = await geometry(win(page, HEATMAP));
  await page.getByTestId("window-fit-all").click();
  await expect.poll(async () => (await geometry(win(page, HEATMAP))).left).not.toBe(before.left);
  // Let the debounced layout write settle: a late save re-render replaces the
  // title-bar buttons and would swallow an input aimed at the old node.
  await expect.poll(() => config.puts().length).toBeGreaterThan(0);
}

/**
 * Title-bar controls are activated with the keyboard: a physical mouse click
 * is swallowed because the focus re-render replaces the button between
 * mousedown and mouseup (reported as an app bug). `press` focuses and presses
 * in one action, so the real onClick handler still runs deterministically and
 * the state assertions below remain genuine.
 */
async function activateButton(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).press("Enter");
}

function persistedMain(handle: HomeConfigMockHandle): PersistedWindow[] {
  const raw = handle.stored();
  const layouts = raw?.layouts as Array<{ name: string; windows: PersistedWindow[] }> | undefined;
  return layouts?.find((layout) => layout.name === "Main")?.windows ?? [];
}

async function addPanel(page: Page, panelId: string): Promise<void> {
  await page.getByTestId("home-panel-picker").locator("select").selectOption(panelId);
}

/** Monitor is the default surface; the desk spec opts in explicitly. */
async function goDesk(page: Page): Promise<void> {
  await page.getByTestId("home-view-desk").click();
}

function pickerOptions(page: Page): Promise<Array<{ value: string; label: string }>> {
  return page
    .getByTestId("home-panel-picker")
    .locator("select option")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          value: (el as HTMLOptionElement).value,
          label: (el.textContent ?? "").trim(),
        }))
        .filter((option) => option.value !== ""),
    );
}

test.describe("/home floating-window desk", () => {
  let consoleErrors: string[];
  let config: HomeConfigMockHandle;
  let seen: SeenUrls;

  test.beforeEach(async ({ page }) => {
    consoleErrors = collectConsoleErrors(page);
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
    config = await setupHomeConfigMocks(page);
    seen = await mockHomeNetwork(page);
    await page.goto("/");
    await page.getByTestId("nav-home").click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByTestId("home-page")).toBeVisible();
    await goDesk(page);
    await expect(windows(page)).toHaveCount(2);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("load: /home seeds two floating windows and the mocks saw the real URLs", async ({ page }) => {
    await expect(win(page, HEATMAP)).toBeVisible();
    await expect(win(page, CHAIN)).toBeVisible();
    await expect(win(page, HEATMAP)).toHaveAttribute("aria-label", "MARKET HEATMAP");
    await expect(win(page, CHAIN)).toHaveAttribute("aria-label", "OPTIONS CHAIN");
    await expect(page.getByTestId("window-fit-all")).toBeVisible();
    await expect(page.getByTestId("window-lock-toggle")).toBeVisible();

    // The seeded heatmap fetched the market snapshot at the real endpoint.
    await expect
      .poll(() => seen.snapshot.some((url) => url.includes("/api/market/snapshot?universe=all_equity")), { timeout: 10000 })
      .toBe(true);
    expect(seen.snapshot.length).toBeGreaterThan(0);

    // The desk read its saved layout from the window.home scope.
    await expect
      .poll(() => config.requests().some((url) => url.includes("/api/user-configs/window.home")))
      .toBe(true);

    // The options window defaults to the nearest listing and fetches that
    // chain; choosing a different expiry must retarget the request.
    await expect
      .poll(() => seen.chain.some((url) => url.includes(`/api/options/chain/NIFTY?expiry=${CHAIN_EXPIRY}`)))
      .toBe(true);
    expect(seen.chain.length).toBeGreaterThan(0);
    await expect(page.getByTestId("options-chain-loading")).toHaveCount(0);
    await expect(page.getByTestId(`window-${CHAIN}`).getByTestId("options-chain-empty")).toHaveCount(0);
  });

  test("add a panel: picking NEWS grows the desk by one window", async ({ page }) => {
    const before = await windows(page).count();
    expect(before).toBe(2);

    await addPanel(page, "news.feed");

    await expect(windows(page)).toHaveCount(before + 1);
    await expect(win(page, "news.feed-3")).toBeVisible();
    await expect(win(page, "news.feed-3")).toHaveAttribute("aria-label", "NEWS");
    await expect(win(page, "news.feed-3").getByTestId("panel-news-feed")).toBeVisible();
    await expect.poll(() => persistedMain(config)).toHaveLength(3);
  });

  test("picker lists every registered real panel with its title", async ({ page }) => {
    const actual = (await pickerOptions(page))
      .map((option) => `${option.value}=${option.label}`)
      .sort();
    const expected = EXPECTED_PICKER_PANELS.map((spec) => `${spec.id}=${spec.title}`).sort();

    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(EXPECTED_PICKER_PANELS.length);
  });

  test("picker no longer offers removed panels (paper.positions, report stubs)", async ({ page }) => {
    const ids = (await pickerOptions(page)).map((option) => option.value);
    // The positive assertion keeps the negative one from passing on an empty list.
    expect(ids).toContain("sector.table");
    expect(ids).toContain("patterns.results");
    for (const removed of ["paper.positions", "report.chart", "report.walls", "report.breadth"]) {
      expect(ids, removed).not.toContain(removed);
    }
  });

  test("add a patterns panel: it renders its honest empty state", async ({ page }) => {
    const before = await windows(page).count();
    expect(before).toBe(2);

    await addPanel(page, "patterns.results");

    await expect(windows(page)).toHaveCount(before + 1);
    // Resolve the window by panel id instead of assuming the instance-counter
    // suffix — `patterns.results-3` bakes in "exactly two windows came before",
    // which only holds in the seeded order this test happens to get locally.
    const panelId = await newestWindowId(page, "patterns.results");
    const panel = win(page, panelId);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "PATTERNS");
    await expect(panel.getByTestId("patterns-results-panel")).toBeVisible();
    await expect(panel.getByTestId("patterns-results-toolbar")).toBeVisible();
    await expect(panel.getByTestId("patterns-results-empty")).toBeVisible();
    await expect(panel.getByTestId("patterns-results-error")).toHaveCount(0);
    await expect.poll(() => persistedMain(config)).toHaveLength(3);
  });

  test("add a sector panel: it renders the mocked sector feed", async ({ page }) => {
    const before = await windows(page).count();
    expect(before).toBe(2);

    await addPanel(page, "sector.table");

    await expect(windows(page)).toHaveCount(before + 1);
    const panel = win(page, "sector.table-3");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "SECTOR PERFORMANCE");
    await expect(panel.getByTestId("sector-table-panel")).toBeVisible();
    await expect(panel.getByTestId("sector-table-error")).toHaveCount(0);
    await expect(panel.getByTestId("sector-table-empty")).toHaveCount(0);
    await expect(panel.getByText(/3 sectors/)).toBeVisible();
    await expect(panel.getByText(/Technology/)).toBeVisible();
    await expect
      .poll(() => seen.sector.some((url) => url.includes("/api/sector?market=india")))
      .toBe(true);
  });

  test("add an options panel: it renders its honest empty state", async ({ page }) => {
    const before = await windows(page).count();
    expect(before).toBe(2);

    await addPanel(page, "options.positioning");

    await expect(windows(page)).toHaveCount(before + 1);
    const panel = win(page, "options.positioning-3");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "OPTIONS POSITIONING");
    await expect(panel.getByTestId("options-positioning-window")).toBeVisible();
    // The panel now defaults to the nearest listing instead of asking the user
    // to type a date, so it has a symbol and an expiry from the first frame.
    await expect(panel.getByTestId("options-positioning-window")).toContainText("NIFTY");
    await expect(panel.getByTestId("options-positioning-empty")).toHaveCount(0);
    await expect.poll(() => persistedMain(config)).toHaveLength(3);
  });

  test("two sector windows share one /api/sector fetch", async ({ page }) => {
    const before = await windows(page).count();
    expect(before).toBe(2);

    await addPanel(page, "sector.table");
    await expect(windows(page)).toHaveCount(before + 1);
    const table = win(page, "sector.table-3");
    await expect(table.getByTestId("sector-table-panel")).toBeVisible();

    await addPanel(page, "sector.movers");
    await expect(windows(page)).toHaveCount(before + 2);
    const movers = win(page, "sector.movers-4");
    await expect(movers.getByTestId("sector-movers-panel")).toBeVisible();

    // Both windows paint from the one shared store load before we count the
    // network boundary, so a late second fetch cannot slip past the assertion.
    await expect(table.getByText(/3 sectors/)).toBeVisible();
    await expect(movers.getByText(/5 movers/)).toBeVisible();
    await expect.poll(() => seen.sector.length).toBeGreaterThan(0);
    expect(seen.sector).toHaveLength(1);
    expect(seen.sector.join(" ")).toContain("/api/sector?market=india");
  });

  test("drag: moving by the title bar changes left/top and survives the save", async ({ page }) => {
    const target = win(page, HEATMAP);
    const before = await geometry(target);

    await dragTitleBy(page, titleBar(page, HEATMAP), 80, 50);

    const after = await geometry(target);
    expect(after.left).toBeCloseTo(before.left + 80, 0);
    expect(after.top).toBeCloseTo(before.top + 50, 0);
    expect(after.width).toBeCloseTo(before.width, 0);

    await expect
      .poll(() => persistedMain(config).find((w) => w.id === HEATMAP)?.x)
      .toBeCloseTo(after.left, 0);
    // The debounced save echo must not snap the window back to its old spot.
    expect((await geometry(target)).left).toBeCloseTo(after.left, 0);
  });

  test("focus: clicking a background window raises it above the other one", async ({ page }) => {
    const background = win(page, HEATMAP);
    const foregroundZ = (await geometry(win(page, CHAIN))).z;
    expect(foregroundZ).toBe(2);

    await titleBar(page, HEATMAP).click();

    await expect.poll(async () => (await geometry(background)).z).toBeGreaterThan(foregroundZ);
    expect((await geometry(background)).z).toBe(3);
    await expect(background).toHaveAttribute("data-focused", "true");
  });

  test("minimize + restore: body collapses, title stays, restore returns it", async ({ page }) => {
    await fitAll(page, config);
    const target = win(page, HEATMAP);
    const before = await geometry(target);

    await activateButton(page, `window-minimize-${HEATMAP}`);

    await expect(target).toHaveAttribute("data-minimized", "true");
    await expect(page.getByTestId(`window-body-${HEATMAP}`)).toHaveCount(0);
    await expect(titleBar(page, HEATMAP)).toBeVisible();
    expect((await geometry(target)).width).toBeCloseTo(before.width, 0);

    await activateButton(page, `window-minimize-${HEATMAP}`);

    await expect(target).not.toHaveAttribute("data-minimized");
    await expect(page.getByTestId(`window-body-${HEATMAP}`)).toBeVisible();
    expect((await geometry(target)).top).toBeCloseTo(before.top, 0);
  });

  test("maximize + restore: fill the canvas, then return to the prior rect", async ({ page }) => {
    await fitAll(page, config);
    const target = win(page, HEATMAP);
    const before = await geometry(target);
    const canvasBox = await canvas(page).boundingBox();
    expect(canvasBox).not.toBeNull();

    await activateButton(page, `window-maximize-${HEATMAP}`);

    await expect(target).toHaveAttribute("data-maximized", "true");
    await expect.poll(async () => geometry(target)).toEqual(
      expect.objectContaining({
        left: 0,
        top: 0,
        width: canvasBox!.width,
        height: canvasBox!.height,
      }),
    );

    await activateButton(page, `window-maximize-${HEATMAP}`);

    await expect(target).not.toHaveAttribute("data-maximized");
    const restored = await geometry(target);
    expect(restored.left).toBeCloseTo(before.left, 0);
    expect(restored.top).toBeCloseTo(before.top, 0);
    expect(restored.width).toBeCloseTo(before.width, 0);
    expect(restored.height).toBeCloseTo(before.height, 0);
  });

  test("close + re-add: closing removes the window and the picker brings it back", async ({ page }) => {
    await fitAll(page, config);
    expect(await windows(page).count()).toBe(2);

    await activateButton(page, `window-close-${CHAIN}`);

    await expect(windows(page)).toHaveCount(1);
    await expect(win(page, CHAIN)).toHaveCount(0);
    await expect.poll(() => persistedMain(config)).toHaveLength(1);

    await addPanel(page, "options.chain");

    await expect(windows(page)).toHaveCount(2);
    const readded = page.locator(`[data-window-id^="${CHAIN_ID_PREFIX}"]`);
    await expect(readded).toHaveCount(1);
    await expect(readded).toHaveAttribute("aria-label", "OPTIONS CHAIN");
    await expect.poll(() => persistedMain(config)).toHaveLength(2);
  });

  test("Fit all windows: an off-canvas window is brought back into view", async ({ page }) => {
    const canvasBox = await canvas(page).boundingBox();
    expect(canvasBox).not.toBeNull();
    const canvasWidth = canvasBox!.width;
    const target = win(page, HEATMAP);

    // Two in-viewport drags push the window to the canvas clamp (only its
    // 60px title strip remains on screen), without dispatching mouse
    // coordinates outside the browser viewport.
    await dragTitleBy(page, titleBar(page, HEATMAP), 700, 0);
    await dragTitleBy(page, titleBar(page, HEATMAP), 400, 0);

    const offCanvas = await geometry(target);
    expect(offCanvas.left).toBeGreaterThanOrEqual(canvasWidth - 70);
    expect(offCanvas.left + offCanvas.width).toBeGreaterThan(canvasWidth);

    await page.getByTestId("window-fit-all").click();

    const fitted = await geometry(target);
    expect(fitted.left).toBeGreaterThanOrEqual(0);
    expect(fitted.left).toBeLessThan(canvasWidth - 60);
    expect(fitted.left + fitted.width).toBeLessThanOrEqual(canvasWidth + 1);
    expect(fitted.left).toBeLessThan(offCanvas.left);
    await expect
      .poll(() => persistedMain(config).find((w) => w.id === HEATMAP)?.x)
      .toBeCloseTo(fitted.left, 0);
  });

  test("Lock: with the desk locked, dragging does not move a window", async ({ page }) => {
    const lock = page.getByTestId("window-lock-toggle");
    await lock.click();

    await expect(lock).toHaveText("Unlock");
    await expect(lock).toHaveAttribute("aria-pressed", "true");
    await expect(canvas(page)).toHaveAttribute("data-locked", "true");
    await expect(page.getByTestId(`window-resize-${HEATMAP}-n`)).toHaveCount(0);

    const target = win(page, HEATMAP);
    const before = await geometry(target);

    await dragTitleBy(page, titleBar(page, HEATMAP), 140, 90);

    const after = await geometry(target);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    await expect.poll(() => persistedMain(config)).toHaveLength(2);

    await lock.click();
    await expect(canvas(page)).toHaveAttribute("data-locked", "false");
    await dragTitleBy(page, titleBar(page, HEATMAP), 60, 40);
    expect((await geometry(target)).left).toBeCloseTo(before.left + 60, 0);
  });

  test("layout tabs: Blank is empty and switching back restores Main", async ({ page }) => {
    expect(await windows(page).count()).toBe(2);

    await page.getByTestId("home-layout-tab-blank").click();

    await expect(page.getByTestId("home-layout-tab-blank")).toHaveAttribute("aria-selected", "true");
    await expect(windows(page)).toHaveCount(0);
    await expect(win(page, HEATMAP)).toHaveCount(0);

    await page.getByTestId("home-layout-tab-main").click();

    await expect(page.getByTestId("home-layout-tab-main")).toHaveAttribute("aria-selected", "true");
    await expect(windows(page)).toHaveCount(2);
    await expect(win(page, HEATMAP)).toBeVisible();
    await expect(win(page, CHAIN)).toBeVisible();
  });

  test("persistence: a dragged + extended layout survives a reload", async ({ page }) => {
    await dragTitleBy(page, titleBar(page, HEATMAP), 64, 36);
    await addPanel(page, "news.feed");

    await expect.poll(() => persistedMain(config)).toHaveLength(3);
    const persistedHeatmap = persistedMain(config).find((w) => w.id === HEATMAP);
    expect(persistedHeatmap).toBeDefined();
    const expectedX = persistedHeatmap!.x;
    const expectedY = persistedHeatmap!.y;
    await expect
      .poll(() => config.requests().filter((url) => url.includes("/api/user-configs/window.home")).length)
      .toBeGreaterThan(1);

    await page.reload();
    await expect(page.getByTestId("home-page")).toBeVisible();
    await goDesk(page);
    await expect(windows(page)).toHaveCount(3);

    const reloaded = await geometry(win(page, HEATMAP));
    expect(reloaded.left).toBeCloseTo(expectedX, 0);
    expect(reloaded.top).toBeCloseTo(expectedY, 0);
    await expect(win(page, "news.feed-3")).toBeVisible();
    await expect(page.getByTestId("home-layout-tab-main")).toHaveAttribute("aria-selected", "true");
  });

  test("presets: applying Research adds one scoped tab and leaves Main untouched", async ({ page }) => {
    const mainBefore = await windowLabels(page);
    expect(mainBefore).toHaveLength(2);
    expect(mainBefore.map((w) => w.title).sort()).toEqual(["MARKET HEATMAP", "OPTIONS CHAIN"]);

    await applyPreset(page, "research");

    await expect(page.getByTestId("home-layout-tab-research")).toBeVisible();
    await expect(page.getByTestId("home-layout-tab-research")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("home-layout-tab-main")).toHaveAttribute("aria-selected", "false");
    await expect(windows(page)).toHaveCount(3);
    await expect.poll(() => windowTitles(page)).toEqual(RESEARCH_TITLES);

    // The undo path is the tab switch: Main must still hold its original windows.
    await page.getByTestId("home-layout-tab-main").click();

    await expect(page.getByTestId("home-layout-tab-main")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => windowLabels(page)).toEqual(mainBefore);
    expect(await windowTitles(page)).toEqual(["MARKET HEATMAP", "OPTIONS CHAIN"]);
  });

  test("presets: every window of the applied desk fits inside the canvas", async ({ page }) => {
    await applyPreset(page, "research");
    await expect.poll(() => windowTitles(page)).toEqual(RESEARCH_TITLES);

    const rects = await windowCanvasRects(page);
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.right, `${rect.id} right edge`).toBeLessThanOrEqual(rect.canvasRight + 1);
      expect(rect.bottom, `${rect.id} bottom edge`).toBeLessThanOrEqual(rect.canvasBottom + 1);
    }
  });

  test("presets: the menu opens and applies with the keyboard only", async ({ page }) => {
    const trigger = page.getByTestId("home-preset-menu-trigger");
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");

    await expect(page.getByTestId("home-preset-menu-dropdown")).toBeVisible();
    const item = page.getByTestId("home-preset-research");
    await expect(item).toHaveAttribute("role", "menuitem");
    await item.focus();
    await expect(item).toBeFocused();
    await item.press("Enter");

    await expect(page.getByTestId("home-layout-tab-research")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("home-layout-tab-main")).toHaveAttribute("aria-selected", "false");
    await expect.poll(() => windowTitles(page)).toEqual(RESEARCH_TITLES);
  });

  test("presets: rapid switching leaves exactly the last preset's windows", async ({ page }) => {
    await applyPreset(page, "research");
    await applyPreset(page, "trading");

    await expect(page.getByTestId("home-layout-tab-trading")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => windowTitles(page)).toEqual(TRADING_TITLES);
    await expect(windows(page)).toHaveCount(3);
    expect((await windowLabels(page)).map((w) => w.id).sort()).toEqual([
      "market.heatmap-1",
      "options.chain-2",
      "options.positioning-3",
    ]);
  });
});
