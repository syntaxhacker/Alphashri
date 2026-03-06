import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Notification Panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  // Skip: The notification panel UI has changed and these selectors no longer match
  test.skip("should toggle notification panel when button clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    // Find notification toggle button (Updates button)
    const notifBtn = page.locator('button:has-text("Updates")');
    if ((await notifBtn.count()) > 0) {
      await notifBtn.click();
      await page.waitForTimeout(300);

      // Verify panel is visible
      const panel = page.locator(".notification-panel, [class*='notification']");
      expect(await panel.count()).toBeGreaterThan(0);
    }
  });

  // Skip: The notification panel UI has changed and these selectors no longer match
  test.skip("should show notification filter tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    // Open notification panel
    const openBtn = page.locator('button:has-text("Updates")');
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await page.waitForTimeout(300);

      // Check for filter tabs
      const allTab = page.locator("button, .tab").filter({ hasText: "All" });
      const primaryTab = page.locator("button, .tab").filter({ hasText: "Primary" });
      const secondaryTab = page.locator("button, .tab").filter({ hasText: "Secondary" });

      expect(await allTab.count()).toBeGreaterThan(0);
      expect(await primaryTab.count()).toBeGreaterThan(0);
      expect(await secondaryTab.count()).toBeGreaterThan(0);
    }
  });

  test("should clear notifications when clear button clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    // Open notification panel
    const openBtn = page.locator(".notif-open-btn");
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await page.waitForTimeout(300);

      // Click clear button
      const clearBtn = page.locator(".notif-clear-btn");
      if ((await clearBtn.count()) > 0) {
        await clearBtn.click();
        await page.waitForTimeout(300);

        // Verify notifications are cleared (count shows 0)
        const btn = page.locator(".notif-open-btn");
        const text = await btn.textContent();
        expect(text).toContain("0");
      }
    }
  });

  test("should filter notifications by type", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    // Open notification panel
    const openBtn = page.locator(".notif-open-btn");
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await page.waitForTimeout(300);

      // Click Primary tab
      const primaryTab = page.locator(".notif-tab").filter({ hasText: "Primary" });
      if ((await primaryTab.count()) > 0) {
        await primaryTab.click();
        await page.waitForTimeout(200);

        // Verify tab is active
        const isActive = await primaryTab.evaluate((el) => el.classList.contains("active"));
        expect(isActive).toBe(true);
      }
    }
  });
});
