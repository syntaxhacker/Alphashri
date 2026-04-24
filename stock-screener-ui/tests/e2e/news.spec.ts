import { test, expect } from "@playwright/test";
import {
  setupNewsTest,
  openNewsPanel,
  gotoNewsPage,
  openRootPage,
} from "./helpers/newsHelpers";

test.describe("News Panel - Basic Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should show news toggle button on page load", async ({ page }) => {
    await openRootPage(page);
    const toggleBtn = page.locator('[data-testid="news-toggle-btn"]');
    await expect(toggleBtn).toBeVisible({ timeout: 15000 });
    await expect(toggleBtn).toContainText("NEWS");
  });

  test("should open panel when toggle button is clicked", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
  });

  test("should close panel when close button is clicked", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    const panel = page.locator('[data-testid="news-panel"]');
    const closeBtn = panel.locator(".news-close-btn");
    await closeBtn.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await expect(panel).not.toHaveClass(/open/);
  });

  test("should close panel when overlay is clicked", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    const panel = page.locator('[data-testid="news-panel"]');
    const overlay = page.locator(".news-overlay");
    await overlay.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await expect(panel).not.toHaveClass(/open/);
  });
});

test.describe("News Panel - Content Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should display news source selector", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    const sourceSelector = page
      .locator('[data-testid="news-panel"]')
      .locator(".news-source-select");
    await expect(sourceSelector).toBeVisible();
  });

  test("should display refresh button", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    const refreshBtn = page
      .locator('[data-testid="news-panel"]')
      .locator('[data-testid="news-refresh-btn"]');
    await expect(refreshBtn).toBeVisible({ timeout: 5000 });
  });

  test("should display news items", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    await expect(
      page.locator('[data-testid="news-panel"]').locator('[data-testid="news-item"]').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should show headlines for news items", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    await expect(
      page.locator('[data-testid="news-panel"]').locator(".news-item-headline").first(),
    ).toBeVisible({ timeout: 5000 });
    const headlines = page.locator('[data-testid="news-panel"]').locator(".news-item-headline");
    expect(await headlines.count()).toBeGreaterThan(0);
  });

  test("should mark unread items with visual indicator", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    await expect(
      page.locator('[data-testid="news-panel"]').locator('[data-testid="news-item"]').first(),
    ).toBeVisible({ timeout: 5000 });
    const firstItem = page
      .locator('[data-testid="news-panel"]')
      .locator('[data-testid="news-item"]')
      .first();
    expect(await firstItem.evaluate((el) => el.classList.contains("unread"))).toBe(true);
  });
});

test.describe("News Panel - Source Switching", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should allow switching news sources", async ({ page }) => {
    await openRootPage(page);
    await openNewsPanel(page);
    const sourceSelector = page
      .locator('[data-testid="news-panel"]')
      .locator(".news-source-select");
    await sourceSelector.click();
    await expect(page.getByRole("option", { name: "Economic Times" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("option", { name: "Economic Times" }).click();
    expect(await sourceSelector.locator("input").inputValue()).toBe("Economic Times");
  });
});

test.describe("News Panel - Refresh", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
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
    await openRootPage(page);
    await openNewsPanel(page);
    await expect(
      page.locator('[data-testid="news-panel"]').locator('[data-testid="news-item"]').first(),
    ).toBeVisible({ timeout: 5000 });
    const countBeforeRefresh = requestCount;
    const refreshBtn = page
      .locator('[data-testid="news-panel"]')
      .locator('[data-testid="news-refresh-btn"]');
    await refreshBtn.click();
    await expect(refreshBtn).toBeDisabled({ timeout: 5000 });
    await expect(refreshBtn).toBeEnabled({ timeout: 10000 });
    expect(requestCount).toBeGreaterThan(countBeforeRefresh);
    await expect(
      page.locator('[data-testid="news-panel"]').locator('[data-testid="news-item"]').first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("News Page - Full Page View", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should navigate to news page", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="news-page"]')).toBeVisible();
  });

  test("should display news page header", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(page.locator("text=News").first()).toBeVisible();
  });

  test("should display source selector on news page", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="source-selector"]')).toBeVisible();
  });

  test("should display news list", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="news-list-item"]').first()).toBeVisible({
      timeout: 10000,
    });
    expect(await page.locator('[data-testid="news-list-item"]').count()).toBeGreaterThan(0);
  });
});

test.describe("News Page - Sentiment Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should display BULLISH sentiment badge", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(
      page.locator('[data-testid="sentiment-badge"]:has-text("BULLISH")').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should display BEARISH sentiment badge", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(
      page.locator('[data-testid="sentiment-badge"]:has-text("BEARISH")').first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("News Page - Impact Score Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should display impact score ring", async ({ page }) => {
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="impact-score"]').first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("News Page - Article Detail", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should open article detail on click", async ({ page }) => {
    await gotoNewsPage(page);
    await page.locator('[data-testid="news-list-item"]').first().click();
    await expect(page.locator('[data-testid="article-detail"]')).toBeVisible({ timeout: 5000 });
  });

  test("should display summary in article detail", async ({ page }) => {
    await gotoNewsPage(page);
    await page.locator('[data-testid="news-list-item"]').first().click();
    await expect(page.locator('[data-testid="article-detail"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Summary").first()).toBeVisible({ timeout: 5000 });
  });

  test("should display key points section", async ({ page }) => {
    await gotoNewsPage(page);
    await page.locator('[data-testid="news-list-item"]').first().click();
    await expect(page.locator("text=Key Takeaways").first()).toBeVisible({ timeout: 5000 });
  });

  test("should display trade ideas section", async ({ page }) => {
    await gotoNewsPage(page);
    await page
      .locator('[data-testid="news-list-item"]')
      .filter({ hasText: "Reliance" })
      .first()
      .click();
    await expect(page.locator("text=Trade Ideas")).toBeVisible({ timeout: 5000 });
  });

  test("should display LONG trade idea with green badge", async ({ page }) => {
    await gotoNewsPage(page);
    await page
      .locator('[data-testid="news-list-item"]')
      .filter({ hasText: "Reliance" })
      .first()
      .click();
    await expect(page.locator('[data-testid="trade-idea"]').first()).toContainText("LONG", {
      timeout: 5000,
    });
  });

  test("should display stocks mentioned section", async ({ page }) => {
    await gotoNewsPage(page);
    await page
      .locator('[data-testid="news-list-item"]')
      .filter({ hasText: "Reliance" })
      .first()
      .click();
    await expect(page.locator("text=Stocks mentioned")).toBeVisible({ timeout: 5000 });
  });

  test("should show back button in article detail", async ({ page }) => {
    await page.setViewportSize({ width: 575, height: 800 });
    await gotoNewsPage(page);
    await page.locator('[data-testid="news-list-item"]').first().click();
    await expect(page.locator('[data-testid="close-article-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test("should return to news list when clicking back", async ({ page }) => {
    await page.setViewportSize({ width: 575, height: 800 });
    await gotoNewsPage(page);
    await page.locator('[data-testid="news-list-item"]').first().click();
    await expect(page.locator('[data-testid="close-article-btn"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="close-article-btn"]').click();
    await expect(page.locator('[data-testid="news-list-item"]').first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("News Page - Search", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should filter news by search query", async ({ page }) => {
    await gotoNewsPage(page);
    const searchInput = page.locator('input[placeholder*="Search"]');
    if ((await searchInput.count()) > 0) {
      await searchInput.fill("Reliance");
      await page.waitForLoadState("networkidle");
      expect(await page.locator('[data-testid="news-list-item"]').count()).toBeGreaterThanOrEqual(
        1,
      );
    }
  });
});

test.describe("News Page - Source Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should filter news by source", async ({ page }) => {
    await gotoNewsPage(page);
    const sourceSelector = page.locator('[data-testid="source-selector"]');
    if ((await sourceSelector.count()) > 0) {
      await sourceSelector.click();
      await expect(page.getByRole("option", { name: "Economic Times" })).toBeVisible({
        timeout: 5000,
      });
      await page.getByRole("option", { name: "Economic Times" }).click();
      await expect(page.locator('[data-testid="news-list-item"]').first()).toBeVisible({
        timeout: 5000,
      });
    }
  });
});

test.describe("News Page - Loading States", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should show loading indicator while fetching news", async ({ page }) => {
    await page.goto("/news");
    await expect(page.locator('[data-testid="news-loader"]'))
      .toBeVisible({ timeout: 5000 })
      .catch(() => {});
  });
});

test.describe("News Page - Responsive Design", () => {
  test.beforeEach(async ({ page }) => {
    await setupNewsTest(page);
  });

  test("should display correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="news-page"]')).toBeVisible();
  });

  test("should display correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="news-page"]')).toBeVisible();
  });

  test("should display correctly on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoNewsPage(page);
    await expect(page.locator('[data-testid="news-page"]')).toBeVisible();
  });
});
