/**
 * Capture-only route evidence for the Patterns layout fix.
 *
 * Unlike `patterns-evidence.spec.ts` this file deliberately carries no layout
 * assertions: it exists so the same mocks and route can be photographed before
 * and after a change, including while an intermediate state fails a guard.
 */
import { test, expect } from "@playwright/test";
import { loginAsTestUser, setupApiMocks } from "../mocks/apiResponses";
import { setupHomePatternMocks } from "../mocks/homeDeskFixtures";
import { PATTERNS_EVIDENCE_PATH, setupPatternEvidenceMocks } from "../mocks/patternEvidence";
import { collectConsoleErrors } from "./helpers/flowsB";

const CAPTURE = process.env.SCREENSHOT_EVIDENCE === "1";
const DIR = process.env.PATTERNS_CAPTURE_DIR ?? "/workspaces/test-rag/.agent-artifacts/ui-a-plus/fixes";
const PHASE = process.env.PATTERNS_CAPTURE_PHASE ?? "capture";

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  test(`captures patterns ${PHASE} at ${width}`, async ({ page }) => {
    test.skip(!CAPTURE, "set SCREENSHOT_EVIDENCE=1 to write captures");
    await page.setViewportSize({ width, height });
    const consoleErrors = collectConsoleErrors(page);
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupHomePatternMocks(page);
    await setupPatternEvidenceMocks(page);
    await page.goto(PATTERNS_EVIDENCE_PATH);

    await page.waitForSelector('[data-testid="patterns-page"]', { timeout: 30000 });
    await expect(page.getByTestId("patterns-page")).toBeVisible();
    await expect
      .poll(async () =>
        page.locator(
          '[data-testid^="patterns-narrow-result-"], [data-testid="patterns-symbol-matrix"] [data-testid^="patterns-matrix-row-"]',
        ).count(),
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
    expect(consoleErrors.filter((text) => text.includes("Failed to fetch"))).toEqual([]);

    await page.screenshot({ path: `${DIR}/patterns-${PHASE}-${width}.png`, fullPage: true });
  });
}
