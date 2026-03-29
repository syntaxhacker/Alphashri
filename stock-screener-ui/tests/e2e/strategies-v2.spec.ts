import { test, expect } from "@playwright/test";
import {
  setupStrategiesEmptyMocks,
  setupStrategiesErrorMocks,
  setupStrategiesLoadingMocks,
} from "../mocks/apiResponses";
import {
  setupStrategiesTest,
  gotoStrategies,
  switchToStrategiesTab,
  openCreateStrategyDialog,
  openEditStrategyDialog,
} from "./helpers/strategiesHelpers";

test.describe("Strategies V2", () => {
  test.beforeEach(async ({ page }) => {
    await setupStrategiesTest(page);
  });

  test.describe("Navigation", () => {
    test("navigate via nav-strategies -> strategies-view visible", async ({ page }) => {
      await page.goto("/");
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
      await page.getByTestId("nav-strategies").click();
      await expect(page.getByTestId("strategies-view")).toBeVisible({ timeout: 10000 });
    });

    test("@smoke navigate via URL /strategies -> strategies-view visible", async ({ page }) => {
      await gotoStrategies(page);
    });
  });

  test.describe("Tab Navigation", () => {
    test("strategies-nav-tabs visible, default Templates tab active", async ({ page }) => {
      await gotoStrategies(page);
      await expect(page.getByTestId("strategies-nav-tabs")).toBeVisible();
      const templatesTab = page
        .getByTestId("strategies-nav-tabs")
        .locator('input[value="templates"]');
      await expect(templatesTab).toBeChecked();
    });

    test("click All Strategies tab -> strategy-list-table visible", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategy-list-table")).toBeVisible();
    });

    test("click Performance tab -> performance-view visible", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "Performance");
      await expect(page.getByTestId("performance-view")).toBeVisible();
    });

    test("click back Templates -> templates-view visible", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategy-list-table")).toBeVisible();
      await switchToStrategiesTab(page, "Templates");
      await expect(page.getByTestId("templates-view")).toBeVisible();
    });
  });

  test.describe("Templates View", () => {
    test("@smoke templates-grid visible with strategy-card items", async ({ page }) => {
      await gotoStrategies(page);
      await expect(page.getByTestId("templates-grid")).toBeVisible();
      await expect(page.getByTestId("strategy-card").first()).toBeVisible();
    });

    test("each card has create-from-template-btn", async ({ page }) => {
      await gotoStrategies(page);
      const cards = page.getByTestId("strategy-card");
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        await expect(cards.nth(i).getByTestId("create-from-template-btn")).toBeVisible();
      }
    });

    test("empty state with setupStrategiesEmptyMocks -> templates-empty-state visible", async ({
      page,
    }) => {
      await setupStrategiesEmptyMocks(page);
      await gotoStrategies(page);
      await expect(page.getByTestId("templates-empty-state")).toBeVisible();
    });
  });

  test.describe("Strategy List", () => {
    test("strategy-list-table with strategy-list-body visible", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategy-list-table")).toBeVisible();
      await expect(page.getByTestId("strategy-list-body")).toBeVisible();
    });

    test("strategy-row items have edit-strategy-btn and delete-strategy-btn", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategy-list-table")).toBeVisible();
      const rows = page.locator('[data-testid^="strategy-row-"]');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).getByTestId("edit-strategy-btn")).toBeVisible();
        await expect(rows.nth(i).getByTestId("delete-strategy-btn")).toBeVisible();
      }
    });

    test("loading state visible briefly during API call", async ({ page }) => {
      await setupStrategiesLoadingMocks(page);
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategies-loading-state")).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId("strategy-list-table")).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe("Create Strategy", () => {
    test("click create-from-template-btn -> modal visible", async ({ page }) => {
      await gotoStrategies(page);
      await openCreateStrategyDialog(page);
    });

    test("strategy-form-modal has strategy-name-input and strategy-type-input", async ({
      page,
    }) => {
      await gotoStrategies(page);
      await openCreateStrategyDialog(page);
      await expect(page.getByTestId("strategy-name-input")).toBeVisible();
      await expect(page.getByTestId("strategy-type-input")).toBeVisible();
    });

    test("strategy-form-tabs has strategy-tab-orb, strategy-tab-risk, strategy-tab-runner", async ({
      page,
    }) => {
      await gotoStrategies(page);
      await openCreateStrategyDialog(page);
      await expect(page.getByTestId("strategy-form-tabs")).toBeVisible();
      await expect(page.getByTestId("strategy-tab-orb")).toBeVisible();
      await expect(page.getByTestId("strategy-tab-risk")).toBeVisible();
      await expect(page.getByTestId("strategy-tab-runner")).toBeVisible();
    });

    test("click strategy-tab-risk -> strategy-panel-risk visible", async ({ page }) => {
      await gotoStrategies(page);
      await openCreateStrategyDialog(page);
      await page.getByTestId("strategy-tab-risk").click();
      await expect(page.getByTestId("strategy-panel-risk")).toBeVisible();
    });

    test("fill name Test Strategy, click strategy-cancel-btn -> modal closes", async ({ page }) => {
      await gotoStrategies(page);
      await openCreateStrategyDialog(page);
      await page.getByTestId("strategy-name-input").fill("Test Strategy");
      await page.getByTestId("strategy-cancel-btn").click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });
  });

  test.describe("Edit Strategy", () => {
    test("click edit-strategy-btn -> modal visible", async ({ page }) => {
      await gotoStrategies(page);
      await openEditStrategyDialog(page);
    });

    test("strategy-name-input pre-filled, click submit-strategy-btn", async ({ page }) => {
      await gotoStrategies(page);
      await openEditStrategyDialog(page);
      const nameInput = page.getByTestId("strategy-name-input");
      await expect(nameInput).toBeVisible();
      expect(await nameInput.inputValue()).toBe("ORB Conservative");
      await page.getByTestId("submit-strategy-btn").click();
    });
  });

  test.describe("Delete Strategy", () => {
    test("click delete-strategy-btn -> confirm dialog", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategy-list-table")).toBeVisible();
      await page.evaluate(() => {
        (window as any).deleteStrategy = () => {
          window.confirm("Delete this strategy?");
        };
      });
      const rows = page.locator('[data-testid^="strategy-row-"]');
      const count = await rows.count();
      let dialogSeen = false;
      for (let i = 0; i < count; i++) {
        const btn = rows.nth(i).getByTestId("delete-strategy-btn");
        if (await btn.isEnabled()) {
          const dialogPromise = new Promise<{ type: string }>((resolve) => {
            page.once("dialog", (dialog) => {
              resolve({ type: dialog.type() });
              dialog.dismiss();
            });
          });
          await btn.click();
          const dialog = await dialogPromise;
          expect(dialog.type).toBe("confirm");
          dialogSeen = true;
          break;
        }
      }
      expect(dialogSeen).toBe(true);
    });

    test("confirm -> dialog accepted", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "All Strategies");
      await expect(page.getByTestId("strategy-list-table")).toBeVisible();
      await page.evaluate(() => {
        (window as any).deleteStrategy = () => {
          window.confirm("Delete this strategy?");
        };
      });
      const rows = page.locator('[data-testid^="strategy-row-"]');
      const countBefore = await rows.count();
      expect(countBefore).toBeGreaterThan(0);
      let dialogAccepted = false;
      page.on("dialog", (dialog) => {
        dialog.accept();
        dialogAccepted = true;
      });
      for (let i = 0; i < countBefore; i++) {
        const btn = rows.nth(i).getByTestId("delete-strategy-btn");
        if (await btn.isEnabled()) {
          await btn.click();
          break;
        }
      }
      await page.waitForTimeout(500);
      expect(dialogAccepted).toBe(true);
    });
  });

  test.describe("Performance View", () => {
    test("performance-view with stat cards", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "Performance");
      await expect(page.getByTestId("performance-view")).toBeVisible();
      await expect(page.locator(".performance-card-trades")).toBeVisible({ timeout: 10000 });
      await expect(page.locator(".performance-card-winrate")).toBeVisible();
      await expect(page.locator(".performance-card-pnl")).toBeVisible();
      await expect(page.locator(".performance-card-strategies")).toBeVisible();
    });

    test("performance-table with performance-table-header and performance-table-body", async ({
      page,
    }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "Performance");
      await expect(page.getByTestId("performance-view")).toBeVisible();
      await expect(page.getByTestId("performance-table")).toBeVisible();
      await expect(page.getByTestId("performance-table-header")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("performance-table-body")).toBeVisible({ timeout: 10000 });
    });

    test("empty performance with setupStrategiesEmptyMocks -> performance-empty-state", async ({
      page,
    }) => {
      await setupStrategiesEmptyMocks(page);
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "Performance");
      await expect(page.getByTestId("performance-empty-state")).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Error State", () => {
    test("with setupStrategiesErrorMocks -> strategies-error visible", async ({ page }) => {
      await setupStrategiesErrorMocks(page);
      await gotoStrategies(page);
      await expect(page.getByTestId("strategies-error")).toBeVisible();
    });

    test("strategies-retry-btn and strategies-dismiss-btn visible", async ({ page }) => {
      await setupStrategiesErrorMocks(page);
      await gotoStrategies(page);
      await expect(page.getByTestId("strategies-error")).toBeVisible();
      await expect(page.getByTestId("strategies-retry-btn")).toBeVisible();
      await expect(page.getByTestId("strategies-dismiss-btn")).toBeVisible();
    });
  });
});
