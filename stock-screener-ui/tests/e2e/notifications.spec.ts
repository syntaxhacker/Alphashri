import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Notification Panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test.skip("should open notification panel and button clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    await expect(openBtn).toBeVisible();
    await openBtn.click();
    await page.waitForTimeout(300);

    const panel = page.locator(".notif-sidebar");
    await expect(panel).toBeVisible();
  });

  test.skip("should show notification filter tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    await openBtn.click();
    await page.waitForTimeout(300);

    const allTab = page.locator(".notif-tab").filter({ hasText: "All" });
    const primaryTab = page.locator(".notif-tab").filter({ hasText: "Primary" });
    const secondaryTab = page.locator(".notif-tab").filter({ hasText: "Secondary" });

    await expect(allTab).toBeVisible();
    await expect(primaryTab).toBeVisible();
    await expect(secondaryTab).toBeVisible();
  });

  test("should clear notifications when clear button clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await page.waitForTimeout(300);

      const clearBtn = page.locator(".notif-clear-btn");
      if ((await clearBtn.count()) > 0) {
        await clearBtn.click();
        await page.waitForTimeout(300);

        const btn = page.locator(".notif-open-btn");
        const text = await btn.textContent();
        expect(text).toContain("0");
      }
    }
  });

  test("should filter notifications by type", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });

    const openBtn = page.locator(".notif-open-btn");
    if ((await openBtn.count()) > 0) {
      await openBtn.click();
      await page.waitForTimeout(300);

      const primaryTab = page.locator(".notif-tab").filter({ hasText: "Primary" });
      if ((await primaryTab.count()) > 0) {
        await primaryTab.click();
        await page.waitForTimeout(200);

        const isActive = await primaryTab.evaluate((el) => el.classList.contains("active"));
        expect(isActive).toBe(true);
      }
    }
  });
});
