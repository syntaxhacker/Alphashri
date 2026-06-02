import { chromium, FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { apiRoute } from "./tests/mocks/routeHelper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testUser = {
  id: 1,
  email: "test@alphashri.dev",
  display_name: "TestUser",
  initial_capital: 1000000,
  created_at: "2026-01-01T00:00:00",
};

async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.route(apiRoute("auth/me"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testUser),
    });
  });

  await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });

  await page.evaluate(() => {
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

  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 }).catch(() => {
    // Storage state is optional; auth E2E tests manage their own session.
  });

  const storageState = await page.context().storageState();

  const authDir = path.join(__dirname, "tests", ".auth");
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const storageStatePath = path.join(authDir, "user.json");
  fs.writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));

  await browser.close();
}

export default globalSetup;
