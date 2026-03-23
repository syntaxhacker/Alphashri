import { Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupMultiStrategyBotMocks,
  setupSectorMocks,
} from "../../mocks/apiResponses";

export async function setupSectorTest(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupMultiStrategyBotMocks(page);
  await setupSectorMocks(page);
}

export async function gotoSector(page: Page) {
  await page.goto("/sector");
  await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });
}
