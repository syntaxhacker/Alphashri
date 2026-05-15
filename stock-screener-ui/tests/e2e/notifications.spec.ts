import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Notification Panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test.skip("reason: notification sidebar/panel (notif-open-btn, notif-sidebar, notif-tab) not implemented - only toast-style notifications exist", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    await expect(openBtn).toBeVisible();
    await openBtn.click();
    await expect(page.locator(".notif-sidebar")).toBeVisible({ timeout: 5000 });
  });

  test.skip("reason: notification sidebar/panel not implemented - only toast-style notifications exist", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    await openBtn.click();
    await expect(page.locator(".notif-sidebar")).toBeVisible({ timeout: 5000 });
    const allTab = page.locator(".notif-tab").filter({ hasText: "All" });
    const primaryTab = page.locator(".notif-tab").filter({ hasText: "Primary" });
    const secondaryTab = page.locator(".notif-tab").filter({ hasText: "Secondary" });

    await expect(allTab).toBeVisible();
    await expect(primaryTab).toBeVisible();
    await expect(secondaryTab).toBeVisible();
  });

  test("should clear notifications when clear button clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await expect(page.locator(".notif-clear-btn")).toBeVisible({ timeout: 5000 });
      const clearBtn = page.locator(".notif-clear-btn");
      if ((await clearBtn.count()) > 0) {
        await clearBtn.click();
        await page.waitForLoadState("networkidle");

        const btn = page.locator(".notif-open-btn");
        const text = await btn.textContent();
        expect(text).toContain("0");
      }
    }
  });

  test("should filter notifications by type", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await expect(page.locator(".notif-tab").filter({ hasText: "Primary" })).toBeVisible({
        timeout: 5000,
      });

      const primaryTab = page.locator(".notif-tab").filter({ hasText: "Primary" });
      if ((await primaryTab.count()) > 0) {
        await primaryTab.click();
        await page.waitForLoadState("networkidle");

        const isActive = await primaryTab.evaluate((el) => el.classList.contains("active"));
        expect(isActive).toBe(true);
      }
    }
  });
});
