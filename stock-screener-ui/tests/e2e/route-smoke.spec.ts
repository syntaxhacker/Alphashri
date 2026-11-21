import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

const CRITICAL_ROUTES = ["/", "/screener", "/report/index", "/options", "/patterns"];

const IGNORED_CONSOLE = [
  "Failed to load resource",
  "net::ERR",
  "status of 4",
  "status of 5",
  "WebSocket",
  "ws/",
  "ERR_CONNECTION_REFUSED",
  "Access to fetch",
  "Failed to fetch",
  "AbortError",
  "CORS policy",
  "Maximum update depth",
  "React does not recognize",
  "hydration error",
];

const BASE_URL = process.env.ROUTE_SMOKE_BASE_URL ?? "";

function watchRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => text.includes(pattern))) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function visit(page: Page, route: string): Promise<string[]> {
  const errors = watchRuntimeErrors(page);
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await page.goto(`${BASE_URL}${route}`);
  await expect(page.locator("#app")).toBeVisible();
  await page.waitForFunction(() => (document.querySelector("#app")?.children.length ?? 0) > 0, undefined, {
    timeout: 20000,
  });
  return errors;
}

test.describe("route smoke", () => {
  for (const route of CRITICAL_ROUTES) {
    test(`${route} renders without a runtime error @smoke`, async ({ page }) => {
      const errors = await visit(page, route);
      if (route === "/report/index") {
        await expect(page.getByTestId("nifty-report-panel")).toBeVisible({ timeout: 20000 });
      }
      expect(errors, `${route} threw:\n${errors.join("\n")}`).toEqual([]);
    });
  }
});
