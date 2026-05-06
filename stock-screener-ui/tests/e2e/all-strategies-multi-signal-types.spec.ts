import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { TEST_BOT_UUID, setupBotApiMocks, expectPositionsVisible } from "./helpers/botHelpers";

const ALL_STRATEGY_TYPES = [
  { id: 1, name: "ORB Conservative", strategy_type: "ORB", allocation: 0.3 },
  { id: 2, name: "SR Breakout", strategy_type: "SR_BREAKOUT", allocation: 0.25 },
  { id: 3, name: "EMA Cross", strategy_type: "EMA_CROSS", allocation: 0.2 },
  { id: 4, name: "52W Chaser", strategy_type: "52W_CHASER", allocation: 0.15 },
  { id: 5, name: "52W Target", strategy_type: "52W_TARGET", allocation: 0.1 },
];

type StrategyItem = (typeof ALL_STRATEGY_TYPES)[number];

async function setupMultiStrategyBot(
  page: Page,
  strategies: StrategyItem[] = [...ALL_STRATEGY_TYPES],
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);

  const positions = strategies.map((s, i) => ({
    id: i + 1,
    symbol: ["TCS", "RELIANCE", "INFY", "HDFC", "SBIN"][i % 5],
    side: "BUY" as const,
    quantity: 10,
    entry_price: 3000 + i * 100,
    current_price: 3050 + i * 100,
    pnl: 500 + i * 50,
    pnl_pct: 1.5 + i * 0.1,
    margin_used: 30000 + i * 1000,
    strategy_name: s.name,
    strategy_id: s.id,
    stop_loss: 2900 + i * 100,
    take_profit: 3200 + i * 100,
    entry_time: "2026-03-02T09:30:00",
  }));

  const scanItems = strategies.map((s, i) => ({
    id: i + 1,
    symbol: ["TCS", "RELIANCE", "INFY", "HDFC", "SBIN"][i % 5],
    price: 3050 + i * 100,
    status: i % 2 === 0 ? "signal" : "watching",
    side: i % 2 === 0 ? "LONG" : undefined,
    strategy_name: s.name,
  }));

  await setupBotApiMocks(page, {
    botId: TEST_BOT_UUID,
    botName: "All Strategies Bot",
    strategies: strategies.map((s) => ({ id: s.id, name: s.name, allocation: s.allocation })),
    positions,
    scanItems,
  });
}

async function navigateToBot(page: Page) {
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });

  await page.waitForSelector('[data-testid^="bot-card-"]', { state: "visible", timeout: 10000 });
  const firstBotCard = page.locator('[data-testid^="bot-card-"]').first();
  await firstBotCard.click();

  await page.getByTestId("tab-live").click();
  await page.waitForLoadState("networkidle");
}

test.describe("Multi-Strategy - All 5 Strategy Types", () => {
  test("should display strategy tabs for all 5 strategy types", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await expect(page.locator('[data-testid="strategy-tabs"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="strategy-tab-all"]')).toBeVisible();

    for (const s of ALL_STRATEGY_TYPES) {
      const slug = s.name.toLowerCase().replace(/\s+/g, "-");
      const tab = page.locator(`[data-testid="strategy-tab-${slug}"]`);
      await expect(tab.first()).toBeVisible();
    }
  });

  test("should show positions for each strategy type", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await expectPositionsVisible(page);

    const symbols = ["TCS", "RELIANCE", "INFY", "HDFC", "SBIN"];
    for (const symbol of symbols) {
      await expect(page.locator('[data-testid="positions-table-container"]')).toContainText(symbol);
    }
  });

  test("should filter positions by strategy tab - ORB", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await page.locator('[data-testid="strategy-tab-orb-conservative"]').click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS");
  });

  test("should filter positions by strategy tab - SR Breakout", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    const slug = "sr-breakout";
    await page.locator(`[data-testid="strategy-tab-${slug}"]`).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText(
      "RELIANCE",
    );
  });

  test("should filter positions by strategy tab - EMA Cross", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await page.locator('[data-testid="strategy-tab-ema-cross"]').click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("INFY");
  });

  test("should filter positions by strategy tab - 52W Chaser", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await page.locator('[data-testid="strategy-tab-52w-chaser"]').click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("HDFC");
  });

  test("should filter positions by strategy tab - 52W Target", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await page.locator('[data-testid="strategy-tab-52w-target"]').click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("SBIN");
  });

  test("should show all positions in All tab", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await page.locator('[data-testid="strategy-tab-all"]').click();
    await page.waitForLoadState("networkidle");

    for (const symbol of ["TCS", "RELIANCE", "INFY", "HDFC", "SBIN"]) {
      await expect(page.locator('[data-testid="positions-table-container"]')).toContainText(symbol);
    }
  });
});

test.describe("Multi-Strategy - Scan Items per Strategy Type", () => {
  test("should display scan items with strategy attribution", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 15000 });
    await expect(scanCard).toContainText("Strategy");
  });

  test("should show signal scan items", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 15000 });
    await expect(scanCard).toContainText("Signals");
  });

  test("should show watching scan items", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 15000 });
    await expect(scanCard).toContainText("Watching");
  });
});

test.describe("Multi-Strategy - Strategy Type Display in Positions", () => {
  test("should display strategy column in positions table", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await expectPositionsVisible(page);
    await expect(
      page
        .locator('[data-testid="positions-table-container"]')
        .locator("th", { hasText: "Strategy" })
        .first(),
    ).toBeVisible();
  });

  test("should show correct strategy name per position", async ({ page }) => {
    await setupMultiStrategyBot(page);
    await navigateToBot(page);

    await expectPositionsVisible(page);

    for (const s of ALL_STRATEGY_TYPES) {
      await expect(page.locator('[data-testid="positions-table-container"]')).toContainText(s.name);
    }
  });
});

test.describe("Multi-Strategy - Single Strategy Bot", () => {
  test("should work with only ORB strategy", async ({ page }) => {
    await setupMultiStrategyBot(page, [ALL_STRATEGY_TYPES[0]]);
    await navigateToBot(page);

    await expectPositionsVisible(page);
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS", {
      timeout: 10000,
    });
  });

  test("should work with only 52W Chaser strategy", async ({ page }) => {
    await setupMultiStrategyBot(page, [ALL_STRATEGY_TYPES[3]]);
    await navigateToBot(page);

    await expectPositionsVisible(page);
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS", {
      timeout: 10000,
    });
  });

  test("should work with only EMA Cross strategy", async ({ page }) => {
    await setupMultiStrategyBot(page, [ALL_STRATEGY_TYPES[2]]);
    await navigateToBot(page);

    await expectPositionsVisible(page);
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS", {
      timeout: 10000,
    });
  });
});

test.describe("Multi-Strategy - Empty States", () => {
  test("should show empty positions state when no positions", async ({ page }) => {
    await setupMultiStrategyBot(page, []);

    await page.route(apiRoute(`bots/${TEST_BOT_UUID}/positions`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ positions: [], count: 0 }),
      });
    });
    await page.route(apiRoute("paper/positions"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ positions: [], count: 0 }),
      });
    });

    await navigateToBot(page);
    await expect(page.locator('[data-testid="positions-empty"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="positions-empty"]')).toContainText(
      "No open positions",
    );
  });

  test("should show no scan data when bot is stopped", async ({ page }) => {
    await setupMultiStrategyBot(page);

    await page.route(apiRoute(`bots/${TEST_BOT_UUID}/scan*`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ bot_id: TEST_BOT_UUID, scan_items: [], count: 0 }),
      });
    });

    await navigateToBot(page);
    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 15000 });
    await expect(scanCard).toContainText("No scan data yet");
  });
});
