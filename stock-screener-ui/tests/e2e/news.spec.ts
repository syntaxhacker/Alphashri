import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

// Mock news data
const mockNewsSources = [
  { id: "moneycontrol", name: "Moneycontrol", url: "https://www.moneycontrol.com" },
  { id: "economicstimes", name: "Economic Times", url: "https://economictimes.indiatimes.com" },
  { id: "livemint", name: "LiveMint", url: "https://www.livemint.com" },
];

const mockNewsItems = [
  {
    id: "news-1",
    headline: "Market hits all-time high as Sensex crosses 75,000",
    description: "Indian stock markets reached new heights today as benchmark indices surged.",
    source: "Moneycontrol",
    sourceUrl: "https://www.moneycontrol.com/news/article-1",
    publishedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    fetchedAt: new Date().toISOString(),
  },
  {
    id: "news-2",
    headline: "RBI holds repo rate unchanged at 6.5%",
    description: "The central bank maintained status quo on interest rates.",
    source: "Economic Times",
    sourceUrl: "https://economictimes.indiatimes.com/article-2",
    publishedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    fetchedAt: new Date().toISOString(),
  },
];

// Helper to setup news API mocks
async function setupNewsMocks(page: import("@playwright/test").Page) {
  await page.route("**/api/news/sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sources: mockNewsSources }),
    });
  });

  // Use specific route to avoid matching /api/news/sources
  await page.route("**/api/news?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: mockNewsItems,
        source: "moneycontrol",
        total: mockNewsItems.length,
        fetchedAt: new Date().toISOString(),
      }),
    });
  });
}

// Helper to click the news toggle button (handles overlay issues)
async function clickNewsToggle(page: import("@playwright/test").Page) {
  const toggleBtn = page.locator('[data-testid="news-toggle-btn"]');
  // Use evaluate to dispatch click directly to avoid any overlay issues
  await toggleBtn.evaluate((el) => {
    (el as HTMLElement).click();
  });
}

test.describe("News Panel - Toggle Visibility", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should show news toggle button on page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    const toggleBtn = page.locator('[data-testid="news-toggle-btn"]');
    await expect(toggleBtn).toBeVisible({ timeout: 10000 });
    await expect(toggleBtn).toContainText("NEWS");
  });

  test("should open panel when toggle button is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    // Wait for the panel to get the open class
    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });
  });

  test("should close panel when close button is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    // Open panel first
    await clickNewsToggle(page);

    // Wait for panel to open and close button to be visible
    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });

    // Click close button using evaluate to bypass any viewport issues
    const closeBtn = panel.locator(".news-close-btn");
    await closeBtn.evaluate((el) => {
      (el as HTMLElement).click();
    });

    // Verify panel is closed
    await expect(panel).not.toHaveClass(/open/);
  });

  test("should close panel when overlay is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    // Open panel first
    await clickNewsToggle(page);

    // Wait for panel to open
    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });

    // Click overlay using evaluate
    const overlay = page.locator(".news-overlay");
    await overlay.evaluate((el) => {
      (el as HTMLElement).click();
    });

    // Verify panel is closed
    await expect(panel).not.toHaveClass(/open/);
  });
});

test.describe("News Panel - Content Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should display news source selector when panel is open", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });

    const sourceSelector = panel.locator(".news-source-select");
    await expect(sourceSelector).toBeVisible();
  });

  test("should display refresh button when panel is open", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });

    const refreshBtn = panel.locator(".news-refresh-btn");
    await expect(refreshBtn).toBeVisible();
  });

  test("should display news items when panel is open", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });

    // Wait for news to load
    await page.waitForTimeout(1000);

    const newsItems = panel.locator('[data-testid="news-item"]');
    const count = await newsItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should show headlines for news items", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(1000);

    const headlines = panel.locator(".news-item-headline");
    const count = await headlines.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should show descriptions for news items", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(1000);

    const descriptions = panel.locator(".news-item-desc");
    const count = await descriptions.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should show source for each news item", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(1000);

    const sources = panel.locator(".news-item-meta");
    const count = await sources.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should mark unread items with visual indicator", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(1000);

    // Items are marked unread if not in localStorage
    // Since this is a fresh page, all items should be unread
    const newsItems = panel.locator('[data-testid="news-item"]');
    const count = await newsItems.count();
    expect(count).toBeGreaterThan(0);

    // Check that items have the unread class
    const firstItem = newsItems.first();
    const hasUnreadClass = await firstItem.evaluate((el) => el.classList.contains("unread"));
    expect(hasUnreadClass).toBe(true);
  });
});

test.describe("News Panel - Source Switching", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should allow switching news sources", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });

    // Mantine Select requires clicking to open dropdown, then clicking the option
    const sourceSelector = panel.locator(".news-source-select");
    await sourceSelector.click();

    // Wait for dropdown to appear and click on Economic Times option
    await page.getByRole("option", { name: "Economic Times" }).click();
    await page.waitForTimeout(500);

    // Verify the select displays Economic Times (Mantine shows label in input)
    const inputValue = await sourceSelector.locator("input").inputValue();
    expect(inputValue).toBe("Economic Times");
  });
});

test.describe("News Panel - Refresh", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should reload news when refresh button is clicked", async ({ page }) => {
    let requestCount = 0;

    page.on("request", (request) => {
      if (
        request.url().includes("/api/news") &&
        !request.url().includes("/article") &&
        !request.url().includes("/sources")
      ) {
        requestCount++;
      }
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 5000 });
    await page.waitForTimeout(1000);
    const countAfterOpen = requestCount;

    const refreshBtn = panel.locator(".news-refresh-btn");
    await refreshBtn.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await page.waitForTimeout(1000);

    expect(requestCount).toBeGreaterThan(countAfterOpen);
  });
});
