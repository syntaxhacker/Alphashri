import { Page, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../../mocks/apiResponses";
import { apiRoute } from "../../mocks/routeHelper";

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

export async function setupNewsMocks(page: Page) {
  // Broad route registered FIRST so more-specific sub-routes registered below
  // take priority (Playwright matches routes in reverse registration order).
  await page.route(apiRoute("news"), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
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

  await page.route(apiRoute("news/sources"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sources: mockNewsSources }),
    });
  });

  await page.route(apiRoute("news/recent"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockRecentArticles),
    });
  });

  await page.route(apiRoute("news/article"), async (route) => {
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

  await page.route(apiRoute("news/stats"), async (route) => {
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

  await page.route(apiRoute("news/search"), async (route) => {
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

  await page.route(apiRoute("news/*/articles"), async (route) => {
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

export async function setupNewsTest(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNewsMocks(page);
}

export async function clickNewsToggle(page: Page) {
  const toggleBtn = page.locator('[data-testid="news-toggle-btn"]');
  await toggleBtn.click();
}

export async function openNewsPanel(page: Page) {
  await clickNewsToggle(page);
  const panel = page.locator('[data-testid="news-panel"]');
  await expect(panel).toHaveClass(/open/, { timeout: 15000 });
}

export async function openRootPage(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
}

export async function gotoNewsPage(page: Page) {
  await page.goto("/news");
  await page.waitForSelector('[data-testid="news-page"]', { timeout: 30000 });
}
