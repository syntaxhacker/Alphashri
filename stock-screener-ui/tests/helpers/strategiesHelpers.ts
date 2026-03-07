import { Page, Locator } from "@playwright/test";

/**
 * Strategy data interface for filling forms
 */
export interface StrategyData {
  name?: string;
  strategyType?: string;
  slPct?: string;
  tpPct?: string;
  entryThresholdPct?: string;
  orMinutes?: string;
  maxPositions?: string;
}

/**
 * Navigate to strategies view and wait for it to load
 */
export async function gotoStrategiesView(page: Page): Promise<void> {
  await page.goto("/strategies");
  await page.waitForSelector('[data-testid="strategies-view"]', { timeout: 10000 });
}

/**
 * Get the create strategy button locator
 * Uses specific data-testid to avoid matching template "Create Variation" buttons
 */
export function getCreateStrategyButton(page: Page): Locator {
  return page.locator('[data-testid="create-strategy-btn"]');
}

/**
 * Get the edit button locator (first one by default)
 */
export function getEditButton(page: Page, index: number = 0): Locator {
  return page.locator(".edit-btn, button:has-text('Edit')").nth(index);
}

/**
 * Get the delete button locator (first one by default)
 */
export function getDeleteButton(page: Page, index: number = 0): Locator {
  return page.locator(".delete-btn, button:has-text('Delete')").nth(index);
}

/**
 * Get the modal locator
 */
export function getModal(page: Page): Locator {
  // Return only visible modals to avoid strict mode violations
  return page.locator(".modal:visible, .strategy-form-modal:visible").first();
}

/**
 * Open the create strategy modal
 */
export async function openStrategyModal(page: Page): Promise<boolean> {
  const createBtn = getCreateStrategyButton(page);
  const count = await createBtn.count();
  if (count > 0) {
    await createBtn.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

/**
 * Close the strategy modal (clicks outside or presses Escape)
 */
export async function closeStrategyModal(page: Page): Promise<void> {
  const modal = getModal(page);
  const count = await modal.count();
  if (count > 0) {
    // Try pressing Escape first
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

/**
 * Fill the strategy form with the provided data
 */
export async function fillStrategyForm(page: Page, strategy: StrategyData): Promise<void> {
  // Fill name
  if (strategy.name) {
    const nameInput = page.locator("#strategy-name, input[name='name']");
    if ((await nameInput.count()) > 0) {
      await nameInput.fill(strategy.name);
    }
  }

  // Select strategy type
  if (strategy.strategyType) {
    const typeSelect = page.locator("#strategy-type, select[name='strategy_type']");
    if ((await typeSelect.count()) > 0) {
      await typeSelect.selectOption(strategy.strategyType);
      await page.waitForTimeout(300);
    }
  }

  // Fill stop loss percentage
  if (strategy.slPct) {
    const slInput = page.locator("#sl-pct, input[name='sl_pct']");
    if ((await slInput.count()) > 0) {
      await slInput.fill(strategy.slPct);
    }
  }

  // Fill take profit percentage
  if (strategy.tpPct) {
    const tpInput = page.locator("#tp-pct, input[name='tp_pct']");
    if ((await tpInput.count()) > 0) {
      await tpInput.fill(strategy.tpPct);
    }
  }

  // Fill entry threshold (for 52W Chaser)
  if (strategy.entryThresholdPct) {
    const thresholdInput = page.locator("#entry-threshold, input[name='entry_threshold_pct']");
    if ((await thresholdInput.count()) > 0) {
      await thresholdInput.fill(strategy.entryThresholdPct);
    }
  }

  // Fill opening range minutes (for ORB)
  if (strategy.orMinutes) {
    const orMinutesInput = page.locator("#or-minutes, input[name='or_minutes']");
    if ((await orMinutesInput.count()) > 0) {
      await orMinutesInput.fill(strategy.orMinutes);
    }
  }

  // Fill max positions
  if (strategy.maxPositions) {
    const maxPositionsInput = page.locator("#max-positions, input[name='max_positions']");
    if ((await maxPositionsInput.count()) > 0) {
      await maxPositionsInput.fill(strategy.maxPositions);
    }
  }
}

/**
 * Submit the strategy form (click Save/Create button)
 */
export async function submitStrategyForm(page: Page): Promise<void> {
  const submitBtn = page.locator('button:has-text("Save"), button:has-text("Create")').last();
  if ((await submitBtn.count()) > 0) {
    await submitBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Verify a strategy appears in the list by name
 */
export async function verifyStrategyInList(page: Page, name: string): Promise<boolean> {
  const strategyLocator = page.locator(
    `.strategy-card:has-text("${name}"), .strategies-table tr:has-text("${name}"), .template-card:has-text("${name}")`,
  );
  const count = await strategyLocator.count();
  return count > 0;
}

/**
 * Get strategy card or table row locator
 */
export function getStrategyCard(page: Page, index: number = 0): Locator {
  return page.locator(".strategy-card, .strategies-table tr").nth(index);
}

/**
 * Click on a strategy card to view details
 */
export async function clickStrategyCard(page: Page, index: number = 0): Promise<void> {
  const strategyCard = getStrategyCard(page, index);
  if ((await strategyCard.count()) > 0) {
    await strategyCard.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Open edit modal for a strategy
 */
export async function openEditModal(page: Page, index: number = 0): Promise<boolean> {
  const editBtn = getEditButton(page, index);
  const count = await editBtn.count();
  if (count > 0) {
    await editBtn.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

/**
 * Click delete button for a strategy
 */
export async function clickDeleteButton(page: Page, index: number = 0): Promise<boolean> {
  const deleteBtn = getDeleteButton(page, index);
  const count = await deleteBtn.count();
  if (count > 0) {
    await deleteBtn.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

/**
 * Get the save button locator
 */
export function getSaveButton(page: Page): Locator {
  return page.locator('button:has-text("Save")').last();
}

/**
 * Verify modal is visible
 */
export async function isModalVisible(page: Page): Promise<boolean> {
  const modal = getModal(page);
  const count = await modal.count();
  if (count > 0) {
    return await modal.isVisible();
  }
  return false;
}

/**
 * Get strategy list count
 */
export async function getStrategyListCount(page: Page): Promise<number> {
  return await page.locator(".strategy-card, .strategies-table tr").count();
}

/**
 * Get default badge locator
 */
export function getDefaultBadge(page: Page): Locator {
  return page.locator(".default-badge, .is-default");
}

/**
 * Get set default button locator
 */
export function getSetDefaultButton(page: Page, index: number = 0): Locator {
  return page.locator('button:has-text("Set Default"), button:has-text("Make Default")').nth(index);
}
