import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import {
  gotoBotsView,
  expectBotsViewVisible,
  getBotListItems,
  getBotStatus,
} from "../helpers/botsHelpers";

const BOT_ID_1 = "550e8400-e29b-41d4-a716-446655440000";
const BOT_ID_2 = "81b1e4e1-de04-4989-8357-96daade0bd86";

const mockBots = [
  {
    id: BOT_ID_1,
    name: "Default Bot",
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
    ],
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    running: false,
    pid: null,
  },
  {
    id: BOT_ID_2,
    name: "Multi-Strategy Bot",
    is_active: true,
    max_total_positions: 20,
    max_total_capital_pct: 0.8,
    strategies: [
      {
        id: "strat-2",
        name: "ORB Conservative",
        strategy_type: "ORB",
        max_positions: 3,
        capital_allocation_pct: 0.3,
      },
      {
        id: "strat-3",
        name: "ORB Aggressive",
        strategy_type: "ORB",
        max_positions: 3,
        capital_allocation_pct: 0.3,
      },
      {
        id: "strat-4",
        name: "52W Chaser",
        strategy_type: "52W_CHASER",
        max_positions: 4,
        capital_allocation_pct: 0.4,
      },
    ],
    created_at: "2026-01-15T00:00:00",
    updated_at: "2026-03-01T00:00:00",
    running: true,
    pid: 12345,
  },
];

const mockAvailableStrategies = [
  {
    id: "strat-1",
    name: "ORB Conservative",
    strategy_type: "ORB",
    is_template: false,
    is_default: false,
    sl_pct: 0.3,
    tp_pct: 0.8,
    max_positions: 5,
  },
  {
    id: "strat-2",
    name: "ORB Aggressive",
    strategy_type: "ORB",
    is_template: false,
    is_default: false,
    sl_pct: 0.6,
    tp_pct: 2.0,
    max_positions: 6,
  },
  {
    id: "strat-3",
    name: "52W Chaser",
    strategy_type: "52W_CHASER",
    is_template: false,
    is_default: false,
    sl_pct: 0.6,
    tp_pct: 2.0,
    max_positions: 3,
  },
];

async function setupBotsTest(page: import("@playwright/test").Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

async function mockBotsList(
  page: import("@playwright/test").Page,
  bots: typeof mockBots = mockBots,
) {
  await page.route(/\/api\/bots(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bots),
    });
  });
}

async function mockAvailableStrategiesRoute(page: import("@playwright/test").Page) {
  await page.route("**/api/bots/available-strategies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockAvailableStrategies),
    });
  });
}

async function gotoBotsViewAndWait(page: import("@playwright/test").Page) {
  await gotoBotsView(page);
  await page.waitForLoadState("networkidle");
}

test.describe("Bots View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should navigate to bots view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await page.locator('[data-testid="nav-bots"]').click();
    await expectBotsViewVisible(page);
  });

  test("should load bots view from URL", async ({ page }) => {
    await gotoBotsView(page);
    await expectBotsViewVisible(page);
  });
});

test.describe("Bots View - List", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
    await mockBotsList(page);
  });

  test("@smoke should display list of bots", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(getBotListItems(page)).toHaveCount(2);
  });

  test("@smoke should show bot status for each bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(getBotStatus(page)).toHaveCount(2);
    await expect(getBotStatus(page).first()).toBeVisible();
  });

  test("should show strategies count for each bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_ID_1}"]`)).toContainText("strategies");
  });

  test("should show PID for running bots", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-status-${BOT_ID_2}"]`)).toContainText("12345");
  });
});

test.describe("Bots View - Create", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
    await mockAvailableStrategiesRoute(page);
  });

  test("should have create bot button", async ({ page }) => {
    await mockBotsList(page, []);
    await gotoBotsViewAndWait(page);
    await expect(page.locator('[data-testid="create-bot-btn"]')).toBeVisible();
  });

  test("should open create bot modal", async ({ page }) => {
    await mockBotsList(page, []);
    await gotoBotsViewAndWait(page);
    await page.locator('[data-testid="create-bot-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
  });

  test("should create new bot", async ({ page }) => {
    await page.route(/\/api\/bots(\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "new-bot-id-11111111-1111-1111-1111-111111111111",
            name: "Test Bot",
            is_active: true,
            max_total_positions: 10,
            max_total_capital_pct: 0.8,
            strategies: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            running: false,
            pid: null,
          }),
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
    await page.locator('[data-testid="bot-name-input"]').fill("Test Bot");
    await page.locator('[data-testid="save-bot-config-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeHidden();
  });
});

test.describe("Bots View - Edit", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
    await mockBotsList(page);
    await mockAvailableStrategiesRoute(page);
  });

  test("should have edit button for each bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="edit-bot-btn-${BOT_ID_1}"]`)).toBeVisible();
  });

  test("should open edit modal with current values", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ID_1}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="bot-name-input"]')).toHaveValue("Default Bot");
  });

  test("should save edited bot", async ({ page }) => {
    await page.route(/\/api\/bots\/[^/]+$/, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...mockBots[0],
            name: "Updated Bot Name",
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        await route.continue();
      }
    });
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ID_1}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await page.locator('[data-testid="bot-name-input"]').fill("Updated Bot Name");
    await page.locator('[data-testid="save-bot-config-btn"]').click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeHidden();
  });
});

test.describe("Bots View - Delete", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should have delete button for each bot", async ({ page }) => {
    await mockBotsList(page);
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="delete-bot-btn-${BOT_ID_1}"]`)).toBeVisible();
  });

  test("should confirm before deleting", async ({ page }) => {
    await mockBotsList(page);
    await gotoBotsViewAndWait(page);
    page.on("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      await dialog.dismiss();
    });
    await page.locator(`[data-testid="delete-bot-btn-${BOT_ID_1}"]`).click();
  });

  test("should remove bot after delete", async ({ page }) => {
    let deleted = false;
    await page.route(/\/api\/bots(\?|$)/, async (route) => {
      const bots = deleted ? [mockBots[1]] : mockBots;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(bots),
      });
    });
    await page.route(/\/api\/bots\/[^/]+\/trade-count/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0 }),
      });
    });
    await page.route(/\/api\/bots\/[^/]+$/, async (route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Bot deleted" }),
        });
      } else {
        await route.continue();
      }
    });

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await gotoBotsViewAndWait(page);
    await expect(getBotListItems(page)).toHaveCount(2);
    await page.locator(`[data-testid="delete-bot-btn-${BOT_ID_1}"]`).click();
    await expect(getBotListItems(page)).toHaveCount(1);
  });
});

test.describe("Bots View - Controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
    await mockBotsList(page);
  });

  test("should show Start Bot button when bot is not running", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="start-bot-btn-${BOT_ID_1}"]`)).toBeVisible();
  });

  test("should show Stop Bot button when bot is running", async ({ page }) => {
    await page.route(/\/api\/bots\/[^/]+\/stop/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Bot stopped" }),
      });
    });
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="stop-bot-btn-${BOT_ID_2}"]`)).toBeVisible();
    await page.locator(`[data-testid="stop-bot-btn-${BOT_ID_2}"]`).click();
    await page.waitForLoadState("networkidle");
  });
});

test.describe("Bots View - Status", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
    await mockBotsList(page);
  });

  test("should have view status button for each bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="view-bot-status-btn-${BOT_ID_1}"]`)).toBeVisible();
  });

  test("should show bot status panel", async ({ page }) => {
    await page.route(/\/api\/bots\/[^/]+\/trades/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bot_id: BOT_ID_1,
          trades: [],
          count: 0,
        }),
      });
    });
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="view-bot-status-btn-${BOT_ID_1}"]`).click();
    await expect(page.locator('[data-testid="bot-status-panel"]')).toBeVisible();
  });
});

test.describe("Bots View - Assign Strategies", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
    await mockBotsList(page);
    await mockAvailableStrategiesRoute(page);
  });

  test("should show assigned strategies", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await expect(page.locator(`[data-testid="bot-row-${BOT_ID_2}"]`)).toContainText("3 strategies");
  });

  test("should add strategy to bot", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ID_1}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(1);
    await page.locator('[data-testid="add-strategy-btn"]').click();
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(2);
  });

  test("should set capital allocation for strategy", async ({ page }) => {
    await gotoBotsViewAndWait(page);
    await page.locator(`[data-testid="edit-bot-btn-${BOT_ID_2}"]`).click();
    await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="bot-config-strategies"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-allocation-row"]').first()).toBeVisible();
  });
});
