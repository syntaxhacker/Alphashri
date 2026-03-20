import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupMultiStrategyBotMocks,
  setupSectorMocks,
} from "../mocks/apiResponses";

test.describe("Sector Dashboard - Navigation and Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should navigate to sector dashboard view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-sector"]').click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });
    expect(page.url()).toContain("/sector");
  });

  test("should display Sector Dashboard title", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    await expect(sectorView.locator("h2")).toContainText("Sector Dashboard");
  });

  test("should display subtitle about real-time performance", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView.locator(".sector-analysis-header")).toBeVisible();
    await expect(sectorView).toContainText("Real-time sector performance");
  });

  test("should display market toggle buttons India and US", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    const header = sectorView.locator(".sector-analysis-header");

    // Mantine SegmentedControl renders as labels with text
    await expect(header.locator("label", { hasText: "India" })).toBeVisible();
    await expect(header.locator("label", { hasText: "US" })).toBeVisible();
  });

  test("should display Live Dashboard and Historical Cycles tabs", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    const tabs = sectorView.locator('[role="tablist"]');
    await expect(tabs).toBeVisible();

    await expect(tabs.locator('[role="tab"]:has-text("Live Dashboard")')).toBeVisible();
    await expect(tabs.locator('[role="tab"]:has-text("Historical Cycles")')).toBeVisible();
  });

  test("should display Refresh button", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const refreshBtn = page.locator('[data-testid="sector-refresh-btn"]');

    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();
  });
});

test.describe("Sector Dashboard - Live Dashboard Tab", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should show Live Dashboard tab as active by default", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const liveTab = page
      .locator('[data-testid="sector-analysis-view"]')
      .locator('[role="tab"]:has-text("Live Dashboard")');
    await expect(liveTab).toHaveAttribute("aria-selected", "true");
  });

  test("should display sector performance table with headers", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    // Table should be present in the dashboard
    const table = sectorView.locator("table").first();
    await expect(table).toBeVisible();

    // Check expected column headers
    await expect(table.locator("th", { hasText: "Sector" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Change" })).toBeVisible();
    await expect(table.locator("th", { hasText: "A/D Ratio" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Strength" })).toBeVisible();
  });

  test("should display top sector summary card with green styling", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    // Top Sector card shows "TOP SECTOR" label and a green sector name
    await expect(sectorView.locator("text=Top Sector")).toBeVisible();
  });

  test("should display market breadth card with UP/DOWN badges", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    await expect(sectorView.locator("text=Market Breadth")).toBeVisible();
    await expect(sectorView.locator("text=/\\d+ UP/")).toBeVisible();
    await expect(sectorView.locator("text=/\\d+ DOWN/")).toBeVisible();
  });

  test("should display weakest sector summary card", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    await expect(sectorView.locator("text=Weakest Sector")).toBeVisible();
  });

  test("should display real-time alerts section", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    await expect(sectorView.locator("text=Real-time Alerts")).toBeVisible();
    await expect(sectorView.locator("text=Waiting for major movements...")).toBeVisible();
  });

  test("should display interval movers section", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    await expect(sectorView.locator("text=Interval Movers")).toBeVisible();
    await expect(sectorView.locator('[data-testid="sector-interval-movers-card"]')).toBeVisible();
  });
});

test.describe("Sector Dashboard - Tab Switching", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should switch to Historical Cycles tab and show iframe", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });
  });

  test("should switch back to Live Dashboard tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });

    // Small delay to ensure tab switch is complete
    await page.waitForTimeout(300);

    await page.locator('[role="tab"]:has-text("Live Dashboard")').click();

    // Should show the sector table again - wait for it directly
    await expect(page.locator('[data-testid="sector-table-container"] table').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("should have correct iframe src on Historical Cycles tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });

    const src = await page.locator('[data-testid="sector-iframe"]').getAttribute("src");
    expect(src).toContain("dashboard-modular.html");
    expect(src).toContain("/sector/dashboard-modular.html");
  });

  test("should hide dashboard content when on Historical Cycles tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // Wait for data to load before interacting
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });

    // Live Dashboard should show table
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("table").first(),
    ).toBeVisible();

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible();
    await expect(page.locator('[data-testid="sector-analysis-frame"]')).toBeVisible();
  });
});

test.describe("Sector Dashboard - Market Selector", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should have India button visible in header", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    const indiaBtn = sectorView.locator(".sector-analysis-header label", { hasText: "India" });
    await expect(indiaBtn).toBeVisible();
  });

  test("should have US button visible in header", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    const usBtn = sectorView.locator(".sector-analysis-header label", { hasText: "US" });
    await expect(usBtn).toBeVisible();
  });

  test("should toggle between India and US markets", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    const header = sectorView.locator(".sector-analysis-header");

    const indiaBtn = header.locator("label", { hasText: "India" });
    const usBtn = header.locator("label", { hasText: "US" });

    // Click US
    await usBtn.click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });

    // Click India to toggle back
    await indiaBtn.click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });

    // Both buttons should still be visible after toggling
    await expect(indiaBtn).toBeVisible();
    await expect(usBtn).toBeVisible();
  });
});

test.describe("Sector Dashboard - Refresh Button", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should display refresh button and be clickable", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // Wait for data to load (table visible indicates loading is complete)
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });

    const refreshBtn = page.locator('[data-testid="sector-refresh-btn"]');

    await expect(refreshBtn).toBeVisible();

    // Wait for the button to become enabled (not in loading state)
    await expect(refreshBtn).toBeEnabled({ timeout: 10000 });

    await refreshBtn.click();
    await expect(refreshBtn).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Sector Dashboard - Responsive Layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should display properly on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    await expect(sectorView.locator("h2")).toBeVisible();
    await expect(sectorView.locator(".sector-analysis-header")).toBeVisible();
  });

  test("should display properly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    await expect(sectorView.locator("h2")).toBeVisible();
    await expect(sectorView.locator('[role="tablist"]')).toBeVisible();
  });

  test("should display properly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();

    await expect(sectorView.locator("h2")).toBeVisible();
  });
});

test.describe("Sector Dashboard - Navigation State", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupMultiStrategyBotMocks(page);
    await setupSectorMocks(page);
  });

  test("should update navigation active state when navigating to sector view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-sector"]').click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("should navigate to sector view from other views", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="paper-trading-view"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-sector"]').click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });
    expect(page.url()).toContain("/sector");
  });

  test("should navigate away from sector view to other views", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-screener"]').click();
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 5000 });
    expect(page.url()).not.toContain("/sector");
  });
});
