import { test, expect } from '@playwright/test';
import { setupApiMocks, mockTrendingResponse } from '../mocks/apiResponses';

test.describe('Stock Screener UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('should load the main page with title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Stock Screener/);
  });

  test('should display data table', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  test('should display mock stock data', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Check that mock data is displayed - use more specific selector
    const firstSymbol = mockTrendingResponse.approaching[0].symbol;
    await expect(page.getByRole('cell', { name: firstSymbol })).toBeVisible();
  });
});
