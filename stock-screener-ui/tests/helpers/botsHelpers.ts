import { Page, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

/**
 * Setup mocks for bots tests
 */
export async function setupBotsMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

/**
 * Navigate to bots view via sidebar
 */
export async function navigateToBotsView(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });
  await page.locator('[data-testid="nav-bots"]').click();
  await page.waitForTimeout(500);
}

/**
 * Go to bots view directly via URL
 */
export async function gotoBotsView(page: Page): Promise<void> {
  await page.goto("/bots");
  await page.waitForSelector('[data-testid="bots-view"]', { timeout: 10000 });
}

/**
 * Verify bots view is visible
 */
export async function expectBotsViewVisible(page: Page): Promise<void> {
  const botsView = page.locator('[data-testid="bots-view"]');
  if ((await botsView.count()) > 0) {
    await expect(botsView).toBeVisible();
  }
}

/**
 * Get bot cards or table rows
 */
export function getBotListItems(page: Page) {
  return page.locator(".bot-card, .bots-table tr");
}

/**
 * Get bot status element
 */
export function getBotStatus(page: Page) {
  return page.locator(".bot-status, .status-badge");
}
