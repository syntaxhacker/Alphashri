import { defineConfig, devices } from '@playwright/test';

/**
 * Evidence-only Playwright config. Functional CI keeps the default config and
 * all of its assertions; this run is optimized for capture throughput.
 *
 * - parallel workers (override with EVIDENCE_WORKERS)
 * - no trace/video/screenshot artifacts (we write the evidence PNGs ourselves)
 * - deterministic, non-fail-fast capture (EVIDENCE_MAX_FAILURES)
 * - reuses a local dev server when one is already running
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  workers: Number(process.env.EVIDENCE_WORKERS ?? 4),
  reporter: [['line']],
  // No cap by default: a failed capture must not stop later states from
  // being written. Set EVIDENCE_MAX_FAILURES to fail faster deliberately.
  maxFailures: process.env.EVIDENCE_MAX_FAILURES
    ? Number(process.env.EVIDENCE_MAX_FAILURES)
    : undefined,
  timeout: 60000,
  expect: { timeout: 20000 },
  use: {
    baseURL: process.env.EVIDENCE_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 5173',
    url: process.env.EVIDENCE_BASE_URL ?? 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
