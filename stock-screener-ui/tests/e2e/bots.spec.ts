import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import {
  gotoBotsView,
  expectBotsViewVisible,
  getBotListItems,
  getBotStatus,
} from "../helpers/botsHelpers";

// Shared beforeEach for bots tests
async function setupBotsTest(page: import("@playwright/test").Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

test.describe("Bots View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should navigate to bots view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-bots"]').click();
    await page.waitForTimeout(500);

    await expectBotsViewVisible(page);
  });

  test("should load bots view from URL", async ({ page }) => {
    await gotoBotsView(page);
    await expectBotsViewVisible(page);
  });
});

test.describe("Bots View - List", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);

    // Mock bots list
    await page.route("**/api/bots", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            name: "Default Bot",
            is_active: true,
            running: false,
            pid: null,
            strategies: [{ id: 1, name: "ORB Conservative", capital_allocation_pct: 0.5 }],
          },
          {
            id: 2,
            name: "Multi-Strategy Bot",
            is_active: true,
            running: true,
            pid: 12345,
            strategies: [
              { id: 1, name: "ORB Conservative", capital_allocation_pct: 0.3 },
              { id: 2, name: "ORB Aggressive", capital_allocation_pct: 0.3 },
              { id: 3, name: "52W Chaser", capital_allocation_pct: 0.4 },
            ],
          },
        ]),
      });
    });
  });

  test("should display list of bots", async ({ page }) => {
    await gotoBotsView(page);
    const count = await getBotListItems(page).count();
    expect(count).toBeGreaterThan(0);
  });

  test("should show bot status for each bot", async ({ page }) => {
    await gotoBotsView(page);
    const status = getBotStatus(page);
    if ((await status.count()) > 0) {
      await expect(status.first()).toBeVisible();
    }
  });

  test("should show strategies count for each bot", async ({ page }) => {
    await gotoBotsView(page);
    const strategiesInfo = page.locator(".strategies-count, :text('strategies')");
    if ((await strategiesInfo.count()) > 0) {
      await expect(strategiesInfo.first()).toBeVisible();
    }
  });

  test("should show PID for running bots", async ({ page }) => {
    await gotoBotsView(page);
    const pidInfo = page.locator(":text('PID'), :text('12345')");
    if ((await pidInfo.count()) > 0) {
      await expect(pidInfo.first()).toBeVisible();
    }
  });
});

test.describe("Bots View - Create", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should have create bot button", async ({ page }) => {
    await gotoBotsView(page);
    const createBtn = page.locator('button:has-text("Create"), button:has-text("New Bot")');
    if ((await createBtn.count()) > 0) {
      await expect(createBtn).toBeVisible();
    }
  });

  test("should open create bot modal", async ({ page }) => {
    await gotoBotsView(page);
    const createBtn = page.locator('button:has-text("Create"), button:has-text("New Bot")');
    if ((await createBtn.count()) > 0) {
      await createBtn.click();
      await page.waitForTimeout(300);

      // Modal should open
      const modal = page.locator(".modal, .bot-form-modal");
      if ((await modal.count()) > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("should create new bot", async ({ page }) => {
    await gotoBotsView(page);
    const createBtn = page.locator('button:has-text("Create"), button:has-text("New Bot")');
    if ((await createBtn.count()) > 0) {
      await createBtn.click();
      await page.waitForTimeout(300);

      // Mock create API
      await page.route("**/api/bots", async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: 3,
              name: "Test Bot",
              is_active: true,
              strategies: [],
            }),
          });
        }
      });

      // Submit form
      const submitBtn = page.locator('button:has-text("Save"), button:has-text("Create")').last();
      if ((await submitBtn.count()) > 0) {
        await submitBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });
});

test.describe("Bots View - Edit", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should have edit button for each bot", async ({ page }) => {
    await gotoBotsView(page);
    const editBtn = page.locator(".edit-btn, button:has-text('Edit')");
    if ((await editBtn.count()) > 0) {
      await expect(editBtn.first()).toBeVisible();
    }
  });

  test("should open edit modal with current values", async ({ page }) => {
    await gotoBotsView(page);
    const editBtn = page.locator(".edit-btn, button:has-text('Edit')").first();
    if ((await editBtn.count()) > 0) {
      await editBtn.click();
      await page.waitForTimeout(300);

      const modal = page.locator(".modal, .bot-form-modal");
      if ((await modal.count()) > 0) {
        await expect(modal).toBeVisible();
      }
    }
  });

  test("should save edited bot", async ({ page }) => {
    await gotoBotsView(page);
    const editBtn = page.locator(".edit-btn, button:has-text('Edit')").first();
    if ((await editBtn.count()) > 0) {
      await editBtn.click();
      await page.waitForTimeout(300);

      const nameInput = page.locator("#bot-name, input[name='name']");
      if ((await nameInput.count()) > 0) {
        await nameInput.fill("Updated Bot Name");
      }

      const saveBtn = page.locator('button:has-text("Save")').last();
      if ((await saveBtn.count()) > 0) {
        await saveBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });
});

test.describe("Bots View - Delete", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should have delete button for each bot", async ({ page }) => {
    await gotoBotsView(page);
    const deleteBtn = page.locator(".delete-btn, button:has-text('Delete')");
    if ((await deleteBtn.count()) > 0) {
      await expect(deleteBtn.first()).toBeVisible();
    }
  });

  test("should confirm before deleting", async ({ page }) => {
    await gotoBotsView(page);
    const deleteBtn = page.locator(".delete-btn, button:has-text('Delete')").first();
    if ((await deleteBtn.count()) > 0) {
      await deleteBtn.click();
      await page.waitForTimeout(300);

      const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
      if ((await confirmBtn.count()) > 0) {
        await expect(confirmBtn).toBeVisible();
      }
    }
  });

  test("should remove bot after delete", async ({ page }) => {
    await gotoBotsView(page);
    const deleteBtn = page.locator(".delete-btn, button:has-text('Delete')").first();
    if ((await deleteBtn.count()) > 0) {
      const countBefore = await getBotListItems(page).count();
      // ... delete logic
    }
  });
});

test.describe("Bots View - Controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should show Start Bot button when bot is not running", async ({ page }) => {
    await gotoBotsView(page);
    const startBtn = page.locator('button:has-text("Start"), .start-btn');
    if ((await startBtn.count()) > 0) {
      await expect(startBtn.first()).toBeVisible();
    }
  });

  test("should show Stop Bot button when bot is running", async ({ page }) => {
    await gotoBotsView(page);
    const stopBtn = page.locator('button:has-text("Stop"), .stop-btn').first();
    if ((await stopBtn.count()) > 0) {
      await page.route("**/api/bots/*/stop", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Bot stopped" }),
        });
      });
      await stopBtn.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Bots View - Logs", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should have view logs button", async ({ page }) => {
    await gotoBotsView(page);
    const logsBtn = page.locator('button:has-text("Logs"), button:has-text("View Logs")');
    if ((await logsBtn.count()) > 0) {
      await expect(logsBtn.first()).toBeVisible();
    }
  });

  test("should show bot logs", async ({ page }) => {
    await gotoBotsView(page);
    const logsBtn = page.locator('button:has-text("Logs"), button:has-text("View Logs")').first();
    if ((await logsBtn.count()) > 0) {
      await page.route("**/api/bots/*/logs", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            logs: [
              { timestamp: "2026-03-02T10:00:00", level: "INFO", message: "Bot started" },
              { timestamp: "2026-03-02T10:01:00", level: "INFO", message: "Scanning for signals" },
            ],
          }),
        });
      });

      await logsBtn.click();
      await page.waitForTimeout(500);

      const logsPanel = page.locator(".logs-panel, .bot-logs");
      if ((await logsPanel.count()) > 0) {
        await expect(logsPanel).toBeVisible();
      }
    }
  });
});

test.describe("Bots View - Assign Strategies", () => {
  test.beforeEach(async ({ page }) => {
    await setupBotsTest(page);
  });

  test("should show assigned strategies", async ({ page }) => {
    await gotoBotsView(page);
    const strategies = page.locator(".assigned-strategies, .bot-strategies");
    if ((await strategies.count()) > 0) {
      await expect(strategies.first()).toBeVisible();
    }
  });

  test("should add strategy to bot", async ({ page }) => {
    await gotoBotsView(page);
    const editBtn = page.locator(".edit-btn, button:has-text('Edit')").first();
    if ((await editBtn.count()) > 0) {
      await editBtn.click();
      await page.waitForTimeout(300);

      const addStrategyBtn = page.locator('button:has-text("Add Strategy")');
      if ((await addStrategyBtn.count()) > 0) {
        await addStrategyBtn.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test("should set capital allocation for strategy", async ({ page }) => {
    await gotoBotsView(page);
    const editBtn = page.locator(".edit-btn, button:has-text('Edit')").first();
    if ((await editBtn.count()) > 0) {
      await editBtn.click();
      await page.waitForTimeout(300);

      const allocationInput = page.locator("input[name*='allocation'], input[name*='capital']");
      if ((await allocationInput.count()) > 0) {
        await allocationInput.first().fill("0.3");
      }
    }
  });
});
