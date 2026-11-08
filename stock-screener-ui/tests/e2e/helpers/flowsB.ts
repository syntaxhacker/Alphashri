import { type Page, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupValueScanMocks,
} from "../../mocks/apiResponses";
import { apiRoute } from "../../mocks/routeHelper";
import { gotoBacktest, selectSymbolAndRun, waitForBacktestResult } from "./backtestHelpers";
import { gotoNewsPage } from "./newsHelpers";
import { TEST_BOT_UUID } from "./botHelpers";

/**
 * Standard console-noise filter shared by the Deep Value / Event Radar / Correlation specs.
 * Extra patterns are matched as substrings (e.g. "Failed to fetch news").
 */
export function collectConsoleErrors(page: Page, extraIgnorePatterns: string[] = []): string[] {
  const errors: string[] = [];
  const ignorePatterns = [
    "ws/",
    "WebSocket",
    "ERR_CONNECTION_REFUSED",
    "hydration error",
    "Maximum update depth",
    "React does not recognize",
    ...extraIgnorePatterns,
  ];
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (ignorePatterns.some((pattern) => text.includes(pattern))) return;
    errors.push(text);
  });
  return errors;
}

/** Deep Value / Event Radar app shell: mocks + login (no backend, fully mocked panel). */
export async function enterValueScanApp(page: Page) {
  await setupApiMocks(page);
  await setupValueScanMocks(page);
  await loginAsTestUser(page);
}

/** Market ticker shell shared by Layout and Market Ticker specs. */
export async function mockMarketTicker(page: Page, tickerData: unknown) {
  await page.addInitScript(() => {
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
  });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await page.route(apiRoute("market-ticker"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tickerData),
    });
  });
}

/** Navigate to the paper trading settings panel (shared by app.spec + paper-trading.spec). */
export async function navigateToPaperTradingSettings(page: Page) {
  await page.goto("/paper", { timeout: 30000 });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible();
  const settingsTab = page.locator('[data-testid="tab-settings"]');
  await settingsTab.waitFor({ state: "visible", timeout: 10000 });
  await settingsTab.click({ timeout: 10000, trial: true }).catch(() => {});
  await settingsTab.click({ timeout: 10000 });
  await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 10000 });
}

/** Open the backtest view, run RELIANCE, wait for the results panel. */
export async function runBacktest(page: Page, testId = "results-table-wrapper") {
  await gotoBacktest(page);
  await selectSymbolAndRun(page);
  await waitForBacktestResult(page, testId);
}

/**
 * Open backtest results, open RELIANCE trade history, click the first trade row
 * (native dispatchEvent, since React onClick is unreliable via Playwright click)
 * and return the row locator.
 */
export async function clickFirstTradeRow(page: Page): Promise<import("@playwright/test").Locator> {
  await gotoBacktest(page);
  await selectSymbolAndRun(page);
  await waitForBacktestResult(page, "results-summary");

  const relianceRow = page.locator('[data-testid="result-row-RELIANCE"]');
  await expect(relianceRow).toBeVisible({ timeout: 15000 });
  await relianceRow.click();
  await expect(page.locator('[data-testid="trade-history-panel"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="trade-history-row-0"]')).toHaveCount(1, {
    timeout: 15000,
  });

  const firstTradeRow = page.locator('[data-testid="trade-history-row-0"]');
  await firstTradeRow.scrollIntoViewIfNeeded({ timeout: 15000 });
  await expect(firstTradeRow).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="trade-history-row-0"]');
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  return firstTradeRow;
}

/** Screener app shell shared by Screener and App specs. */
export async function setupScreenerApp(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

/** Open the screener tab and wait for table rows. */
export async function openScreenerTable(page: Page, timeout = 10000) {
  await page.goto("/?tab=screener");
  await page.waitForSelector('[data-testid="screener-table"] tbody tr', { timeout });
}

/** Open the Config tab inside the screener. */
export async function openConfigTab(page: Page) {
  await page.click('[data-testid="tab-config"]');
  await page.waitForLoadState("networkidle");
}

/** Open the sector view via the sidebar from the home page. */
export async function navigateToSectorViaSidebar(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
  await page.locator('[data-testid="nav-sector"]').click();
  await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({ timeout: 5000 });
}

/** Mobile viewport: open the news page and tap the first list item until the detail opens. */
export async function openFirstArticleOnMobile(page: Page) {
  await page.setViewportSize({ width: 575, height: 800 });
  await gotoNewsPage(page);
  const firstNewsItem = page.locator('[data-testid="news-list-item"]').first();
  await firstNewsItem.scrollIntoViewIfNeeded({ timeout: 15000 });
  await expect(firstNewsItem).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const item = document.querySelector('[data-testid="news-list-item"]');
    item?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-testid="close-article-btn"]')).toBeVisible({ timeout: 15000 });
}

/** Open paper trading settings, change an input via the PUT config route, and save. */
export async function openSettingsAndChangeInput(page: Page, inputTestId: string, value: string) {
  await navigateToPaperTradingSettings(page);
  await page.route(apiRoute(`bots/${TEST_BOT_UUID}/config`), async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const postData = JSON.parse(request.postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Config updated", config: postData }),
      });
    } else {
      await route.continue();
    }
  });
  const input = page.locator(`[data-testid="${inputTestId}"] input`);
  await input.fill(value);
  const saveBtn = page.locator('[data-testid="save-settings-button"]');
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(saveBtn).toHaveText("Saved");
}
