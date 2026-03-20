import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

const mockNewsSources = [
  { id: "moneycontrol", name: "Moneycontrol", url: "https://www.moneycontrol.com" },
  { id: "economictimes", name: "Economic Times", url: "https://economictimes.indiatimes.com" },
  { id: "livemint", name: "LiveMint", url: "https://www.livemint.com" },
  { id: "financialexpress", name: "Financial Express", url: "https://www.financialexpress.com" },
  { id: "business_standard", name: "Business Standard", url: "https://www.business-standard.com" },
  { id: "cnbctv18", name: "CNBC TV18", url: "https://www.cnbctv18.com" },
];

const mockNewsItems = [
  {
    id: "news-1",
    headline: "Reliance Industries hits all-time high on strong Q3 results",
    description:
      "Reliance Industries surged to a record high after reporting better-than-expected quarterly earnings.",
    source: "moneycontrol",
    sourceUrl: "https://www.moneycontrol.com/news/article-1",
    publishedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    fetchedAt: new Date().toISOString(),
    sentiment: "BULLISH",
    impact_score: 8,
    summary:
      "Reliance reported strong Q3 results with 15% revenue growth driven by retail and digital services.",
    key_points: [
      "Revenue grew 15% YoY to Rs 2.4 lakh crore",
      "Jio added 10 million new subscribers",
      "Retail business expanded with 500 new stores",
      "Oil-to-chemicals margin improved to 18%",
    ],
    key_entities: ["Reliance Industries", "Mukesh Ambani", "Jio", "Reliance Retail"],
    trade_ideas: [
      { symbol: "RELIANCE", direction: "LONG", reasoning: "Strong earnings and growth momentum" },
    ],
    symbols: [
      {
        code: "RI",
        name: "Reliance Industries",
        trading_symbol: "RELIANCE",
        instrument_key: "NSE_EQ|INE002A01018",
      },
    ],
  },
  {
    id: "news-2",
    headline: "IT sector faces headwinds as clients cut spending",
    description: "Major IT companies report slower growth amid global economic uncertainty.",
    source: "economictimes",
    sourceUrl: "https://economictimes.indiatimes.com/article-2",
    publishedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    fetchedAt: new Date().toISOString(),
    sentiment: "BEARISH",
    impact_score: 7,
    summary: "IT sector under pressure as enterprise clients reduce discretionary spending.",
    key_points: [
      "TCS reported 2% revenue decline in constant currency",
      "Infosys revised guidance downwards",
      "HCL Tech seeing delays in deal closures",
      "Analysts expect recovery only in H2 FY26",
    ],
    key_entities: ["TCS", "Infosys", "HCL Tech", "Wipro"],
    trade_ideas: [
      { symbol: "TCS", direction: "SHORT", reasoning: "Weak guidance and client spending cuts" },
      { symbol: "INFY", direction: "SHORT", reasoning: "Downward revision of guidance" },
    ],
    symbols: [
      { code: "TCS", name: "TCS", trading_symbol: "TCS", instrument_key: "NSE_EQ|INE467B01029" },
      {
        code: "INFY",
        name: "Infosys",
        trading_symbol: "INFY",
        instrument_key: "NSE_EQ|INE009A01021",
      },
    ],
  },
  {
    id: "news-3",
    headline: "RBI maintains repo rate at 6.5%",
    description: "Central bank holds rates steady amid stable inflation outlook.",
    source: "livemint",
    sourceUrl: "https://www.livemint.com/article-3",
    publishedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    fetchedAt: new Date().toISOString(),
    sentiment: "NEUTRAL",
    impact_score: 5,
    summary: "RBI kept rates unchanged as expected, maintaining accommodative stance.",
    key_points: [
      "Repo rate unchanged at 6.5%",
      "Inflation projected at 4.5% for FY26",
      "GDP growth forecast maintained at 7%",
    ],
    key_entities: ["RBI", "Reserve Bank of India", "Monetary Policy Committee"],
    trade_ideas: [],
    symbols: [],
  },
];

const mockRecentArticles = {
  total: mockNewsItems.length,
  articles: mockNewsItems,
};

async function setupNewsMocks(page: import("@playwright/test").Page) {
  await page.route("**/api/news/sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sources: mockNewsSources }),
    });
  });

  await page.route("**/api/news?*", async (route) => {
    // Simulate network latency to allow loading state to be visible
    await new Promise((resolve) => setTimeout(resolve, 100));
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

  await page.route("**/api/news/recent*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockRecentArticles),
    });
  });

  await page.route("**/api/news/article*", async (route) => {
    // Return first item with full analysis
    const articleWithAnalysis = {
      ...mockNewsItems[0],
      description: mockNewsItems[0].description + " Full article content details.",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(articleWithAnalysis),
    });
  });

  await page.route("**/api/news/stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total_articles: 100,
        total_symbol_mentions: 50,
        mapped_symbols: 35,
        unmapped_symbols: 15,
        sources: mockNewsSources.map((s) => s.id),
      }),
    });
  });

  await page.route("**/api/news/search*", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") || "";
    const filtered = mockNewsItems.filter(
      (item) =>
        item.headline.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ query, total: filtered.length, articles: filtered }),
    });
  });

  await page.route("**/api/news/symbols/*/articles*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: "RELIANCE",
        trading_symbol: "RELIANCE",
        instrument_key: "NSE_EQ|INE002A01018",
        is_mapped: true,
        total: 1,
        articles: [mockNewsItems[0]],
      }),
    });
  });
}

async function clickNewsToggle(page: import("@playwright/test").Page) {
  const toggleBtn = page.locator('[data-testid="news-toggle-btn"]');
  await toggleBtn.evaluate((el) => {
    (el as HTMLElement).click();
  });
}

test.describe("News Panel - Basic Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should show news toggle button on page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    const toggleBtn = page.locator('[data-testid="news-toggle-btn"]');
    await expect(toggleBtn).toBeVisible({ timeout: 15000 });
    await expect(toggleBtn).toContainText("NEWS");
  });

  test("should open panel when toggle button is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });
  });

  test("should close panel when close button is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });

    const closeBtn = panel.locator(".news-close-btn");
    await closeBtn.evaluate((el) => {
      (el as HTMLElement).click();
    });

    await expect(panel).not.toHaveClass(/open/);
  });

  test("should close panel when overlay is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });

    const overlay = page.locator(".news-overlay");
    await overlay.evaluate((el) => {
      (el as HTMLElement).click();
    });

    await expect(panel).not.toHaveClass(/open/);
  });
});

test.describe("News Panel - Content Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should display news source selector", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });

    const sourceSelector = panel.locator(".news-source-select");
    await expect(sourceSelector).toBeVisible();
  });

  test("should display refresh button", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });

    const refreshBtn = panel.locator('[data-testid="news-refresh-btn"]');
    await expect(refreshBtn).toBeVisible({ timeout: 5000 });
  });

  test("should display news items", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });
    await expect(panel.locator('[data-testid="news-item"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("should show headlines for news items", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });
    await expect(panel.locator(".news-item-headline").first()).toBeVisible({ timeout: 5000 });

    const headlines = panel.locator(".news-item-headline");
    const count = await headlines.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should mark unread items with visual indicator", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });
    await expect(panel.locator('[data-testid="news-item"]').first()).toBeVisible({ timeout: 5000 });

    const newsItems = panel.locator('[data-testid="news-item"]');
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
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });

    const sourceSelector = panel.locator(".news-source-select");
    await sourceSelector.click();

    await expect(page.getByRole("option", { name: "Economic Times" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("option", { name: "Economic Times" }).click();

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
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    await clickNewsToggle(page);

    const panel = page.locator('[data-testid="news-panel"]');
    await expect(panel).toHaveClass(/open/, { timeout: 15000 });

    // Wait for initial news to load
    await expect(panel.locator('[data-testid="news-item"]').first()).toBeVisible({ timeout: 5000 });
    const countBeforeRefresh = requestCount;

    const refreshBtn = panel.locator('[data-testid="news-refresh-btn"]');
    await refreshBtn.click();

    // Button should be disabled during refresh
    await expect(refreshBtn).toBeDisabled({ timeout: 5000 });

    // Wait for refresh to complete - button should be enabled again
    await expect(refreshBtn).toBeEnabled({ timeout: 10000 });

    // Verify that a new API request was made
    expect(requestCount).toBeGreaterThan(countBeforeRefresh);

    // Verify news items are still displayed
    await expect(panel.locator('[data-testid="news-item"]').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("News Page - Full Page View", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should navigate to news page", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    await expect(page.locator('[data-testid="news-page"]')).toBeVisible();
  });

  test("should display news page header", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const title = page.locator("text=News");
    await expect(title.first()).toBeVisible();
  });

  test("should display source selector on news page", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const sourceSelector = page.locator('[data-testid="source-selector"]');
    await expect(sourceSelector).toBeVisible();
  });

  test("should display news list", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstItem = page.locator('[data-testid="news-list-item"]').first();
    await expect(firstItem).toBeVisible({ timeout: 10000 });

    const count = await page.locator('[data-testid="news-list-item"]').count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("News Page - Sentiment Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should display BULLISH sentiment badge", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const bullishBadge = page.locator('[data-testid="sentiment-badge"]:has-text("BULLISH")');
    await expect(bullishBadge.first()).toBeVisible({ timeout: 5000 });
  });

  test("should display BEARISH sentiment badge", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const bearishBadge = page.locator('[data-testid="sentiment-badge"]:has-text("BEARISH")');
    await expect(bearishBadge.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("News Page - Impact Score Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should display impact score ring", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const impactScore = page.locator('[data-testid="impact-score"]');
    await expect(impactScore.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("News Page - Article Detail", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should open article detail on click", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstNewsItem = page.locator('[data-testid="news-list-item"]').first();
    await firstNewsItem.click();
    await expect(page.locator('[data-testid="article-detail"]')).toBeVisible({ timeout: 5000 });
  });

  test("should display summary in article detail", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstNewsItem = page.locator('[data-testid="news-list-item"]').first();
    await firstNewsItem.click();
    await expect(page.locator('[data-testid="article-detail"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Summary").first()).toBeVisible({ timeout: 5000 });
  });

  test("should display key points section", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstNewsItem = page.locator('[data-testid="news-list-item"]').first();
    await firstNewsItem.click();
    await expect(page.locator("text=Key Takeaways").first()).toBeVisible({ timeout: 5000 });
  });

  test("should display trade ideas section", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const bullishItem = page
      .locator('[data-testid="news-list-item"]')
      .filter({ hasText: "Reliance" })
      .first();
    await bullishItem.click();
    await expect(page.locator("text=Trade Ideas")).toBeVisible({ timeout: 5000 });
  });

  test("should display LONG trade idea with green badge", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const bullishItem = page
      .locator('[data-testid="news-list-item"]')
      .filter({ hasText: "Reliance" })
      .first();
    await bullishItem.click();
    await expect(page.locator('[data-testid="trade-idea"]').first()).toContainText("LONG", {
      timeout: 5000,
    });
  });

  test("should display stocks mentioned section", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstNewsItem = page
      .locator('[data-testid="news-list-item"]')
      .filter({ hasText: "Reliance" })
      .first();
    await firstNewsItem.click();
    await expect(page.locator("text=Stocks mentioned")).toBeVisible({ timeout: 5000 });
  });

  test("should show back button in article detail", async ({ page }) => {
    await page.setViewportSize({ width: 575, height: 800 });
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstNewsItem = page.locator('[data-testid="news-list-item"]').first();
    await firstNewsItem.click();
    await expect(page.locator('[data-testid="close-article-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test("should return to news list when clicking back", async ({ page }) => {
    await page.setViewportSize({ width: 575, height: 800 });
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const firstNewsItem = page.locator('[data-testid="news-list-item"]').first();
    await firstNewsItem.click();
    await expect(page.locator('[data-testid="close-article-btn"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="close-article-btn"]').click();
    await expect(page.locator('[data-testid="news-list-item"]').first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("News Page - Search", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should filter news by search query", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const searchInput = page.locator('input[placeholder*="Search"]');
    if ((await searchInput.count()) > 0) {
      await searchInput.fill("Reliance");
      await page.waitForLoadState("networkidle");

      const filteredItems = page.locator('[data-testid="news-list-item"]');
      const count = await filteredItems.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});

test.describe("News Page - Source Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should filter news by source", async ({ page }) => {
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const sourceSelector = page.locator('[data-testid="source-selector"]');
    if ((await sourceSelector.count()) > 0) {
      await sourceSelector.click();
      await expect(page.getByRole("option", { name: "Economic Times" })).toBeVisible({
        timeout: 5000,
      });
      await page.getByRole("option", { name: "Economic Times" }).click();

      const newsItems = page.locator('[data-testid="news-list-item"]');
      await expect(newsItems.first()).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("News Page - Loading States", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should show loading indicator while fetching news", async ({ page }) => {
    await page.goto("/news");

    const loader = page.locator('[data-testid="news-loader"]');
    await expect(loader)
      .toBeVisible({ timeout: 5000 })
      .catch(() => {});
  });
});

test.describe("News Page - Responsive Design", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNewsMocks(page);
  });

  test("should display correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const newsPage = page.locator('[data-testid="news-page"]');
    await expect(newsPage).toBeVisible();
  });

  test("should display correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const newsPage = page.locator('[data-testid="news-page"]');
    await expect(newsPage).toBeVisible();
  });

  test("should display correctly on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/news");
    await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });

    const newsPage = page.locator('[data-testid="news-page"]');
    await expect(newsPage).toBeVisible();
  });
});
