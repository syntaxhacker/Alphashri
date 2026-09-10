import { defineConfig, devices } from '@playwright/test';

// Use headless mode by default, set HEADLESS=false to run headed
const headless = process.env.HEADLESS !== 'false';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 6,
  reporter: process.env.CI ? [['blob'], ['list']] : 'list',
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  maxFailures: process.env.CI ? 10 : undefined,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
    headless,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
