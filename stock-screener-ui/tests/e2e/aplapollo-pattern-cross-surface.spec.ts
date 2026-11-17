import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * APLAPOLLO cross-surface regression.
 *
 * The stored scan says `Consolidation`; live detection on the same symbol says
 * `Ascending Triangle`. The two surfaces that read the stored scan must agree:
 *
 *   - the market table PATTERNS column (fed by `/patterns/lookup`), and
 *   - the chart page `/chart/APLAPOLLO` (fed by `/symbol/APLAPOLLO/chart`).
 *
 * The chart page is stored-first: it calls the chart endpoint WITHOUT
 * `detect_patterns=1`, and only falls through to live detection when the stored
 * call returns no hits. So a scanned symbol must render the stored hit, and an
 * unscanned symbol must still be detected live. Both paths are asserted below.
 *
 * Note on the wire contract: the frontend omits the `detect_patterns` param
 * entirely on the stored call (false -> null -> omitted in `appendParams`);
 * only the live call sends `detect_patterns=1`. The mock therefore treats
 * "param absent or 0" as stored and "param === 1" as live.
 *
 * No `waitForTimeout`: web-first assertions and `waitForResponse` only.
 */

const SYMBOL = "APLAPOLLO";

type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };
type Hit = Record<string, unknown>;

const CANDLES: Candle[] = [
  { t: "2026-11-12", o: 200, h: 205, l: 195, c: 202, v: 1000 },
  { t: "2026-11-13", o: 202, h: 206, l: 200, c: 204, v: 900 },
];

function makeHit(overrides: Hit = {}): Hit {
  return {
    id: 9100,
    symbol: SYMBOL,
    name: "Apollo Pipes",
    timeframe: "1D",
    pattern_id: "consolidation",
    pattern_name: "Consolidation",
    family: "continuation",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78,
    start_date: "2026-10-28",
    end_date: "2026-11-13 18:30",
    start_price: 195,
    end_price: 204,
    breakout_level: 206,
    target: 220,
    stop: 192,
    rr: 2.2,
    bars_ago: 3,
    volume_confirmed: true,
    trendlines: [],
    notes: "",
    // Provenance is optional on the wire, but included so the chart's SCAN/LIVE
    // badge is an independent assertion of which endpoint supplied the hit.
    source: "stored",
    ...overrides,
  };
}

const STORED_HIT = makeHit();
const LIVE_HIT = makeHit({
  id: 9101,
  pattern_id: "ascending_triangle",
  pattern_name: "Ascending Triangle",
  direction: "bullish",
  confidence: 66,
  source: "live",
});

interface ChartRequest {
  path: string;
  detect: string | null;
}

interface Fixture {
  storedHits: Hit[];
  liveHits: Hit[];
  chartRequests: ChartRequest[];
}

let fixture: Fixture;

function chartPanel(page: Page) {
  return page.getByTestId("patterns-fullscreen-panel");
}

test.describe("APLAPOLLO pattern cross-surface agreement", () => {
  test.beforeEach(async ({ page }) => {
    fixture = {
      storedHits: [STORED_HIT],
      liveHits: [LIVE_HIT],
      chartRequests: [],
    };

    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Broad catch-all registered FIRST so the specific handlers below (registered
    // later) win — Playwright resolves routes last-registered-first.
    await page.route(apiRoute("chart-patterns"), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframes: [{ id: "1D", label: "1D" }] }),
      });
    });

    // Stored scan used by the market table PATTERNS column.
    await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
      const raw = route.request().postData();
      const body = raw ? (JSON.parse(raw) as { symbols?: string[] }) : { symbols: [] };
      const items = (body.symbols ?? [])
        .filter((symbol) => symbol === SYMBOL)
        .map(() => ({
          symbol: SYMBOL,
          count: 1,
          patterns: [
            {
              pattern_id: "consolidation",
              name: "Consolidation",
              direction: "bullish",
              status: "confirmed",
              quality: "strong",
              confidence: 78,
              bars_ago: 3,
            },
          ],
        }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timeframe: "1D",
          session: "2026-11-16",
          source: "stored",
          data_through: "2026-11-13",
          items,
        }),
      });
    });

    // The chart endpoint: stored (no detect_patterns=1) vs live (=1).
    await page.route(apiRoute(`chart-patterns/symbol/${SYMBOL}/chart`), async (route) => {
      const url = new URL(route.request().url());
      const detect = url.searchParams.get("detect_patterns");
      fixture.chartRequests.push({ path: url.pathname, detect });
      const isLive = detect === "1";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: SYMBOL,
          timeframe: url.searchParams.get("timeframe") || "1D",
          candles: CANDLES,
          hits: isLive ? fixture.liveHits : fixture.storedHits,
          overlays: [],
          trend_lines: [],
          source: isLive ? "live" : "stored",
        }),
      });
    });

    // Market snapshot containing only APLAPOLLO, so the table is unambiguous.
    await page.route(apiRoute("market/snapshot"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          as_of: new Date().toISOString(),
          universe: "all_equity",
          total: 1,
          update_mode: "streaming",
          rows: [
            {
              symbol: SYMBOL,
              name: "Apollo Pipes",
              sector: "Capital Goods",
              close: 204,
              change: 1.2,
              relative_volume: 1.4,
              market_cap_cr: 12000,
              cap_tier: "mid",
              rsi: 58,
              adx: 24,
              pos_52w: 0.7,
              fno: false,
              etf: false,
            },
          ],
        }),
      });
    });
  });

  async function assertTableShowsStoredConsolidation(page: Page) {
    await page.goto("/?tab=market");
    await expect(page.getByTestId("market-screener")).toBeVisible({ timeout: 15000 });
    const badge = page.getByTestId(`market-patterns-${SYMBOL}`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("1▲");
    await badge.hover();
    await expect(page.getByRole("tooltip")).toContainText("Consolidation");
  }

  test("scanned symbol: table and chart agree on Consolidation, live hit never shown", async ({
    page,
  }) => {
    await assertTableShowsStoredConsolidation(page);

    await page.goto(`/chart/${SYMBOL}`);
    const panel = chartPanel(page);
    await expect(panel).toBeVisible({ timeout: 15000 });

    // The opened chart renders the stored pattern, not the live one.
    await expect(panel).toContainText("Consolidation");
    await expect(panel).not.toContainText("Ascending Triangle");
    await expect(page.getByTestId("patterns-fullscreen-list-item-0")).toContainText(
      "Consolidation",
    );
    await expect(page.getByTestId("chart-pattern-source")).toHaveText("SCAN");

    // Stored-first short-circuits: no live detection call for a scanned symbol.
    expect(fixture.chartRequests.some((r) => r.detect === "1")).toBe(false);
  });

  test("unscanned symbol: stored call empty, chart falls through to live Ascending Triangle", async ({
    page,
  }) => {
    fixture.storedHits = [];

    const liveResponse = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        url.pathname.includes(`/api/chart-patterns/symbol/${SYMBOL}/chart`) &&
        url.searchParams.get("detect_patterns") === "1" &&
        res.status() === 200
      );
    });

    await page.goto(`/chart/${SYMBOL}`);
    await liveResponse;

    const panel = chartPanel(page);
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toContainText("Ascending Triangle");
    await expect(panel).not.toContainText("Consolidation");
    await expect(page.getByTestId("patterns-fullscreen-list-item-0")).toContainText(
      "Ascending Triangle",
    );
    await expect(page.getByTestId("chart-pattern-source")).toHaveText("LIVE");
    expect(fixture.chartRequests.some((r) => r.detect === "1")).toBe(true);
  });
});
