import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const snap = {
  legs: [
    { underlying: "NIFTY", spot: 23140, atm_strike: 23150, ce_ltp: 90, pe_ltp: 106, straddle_price: 196, straddle_pct: 0.847, ce_iv_pct: 25.2, pe_iv_pct: 15.3, dte_days: 1, hv20_ann_pct: 9.2, hv20_daily_pct: 0.58, avg_range20_pct: 0.71, iv_hv_ratio: 2.73, verdict: "EXPENSIVE", error: null },
    { underlying: "BANKNIFTY", spot: 55580, atm_strike: 55600, ce_ltp: 300, pe_ltp: 256, straddle_price: 556, straddle_pct: 1.0, ce_iv_pct: 27.3, pe_iv_pct: 20.6, dte_days: 1, hv20_ann_pct: 12.1, hv20_daily_pct: 0.76, avg_range20_pct: 0.92, iv_hv_ratio: 2.26, verdict: "EXPENSIVE", error: null },
  ],
  as_of: "2026-09-27T00:00:00+00:00",
  cached: false,
};

test("premium tab full state", async ({ page }) => {
  await loginAsTestUser(page);
  await page.route(apiRoute("options/premium-tracker"), (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) }));
  await page.goto("/options");
  await page.getByTestId("nav-tab-premium").click();
  await expect(page.getByTestId("premium-leg-NIFTY")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("premium-tracker-panel").screenshot({ path: "/tmp/opencode/premium-full.png" });
});
