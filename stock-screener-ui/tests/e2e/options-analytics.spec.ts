import { test, expect, type Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupOptionDockMocks,
  type OptionDockMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { analyticsBody } from "../mocks/analyticsResponse";

/**
 * Options analytics (P1): the dock's lazily mounted analytics band.
 *
 * E1/E2 stay mocked by `setupOptionDockMocks` (closed market → exact counts).
 * The analytics bundle is a third, independent budget: zero on open, one on the
 * first non-payoff tab, shared by every other tab and by an expiry change.
 */

const SNAPSHOT_PATH = "/?tab=market";

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

interface AnalyticsMocks {
  counts: { analytics: number };
  /** Next analytics responses use this status (500 exercises the error band). */
  setAnalyticsStatus: (status: number) => void;
}

async function setupAnalyticsMocks(page: Page): Promise<AnalyticsMocks> {
  const counts = { analytics: 0 };
  let status = 200;

  await page.route(apiRoute("options/analytics/**"), async (route) => {
    counts.analytics += 1;
    if (status !== 200) {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          detail: { code: "analytics_unavailable", detail: "Analytics upstream is unavailable" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(analyticsBody()),
    });
  });

  return { counts, setAnalyticsStatus: (next) => { status = next; } };
}

async function enterWithDock(page: Page): Promise<{ dock: OptionDockMocks; analytics: AnalyticsMocks }> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page);
  await mockPatternLookup(page);
  const dock = await setupOptionDockMocks(page);
  // Registered last so this route wins over any app-shell catch-all.
  const analytics = await setupAnalyticsMocks(page);
  return { dock, analytics };
}

async function openDock(page: Page) {
  await page.goto(SNAPSHOT_PATH);
  await expect(page.getByTestId("market-row-RELIANCE")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("symbol-options-RELIANCE").first().click();
  await expect(page.getByTestId("options-dock")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("options-chain-table")).toBeVisible();
}

/** The analytics band is only mounted once a leg exists (payoff anchor). */
async function revealAnalytics(page: Page) {
  await page.getByTestId("options-ce-1420").click();
  await expect(page.getByTestId("options-payoff")).toBeVisible();
  await expect(page.getByTestId("analytics-tab-strip")).toBeVisible();
}

type ChartSize = { hostW: number; hostH: number; canvasW: number; canvasH: number };

async function chartSize(page: Page, testId: string): Promise<ChartSize | null> {
  return page.evaluate((id) => {
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
}

async function expectChartPainted(page: Page, testId: string) {
  await expect
    .poll(
      async () => {
        const size = await chartSize(page, testId);
        return size != null && size.hostW > 0 && size.hostH > 0 && size.canvasW > 0 && size.canvasH > 0;
      },
      { timeout: 10000, intervals: [150] },
    )
    .toBe(true);
}

test.describe("Options analytics", () => {
  test("open costs two dock requests and zero analytics; only the first analytics tab fetches", async ({
    page,
  }) => {
    const { dock, analytics } = await enterWithDock(page);
    await openDock(page);

    // The lazy bundle is not even imported on open, and a leg change is local.
    expect(dock.counts.underlying).toBe(1);
    expect(dock.counts.chain).toBe(1);
    expect(analytics.counts.analytics).toBe(0);
    await revealAnalytics(page);
    expect(analytics.counts.analytics).toBe(0);

    await page.getByTestId("analytics-tab-smile").click();
    await expect(page.getByTestId("analytics-panel")).toBeVisible();
    await expect(page.getByTestId("analytics-smile")).toBeVisible();
    await expect.poll(() => analytics.counts.analytics).toBe(1);

    // The other analytics tabs are views over the same frame, not new reads.
    for (const tab of ["term", "surface", "prob"] as const) {
      await page.getByTestId(`analytics-tab-${tab}`).click();
      await expect(page.getByTestId(`analytics-${tab}`)).toBeVisible();
      expect(analytics.counts.analytics).toBe(1);
    }
    // Switching back must not refetch either.
    await page.getByTestId("analytics-tab-smile").click();
    await expect(page.getByTestId("analytics-smile")).toBeVisible();
    expect(analytics.counts.analytics).toBe(1);
  });

  test("the shell shows context, verdict chips, expiry chips and an in-band help popover", async ({
    page,
  }) => {
    const { dock, analytics } = await enterWithDock(page);
    await openDock(page);
    await revealAnalytics(page);

    // The context row is persistent: symbol, nearest expiry and spot.
    const context = page.getByTestId("analytics-context");
    await expect(context).toContainText("RELIANCE");
    await expect(context).toContainText("26 NOV");
    await expect(context).toContainText("spot");
    await expect(context).toContainText("1,417.4");

    // All four verdicts exist before any analytics fetch; a missing value
    // renders "—" rather than removing the chip.
    for (const id of ["rr", "term", "coverage", "maxpain"] as const) {
      await expect(page.getByTestId(`analytics-chip-${id}`)).toBeVisible();
    }
    expect(analytics.counts.analytics).toBe(0);

    // How to read owns Escape while open: it closes only the popover.
    const help = page.getByTestId("analytics-help");
    await expect(help).toBeVisible();
    await help.click();
    const popover = page.getByTestId("analytics-help-popover");
    await expect(popover).toBeVisible();
    await expect(page.getByTestId("analytics-help-bullet-0")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(page.getByTestId("options-dock")).toBeVisible();
    await expect(context).toBeVisible();

    // The in-band expiry chip switches expiry and refetches the chain once,
    // without pulling the all-expiry analytics frame.
    const chainBefore = dock.counts.chain;
    await page.getByTestId("analytics-expiry-2026-12-31").click();
    await expect.poll(() => dock.counts.chain, { timeout: 15000 }).toBe(chainBefore + 1);
    await expect(page.getByTestId("analytics-expiry-2026-12-31")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(dock.counts.underlying).toBe(1);
    expect(analytics.counts.analytics).toBe(0);
  });

  test("an expiry change refetches the chain but reuses the all-expiry analytics frame", async ({
    page,
  }) => {
    const { dock, analytics } = await enterWithDock(page);
    await openDock(page);
    await revealAnalytics(page);
    await page.getByTestId("analytics-tab-term").click();
    await expect(page.getByTestId("analytics-term")).toBeVisible();
    await expect.poll(() => analytics.counts.analytics).toBe(1);

    const chainBefore = dock.counts.chain;
    await page.getByTestId("options-expiry-select").selectOption("2026-12-31");
    await expect.poll(() => dock.counts.chain, { timeout: 15000 }).toBe(chainBefore + 1);

    // The payload carried all three expiries, so the term view stays painted
    // and the analytics budget does not move.
    await expect(page.getByTestId("analytics-term")).toBeVisible();
    await expect(page.getByTestId("term-chart")).toBeVisible();
    expect(analytics.counts.analytics).toBe(1);
    expect(dock.counts.underlying).toBe(1);
  });

  test("the analytics refresh control costs exactly one extra request", async ({ page }) => {
    // Contract: the dock owns the strip and must pass onRefresh/refreshing into
    // AnalyticsTabStrip so analytics-refresh is actually rendered there.
    const { analytics } = await enterWithDock(page);
    await openDock(page);
    await revealAnalytics(page);
    await page.getByTestId("analytics-tab-smile").click();
    await expect.poll(() => analytics.counts.analytics).toBe(1);

    const refresh = page.getByTestId("analytics-refresh");
    await expect(refresh).toBeVisible({ timeout: 3000 });
    await refresh.click();
    await expect.poll(() => analytics.counts.analytics).toBe(2);

    // The refreshed frame is still cached for every other tab.
    await page.getByTestId("analytics-tab-surface").click();
    await expect(page.getByTestId("analytics-surface")).toBeVisible();
    expect(analytics.counts.analytics).toBe(2);
  });

  test("a 500 shows the error band with Retry, keeps the chain and payoff painted, and Retry recovers", async ({
    page,
  }) => {
    const { analytics } = await enterWithDock(page);
    analytics.setAnalyticsStatus(500);
    await openDock(page);
    await revealAnalytics(page);

    await expect(page.getByTestId("options-chain-table")).toBeVisible();
    await expect(page.getByTestId("options-payoff")).toBeVisible();
    await page.getByTestId("analytics-tab-smile").click();

    await expect(page.getByTestId("analytics-error")).toBeVisible();
    await expect(page.getByTestId("analytics-error")).toContainText("Analytics upstream is unavailable");
    await expect(page.getByTestId("analytics-retry")).toBeVisible();

    // IV BY STRIKE is chain-only: it paints even while the bundle is in error.
    // The payoff *body* is swapped for the tab's body, but its band, the chain
    // and the whole dock stay painted.
    await expect(page.getByTestId("analytics-smile")).toBeVisible();
    await expect(page.getByTestId("options-analytics-band")).toBeVisible();
    await expect(page.getByTestId("options-chain-row-1420")).toBeVisible();

    // The shared transport retries one 5xx before surfacing the failure, so a
    // failed load costs two wire requests; a healthy Retry costs exactly one.
    const failedCount = analytics.counts.analytics;
    expect(failedCount).toBeGreaterThanOrEqual(2);

    analytics.setAnalyticsStatus(200);
    await page.getByTestId("analytics-retry").click();
    await expect.poll(() => analytics.counts.analytics).toBe(failedCount + 1);
    await expect(page.getByTestId("analytics-error")).toBeHidden();
    await expect(page.getByTestId("analytics-panel")).toBeVisible();
    await expect(page.getByTestId("options-chain-table")).toBeVisible();
    await page.getByTestId("analytics-tab-payoff").click();
    await expect(page.getByTestId("options-payoff")).toBeVisible();
  });

  test("390×844: the strip owns horizontal overflow, the page does not, and charts paint on every tab", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { analytics } = await enterWithDock(page);
    await openDock(page);
    await revealAnalytics(page);
    await expect(page.getByTestId("options-dock-sheet")).toBeVisible();

    const stripMetrics = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="analytics-tabs-list"]') as HTMLElement;
      const style = getComputedStyle(list);
      const tabs = Array.from(list.querySelectorAll('[role="tab"]')) as HTMLElement[];
      return {
        overflowX: style.overflowX,
        scrollbarWidth: style.scrollbarWidth,
        tabCount: tabs.length,
        scrollWidth: list.scrollWidth,
        clientWidth: list.clientWidth,
      };
    });
    // The five 9px labels fit at 390px, but the strip must remain the scroll
    // owner (never let the sheet or the document grow a horizontal bar).
    expect(stripMetrics.overflowX).toBe("auto");
    expect(stripMetrics.scrollbarWidth).toBe("none");
    expect(stripMetrics.tabCount).toBe(5);
    expect(stripMetrics.scrollWidth).toBeGreaterThanOrEqual(stripMetrics.clientWidth);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        { timeout: 10000 },
      )
      .toBe(true);

    // Force a genuinely narrow band to prove the strip scrolls rather than the
    // page — and that the last tab is still reachable.
    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="analytics-tabs-list"]') as HTMLElement;
      list.style.maxWidth = "140px";
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const list = document.querySelector('[data-testid="analytics-tabs-list"]') as HTMLElement;
            return list.scrollWidth > list.clientWidth;
          }),
        { timeout: 10000 },
      )
      .toBe(true);
    await page.getByTestId("analytics-tab-prob").click();
    await expect(page.getByTestId("analytics-tab-prob")).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        { timeout: 10000 },
      )
      .toBe(true);

    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="analytics-tabs-list"]') as HTMLElement;
      list.style.maxWidth = "";
    });
    for (const tab of ["smile", "term", "surface", "prob"] as const) {
      await page.getByTestId(`analytics-tab-${tab}`).click();
      await expect(page.getByTestId(`analytics-${tab}`)).toBeVisible();
      await expectChartPainted(page, `${tab}-chart`);
    }
    expect(analytics.counts.analytics).toBe(1);
  });
});
