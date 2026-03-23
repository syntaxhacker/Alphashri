import { Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
  setupOptionsMocks,
  setupSectorMocks,
} from "../../mocks/apiResponses";

export async function setupFullNavigationMocks(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
  await setupOptionsMocks(page);
  await setupSectorMocks(page);
}
