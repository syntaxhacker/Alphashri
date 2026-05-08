import { test, expect } from "@playwright/test";
import {
  setupStrategiesEmptyMocks,
  setupStrategiesErrorMocks,
} from "../mocks/apiResponses";
import {
  setupStrategiesTest,
  gotoStrategies,
  switchToStrategiesTab,
  openCreateFromTemplate,
  openEditTemplateFromTree,
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
    test("strategies-nav-tabs visible, default Strategy Tree tab active", async ({ page }) => {
      await gotoStrategies(page);
      await expect(page.getByTestId("strategies-nav-tabs")).toBeVisible();
      const treeTab = page.getByTestId("strategies-nav-tabs").locator('input[value="tree"]');
      await expect(treeTab).toBeChecked();
    });

    test("click Performance tab -> performance-view visible", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "Performance");
      await expect(page.getByTestId("performance-view")).toBeVisible();
    });

    test("click back Strategy Tree -> template-tree-panel visible", async ({ page }) => {
      await gotoStrategies(page);
      await switchToStrategiesTab(page, "Performance");
      await expect(page.getByTestId("performance-view")).toBeVisible();
      await switchToStrategiesTab(page, "Strategy Tree");
      await expect(page.getByTestId("template-tree-panel")).toBeVisible();
    });
  });

  test.describe("Tree View", () => {
    test("@smoke template-tree-panel visible with tree nodes", async ({ page }) => {
      await gotoStrategies(page);
      await expect(page.getByTestId("template-tree-panel")).toBeVisible();
    });

    test("empty state with setupStrategiesEmptyMocks -> template-tree-empty visible", async ({
      page,
    }) => {
      await setupStrategiesEmptyMocks(page);
      await gotoStrategies(page);
      await expect(page.getByTestId("template-tree-empty")).toBeVisible();
    });
  });

  test.describe("Create Strategy", () => {
    test("click create-from-template (plus icon) -> modal visible", async ({ page }) => {
      await gotoStrategies(page);
      await openCreateFromTemplate(page);
    });

    test("strategy-form-modal has strategy-name-input and strategy-type-input", async ({
      page,
    }) => {
      await gotoStrategies(page);
      await openCreateFromTemplate(page);
      await expect(page.getByTestId("strategy-name-input")).toBeVisible();
      await expect(page.getByTestId("strategy-type-input")).toBeVisible();
    });

    test("strategy-form-tabs has strategy-tab-orb, strategy-tab-risk, strategy-tab-runner", async ({
      page,
    }) => {
      await gotoStrategies(page);
      await openCreateFromTemplate(page);
      await expect(page.getByTestId("strategy-form-tabs")).toBeVisible();
      await expect(page.getByTestId("strategy-tab-orb")).toBeVisible();
      await expect(page.getByTestId("strategy-tab-risk")).toBeVisible();
      await expect(page.getByTestId("strategy-tab-runner")).toBeVisible();
    });

    test("click strategy-tab-risk -> strategy-panel-risk visible", async ({ page }) => {
      await gotoStrategies(page);
      await openCreateFromTemplate(page);
      await page.getByTestId("strategy-tab-risk").click();
      await expect(page.getByTestId("strategy-panel-risk")).toBeVisible();
    });

    test("fill name Test Strategy, click strategy-cancel-btn -> modal closes", async ({ page }) => {
      await gotoStrategies(page);
      await openCreateFromTemplate(page);
      await page.getByTestId("strategy-name-input").fill("Test Strategy");
      await page.getByTestId("strategy-cancel-btn").click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });
  });

  test.describe("Edit Strategy", () => {
    test("click edit template (pencil icon) -> modal visible", async ({ page }) => {
      await gotoStrategies(page);
      await openEditTemplateFromTree(page);
    });

    test("strategy-name-input pre-filled, click submit-strategy-btn", async ({ page }) => {
      await gotoStrategies(page);
      await openEditTemplateFromTree(page);
      const nameInput = page.getByTestId("strategy-name-input");
      await expect(nameInput).toBeVisible();
      expect(await nameInput.inputValue()).toBeTruthy();
      await page.getByTestId("submit-strategy-btn").click();
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
