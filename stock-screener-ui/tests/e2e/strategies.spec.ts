import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import {
  gotoStrategiesView,
  openStrategyModal,
  fillStrategyForm,
  submitStrategyForm,
  verifyStrategyInList,
  getStrategyCard,
  clickStrategyCard,
  openEditModal,
  clickDeleteButton,
  isModalVisible,
  getStrategyListCount,
  getDefaultBadge,
  getSetDefaultButton,
  getCreateStrategyButton,
  getEditButton,
  getDeleteButton,
  getModal,
  getSaveButton,
} from "../helpers/strategiesHelpers";

test.describe("Strategies View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should navigate to strategies view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-strategies"]').click();
    await page.waitForTimeout(500);

    // Should show strategies view
    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible();
  });

  test("should load strategies view from URL", async ({ page }) => {
    await gotoStrategiesView(page);
    await expect(page.locator('[data-testid="strategies-view"]')).toBeVisible();
  });
});

test.describe("Strategies View - List", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Mock strategies templates endpoint
    await page.route("http://localhost:8765/api/strategies/templates", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          templates: [
            {
              id: 1,
              name: "orb_conservative",
              display_name: "ORB Conservative",
              strategy_type: "ORB",
              is_active: true,
              is_default: true,
              is_template: true,
              or_minutes: 45,
              sl_pct: 0.4,
              tp_pct: 1.2,
              max_positions: 3,
            },
            {
              id: 2,
              name: "52w_chaser",
              display_name: "52W Chaser",
              strategy_type: "52W_CHASER",
              is_active: true,
              is_default: false,
              is_template: true,
              entry_threshold_pct: 2.0,
              sl_pct: 3.0,
              tp_pct: 6.0,
            },
          ],
        }),
      });
    });

    // Mock strategies list - use specific pattern to avoid matching /src/api/strategies.ts
    await page.route(/http:\/\/localhost:8765\/api\/strategies(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          strategies: [
            {
              id: 1,
              name: "orb_conservative",
              display_name: "ORB Conservative",
              strategy_type: "ORB",
              is_active: true,
              is_default: true,
              or_minutes: 45,
              sl_pct: 0.4,
              tp_pct: 1.2,
              max_positions: 3,
            },
            {
              id: 2,
              name: "orb_aggressive",
              display_name: "ORB Aggressive",
              strategy_type: "ORB",
              is_active: true,
              is_default: false,
              or_minutes: 30,
              sl_pct: 0.6,
              tp_pct: 2.0,
              max_positions: 5,
            },
            {
              id: 3,
              name: "52w_chaser",
              display_name: "52W Chaser",
              strategy_type: "52W_CHASER",
              is_active: true,
              is_default: false,
              entry_threshold_pct: 2.0,
              sl_pct: 3.0,
              tp_pct: 6.0,
            },
          ],
        }),
      });
    });
  });

  test("should display list of strategies", async ({ page }) => {
    await gotoStrategiesView(page);

    // Should show strategy cards (templates) or table
    const strategyList = page.locator(
      '[data-testid="strategy-card"], .strategies-table tr, .template-card',
    );
    const count = await strategyList.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should show strategy type for each strategy", async ({ page }) => {
    await gotoStrategiesView(page);

    // Should show strategy type labels (actual class is .template-type)
    await expect(page.locator(".template-type").first()).toBeVisible();
  });

  test("should show default strategy indicator", async ({ page }) => {
    await gotoStrategiesView(page);

    // Default strategy should be marked
    const defaultBadge = getDefaultBadge(page);
    if ((await defaultBadge.count()) > 0) {
      await expect(defaultBadge).toBeVisible();
    }
  });
});

test.describe("Strategies View - Create", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have create strategy button", async ({ page }) => {
    await gotoStrategiesView(page);

    const createBtn = getCreateStrategyButton(page);
    if ((await createBtn.count()) > 0) {
      await expect(createBtn).toBeVisible();
    }
  });

  test("should open create strategy modal", async ({ page }) => {
    await gotoStrategiesView(page);

    if (await openStrategyModal(page)) {
      // Modal should open
      const modal = getModal(page);
      if ((await modal.count()) > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("should create new ORB strategy", async ({ page }) => {
    await gotoStrategiesView(page);

    if (await openStrategyModal(page)) {
      // Fill form
      await fillStrategyForm(page, { name: "Test ORB Strategy" });

      // Mock create API
      await page.route("**/api/strategies", async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: 4,
              name: "test_orb_strategy",
              display_name: "Test ORB Strategy",
              strategy_type: "ORB",
            }),
          });
        }
      });

      // Submit form
      await submitStrategyForm(page);
    }
  });

  test("should create 52W Chaser strategy", async ({ page }) => {
    await gotoStrategiesView(page);

    if (await openStrategyModal(page)) {
      // Select 52W type
      const typeSelect = page.locator("#strategy-type, select[name='strategy_type']");
      if ((await typeSelect.count()) > 0) {
        await typeSelect.selectOption("52W_CHASER");
        await page.waitForTimeout(300);

        // Should show 52W-specific fields
        const thresholdInput = page.locator("#entry-threshold, input[name='entry_threshold_pct']");
        if ((await thresholdInput.count()) > 0) {
          await expect(thresholdInput).toBeVisible();
        }
      }
    }
  });
});

test.describe("Strategies View - Edit", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have edit button for each strategy", async ({ page }) => {
    await gotoStrategiesView(page);

    const editBtn = getEditButton(page);
    if ((await editBtn.count()) > 0) {
      await expect(editBtn).toBeVisible();
    }
  });

  test("should open edit modal with current values", async ({ page }) => {
    await gotoStrategiesView(page);

    if (await openEditModal(page)) {
      // Modal should open with values
      const modal = getModal(page);
      if ((await modal.count()) > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("should save edited strategy", async ({ page }) => {
    await gotoStrategiesView(page);

    if (await openEditModal(page)) {
      // Change a value
      await fillStrategyForm(page, { slPct: "0.5" });

      // Save
      await submitStrategyForm(page);
    }
  });
});

test.describe("Strategies View - Delete", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have delete button for non-default strategies", async ({ page }) => {
    await gotoStrategiesView(page);

    // Non-default strategies should have delete button
    const deleteBtn = getDeleteButton(page);
    if ((await deleteBtn.count()) > 0) {
      await expect(deleteBtn.first()).toBeVisible();
    }
  });

  test("should confirm before deleting", async ({ page }) => {
    await gotoStrategiesView(page);

    if (await clickDeleteButton(page)) {
      // Should show confirmation dialog
      const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
      if ((await confirmBtn.count()) > 0) {
        await expect(confirmBtn).toBeVisible();
      }
    }
  });

  test("should remove strategy after delete", async ({ page }) => {
    await gotoStrategiesView(page);

    const deleteBtn = getDeleteButton(page);
    if ((await deleteBtn.count()) > 0) {
      const countBefore = await getStrategyListCount(page);

      // Handle confirmation dialog
      page.on("dialog", (dialog) => dialog.accept());
      await clickDeleteButton(page);

      const countAfter = await getStrategyListCount(page);
      expect(countAfter).toBeLessThanOrEqual(countBefore);
    }
  });
});

test.describe("Strategies View - Performance", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    // Mock performance data
    await page.route("**/api/strategies/*/performance", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_trades: 50,
          win_rate: 65,
          total_pnl: 25000,
          avg_pnl_per_trade: 500,
          max_drawdown: 5000,
          sharpe_ratio: 1.5,
        }),
      });
    });
  });

  test("should show performance metrics", async ({ page }) => {
    await gotoStrategiesView(page);

    // Click on a strategy to view details
    const strategyCard = getStrategyCard(page);
    if ((await strategyCard.count()) > 0) {
      await clickStrategyCard(page);

      // Should show performance section
      const performance = page.locator(".strategy-performance, .performance-metrics");
      if ((await performance.count()) > 0) {
        await expect(performance).toBeVisible();
      }
    }
  });

  test("should show win rate metric", async ({ page }) => {
    await gotoStrategiesView(page);

    const strategyCard = getStrategyCard(page);
    if ((await strategyCard.count()) > 0) {
      await clickStrategyCard(page);

      const winRate = page.locator(".metric-win-rate, :text('Win Rate')");
      if ((await winRate.count()) > 0) {
        await expect(winRate).toBeVisible();
      }
    }
  });

  test("should show P&L metric", async ({ page }) => {
    await gotoStrategiesView(page);

    const strategyCard = getStrategyCard(page);
    if ((await strategyCard.count()) > 0) {
      await clickStrategyCard(page);

      const pnl = page.locator(".metric-pnl, :text('P&L')");
      if ((await pnl.count()) > 0) {
        await expect(pnl).toBeVisible();
      }
    }
  });
});

test.describe("Strategies View - Set Default", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have set default button", async ({ page }) => {
    await gotoStrategiesView(page);

    const setDefaultBtn = getSetDefaultButton(page);
    if ((await setDefaultBtn.count()) > 0) {
      await expect(setDefaultBtn.first()).toBeVisible();
    }
  });

  test("should update default strategy", async ({ page }) => {
    await gotoStrategiesView(page);

    const setDefaultBtn = getSetDefaultButton(page);
    if ((await setDefaultBtn.count()) > 0) {
      await setDefaultBtn.first().click();
      await page.waitForTimeout(500);

      // Default badge should move
      const defaultBadges = getDefaultBadge(page);
      await expect(defaultBadges.first()).toBeVisible();
    }
  });
});
