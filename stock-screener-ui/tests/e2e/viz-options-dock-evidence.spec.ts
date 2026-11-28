import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupOptionDockMocks,
  setupFnoScreenerMocks,
  setupOptionsMocks,
} from "../mocks/apiResponses";
import { analyticsBody } from "../mocks/analyticsResponse";
import { apiRoute } from "../mocks/routeHelper";

/**
 * Visual evidence for the shared chart defaults / payoff math consolidation in
 * the options dock. Every capture comes from the running app with route-mocked
 * chain, analytics and contract-chart payloads; the browser is never resized
 * after navigation (each viewport gets its own Playwright context).
 *
 * Run with:
 *   EVIDENCE_BASE_URL=http://127.0.0.1:5175 npx playwright test \
 *     tests/e2e/viz-options-dock-evidence.spec.ts --workers=2 --output=/tmp/opencode/viz4-pw
 */

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:5173";
const SHOT_DIR = process.env.SCREENSHOT_EVIDENCE_DIR ?? "docs/screenshots/viz-options-dock";
const METRICS_PATH = "/tmp/opencode/viz-options-dock-evidence.json";
const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

interface ConsoleEvent {
  viewport: string;
  state: string;
  type: string;
  text: string;
}

const consoleEvents: ConsoleEvent[] = [];

fs.mkdirSync(SHOT_DIR, { recursive: true });

test.afterAll(() => {
  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
  fs.writeFileSync(
    METRICS_PATH,
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        consoleEvents,
        noiseCount: consoleEvents.filter((event) => event.text.includes("Failed to load resource"))
          .length,
      },
      null,
      2,
    ),
  );
  if (consoleEvents.length) {
    console.log(`[viz-options-dock] ${consoleEvents.length} console error/warning event(s):`);
    for (const event of consoleEvents) console.log(`  ${event.viewport} ${event.state}: ${event.text}`);
  } else {
    console.log("[viz-options-dock] no console errors or warnings");
  }
});

/** All console errors are recorded, including Chromium's resource-load noise. */
function watchConsole(page: Page, viewport: string, state: () => string) {
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    consoleEvents.push({ viewport, state: state(), type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    consoleEvents.push({ viewport, state: state(), type: "pageerror", text: String(error) });
  });
}

const MOCK_ROWS = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "Energy",
    exchange: "NSE",
    close: 1417.4,
    change: 0.8,
    relative_volume: 1.4,
    market_cap_cr: 1900000,
    cap_tier: "large",
    rsi: 58,
    adx: 24,
    pos_52w: 0.72,
    fno: true,
    etf: false,
  },
];

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

async function mockPatternLookup(page: Page) {
  await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "1D",
        session: "2026-11-16",
        source: "stored",
        data_through: "2026-11-14",
        items: [],
      }),
    });
  });
}

async function mockAnalytics(page: Page) {
  await page.route(apiRoute("options/analytics/**"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(analyticsBody()),
    });
  });
}

/** One minute grid around the chain's 1420 CE premium (15.4), with real OI. */
function contractCandles(instrumentKey: string, interval: string) {
  const stepMs = interval === "1m" ? 60_000 : interval === "5m" ? 300_000 : 900_000;
  const first = Date.parse("2026-11-16T09:15:00+05:30");
  return {
    instrument_key: instrumentKey,
    interval,
    source: "e2e",
    cached: false,
    empty_reason: null,
    candles: Array.from({ length: 48 }, (_, index) => {
      const base = 15.4 + Math.sin(index / 5) * 1.6 + index * 0.02;
      const open = Number(base.toFixed(2));
      const close = Number((base + Math.cos(index / 4) * 0.35).toFixed(2));
      return {
        t: new Date(first + index * stepMs).toISOString(),
        o: open,
        h: Number((Math.max(open, close) + 0.42).toFixed(2)),
        l: Number((Math.min(open, close) - 0.38).toFixed(2)),
        c: close,
        v: 180 + (index % 7) * 45,
        oi: 84_000 + index * 130,
      };
    }),
  };
}

async function mockContractChart(page: Page) {
  await page.route(apiRoute("options/contract-chart**"), async (route) => {
    const url = new URL(route.request().url());
    const instrumentKey = url.searchParams.get("instrument_key") ?? "NSE_FO|86000";
    const interval = url.searchParams.get("interval") ?? "1m";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(contractCandles(instrumentKey, interval)),
    });
  });
}

function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 900;
}

async function enterWithDock(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page);
  await mockPatternLookup(page);
  if (isNarrow(page)) await setupFnoScreenerMocks(page);
  await setupOptionDockMocks(page, { marketState: "closed" });
  // Registered last: the analytics / contract routes must win over any
  // app-shell catch-all installed by setupApiMocks.
  await mockAnalytics(page);
  await mockContractChart(page);
}

async function openDock(page: Page) {
  const narrow = isNarrow(page);
  await page.goto(`${BASE_URL}${narrow ? "/screener/fno" : "/?tab=market"}`);
  const row = narrow ? "fno-row-RELIANCE" : "market-row-RELIANCE";
  await expect(page.getByTestId(row)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("symbol-options-RELIANCE").first().click();
  await expect(page.getByTestId("options-dock")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("options-chain-table")).toBeVisible();
}

/**
 * The chain centres itself with a smooth scroll after a leg mounts, so the
 * sticky header can intercept a normal click. Centre the target row first and
 * dispatch the click on the DOM node, like the functional dock spec does.
 */
async function clickChainCell(page: Page, testId: string) {
  const cell = page.getByTestId(testId);
  await expect(cell).toBeVisible();
  let lastTop: number | null = null;
  await expect
    .poll(
      async () => {
        const top = await page.evaluate(() => {
          const scroller = document.querySelector(
            '[data-testid="options-chain-table"] .paper-tanstack-scroll',
          ) as HTMLElement | null;
          return scroller ? Math.round(scroller.scrollTop) : -1;
        });
        const stable = lastTop === top;
        lastTop = top;
        return stable;
      },
      { timeout: 5_000, intervals: [100] },
    )
    .toBe(true);
  await cell.evaluate((node) => {
    const scroller = node.closest(".paper-tanstack-scroll") as HTMLElement | null;
    const row = node.closest("tr") as HTMLElement | null;
    if (!scroller || !row) return;
    const scrollTop = scroller.scrollTop;
    const rowTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scrollTop;
    scroller.scrollTop = rowTop - (scroller.clientHeight - row.getBoundingClientRect().height) / 2;
  });
  await cell.evaluate((node) => (node as HTMLElement).click());
}

async function expectChartPainted(page: Page, testId: string) {
  await expect
    .poll(
      async () => {
        const size = await page.evaluate((id) => {
          const host = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
          if (!host) return null;
          const canvas = host.querySelector("canvas") as HTMLCanvasElement | null;
          const rect = host.getBoundingClientRect();
          const painted = canvas?.getBoundingClientRect();
          return {
            hostW: rect.width,
            hostH: rect.height,
            canvasW: painted?.width ?? 0,
            canvasH: painted?.height ?? 0,
          };
        }, testId);
        return size != null && size.hostW > 0 && size.hostH > 0 && size.canvasW > 0 && size.canvasH > 0;
      },
      { timeout: 20_000, intervals: [150] },
    )
    .toBe(true);
}

async function capture(page: Page, name: string) {
  const width = page.viewportSize()?.width ?? 1600;
  const file = path.join(SHOT_DIR, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled", caret: "hide" });
  return file;
}

for (const viewport of VIEWPORTS) {
  const tag = `${viewport.width}`;

  test.describe(`options dock evidence · ${tag}px`, () => {
    test.use({ viewport, baseURL: BASE_URL });

    let currentState = "boot";

    test.beforeEach(async ({ page }) => {
      currentState = "boot";
      watchConsole(page, tag, () => currentState);
    });

    test("payoff empty, payoff, smile, position odds and contract chart", async ({ page }) => {
      await enterWithDock(page);
      await openDock(page);

      // The no-legs placeholder owns its own PAYOFF band; no canvas exists yet.
      currentState = "payoff-empty";
      await expect(page.getByTestId("options-payoff-placeholder")).toBeVisible();
      await expect(page.getByTestId("options-payoff-placeholder")).toContainText(
        "add a leg to see the payoff",
      );
      await capture(page, "payoff-empty");

      currentState = "payoff";
      await clickChainCell(page, "options-ce-1420");
      await expect(page.getByTestId("options-payoff")).toBeVisible();
      // The rail leaves the 206px band half below the fold at 1000px; the
      // maximized dock gives the shared chart cores their full plot area.
      await page.getByTestId("options-maximize").click();
      await expect(page.getByTestId("options-dock")).toHaveAttribute("role", "dialog");
      await expectChartPainted(page, "options-payoff-chart");
      await expect(page.getByTestId("options-breakevens-value")).toBeVisible();
      await capture(page, "payoff");

      currentState = "smile";
      await page.getByTestId("analytics-tab-smile").click();
      await expect(page.getByTestId("analytics-smile")).toBeVisible();
      await expectChartPainted(page, "smile-chart");
      await expect(page.getByTestId("smile-metric-atm-value")).toBeVisible();
      await capture(page, "smile");

      currentState = "prob";
      await page.getByTestId("analytics-tab-prob").click();
      await expect(page.getByTestId("analytics-prob")).toBeVisible();
      await expect(page.getByTestId("prob-chart")).toBeVisible();
      await expectChartPainted(page, "prob-chart");
      await capture(page, "prob");

      currentState = "contract";
      await page.getByTestId("analytics-tab-payoff").click();
      await expect(page.getByTestId("options-payoff")).toBeVisible();
      await clickChainCell(page, "options-ce-1420-chart");
      await expect(page.getByTestId("options-contract-chart")).toBeVisible();
      await expect(page.getByTestId("contract-chart-panel")).toBeVisible();
      await expectChartPainted(page, "contract-chart");
      await expect(page.getByTestId("contract-chart-title")).toContainText("1,420 CE");
      await capture(page, "contract");

      await page.getByTestId("contract-chart-back").click();
      await expect(page.getByTestId("options-dock")).toBeVisible();
      await expect(page.getByTestId("options-chain-table")).toBeVisible();
    });
  });
}

/**
 * The dock's Smile plot uses the shared canvas core introduced by this PR. The
 * legacy SVG-rendered IVSkewChart lives in the standalone `/options` chain view
 * (OI Analysis tab) — capture it too so the SVG renderer's painted paths (not a
 * flat, failed-to-init frame) are on record.
 */
for (const viewport of VIEWPORTS) {
  const tag = `${viewport.width}`;

  test.describe(`IV skew SVG renderer evidence · ${tag}px`, () => {
    test.use({ viewport, baseURL: BASE_URL });

    let currentState = "boot";

    test.beforeEach(async ({ page }) => {
      currentState = "boot";
      watchConsole(page, tag, () => currentState);
    });

    test("OI Analysis IV skew chart renders as SVG", async ({ page }) => {
      await setupApiMocks(page);
      await loginAsTestUser(page);
      await setupOptionsMocks(page);
      await page.goto(`${BASE_URL}/options`);

      currentState = "iv-skew";
      await expect(page.getByTestId("options-chain-panel")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("chain-tab-analysis").click();
      await expect(page.getByTestId("oi-analysis")).toBeVisible();
      const root = page.getByTestId("options-iv-skew-chart");
      await expect(root).toBeVisible();
      await expect
        .poll(
          async () => {
            const host = page.getByTestId("options-iv-skew-chart-canvas");
            return host.locator("svg path").count();
          },
          { timeout: 10_000, intervals: [150] },
        )
        .toBeGreaterThan(2);
      await expect(root).toContainText("VOLATILITY SMILE (OTM IV)");
      await capture(page, "iv-skew");
    });
  });
}
