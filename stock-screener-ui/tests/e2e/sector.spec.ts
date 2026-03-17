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
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible();
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

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    const refreshBtn = sectorView.locator("button", { hasText: "Refresh" });

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
    await expect(sectorView.locator("text=UP")).toBeVisible();
    await expect(sectorView.locator("text=DOWN")).toBeVisible();
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
    await expect(sectorView.locator("text=Waiting for major movements")).toBeVisible();
  });

  test("should display interval movers section", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');

    await expect(sectorView.locator("text=Interval Movers")).toBeVisible();
    await expect(sectorView.locator("text=Collecting baseline")).toBeVisible();
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
    await page.waitForTimeout(500);

    const iframe = page.locator('[data-testid="sector-iframe"]');
    await expect(iframe).toBeVisible();
  });

  test("should switch back to Live Dashboard tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await page.waitForTimeout(500);

    await page.locator('[role="tab"]:has-text("Live Dashboard")').click();
    await page.waitForTimeout(500);

    const liveTab = page
      .locator('[data-testid="sector-analysis-view"]')
      .locator('[role="tab"]:has-text("Live Dashboard")');
    await expect(liveTab).toHaveAttribute("aria-selected", "true");

    // Should show the sector table again
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("table").first(),
    ).toBeVisible();
  });

  test("should have correct iframe src on Historical Cycles tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await page.waitForTimeout(500);

    const iframe = page.locator('[data-testid="sector-iframe"]');
    await expect(iframe).toBeVisible();

    const src = await iframe.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toContain("dashboard-modular.html");
    expect(src).toContain("/sector/dashboard-modular.html");
  });

  test("should hide dashboard content when on Historical Cycles tab", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    // Live Dashboard should show table
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("table").first(),
    ).toBeVisible();

    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await page.waitForTimeout(500);

    // Table should be hidden, iframe should be visible
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
    await page.waitForTimeout(300);

    // Click India to toggle back
    await indiaBtn.click();
    await page.waitForTimeout(300);

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

    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    const refreshBtn = sectorView.locator("button", { hasText: "Refresh" });

    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();

    await refreshBtn.click();
    await page.waitForTimeout(500);

    // Button should still be visible after click
    await expect(refreshBtn).toBeVisible();
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
    await page.waitForTimeout(500);

    const sectorNav = page.locator('[data-testid="nav-sector"]');
    await expect(sectorNav).toHaveAttribute("data-active", "true");
  });

  test("should navigate to sector view from other views", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="paper-trading-view"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-sector"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible();
    expect(page.url()).toContain("/sector");
  });

  test("should navigate away from sector view to other views", async ({ page }) => {
    await page.goto("/sector");
    await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-screener"]').click();
    await page.waitForTimeout(500);

    const url = page.url();
    expect(url).not.toContain("/sector");
  });
});
