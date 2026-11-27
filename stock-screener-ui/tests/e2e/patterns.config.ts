import { defineConfig, devices } from "@playwright/test";

/**
 * Patterns E2E config with an overridable base URL: the shared dev server has
 * moved ports during parallel agent work, and the spec should not depend on a
 * hardcoded 5173 when verifying a layout fix.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,
  reporter: "list",
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.PATTERNS_BASE_URL ?? "http://localhost:5173",
    headless: process.env.HEADLESS !== "false",
    actionTimeout: 10000,
    navigationTimeout: 30000,
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
