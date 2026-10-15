import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const snap = {
  legs: [
    { underlying: "NIFTY", spot: 23140, atm_strike: 23150, ce_ltp: 90, pe_ltp: 106, straddle_price: 196, straddle_pct: 0.847, ce_iv_pct: 25.2, pe_iv_pct: 15.3, dte_days: 1, hv20_ann_pct: 9.2, hv20_daily_pct: 0.58, avg_range20_pct: 0.71, iv_hv_ratio: 2.73, verdict: "EXPENSIVE", error: null },
    { underlying: "BANKNIFTY", spot: 55580, atm_strike: 55600, ce_ltp: 300, pe_ltp: 256, straddle_price: 556, straddle_pct: 1.0, ce_iv_pct: 27.3, pe_iv_pct: 20.6, dte_days: 1, hv20_ann_pct: 12.1, hv20_daily_pct: 0.76, avg_range20_pct: 0.92, iv_hv_ratio: 2.26, verdict: "EXPENSIVE", error: null },
  ],
  as_of: "2026-09-28T00:00:00+00:00",
  cached: false,
};

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
