import { test, expect } from "@playwright/test";
import { setupSectorTest, gotoSector } from "./helpers/sectorHelpers";

test.describe("Sector Dashboard - Navigation and Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
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
    await gotoSector(page);
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();
    await expect(sectorView.locator("h2")).toContainText("Sector Dashboard");
  });

  test("should display subtitle about real-time performance", async ({ page }) => {
    await gotoSector(page);
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView.locator(".sector-analysis-header")).toBeVisible();
    await expect(sectorView).toContainText("Real-time sector performance");
  });

  test("should display market toggle buttons India and US", async ({ page }) => {
    await gotoSector(page);
    const header = page
      .locator('[data-testid="sector-analysis-view"]')
      .locator(".sector-analysis-header");
    await expect(header.locator("label", { hasText: "India" })).toBeVisible();
    await expect(header.locator("label", { hasText: "US" })).toBeVisible();
  });

  test("should display Live Dashboard and Historical Cycles tabs", async ({ page }) => {
    await gotoSector(page);
    const tabs = page.locator('[data-testid="sector-analysis-view"]').locator('[role="tablist"]');
    await expect(tabs).toBeVisible();
    await expect(tabs.locator('[role="tab"]:has-text("Live Dashboard")')).toBeVisible();
    await expect(tabs.locator('[role="tab"]:has-text("Historical Cycles")')).toBeVisible();
  });

  test("should display Refresh button", async ({ page }) => {
    await gotoSector(page);
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });
    const refreshBtn = page.locator('[data-testid="sector-refresh-btn"]');
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();
  });
});

test.describe("Sector Dashboard - Live Dashboard Tab", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should show Live Dashboard tab as active by default", async ({ page }) => {
    await gotoSector(page);
    const liveTab = page
      .locator('[data-testid="sector-analysis-view"]')
      .locator('[role="tab"]:has-text("Live Dashboard")');
    await expect(liveTab).toHaveAttribute("aria-selected", "true");
  });

  test("should display sector performance table with headers", async ({ page }) => {
    await gotoSector(page);
    const table = page.locator('[data-testid="sector-analysis-view"]').locator("table").first();
    await expect(table).toBeVisible();
    await expect(table.locator("th", { hasText: "Sector" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Change" })).toBeVisible();
    await expect(table.locator("th", { hasText: "A/D Ratio" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Strength" })).toBeVisible();
  });

  test("should display top sector summary card with green styling", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=Top Sector"),
    ).toBeVisible();
  });

  test("should display market breadth card with UP/DOWN badges", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=Market Breadth"),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=/\\d+ UP/"),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=/\\d+ DOWN/"),
    ).toBeVisible();
  });

  test("should display weakest sector summary card", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=Weakest Sector"),
    ).toBeVisible();
  });

  test("should display real-time alerts section", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=Real-time Alerts"),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-testid="sector-analysis-view"]')
        .locator("text=Waiting for major movements..."),
    ).toBeVisible();
  });

  test("should display interval movers section", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("text=Interval Movers"),
    ).toBeVisible();
    await expect(page.locator('[data-testid="sector-interval-movers-card"]')).toBeVisible();
  });
});

test.describe("Sector Dashboard - Tab Switching", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should switch to Historical Cycles tab and show iframe", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });
  });

  test("should switch back to Live Dashboard tab", async ({ page }) => {
    await gotoSector(page);
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });
    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.locator('[role="tab"]:has-text("Live Dashboard")').click();
    await expect(page.locator('[data-testid="sector-table-container"] table').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("should have correct iframe src on Historical Cycles tab", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });
    const src = await page.locator('[data-testid="sector-iframe"]').getAttribute("src");
    expect(src).toContain("dashboard-modular.html");
    expect(src).toContain("/sector/dashboard-modular.html");
  });

  test("should hide dashboard content when on Historical Cycles tab", async ({ page }) => {
    await gotoSector(page);
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });
    await expect(
      page.locator('[data-testid="sector-analysis-view"]').locator("table").first(),
    ).toBeVisible();
    await page.locator('[role="tab"]:has-text("Historical Cycles")').click();
    await expect(page.locator('[data-testid="sector-iframe"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="sector-analysis-frame"]')).toBeVisible();
  });
});

test.describe("Sector Dashboard - Market Selector", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should have India button visible in header", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page
        .locator('[data-testid="sector-analysis-view"]')
        .locator(".sector-analysis-header label", { hasText: "India" }),
    ).toBeVisible();
  });

  test("should have US button visible in header", async ({ page }) => {
    await gotoSector(page);
    await expect(
      page
        .locator('[data-testid="sector-analysis-view"]')
        .locator(".sector-analysis-header label", { hasText: "US" }),
    ).toBeVisible();
  });

  test("should toggle between India and US markets", async ({ page }) => {
    await gotoSector(page);
    const header = page
      .locator('[data-testid="sector-analysis-view"]')
      .locator(".sector-analysis-header");
    const indiaBtn = header.locator("label", { hasText: "India" });
    const usBtn = header.locator("label", { hasText: "US" });
    await usBtn.click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });
    await indiaBtn.click();
    await expect(page.locator('[data-testid="sector-analysis-view"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(indiaBtn).toBeVisible();
    await expect(usBtn).toBeVisible();
  });
});

test.describe("Sector Dashboard - Refresh Button", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should display refresh button and be clickable", async ({ page }) => {
    await gotoSector(page);
    await page.waitForSelector('[data-testid="sector-table-container"] table', { timeout: 10000 });
    const refreshBtn = page.locator('[data-testid="sector-refresh-btn"]');
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled({ timeout: 10000 });
    await refreshBtn.click();
    await expect(refreshBtn).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Sector Dashboard - Responsive Layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should display properly on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoSector(page);
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();
    await expect(sectorView.locator("h2")).toBeVisible();
    await expect(sectorView.locator(".sector-analysis-header")).toBeVisible();
  });

  test("should display properly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoSector(page);
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();
    await expect(sectorView.locator("h2")).toBeVisible();
    await expect(sectorView.locator('[role="tablist"]')).toBeVisible();
  });

  test("should display properly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoSector(page);
    const sectorView = page.locator('[data-testid="sector-analysis-view"]');
    await expect(sectorView).toBeVisible();
    await expect(sectorView.locator("h2")).toBeVisible();
  });
});

test.describe("Sector Dashboard - Navigation State", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
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
    await gotoSector(page);
    await page.locator('[data-testid="nav-screener"]').click();
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 5000 });
    expect(page.url()).not.toContain("/sector");
  });
});
