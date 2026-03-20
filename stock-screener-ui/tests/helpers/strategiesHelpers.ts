import { Page, Locator, expect } from "@playwright/test";

export interface StrategyData {
  name?: string;
  strategyType?: string;
  slPct?: string;
  tpPct?: string;
  entryThresholdPct?: string;
  orMinutes?: string;
  maxPositions?: string;
}

export async function gotoStrategiesView(page: Page): Promise<void> {
  await page.goto("/strategies");
  await waitForStrategiesLoaded(page);
}

export async function waitForStrategiesLoaded(page: Page): Promise<void> {
  const loading = page.getByTestId("strategies-loading");
  try {
    await loading.waitFor({ state: "hidden", timeout: 10000 });
  } catch {
    // Loading spinner may not be present if data loads instantly
  }
}

export async function waitForTemplatesView(page: Page): Promise<void> {
  await page.getByTestId("templates-view").waitFor({ state: "visible", timeout: 10000 });
}

export async function waitForStrategyList(page: Page): Promise<void> {
  await page.getByTestId("strategy-list-table").waitFor({ state: "visible", timeout: 10000 });
}

export async function waitForPerformanceView(page: Page): Promise<void> {
  await page.getByTestId("performance-view").waitFor({ state: "visible", timeout: 10000 });
}

export function getCreateStrategyButton(page: Page): Locator {
  return page.getByTestId("create-strategy-btn");
}

export function getEditButton(page: Page, index: number = 0): Locator {
  return page.getByTestId("edit-strategy-btn").nth(index);
}

export function getDeleteButton(page: Page, index: number = 0): Locator {
  return page.getByTestId("delete-strategy-btn").nth(index);
}

export function getModal(page: Page): Locator {
  return page.getByTestId("strategy-form-modal").first();
}

export async function openStrategyModal(page: Page): Promise<void> {
  const createBtn = getCreateStrategyButton(page);
  await expect(createBtn).toBeVisible();
  await createBtn.click();
  await getModal(page).waitFor({ state: "visible", timeout: 5000 });
}

export async function closeStrategyModal(page: Page): Promise<void> {
  const modal = getModal(page);
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden", timeout: 5000 });
}

/** Fills a form field by its data-testid attribute. */
export async function fillStrategyFormField(
  page: Page,
  testid: string,
  value: string,
): Promise<void> {
  const field = page.getByTestId(testid);
  await expect(field).toBeVisible();
  await field.fill(value);
}

export async function fillStrategyForm(page: Page, strategy: StrategyData): Promise<void> {
  if (strategy.name) {
    await fillStrategyFormField(page, "strategy-name-input", strategy.name);
  }

  if (strategy.strategyType) {
    const typeSelect = page.getByTestId("strategy-type-input");
    await expect(typeSelect).toBeVisible();
    await typeSelect.selectOption(strategy.strategyType);
  }

  if (strategy.slPct) {
    await fillStrategyFormField(page, "strategy-sl-pct-input", strategy.slPct);
  }

  if (strategy.tpPct) {
    await fillStrategyFormField(page, "strategy-tp-pct-input", strategy.tpPct);
  }

  if (strategy.entryThresholdPct) {
    await fillStrategyFormField(page, "strategy-min-or-range-input", strategy.entryThresholdPct);
  }

  if (strategy.orMinutes) {
    await fillStrategyFormField(page, "strategy-or-minutes-input", strategy.orMinutes);
  }

  if (strategy.maxPositions) {
    await fillStrategyFormField(page, "strategy-max-positions-input", strategy.maxPositions);
  }
}

export async function submitStrategyForm(page: Page): Promise<void> {
  const submitBtn = page.getByTestId("submit-strategy-btn");
  await expect(submitBtn).toBeVisible();
  await submitBtn.click();
  await getModal(page)
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => {});
}

export async function verifyStrategyInList(page: Page, name: string): Promise<boolean> {
  const cards = page.getByTestId("strategy-card");
  const rows = page.locator('[data-testid^="strategy-row-"]');
  const count = (await cards.count()) + (await rows.count());
  if (count === 0) return false;

  for (let i = 0; i < (await cards.count()); i++) {
    if ((await cards.nth(i).textContent())?.includes(name)) return true;
  }
  for (let i = 0; i < (await rows.count()); i++) {
    if ((await rows.nth(i).textContent())?.includes(name)) return true;
  }
  return false;
}

export function getStrategyCard(page: Page, index: number = 0): Locator {
  return page.getByTestId("strategy-card").nth(index);
}

export function getStrategyRow(page: Page, index: number = 0): Locator {
  return page.locator('[data-testid^="strategy-row-"]').nth(index);
}

export async function clickStrategyCard(page: Page, index: number = 0): Promise<void> {
  const card = getStrategyCard(page, index);
  await expect(card).toBeVisible();
  await card.click();
}

export async function openEditModal(page: Page, index: number = 0): Promise<void> {
  const editBtn = getEditButton(page, index);
  await expect(editBtn).toBeVisible();
  await editBtn.click();
  await getModal(page).waitFor({ state: "visible", timeout: 5000 });
}

export async function clickDeleteButton(page: Page, index: number = 0): Promise<void> {
  const deleteBtn = getDeleteButton(page, index);
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();
}

export function getSaveButton(page: Page): Locator {
  return page.getByTestId("submit-strategy-btn");
}

export async function isModalVisible(page: Page): Promise<boolean> {
  const modal = getModal(page);
  return await modal.isVisible().catch(() => false);
}

export async function getStrategyListCount(page: Page): Promise<number> {
  const rows = page.locator('[data-testid^="strategy-row-"]');
  const cards = page.getByTestId("strategy-card");
  return (await rows.count()) + (await cards.count());
}

export function getDefaultBadge(page: Page): Locator {
  return page.locator('[data-testid="strategy-row-"]').locator('text="Active"');
}

export function getSetDefaultButton(page: Page, index: number = 0): Locator {
  return page.getByTestId("set-active-btn").nth(index);
}

/** Clicks a navigation tab (templates, list, performance) in the strategies nav. */
export async function clickTab(page: Page, tabName: string): Promise<void> {
  const tab = page.getByTestId("strategies-nav-tabs").locator(`input[value="${tabName}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

/** Clicks a form tab (orb, risk, runner) inside the strategy form. */
export async function clickStrategyTab(page: Page, tab: string): Promise<void> {
  const tabLocator = page.getByTestId(`strategy-tab-${tab}`);
  await expect(tabLocator).toBeVisible();
  await tabLocator.click();
}

/** Gets a performance stat card locator by its stat name. */
export function getPerformanceStat(page: Page, statName: string): Locator {
  const testidMap: Record<string, string> = {
    trades: "performance-card-trades",
    "win rate": "performance-card-winrate",
    pnl: "performance-card-pnl",
    strategies: "performance-card-strategies",
  };
  const testid = testidMap[statName.toLowerCase()] ?? `performance-card-${statName}`;
  return page.getByTestId(testid);
}

export async function confirmDialog(page: Page): Promise<void> {
  const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();
}
