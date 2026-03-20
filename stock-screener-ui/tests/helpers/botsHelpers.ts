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
