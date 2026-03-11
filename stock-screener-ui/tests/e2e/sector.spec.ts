import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupMultiStrategyBotMocks } from "../mocks/apiResponses";

test.describe("Sector Analysis - Navigation and Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should navigate to sector analysis view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    // Click Sector Analysis navigation
    await page.locator('[data-testid="nav-sector"]').click();
    await page.waitForTimeout(500);

    // Should show sector analysis view
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible();

    // URL should change
    expect(page.url()).toContain("/sector");
  });

  test("should display sector rotation dashboard", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // Sector analysis view should be visible
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    // Should have header with title
    await expect(sectorView.locator("h2")).toContainText("Sector Analysis");

    // Should have iframe for the embedded dashboard
    const iframe = sectorView.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();
  });

  test("should display action buttons in header", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    // Should have Usage Guide button
    const usageGuideButton = sectorView.locator('a[href*="usage.md"]');
    await expect(usageGuideButton).toBeVisible();
    await expect(usageGuideButton).toContainText("Usage Guide");

    // Should have Open Fullscreen button
    const fullscreenButton = sectorView.locator('a[href*="dashboard-modular.html"]');
    await expect(fullscreenButton).toBeVisible();
    await expect(fullscreenButton).toContainText("Open Fullscreen");
  });

  test("should show descriptive note about volume endpoints", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    // Should have note about running sector contributors API
    const note = sectorView.locator(".sector-analysis-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("historical_sector_cycles");
    await expect(note).toContainText("sector_contributors_api.py");
  });
});

test.describe("Sector Analysis - Iframe Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should load dashboard iframe with correct source", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const iframe = page.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();

    // Verify iframe src points to the dashboard
    const src = await iframe.getAttribute("src");
    expect(src).toContain("dashboard-modular.html");
    expect(src).toContain("localhost:8765");
  });

  test("should have iframe with proper accessibility attributes", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const iframe = page.locator(".sector-analysis-frame");
    await expect(iframe).toHaveAttribute("title", "Sector Rotation Dashboard");
  });

  test("should wrap iframe in container for proper styling", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    // Should have iframe wrapper
    const wrapper = sectorView.locator(".sector-analysis-frame-wrap");
    await expect(wrapper).toBeVisible();

    // Wrapper should contain the iframe
    const iframe = wrapper.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();
  });
});

test.describe("Sector Analysis - External Links", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should open usage guide in new tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const usageGuideButton = page.locator('a[href*="usage.md"]');

    // Should have rel="noreferrer" for security
    await expect(usageGuideButton).toHaveAttribute("target", "_blank");
    await expect(usageGuideButton).toHaveAttribute("rel", "noreferrer");
  });

  test("should open fullscreen dashboard in new tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const fullscreenButton = page.locator('a[href*="dashboard-modular.html"]');

    // Should have rel="noreferrer" for security
    await expect(fullscreenButton).toHaveAttribute("target", "_blank");
    await expect(fullscreenButton).toHaveAttribute("rel", "noreferrer");
  });

  test("should have correct API base URL in links", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // Usage guide link should point to correct endpoint
    const usageGuideButton = page.locator('a[href*="usage.md"]');
    const usageHref = await usageGuideButton.getAttribute("href");
    expect(usageHref).toContain("localhost:8765");
    expect(usageHref).toContain("/sector/usage.md");

    // Fullscreen link should point to correct endpoint
    const fullscreenButton = page.locator('a[href*="dashboard-modular.html"]');
    const fullHref = await fullscreenButton.getAttribute("href");
    expect(fullHref).toContain("localhost:8765");
    expect(fullHref).toContain("/sector/dashboard-modular.html");
  });
});

test.describe("Sector Analysis - Responsive Layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should display properly on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    // Header should be visible
    const header = sectorView.locator(".sector-analysis-header");
    await expect(header).toBeVisible();

    // Iframe should be visible
    const iframe = sectorView.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();
  });

  test("should display properly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    // Header should still be visible
    const header = sectorView.locator(".sector-analysis-header");
    await expect(header).toBeVisible();

    // Iframe should be visible
    const iframe = sectorView.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();
  });

  test("should display properly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    // Header should be visible
    const header = sectorView.locator(".sector-analysis-header");
    await expect(header).toBeVisible();

    // Iframe should be visible
    const iframe = sectorView.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();
  });
});

test.describe("Sector Analysis - Navigation State", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should update navigation active state when navigating to sector view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    // Click Sector Analysis
    await page.locator('[data-testid="nav-sector"]').click();
    await page.waitForTimeout(500);

    // Sector nav should be active (Mantine uses data-active attribute)
    const sectorNav = page.locator('[data-testid="nav-sector"]');
    await expect(sectorNav).toHaveAttribute("data-active", "true");
  });

  test("should navigate to sector view from other views", async ({ page }) => {
    // Start from paper trading
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="paper-trading-view"]', { timeout: 10000 });

    // Navigate to sector
    await page.locator('[data-testid="nav-sector"]').click();
    await page.waitForTimeout(500);

    // Should show sector view
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible();
    expect(page.url()).toContain("/sector");
  });

  test("should navigate away from sector view to other views", async ({ page }) => {
    // Start from sector
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // Navigate to screener (home)
    await page.locator('[data-testid="nav-screener"]').click();
    await page.waitForTimeout(500);

    // Should navigate to home/screener - URL should not contain /sector
    const url = page.url();
    expect(url).not.toContain("/sector");
  });
});

test.describe("Sector Analysis - Error Handling", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should handle iframe load failure gracefully", async ({ page }) => {
    // Block the iframe request to simulate load failure
    await page.route("**/dashboard-modular.html", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // The view itself should still be visible
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    // The iframe element should still exist in DOM
    const iframe = sectorView.locator(".sector-analysis-frame");
    await expect(iframe).toBeVisible();
  });

  test("should maintain view structure when backend is unavailable", async ({ page }) => {
    // Block all requests to localhost:8765
    await page.route("**localhost:8765/sector/**", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // View structure should still render
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    // Header and buttons should still be present
    await expect(sectorView.locator("h2")).toContainText("Sector Analysis");
    await expect(sectorView.locator('a[href*="usage.md"]')).toBeVisible();
  });
});
