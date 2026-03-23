import { Page, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

export async function setupBotsMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

export async function navigateToBotsView(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
  await page.locator('[data-testid="nav-bots"]').click();
  await page.waitForTimeout(500);
}

export async function gotoBotsView(page: Page): Promise<void> {
  await page.goto("/bots");
  await page.waitForSelector('[data-testid="bots-view"]', { timeout: 10000 });
}

export async function expectBotsViewVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="bots-view"]')).toBeVisible();
}

export function getBotListItems(page: Page) {
  return page.locator('[data-testid^="bot-row-"]');
}

export function getBotStatus(page: Page) {
  return page.locator('[data-testid^="bot-row-"] [data-testid^="bot-status-"]');
}

export async function mockBotsListRoute(page: Page, bots: any[]) {
  await page.route(/\/api\/bots(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bots),
    });
  });
}

export async function mockAvailableStrategiesRoute(page: Page, strategies: any[]) {
  await page.route("**/api/bots/available-strategies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(strategies),
    });
  });
}

export async function gotoBotsViewAndWait(page: Page) {
  await gotoBotsView(page);
  await page.waitForLoadState("networkidle");
}

export async function mockCreateBotRoute(
  page: Page,
  botId: string,
  botName: string,
  maxPositions: number = 10,
  maxCapitalPct: number = 0.8,
) {
  await page.route(/\/api\/bots(\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: botId,
          name: botName,
          is_active: true,
          max_total_positions: maxPositions,
          max_total_capital_pct: maxCapitalPct,
          strategies: body?.strategies ?? [],
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
}

export async function createBotAndSave(page: Page, botName: string, addStrategyCount: number = 1) {
  await gotoBotsViewAndWait(page);
  await page.locator('[data-testid="create-bot-btn"]').click();
  await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
  await page.locator('[data-testid="bot-name-input"]').fill(botName);
  for (let i = 0; i < addStrategyCount; i++) {
    await page.locator('[data-testid="add-strategy-btn"]').click();
  }
  if (addStrategyCount > 1) {
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(
      addStrategyCount,
    );
  }
  await page.locator('[data-testid="save-bot-config-btn"]').click();
  await expect(page.locator('[data-testid="bot-config-form"]')).toBeHidden();
}
