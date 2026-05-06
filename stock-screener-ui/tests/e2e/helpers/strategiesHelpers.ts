import { Page, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupStrategiesMocks } from "../../mocks/apiResponses";

export const STRATEGIES_URL = "/strategies";

export async function setupStrategiesTest(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupStrategiesMocks(page);
}

export async function gotoStrategies(page: Page) {
  await page.goto(STRATEGIES_URL);
  await expect(page.getByTestId("strategies-view")).toBeVisible({ timeout: 10000 });
}

export async function switchToStrategiesTab(page: Page, tabName: string) {
  await page.getByTestId("strategies-nav-tabs").locator("label", { hasText: tabName }).click();
}

export async function openCreateFromTemplate(page: Page) {
  await expect(page.getByTestId("template-tree-panel")).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid^="create-variation-btn-"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
}

export async function openEditTemplateFromTree(page: Page) {
  await expect(page.getByTestId("template-tree-panel")).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid^="edit-template-btn-"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
}
