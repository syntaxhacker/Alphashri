import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { premiumTrackerSnapshot } from "./helpers/premiumFixture";

test("premium tab full state", async ({ page }) => {
  const snap = premiumTrackerSnapshot();
  await loginAsTestUser(page);
  await page.route(apiRoute("options/premium-tracker"), (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) }));
  await page.goto("/options");
  await page.getByTestId("nav-tab-premium").click();
  await expect(page.getByTestId("premium-leg-NIFTY")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("premium-tracker-panel").screenshot({ path: "/tmp/opencode/premium-full.png" });
});
