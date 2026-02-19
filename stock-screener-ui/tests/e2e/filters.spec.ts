import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../mocks/apiResponses';

test.describe('Filter Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test('should have score filter input', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Find the min score input
    const minScoreInput = page.locator('#minScore');
    expect(await minScoreInput.count()).toBeGreaterThan(0);

    // Verify default value
    const value = await minScoreInput.inputValue();
    expect(parseInt(value)).toBe(0);
  });

  test('should have price filter input', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const maxPriceInput = page.locator('#maxPrice');
    expect(await maxPriceInput.count()).toBeGreaterThan(0);
  });

  test('should have sector filter dropdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const sectorSelect = page.locator('#sectorFilter');
    expect(await sectorSelect.count()).toBeGreaterThan(0);
  });

  test('should have reset filters button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const resetBtn = page.getByRole('button', { name: 'Reset' });
    expect(await resetBtn.count()).toBeGreaterThan(0);
  });

  test('should change filter value when input is modified', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const minScoreInput = page.locator('#minScore');
    if (await minScoreInput.count() > 0) {
      // Change the filter
      await minScoreInput.fill('50');
      await page.waitForTimeout(300);

      // Verify value changed
      const value = await minScoreInput.inputValue();
      expect(value).toBe('50');
    }
  });

  test('should click reset filters button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Click reset button - verify it can be clicked without error
    const resetBtn = page.getByRole('button', { name: 'Reset' });
    await resetBtn.click();
    await page.waitForTimeout(300);

    // Table should still be visible after reset
    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });
});
