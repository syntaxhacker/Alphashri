import { test, expect, type Page, type Route } from "@playwright/test";
import { apiRoute } from "../mocks/routeHelper";
import { setupSectorTest } from "./helpers/sectorHelpers";

const MONTHS = Array.from(
  { length: 12 },
  (_, index) => `2025-${String(index + 1).padStart(2, "0")}`,
);

type Market = "india" | "america";

function historyFixture(market: Market, years: number) {
  const names = ["Technology", "Financials", "Energy"].map((name) =>
    market === "america" ? `US ${name}` : name,
  );
  const series: Array<{
    name: string;
    is_benchmark: boolean;
    monthly_returns: number[];
    ranks: (number | null)[];
  }> = names.map((name, index) => ({
    name,
    is_benchmark: false,
    monthly_returns: MONTHS.map((_, month) => ((index + month) % 7) - 3),
    ranks: MONTHS.map((_, month) => ((index + month) % 3) + 1),
  }));
  series.push({
    name: market === "america" ? "S&P 500" : "NIFTY 50",
    is_benchmark: true,
    monthly_returns: MONTHS.map(() => 1),
    ranks: MONTHS.map(() => null),
  });
  return {
    market,
    years,
    cached: false,
    months: MONTHS,
    as_of: market === "america" ? `2027-${String(years).padStart(2, "0")}-28` : "2026-06-30",
    last_updated: "2026-01-01T00:00:00Z",
    source: "fixture",
    disclaimer: "Past performance is not indicative of future results.",
    universe: names,
    series,
    risk: names.map((name, index) => ({
      name,
      max_drawdown: -10 - index,
      current_drawdown: index === 0 ? -2 : 0,
      recovery_days: index,
      sharpe: index === 2 ? null : 0.5 + index,
      volatility: index === 2 ? null : 15 + index,
    })),
    seasonality: names.flatMap((name) =>
      Array.from({ length: 12 }, (_, month) => ({
        name,
        month: month + 1,
        avg_return: ((month + name.length) % 5) - 2,
        hit_rate: 0.5,
        n: years,
      })),
    ),
    persistence: {
      by_sector: [],
      transition_matrix: [
        [0.6, 0.3, 0.1],
        [0.2, 0.5, 0.3],
        [0.1, 0.2, 0.7],
      ],
    },
  };
}

async function mockHistory(
  page: Page,
  handler: (params: URLSearchParams, route: Route) => Promise<void>,
) {
  const requests: URLSearchParams[] = [];
  await page.route(apiRoute("sector/history**"), async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    await handler(params, route);
  });
  return requests;
}

function paramsFrom(params: URLSearchParams) {
  return {
    market: params.get("market") as Market,
    years: Number(params.get("years")),
  };
}

async function fulfillFixture(params: URLSearchParams, route: Route) {
  const { market, years } = paramsFrom(params);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(historyFixture(market, years)),
  });
}

test.describe("Sector History", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("renders overview charts and the rotation lab", async ({ page }) => {
    await mockHistory(page, fulfillFixture);
    await page.goto("/sector?tab=history");

    await expect(page.getByTestId("sector-history-tab")).toBeVisible();
    await expect(page.getByTestId("history-rank-heatmap")).toBeVisible();
    await expect(page.getByTestId("history-seasonality")).toBeVisible();
    await expect(page.getByTestId("history-persistence")).toBeVisible();
    await expect(page.getByTestId("history-rotation-timeline")).toBeVisible();
    await expect(page.getByTestId("sector-history-risk-table")).toBeVisible();
    await expect(page.getByTestId("sector-history-asof")).toHaveText("As of 2026-06-30");

    const labToggle = page
      .getByTestId("sector-history-view-toggle")
      .getByRole("button", { name: "Rotation Lab" });
    await expect(labToggle).toBeVisible();
    await labToggle.click();
    for (const testId of [
      "sector-history-lab-sankey-panel",
      "sector-history-lab-movers-panel",
      "sector-history-lab-drawdown-panel",
      "sector-history-lab-seasonality-panel",
      "sector-history-lab-rs-panel",
      "sector-history-lab-trail-panel",
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
    await expect(page.getByTestId("sector-history-lab-sankey-panel")).toContainText(
      "Rank transitions",
    );
    await expect(page.getByTestId("sector-history-lab-movers-panel")).toContainText(
      "Monthly movers",
    );
    await expect(page.getByTestId("sector-history-lab-drawdown-panel")).toContainText(
      "Monthly drawdown · Financials",
    );
    await expect(page.getByTestId("sector-history-lab-seasonality-panel")).toContainText(
      "Seasonality · Financials",
    );
    await expect(page.getByTestId("sector-history-lab-rs-panel")).toContainText(
      "Relative strength · Financials vs NIFTY 50",
    );
    await expect(page.getByTestId("sector-history-lab-trail-panel")).toContainText(
      "RS momentum trail · Financials",
    );

    const sector = page.getByTestId("sector-history-lab-sector").locator("select");
    await expect(sector).toHaveValue("Financials");
    await expect(sector.locator("option")).toHaveCount(3);
    await sector.selectOption({ label: "Energy" });
    await expect(page.getByTestId("sector-history-lab-drawdown-panel")).toContainText(
      "Monthly drawdown · Energy",
    );
  });

  test("refetches with market and years params and updates rendered data", async ({ page }) => {
    const requests = await mockHistory(page, fulfillFixture);
    await page.goto("/sector?tab=history");
    await expect(page.getByTestId("history-rank-heatmap")).toBeVisible();
    await expect
      .poll(() => requests.map((params) => params.toString()))
      .toEqual(["market=india&years=5"]);

    const labToggle = page
      .getByTestId("sector-history-view-toggle")
      .getByRole("button", { name: "Rotation Lab" });
    await expect(labToggle).toBeVisible();
    await labToggle.click();
    await page.getByTestId("sector-market-selector").getByText("US").click();

    await expect(page.getByTestId("sector-history-asof")).toHaveText("As of 2027-05-28");
    await expect
      .poll(() => requests.map((params) => params.toString()))
      .toEqual(["market=india&years=5", "market=america&years=5"]);
    await expect(page.getByTestId("sector-history-lab-drawdown-panel")).toContainText(
      "Monthly drawdown · US Financials",
    );

    await page.getByTestId("sector-history-years").locator("select").selectOption({ label: "10Y" });
    await expect(page.getByTestId("sector-history-asof")).toHaveText("As of 2027-10-28");
    await expect
      .poll(() => requests.map((params) => params.toString()))
      .toEqual(["market=india&years=5", "market=america&years=5", "market=america&years=10"]);
    await expect(page.getByTestId("sector-history-lab-sankey-panel")).toContainText("10Y");
  });

  test("shows the loading state until the first response arrives", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockHistory(page, async (params, route) => {
      await gate;
      await fulfillFixture(params, route);
    });

    await page.goto("/sector?tab=history");
    await expect(page.getByTestId("sector-history-loading")).toBeVisible();
    await expect(page.getByTestId("sector-history-loading")).toContainText(
      "Loading sector history",
    );

    release();
    await expect(page.getByTestId("history-rank-heatmap")).toBeVisible();
    await expect(page.getByTestId("sector-history-loading")).toHaveCount(0);
  });

  test("shows the error state for an unavailable backend", async ({ page }) => {
    await mockHistory(page, async (_params, route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "sector_history_unavailable" }),
      });
    });

    await page.goto("/sector?tab=history");
    const error = page.getByTestId("sector-history-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Sector history is temporarily unavailable. Try again.");
    await expect(page.getByTestId("sector-history-retry")).toBeVisible();
  });

  test("shows the empty state for a malformed payload", async ({ page }) => {
    await mockHistory(page, async (_params, route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await page.goto("/sector?tab=history");
    await expect(page.getByTestId("sector-history-empty")).toContainText("No sector history");
    await expect(page.getByTestId("sector-history-empty")).toContainText(
      "No history is available for India over 5Y.",
    );
  });
});
