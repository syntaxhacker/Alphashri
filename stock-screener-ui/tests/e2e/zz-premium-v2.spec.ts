import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { premiumTrackerSnapshot } from "./helpers/flowsB";

const snap = premiumTrackerSnapshot();

test("premium v2 fixed chart", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  await loginAsTestUser(page);
  await page.route(apiRoute("options/premium-tracker"), (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) }));
  await page.goto("/options");
  await page.getByTestId("nav-tab-premium").click();
  await expect(page.getByTestId("strategy-row-BUY")).toBeVisible();
  await page.getByTestId("strategy-row-template-BUY").click();
  await page.getByRole("option", { name: "Long Straddle" }).click();
  await page.getByTestId("strategy-row-add-BUY").click();
  const card = page.locator("[data-testid^='setup-card-']").first();
  await expect(card).toBeVisible();
  await page.waitForTimeout(3000);
  console.log("PAGEERRORS: " + (errors.length ? errors.join(" | ") : "(none)"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await card.screenshot({ path: "/tmp/opencode/setup-fixed.png" });
});
