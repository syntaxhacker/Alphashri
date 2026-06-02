import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, testUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

async function clearAuthStorage(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("alphashri_token");
    localStorage.removeItem("alphashri_refresh_token");
    localStorage.removeItem("alphashri_user");
  });
}

async function gotoLoginPage(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible({ timeout: 10000 });
}

async function openUserMenu(page: Page) {
  const trigger = page.locator('[data-testid="user-menu-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();
  await expect(page.locator('[data-testid="logout-button"]')).toBeVisible({ timeout: 5000 });
}

test.describe("Authentication - Login", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthStorage(page);
    await setupApiMocks(page);
  });

  test("@smoke should show login form when not authenticated", async ({ page }) => {
    await gotoLoginPage(page);
    await expect(page.locator('[data-testid="login-email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-submit-btn"]')).toBeVisible();
  });

  test("should show register link on login form", async ({ page }) => {
    await gotoLoginPage(page);
    await expect(page.locator('[data-testid="register-link"]')).toBeVisible();
  });

  test("@smoke should login successfully with valid credentials", async ({ page }) => {
    await page.route(apiRoute("auth/login"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "test_access_token_12345",
          refresh_token: "test_refresh_token_12345",
          token_type: "bearer",
          expires_in: 86400,
        }),
      });
    });

    await page.route(apiRoute("auth/me"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testUser),
      });
    });

    await gotoLoginPage(page);

    await page.locator('[data-testid="login-email-input"]').fill("test@alphashri.dev");
    await page.locator('[data-testid="login-password-input"]').fill("password123");
    await page.locator('[data-testid="login-submit-btn"]').click();

    // Should navigate to main app - wait for sidemenu to appear
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show error message with invalid credentials", async ({ page }) => {
    await page.route(apiRoute("auth/login"), async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid credentials" }),
      });
    });

    await gotoLoginPage(page);

    await page.locator('[data-testid="login-email-input"]').fill("wrong@example.com");
    await page.locator('[data-testid="login-password-input"]').fill("wrongpassword");
    await page.locator('[data-testid="login-submit-btn"]').click();

    // Should show error message using data-testid
    await expect(page.locator('[data-testid="auth-error"]')).toBeVisible({ timeout: 5000 });
  });

  test("should validate email format", async ({ page }) => {
    await gotoLoginPage(page);

    // Enter invalid email
    await page.locator('[data-testid="login-email-input"]').fill("invalid-email");
    await page.locator('[data-testid="login-password-input"]').fill("password123");

    await page.locator('[data-testid="login-submit-btn"]').click();

    const emailInput = page.locator('[data-testid="login-email-input"]');
    await expect(emailInput).toBeVisible();
    expect(
      await emailInput.evaluate((el) => {
        const input = el.querySelector("input") ?? el;
        return (input as HTMLInputElement).validity.valid;
      }),
    ).toBe(false);
  });

  test("should require password field", async ({ page }) => {
    await gotoLoginPage(page);

    // Enter only email
    await page.locator('[data-testid="login-email-input"]').fill("test@example.com");
    // Leave password empty

    // Click login
    await page.locator('[data-testid="login-submit-btn"]').click();

    const passwordInput = page.locator('[data-testid="login-password-input"]');
    await expect(passwordInput).toBeVisible();
    expect(
      await passwordInput.evaluate((el) => {
        const input = el.querySelector("input") ?? el;
        return (input as HTMLInputElement).validity.valid;
      }),
    ).toBe(false);
  });
});

test.describe("Authentication - Register", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthStorage(page);
    await setupApiMocks(page);
  });

  test("should switch to register form", async ({ page }) => {
    await gotoLoginPage(page);

    // Click register link using data-testid
    await page.locator('[data-testid="register-link"]').click();

    // Should show register form using data-testid
    await expect(page.locator('[data-testid="register-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-name-input"]')).toBeVisible();
  });

  test("should register new user successfully", async ({ page }) => {
    const newUser = {
      id: 2,
      email: "newuser@example.com",
      display_name: "New User",
      initial_capital: 1000000,
      created_at: new Date().toISOString(),
    };

    await page.route(apiRoute("auth/register"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "new_access_token",
          refresh_token: "new_refresh_token",
          token_type: "bearer",
        }),
      });
    });

    await page.route(apiRoute("auth/me"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(newUser),
      });
    });

    await gotoLoginPage(page);

    await page.locator('[data-testid="register-link"]').click();
    await expect(page.locator('[data-testid="register-form"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="register-email-input"]').fill("newuser@example.com");
    await page.locator('[data-testid="register-password-input"]').fill("newpassword123");
    await page.locator('[data-testid="confirm-password-input"]').fill("newpassword123");
    await page.locator('[data-testid="display-name-input"]').fill("New User");
    await page.locator('[data-testid="register-button"]').click();

    // Should navigate to main app - wait for sidemenu to appear
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Authentication - Logout", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Set authenticated state
    await page.addInitScript(() => {
      localStorage.setItem("alphashri_token", "test_access_token_12345");
      localStorage.setItem("alphashri_refresh_token", "test_refresh_token_12345");
      localStorage.setItem(
        "alphashri_user",
        JSON.stringify({
          id: 1,
          email: "test@alphashri.dev",
          display_name: "TestUser",
          initial_capital: 1000000,
          created_at: "2026-01-01T00:00:00",
        }),
      );
    });

    await page.route(apiRoute("auth/me"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testUser),
      });
    });
  });

  test("should show user info in navbar footer", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Should show user info
    await expect(page.locator('[data-testid="user-menu-trigger"]')).toContainText("TestUser");
    await expect(page.locator('[data-testid="user-menu-trigger"]')).toContainText(
      "test@alphashri.dev",
    );
  });

  test("@smoke should logout when clicking sign out", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Mock logout endpoint
    await page.route(apiRoute("auth/logout"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Logged out" }),
      });
    });

    await openUserMenu(page);
    await page.locator('[data-testid="logout-button"]').click();

    // Should show login form using data-testid
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible({ timeout: 5000 });
  });

  test("should clear tokens on logout", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Click sign out
    await page.route(apiRoute("auth/logout"), async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    await openUserMenu(page);
    await page.locator('[data-testid="logout-button"]').click();
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible({ timeout: 5000 });
    const token = await page.evaluate(() => localStorage.getItem("alphashri_token"));
    expect(token).toBeNull();
  });
});

test.describe("Authentication - Session", () => {
  test("should persist session on page refresh", async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.setItem("alphashri_token", "test_access_token_12345");
      localStorage.setItem("alphashri_refresh_token", "test_refresh_token_12345");
      localStorage.setItem(
        "alphashri_user",
        JSON.stringify({
          id: 1,
          email: "test@alphashri.dev",
          display_name: "TestUser",
          initial_capital: 1000000,
          created_at: "2026-01-01T00:00:00",
        }),
      );
    });

    await page.route(apiRoute("auth/me"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testUser),
      });
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });

    // Refresh page
    await page.reload();

    // Should still be logged in
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test("should redirect to login when token expired", async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript(() => {
      localStorage.setItem("alphashri_token", "expired_token");
      localStorage.setItem("alphashri_refresh_token", "expired_refresh_token");
    });

    // Mock auth/me to return 401
    await page.route(apiRoute("auth/me"), async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Token expired" }),
      });
    });

    // Mock refresh token failure
    await page.route(apiRoute("auth/refresh"), async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Refresh token expired" }),
      });
    });

    await page.goto("/");

    await expect(page.locator('[data-testid="login-form"]')).toBeVisible({ timeout: 10000 });
  });
});
