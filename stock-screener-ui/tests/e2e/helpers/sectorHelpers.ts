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
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/sector", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 }).catch((e) => {
    if (errors.length > 0) throw new Error(`Page errors during gotoSector: ${errors.join("; ")}`);
    throw e;
  });
}
