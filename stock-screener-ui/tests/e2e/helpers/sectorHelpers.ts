import { Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupMultiStrategyBotMocks,
  setupSectorMocks,
} from "../../mocks/apiResponses";

export async function setupSectorTest(page: Page) {
  // The sector refresh button is disabled while the market is closed, so the
  // suite would fail outside 09:15–15:30 IST. Pin the market open instead of
  // depending on the wall clock.
  await page.addInitScript(() => {
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
  });
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
