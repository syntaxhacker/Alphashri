import { expect, test } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

const THEME = {
  light: { bg: "rgb(244, 245, 247)", surface: "rgb(255, 255, 255)" },
  dark: { bg: "rgb(0, 0, 0)", surface: "rgb(19, 22, 28)" },
} as const;

// The toggle used to flip `data-color-scheme` while every token stayed on its
// dark value — there was no light block in tailwind.css — so the button looked
// broken. Asserting the painted background, not the attribute, is what catches
// that: an attribute check passes on a page that never repaints.
test("theme toggle changes the painted background and persists", async ({ page }) => {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await page.goto("/screener/market");
  await page.waitForSelector('[data-testid="market-grid"] tbody tr', { timeout: 20000 });

  const attr = () => page.evaluate(() => document.documentElement.getAttribute("data-color-scheme"));
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const surface = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="market-toolbar"]');
      return el ? getComputedStyle(el).backgroundColor : "none";
    });
  const stored = () => page.evaluate(() => localStorage.getItem("color-scheme"));

  const initial = (await attr()) as "light" | "dark";
  const next = initial === "dark" ? "light" : "dark";
  // The boot scheme honours the system preference; assert consistency, then flip.
  expect(await bodyBg()).toBe(THEME[initial].bg);

  await page.locator('[data-testid="theme-toggle-btn"]:visible').first().click();
  await expect.poll(attr).toBe(next);
  await expect.poll(bodyBg).toBe(THEME[next].bg);
  expect(await stored()).toBe(next);

  // The choice must survive a reload, and be applied before first paint (the
  // bootstrap in index.html), so no frame is painted in the other scheme.
  await page.reload();
  await page.waitForSelector('[data-testid="market-grid"] tbody tr', { timeout: 20000 });
  expect(await attr()).toBe(next);
  expect(await bodyBg()).toBe(THEME[next].bg);
  expect(await surface()).toBe(THEME[next].surface);

  // Back to the original for a clean end state.
  await page.locator('[data-testid="theme-toggle-btn"]:visible').first().click();
  await expect.poll(attr).toBe(initial);
});
