import { test, expect, type Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  mockDashboardResponse,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * KAYNES close-date incident: a stored hit carried `last_close` 3382 / +2.48%
 * captured on an older frame, while the freshly fetched chart ended at 3430
 * (−1.55% from 3484). The panel must render the chart's close unless the hit's
 * `close_bar_date` proves its bar is at least as recent as the chart's last bar.
 *
 * Fully mocked: the app-wide symbol dock is opened from a market-movers row
 * (the dock owned by the Patterns page has no refresh control). No
 * `waitForTimeout` — web-first assertions and `waitForResponse` only.
 */

type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };
type Hit = Record<string, unknown>;

const BASE_CANDLES: Candle[] = [
  { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
  { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
];

function makeHit(overrides: Hit = {}): Hit {
  return {
    id: 9001,
    symbol: "KAYNES",
    name: "Kaynes Technology",
    timeframe: "1D",
    pattern_id: "descending_channel",
    pattern_name: "Descending Channel",
    family: "continuation",
    direction: "bearish",
    status: "confirmed",
    quality: "strong",
    confidence: 72,
    start_date: "2026-10-28",
    end_date: "2026-11-15 18:30",
    start_price: 3600,
    end_price: 3382,
    breakout_level: 3400,
    target: 3200,
    stop: 3520,
    rr: 2,
    bars_ago: 16,
    volume_confirmed: false,
    trendlines: [],
    notes: "",
    last_close: null,
    day_change_pct: null,
    close_bar_date: null,
    ...overrides,
  };
}

const STALE_HIT = makeHit({ last_close: 3382, day_change_pct: 2.48 });
const SAME_DATE_HIT = makeHit({
  last_close: 3430,
  day_change_pct: -1.55,
  close_bar_date: "2026-11-13",
});
const OLD_DATE_HIT = makeHit({
  last_close: 3382,
  day_change_pct: 2.48,
  close_bar_date: "2026-11-10",
});
const REFRESHED_HIT = makeHit({
  last_close: 3600,
  day_change_pct: 2.86,
  close_bar_date: "2026-11-16",
  end_date: "2026-11-16 18:30",
});

const REFRESHED_CANDLES: Candle[] = [
  ...BASE_CANDLES,
  { t: "2026-11-16", o: 3480, h: 3620, l: 3475, c: 3550, v: 1200 },
];

interface ChartFixture {
  candles: Candle[];
  hits: Hit[];
}

test.describe("Pattern chart close freshness (KAYNES)", () => {
  let fixture: ChartFixture;
  let chartRequests: string[];

  test.beforeEach(async ({ page }) => {
    fixture = { candles: BASE_CANDLES, hits: [STALE_HIT] };
    chartRequests = [];

    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Market movers row for KAYNES — clicking it opens the app-wide symbol
    // dock, which is the only dock wired with `onRefresh`.
    await page.route(apiRoute("screener/dashboard"), async (route) => {
      const sections = mockDashboardResponse.sections.map((section) => ({
        ...section,
        panels: section.panels.map((panel) =>
          panel.id === "gainers"
            ? {
                ...panel,
                total: panel.total + 1,
                rows: [
                  {
                    symbol: "KAYNES",
                    name: "Kaynes Technology",
                    close: 3430,
                    change: -1.55,
                    logo: null,
                    sub_label: "Rel vol",
                    sub_value: "1.2x",
                    spark: [100, 101, 99, 100],
                  },
                  ...panel.rows,
                ],
              }
            : panel,
        ),
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockDashboardResponse, sections }),
      });
    });

    // The broad handler absorbs unrelated chart-patterns lookups; the chart
    // handler below is registered last so it wins for /symbol/:id/chart.
    await page.route(apiRoute("chart-patterns"), async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframe: "1D", session: "2026-11-16", source: "stored", items: [] }),
      });
    });
    await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
      const url = new URL(route.request().url());
      chartRequests.push(`${url.pathname}${url.search}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "KAYNES",
          timeframe: url.searchParams.get("timeframe") || "1D",
          candles: fixture.candles,
          hits: fixture.hits,
          overlays: [],
          trend_lines: [],
        }),
      });
    });
  });

  async function openKaynesDock(page: Page) {
    await page.goto("/screener?tab=market&view=movers");
    const row = page.getByTestId("dashboard-row-gainers-KAYNES");
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();
    await expect(page.getByTestId("symbol-dock")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("patterns-chart-dock")).toBeVisible();
  }

  function panel(page: Page) {
    return page.getByTestId("patterns-fullscreen-panel");
  }

  test("stale hit loses to the fresh chart: PREV CLOSE 13 NOV / ₹3430 / -1.55%", async ({
    page,
  }) => {
    await openKaynesDock(page);

    const p = panel(page);
    await expect(p.getByTestId("patterns-close-label")).toHaveText("PREV CLOSE · 13 NOV");
    await expect(p).toContainText("₹3430.00");
    await expect(p).toContainText("-1.55%");
    // The stale enrichment must never leak into the rendered panel.
    await expect(p).not.toContainText("3382");
    await expect(p).not.toContainText("+2.48%");
    await expect(p).not.toContainText(/LAST CLOSE/i);
  });

  test("a hit dated on the chart's last bar may render its own close/change", async ({
    page,
  }) => {
    fixture = {
      // Same session date as the hit, but a different chart close: only the
      // hit's dated pair can produce 3430 / -1.55% here.
      candles: [
        { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
        { t: "2026-11-13", o: 3484, h: 3400, l: 3280, c: 3300, v: 900 },
      ],
      hits: [SAME_DATE_HIT],
    };
    await openKaynesDock(page);

    const p = panel(page);
    await expect(p.getByTestId("patterns-close-label")).toHaveText("PREV CLOSE · 13 NOV");
    await expect(p).toContainText("₹3430.00");
    await expect(p).toContainText("-1.55%");
    await expect(p).not.toContainText("₹3300.00");
    await expect(p).not.toContainText("-5.28%");
  });

  test("an older close_bar_date loses even with a stale close/change", async ({ page }) => {
    fixture = { candles: BASE_CANDLES, hits: [OLD_DATE_HIT] };
    await openKaynesDock(page);

    const p = panel(page);
    await expect(p.getByTestId("patterns-close-label")).toHaveText("PREV CLOSE · 13 NOV");
    await expect(p).toContainText("₹3430.00");
    await expect(p).toContainText("-1.55%");
    await expect(p).not.toContainText("3382");
    await expect(p).not.toContainText("+2.48%");
  });

  test("refresh re-fetches the same symbol/timeframe and the panel takes the new payload", async ({
    page,
  }) => {
    await openKaynesDock(page);

    const p = panel(page);
    await expect(p.getByTestId("patterns-close-label")).toHaveText("PREV CLOSE · 13 NOV");
    await expect(p).toContainText("₹3430.00");
    expect(chartRequests.length).toBeGreaterThan(0);

    // The refreshed hit is dated on the refreshed chart's last bar, so its
    // close/change pair becomes the authoritative one.
    fixture = { candles: REFRESHED_CANDLES, hits: [REFRESHED_HIT] };
    const before = chartRequests.length;

    const secondResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/chart-patterns/symbol/KAYNES/chart") &&
        response.status() === 200,
    );
    await page.getByTestId("patterns-dock-refresh").click();
    const response = await secondResponse;

    const url = new URL(response.url());
    expect(url.pathname).toContain("/symbol/KAYNES/chart");
    expect(url.searchParams.get("timeframe")).toBe("1D");
    await expect.poll(() => chartRequests.length).toBeGreaterThan(before);

    // phase 1 swaps the candles, phase 2 swaps the dated hit — end state is
    // the hit's new pair.
    await expect(p.getByTestId("patterns-close-label")).toHaveText(/CLOSE · 16 NOV/);
    await expect(p).toContainText("₹3600.00");
    await expect(p).toContainText("+2.86%");
    await expect(p).not.toContainText("₹3430.00");
  });
});
