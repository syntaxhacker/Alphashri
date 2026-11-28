/**
 * Route-level visual evidence for the four charts migrated onto the shared
 * `EChartsHost`: IVSkewChart, PayoffChart, PositioningChart and EChartSolid.
 *
 * Each frame drives a real app route with the shared API mocks plus spec-local
 * fixtures for the endpoints those panels own. Screenshots are viewport-sized
 * (not fullPage) so the 1600x1000 / 390x844 contract is exact. Written only
 * when SCREENSHOT_EVIDENCE=1; CI runs leave the tree untouched.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  loginAsTestUser,
  setupApiMocks,
  setupOptionsMocks,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { premiumTrackerSnapshot } from "./helpers/premiumFixture";
import { collectConsoleErrors } from "./helpers/flowsB";
import { waitForSettled } from "./helpers/evidenceFast";

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";
const SHOT_DIR = "docs/screenshots/viz-echartshost";

const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

type Raw = Record<string, unknown>;

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function positioningRow(strike: number, netCr: number): Raw {
  return {
    strike,
    ce_class: netCr >= 0 ? "bullish" : "bearish",
    ce_doi_shares: 1200 + strike,
    ce_cr: Math.abs(netCr) + 120,
    pe_class: netCr >= 0 ? "bearish" : "bullish",
    pe_doi_shares: 900 + strike,
    pe_cr: Math.abs(netCr) + 90,
    net_cr: netCr,
  };
}

function positioningPayload(rows: Raw[]): Raw {
  return {
    status: "ok",
    underlying: "NIFTY",
    expiry: "2026-03-12",
    spot: 24000.5,
    lot_size: 50,
    timestamp: "2026-03-10T10:15:00+05:30",
    baseline: "since_open",
    baseline_note: "Since open",
    verdict: "bullish",
    initiated_cr: 1180,
    lean_pct: 62.4,
    state: { calls_cr: 1840, puts_cr: 660, note: "Call-side initiated build" },
    flow: { calls_cr: 620, puts_cr: -280, note: "Call OI leading" },
    initiated: { bearish_cr: 210, bullish_cr: 1180, note: "Bullish delta" },
    split: { bearish_cr: 210, bearish_pct: 15.1, bullish_cr: 1180, bullish_pct: 84.9 },
    read: { pct: 78, readable_shares: 3900, total_shares: 5000 },
    biggest_move: {
      strike: 24000,
      side: "CE",
      sentiment: "bullish",
      label: "24,000 CE",
      cr: 420,
    },
    rows,
  };
}

const POSITIONING_ROWS: Raw[] = [
  positioningRow(23800, 320),
  positioningRow(23900, 610),
  positioningRow(24000, 420),
  positioningRow(24100, -180),
  positioningRow(24200, -260),
];

function dashboardPayload(totalTrades: number): Raw {
  return {
    period: { preset: "30D", from_date: "2026-06-15", to_date: "2026-07-15", bot_id: "all", trade_count: totalTrades },
    summary: {
      total_trades: totalTrades,
      winners: 2,
      losers: 2,
      win_rate: totalTrades ? 50 : 0,
      total_gross_pnl: 12000,
      total_net_pnl: 9840,
      total_costs: 2160,
      avg_win: 4300,
      avg_loss: -1380,
      profit_factor: 3.12,
      avg_hold_minutes: 72,
      max_drawdown: 2100,
      max_drawdown_pct: 12.5,
      best_day: { date: "2026-07-12", net_pnl: 4250, trades: 1, winners: 1, losers: 0 },
      worst_day: { date: "2026-07-14", net_pnl: -2100, trades: 1, winners: 0, losers: 1 },
    },
    bot_rankings: [
      {
        bot_id: "bot-1", bot_name: "ORB Bot", running: true, total_net_pnl: 12800,
        total_trades: 42, win_rate: 61.9, profit_factor: 1.92, max_drawdown: 2100,
        max_drawdown_pct: 8.3, avg_hold_minutes: 55,
      },
    ],
    strategy_rankings: [
      {
        bot_id: "bot-1", bot_name: "ORB Bot", strategy_id: 1, strategy_name: "ORB Best",
        total_net_pnl: 12800, total_trades: 42, win_rate: 61.9, profit_factor: 1.92,
        avg_hold_minutes: 55,
      },
    ],
    daily_pnl: [
      { date: "2026-07-12", net_pnl: 4250, trades: 1, winners: 1, losers: 0 },
      { date: "2026-07-14", net_pnl: -2100, trades: 1, winners: 0, losers: 1 },
    ],
    equity_curve: [
      { date: "2026-07-12", cumulative_pnl: 4250 },
      { date: "2026-07-14", cumulative_pnl: 2150 },
    ],
    drawdown: [
      { date: "2026-07-12", drawdown: 0, drawdown_pct: 0 },
      { date: "2026-07-14", drawdown: 2100, drawdown_pct: 49.41 },
    ],
    biggest_winners: [
      {
        trade_id: "TRADE-1", symbol: "RELIANCE", bot_id: "bot-1", bot_name: "ORB Bot",
        strategy_id: 1, strategy_name: "ORB Best", side: "BUY",
        entry_time: "2026-07-12T09:20:00+05:30", exit_time: "2026-07-12T10:20:00+05:30",
        net_pnl: 4250, pnl_pct: 2.4, exit_reason: "TP", hold_duration_minutes: 60,
      },
    ],
    biggest_losers: [
      {
        trade_id: "TRADE-2", symbol: "TCS", bot_id: "bot-2", bot_name: "EMA Bot",
        strategy_id: 2, strategy_name: "EMA Cross", side: "SELL",
        entry_time: "2026-07-14T09:20:00+05:30", exit_time: "2026-07-14T10:20:00+05:30",
        net_pnl: -2100, pnl_pct: -1.1, exit_reason: "SL", hold_duration_minutes: 60,
      },
    ],
    symbol_performance: [
      { symbol: "RELIANCE", total_net_pnl: 4250, total_trades: 1, win_rate: 100 },
      { symbol: "TCS", total_net_pnl: -2100, total_trades: 1, win_rate: 0 },
    ],
    exit_reasons: [
      { reason: "TP", count: 1, pct: 50 },
      { reason: "SL", count: 1, pct: 50 },
    ],
  };
}

async function optionsSetup(page: Page, positioningRows: Raw[]): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupOptionsMocks(page);
  await page.route(apiRoute("options/premium-tracker"), (route) =>
    route.fulfill(json(premiumTrackerSnapshot())));
  await page.route(apiRoute("options/positioning"), (route) =>
    route.fulfill(json(positioningPayload(positioningRows))));
}

async function paperSetup(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
  // Bot refresh reads trades outside the shared multi-strategy fixture; an
  // unhandled request would surface as a console error in the captured frame.
  await page.route(apiRoute("paper/trades"), (route) =>
    route.fulfill(json({ trades: [], count: 0 })));
  await page.route(apiRoute("paper/dashboard/analytics"), (route) =>
    route.fulfill(json(dashboardPayload(4))));
}

async function assertDrawn(page: Page, selector: string): Promise<void> {
  const host = page.locator(selector).first();
  await expect(host, `${selector} must be on screen`).toBeVisible();
  await expect(host.locator("canvas, svg").first(), `${selector} must contain a rendered chart`).toBeVisible();
  const box = await host.boundingBox();
  expect(box && box.width > 0 && box.height > 0, `${selector} must have real dimensions`).toBeTruthy();
}

type ChartState = {
  id: string;
  route: string;
  setup: (page: Page) => Promise<void>;
  reveal: (page: Page) => Promise<string>;
  drawn: boolean;
};

const STATES: readonly ChartState[] = [
  {
    id: "iv-skew",
    route: "/options",
    setup: (page) => optionsSetup(page, POSITIONING_ROWS),
    reveal: async (page) => {
      await page.getByTestId("chain-tab-analysis").click();
      await expect(page.getByTestId("oi-analysis")).toBeVisible();
      await expect(page.getByTestId("options-iv-skew-chart")).toBeVisible();
      return '[data-testid="options-iv-skew-chart-canvas"]';
    },
    drawn: true,
  },
  {
    id: "payoff",
    route: "/options",
    setup: (page) => optionsSetup(page, POSITIONING_ROWS),
    reveal: async (page) => {
      await page.getByTestId("nav-tab-premium").click();
      await expect(page.getByTestId("premium-tracker-panel")).toBeVisible();
      await page
        .getByTestId("strategy-row-template-BUY")
        .locator("select")
        .selectOption("long-straddle");
      await page.getByTestId("strategy-row-add-BUY").click();
      await expect(page.locator('[data-testid^="setup-card-"]').first()).toBeVisible();
      return '[data-testid^="setup-payoff-"]';
    },
    drawn: true,
  },
  {
    id: "payoff-empty",
    route: "/options",
    setup: (page) => optionsSetup(page, POSITIONING_ROWS),
    reveal: async (page) => {
      await page.getByTestId("nav-tab-simulator").click();
      await expect(page.getByTestId("simulator-panel")).toBeVisible();
      await expect(page.getByTestId("simulator-payoff")).toContainText("Add a leg to see payoff");
      return '[data-testid="simulator-payoff"]';
    },
    drawn: false,
  },
  {
    id: "positioning",
    route: "/options",
    setup: (page) => optionsSetup(page, POSITIONING_ROWS),
    reveal: async (page) => {
      await page.getByTestId("nav-tab-positioning").click();
      await expect(page.getByTestId("positioning-panel")).toBeVisible();
      await expect(page.getByTestId("positioning-verdict")).toBeVisible();
      await page.getByTestId("positioning-view").getByText("Chart", { exact: true }).click();
      await expect(page.getByTestId("positioning-chart")).toBeVisible();
      return '[data-testid="positioning-chart"]';
    },
    drawn: true,
  },
  {
    id: "positioning-empty",
    route: "/options",
    setup: (page) => optionsSetup(page, []),
    reveal: async (page) => {
      await page.getByTestId("nav-tab-positioning").click();
      await expect(page.getByTestId("positioning-panel")).toBeVisible();
      await expect(page.getByTestId("positioning-empty")).toBeVisible();
      return '[data-testid="positioning-empty"]';
    },
    drawn: false,
  },
  {
    id: "echart-solid",
    route: "/paper?view=aggregated",
    setup: paperSetup,
    reveal: async (page) => {
      // The paper store restores its own view after mount, so the URL param
      // alone is not a reliable route to the dashboard; activate the real tab.
      await expect(page.getByTestId("paper-trading-view")).toBeVisible();
      await page.getByTestId("tab-aggregated").click();
      await expect(page.getByTestId("paper-dashboard")).toBeVisible();
      await expect(page.getByTestId("equity-curve-chart")).toBeVisible();
      return '[data-testid="equity-curve-chart"]';
    },
    drawn: true,
  },
];

for (const state of STATES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${state.id} at ${viewport.width}`, async ({ page }) => {
      test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const consoleErrors = collectConsoleErrors(page);
      await state.setup(page);
      await page.goto(state.route);
      const selector = await state.reveal(page);
      await waitForSettled(page, selector);
      if (state.drawn) await assertDrawn(page, selector);
      await page.locator(selector).first().scrollIntoViewIfNeeded();

      if (EVIDENCE) mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({
        path: `${SHOT_DIR}/${state.id}-${viewport.width}.png`,
        fullPage: false,
      });

      expect(consoleErrors, `console errors in ${state.id} at ${viewport.width}: ${consoleErrors.join(" | ")}`).toEqual([]);
    });
  }
}
