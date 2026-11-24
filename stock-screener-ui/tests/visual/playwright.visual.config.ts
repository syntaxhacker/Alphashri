import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Standalone config on purpose: the default playwright.config.ts targets the
// running Vite app (tests/e2e, localhost:5173). This one only targets the
// checked-in static Storybook build, so it can never silently fall back to a
// dev server or to the app routes.
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STATIC_DIR = join(PROJECT_ROOT, "storybook-static");
const SCREENSHOTS_DIR = join(PROJECT_ROOT, "tests", "visual", "__screenshots__");
const PORT = 6133;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Default is "none": a missing baseline must fail the gate, never be written
// on the fly. Only UPDATE_SNAPSHOTS=1 flips this to "all".
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  outputDir: join(PROJECT_ROOT, "test-results", "visual"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  updateSnapshots: UPDATE ? "all" : "none",
  snapshotDir: SCREENSHOTS_DIR,
  snapshotPathTemplate: "{snapshotDir}/{arg}-{projectName}.png",
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off",
    headless: true,
  },
  // Own static server, started and torn down by Playwright for this run only.
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 -d "${STATIC_DIR}"`,
    url: `${BASE_URL}/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    {
      name: "desktop-1600",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
    {
      name: "mobile-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
