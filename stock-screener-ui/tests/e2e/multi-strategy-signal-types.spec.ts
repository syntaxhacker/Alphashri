import { test, expect } from "@playwright/test";
import {
  gotoBotsView,
  setupBotsMocks,
  mockBotsListRoute,
  mockAvailableStrategiesRoute,
  gotoBotsViewAndWait,
  mockCreateBotRoute,
  createBotAndSave,
} from "../helpers/botsHelpers";

const BOT_ORB_ID = "bot-orb-001";
const BOT_MIXED_ID = "bot-mixed-001";

const mockMultiTypeBots = [
  {
    id: BOT_ORB_ID,
    name: "ORB Only Bot",
    is_active: true,
    max_total_positions: 10,
    max_total_capital_pct: 0.8,
    strategies: [
      {
        id: "strat-1",
        name: "ORB Conservative",
        strategy_type: "ORB",
        max_positions: 5,
        capital_allocation_pct: 0.5,
      },
      {
        id: "strat-2",
        name: "ORB Aggressive",
        strategy_type: "ORB",
        max_positions: 3,
        capital_allocation_pct: 0.3,
      },
    ],
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T10:00:00Z",
    running: false,
    pid: null,
  },
  {
    id: BOT_MIXED_ID,
    name: "Mixed Strategy Bot",
    is_active: true,
    max_total_positions: 15,
    max_total_capital_pct: 0.9,
    strategies: [
      {
        id: "strat-3",
        name: "ORB Default",
        strategy_type: "ORB",
        max_positions: 5,
        capital_allocation_pct: 0.3,
      },
      {
        id: "strat-4",
        name: "52W Chaser Swing",
        strategy_type: "52W_CHASER",
        max_positions: 3,
        capital_allocation_pct: 0.25,
      },
      {
        id: "strat-5",
        name: "Classic S/R Breakout",
        strategy_type: "SR_BREAKOUT",
        max_positions: 3,
        capital_allocation_pct: 0.2,
      },
      {
        id: "strat-6",
        name: "52W Target Hold",
        strategy_type: "52W_TARGET",
        max_positions: 2,
        capital_allocation_pct: 0.15,
      },
      {
        id: "strat-7",
        name: "EMA Cross Default",
        strategy_type: "EMA_CROSS",
        max_positions: 4,
        capital_allocation_pct: 0.1,
      },
    ],
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T10:00:00Z",
    running: false,
    pid: null,
  },
];

const mockAvailableStrategies = [
  { id: "strat-1", name: "ORB Conservative", strategy_type: "ORB", is_template: false },
  { id: "strat-2", name: "ORB Aggressive", strategy_type: "ORB", is_template: false },
  { id: "strat-3", name: "52W Chaser Swing", strategy_type: "52W_CHASER", is_template: false },
  { id: "strat-4", name: "52W Target Hold", strategy_type: "52W_TARGET", is_template: false },
  { id: "strat-5", name: "Classic S/R Breakout", strategy_type: "SR_BREAKOUT", is_template: false },
  { id: "strat-7", name: "EMA Cross Default", strategy_type: "EMA_CROSS", is_template: false },
  { id: "strat-tpl-1", name: "ORB Template", strategy_type: "ORB", is_template: true },
];

test.describe("Multi-Strategy Bot - Signal Type Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsMocks(page);
    await mockBotsListRoute(page, mockMultiTypeBots);
  });

  test("should display ORB strategy type in bot list", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_ORB_ID}"]`)).toContainText("ORB");
  });

  test("should display SR_BREAKOUT strategy type in bot list", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`)).toContainText(
      "SR_BREAKOUT",
    );
  });

  test("should display 52W_CHASER strategy type in bot list", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`)).toContainText(
      "52W_CHASER",
    );
  });

  test("should display 52W_TARGET strategy type in bot list", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`)).toContainText(
      "52W_TARGET",
    );
  });

  test("should display EMA_CROSS strategy type in bot list", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`)).toContainText(
      "EMA_CROSS",
    );
  });

  test("should display EMA_CROSS strategy type badge correctly", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`)).toContainText(
      "EMA Cross Default",
    );
  });

  test("should show strategy count including all strategy types", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`)).toContainText(
      "5 strategies",
    );
  });

  test("should display each strategy name with correct type badge", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    const mixedRow = page.locator(`[data-testid="bot-row-${BOT_MIXED_ID}"]`);
    await expect(mixedRow).toContainText("ORB Default");
    await expect(mixedRow).toContainText("52W Chaser Swing");
    await expect(mixedRow).toContainText("Classic S/R Breakout");
    await expect(mixedRow).toContainText("52W Target Hold");
    await expect(mixedRow).toContainText("EMA Cross Default");
  });
});

test.describe("Multi-Strategy Bot - Create with Different Strategy Types", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsMocks(page);
    await mockAvailableStrategiesRoute(page, mockAvailableStrategies);
    await mockBotsListRoute(page, []);
  });

  test("should create a bot with ORB strategy", async ({ page }) => {
    await mockCreateBotRoute(page, "new-bot-orb", "ORB Bot");
    await createBotAndSave(page, "ORB Bot");
  });

  test("should create a bot with SR_BREAKOUT strategy", async ({ page }) => {
    await mockCreateBotRoute(page, "new-bot-sr", "SR Breakout Bot");
    await createBotAndSave(page, "SR Breakout Bot");
  });

  test("should create a bot with 52W_CHASER strategy", async ({ page }) => {
    await mockCreateBotRoute(page, "new-bot-52wc", "52W Chaser Bot");
    await createBotAndSave(page, "52W Chaser Bot");
  });

  test("should create a bot with 52W_TARGET strategy", async ({ page }) => {
    await mockCreateBotRoute(page, "new-bot-52wt", "52W Target Bot");
    await createBotAndSave(page, "52W Target Bot");
  });

  test("should create a bot with EMA_CROSS strategy", async ({ page }) => {
    await mockCreateBotRoute(page, "new-bot-ema", "EMA Cross Bot");
    await createBotAndSave(page, "EMA Cross Bot");
  });

  test("should create a bot with mixed strategy types (ORB + 52W_CHASER + SR_BREAKOUT)", async ({
    page,
  }) => {
    await mockCreateBotRoute(page, "new-bot-mixed", "Mixed Types Bot", 15, 0.9);
    await createBotAndSave(page, "Mixed Types Bot", 3);
  });

  test("should create a bot with all four strategy types", async ({ page }) => {
    await mockCreateBotRoute(page, "new-bot-all-types", "All Types Bot", 20, 0.95);
    await createBotAndSave(page, "All Types Bot", 4);
  });

  test("should validate total allocation does not exceed 100%", async ({ page }) => {
    await page.route(/\/api\/bots(\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Total capital allocation cannot exceed 100%" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });
    await gotoBotsViewAndWait(page);
    await page.locator('[data-testid="create-bot-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await page.locator('[data-testid="bot-name-input"]').fill("Over-Allocated Bot");
    await page.locator('[data-testid="save-bot-config-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
  });
});

test.describe("Multi-Strategy Bot - Edit Strategy Types", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsMocks(page);
    await mockBotsListRoute(page, mockMultiTypeBots);
    await mockAvailableStrategiesRoute(page, mockAvailableStrategies);
  });

  test("should allow adding a new strategy to existing bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ORB_ID}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(2);
    await page.locator('[data-testid="add-strategy-btn"]').click();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(3);
  });

  test("should allow adding EMA_CROSS strategy to existing bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ORB_ID}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(2);
    await page.locator('[data-testid="add-strategy-btn"]').click();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(3);
    await page.locator('[data-testid="save-bot-config-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeHidden();
  });

  test("should allow removing a strategy from bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ORB_ID}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(2);
    await page
      .locator('[data-testid="strategy-allocation-row"]')
      .last()
      .locator('[data-testid^="remove-strategy-btn-"]')
      .click();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(1);
  });

  test("should allow changing strategy type via edit", async ({ page }) => {
    await page.route(/\/api\/bots\/[^/]+$/, async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...mockMultiTypeBots[0],
            ...body,
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        await route.continue();
      }
    });
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ORB_ID}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await page.locator('[data-testid="add-strategy-btn"]').click();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(3);
    await page.locator('[data-testid="save-bot-config-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeHidden();
  });
});
