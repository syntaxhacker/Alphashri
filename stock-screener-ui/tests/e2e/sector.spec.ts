/**
 * Sector single-page E2E + visual evidence.
 *
 * `/sector` is one scrollport with four stacked sections and an anchor rail; the
 * old tab locators no longer describe the page. Screenshots are written only
 * with SCREENSHOT_EVIDENCE=1 so ordinary runs leave the evidence folder alone.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupSectorTest, gotoSector } from "./helpers/sectorHelpers";
import { navigateToSectorViaSidebar } from "./helpers/flowsB";
import { apiRoute } from "../mocks/routeHelper";

const SECTION_IDS = ["overview", "rotation", "correlation", "history"] as const;
type SectionId = (typeof SECTION_IDS)[number];

test.describe("Sector Dashboard - Navigation and Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should navigate to sector dashboard view", async ({ page }) => {
    await navigateToSectorViaSidebar(page);
    expect(page.url()).toContain("/sector");
  });

  test("should display Sector Dashboard title", async ({ page }) => {
    await gotoSector(page);
    const sectorView = page.getByTestId("sector-analysis-view");
    await expect(sectorView).toBeVisible();
    await expect(sectorView).toContainText("Sector Dashboard");
  });

  test("should display subtitle about real-time performance", async ({ page }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-header")).toBeVisible();
    await expect(page.getByTestId("sector-analysis-view")).toContainText(
      "Real-time sector performance",
    );
  });

  test("should display market toggle buttons India and US", async ({ page }) => {
    await gotoSector(page);
    const header = page.getByTestId("sector-header");
    await expect(header.getByRole("button", { name: "India" })).toBeVisible();
    await expect(header.getByRole("button", { name: "US" })).toBeVisible();
  });

  test("should expose an anchor rail of four section links and no tab bar", async ({ page }) => {
    await gotoSector(page);
    const nav = page.getByTestId("sector-section-nav");
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute("aria-label", "Sector sections");
    for (const id of SECTION_IDS) {
      const anchor = page.getByTestId(`sector-nav-${id}`);
      await expect(anchor).toBeVisible();
      await expect(anchor).toHaveAttribute("href", `#${id}`);
    }
    await expect(
      page.locator(
        '[data-testid="sector-analysis-view"] [role="tablist"], [data-testid="sector-analysis-view"] [role="tab"]',
      ),
    ).toHaveCount(0);
  });

  test("should render all four stacked, focusable section wrappers", async ({ page }) => {
    await gotoSector(page);
    const wrappers = page.locator('[data-testid="sector-analysis-view"] section[data-section]');
    await expect(wrappers).toHaveCount(4);
    expect(
      await wrappers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section"))),
    ).toEqual([...SECTION_IDS]);
    expect(
      await wrappers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("tabindex"))),
    ).toEqual(["-1", "-1", "-1", "-1"]);
    for (const id of SECTION_IDS) {
      await expect(page.getByTestId(`sector-section-${id}`)).toBeAttached();
    }
  });

  test("should display Refresh button", async ({ page }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-table-container").locator("table")).toBeVisible({
      timeout: 15000,
    });
    const refreshBtn = page.getByTestId("sector-refresh-btn");
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();
  });
});

test.describe("Sector Dashboard - Overview Section", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should treat overview as the active section by default", async ({ page }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-nav-overview")).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expect(page.getByTestId("sector-section-overview")).toBeVisible();
    await expect(page).toHaveURL(/\/sector#overview$/);
  });

  test("should display sector performance table with headers", async ({ page }) => {
    await gotoSector(page);
    const table = page.getByTestId("sector-table-container").locator("table");
    await expect(table).toBeVisible();
    for (const header of ["Sector", "Change", "A/D", "ADX"]) {
      await expect(table.locator("th", { hasText: header }).first()).toBeVisible();
    }
  });

  test("should show a MOVE scale and signed deltas on the bars", async ({ page }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-move-scale")).toHaveText("MOVE −3% · 0 · +3%");
    const delta = page.getByTestId("sector-move-delta").first();
    await expect(delta).toBeVisible();
    await expect(delta).toHaveText(/^Δ [+-]\d+\.\d{2}%$/);
  });

  test("should display top sector and market breadth in the summary strip", async ({ page }) => {
    await gotoSector(page);
    const strip = page.getByTestId("sector-summary-strip");
    await expect(strip).toContainText("Top Sector");
    await expect(strip).toContainText("Market Breadth");
    await expect(strip).toContainText(/\d+ UP/);
    await expect(strip).toContainText(/\d+ DOWN/);
    await expect(strip).toContainText("Weakest Sector");
  });

  test("should display real-time alerts and interval movers", async ({ page }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-alerts-card")).toContainText("Real-time Alerts");
    await expect(page.getByTestId("sector-interval-movers-card")).toContainText(
      "Interval Movers",
    );
  });
});

test.describe("Sector Dashboard - Section Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("clicking the correlation anchor mounts and scrolls to its section", async ({ page }) => {
    await gotoSector(page);
    const scroller = page.locator("#sector-page");
    await page.getByTestId("sector-nav-correlation").click();

    await expect(page.getByTestId("sector-section-correlation")).toBeInViewport();
    await expect(page.getByTestId("sector-section-correlation-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("sector-correlation-header")).toBeVisible();
    await expect(page.getByTestId("sector-nav-correlation")).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expect(page).toHaveURL(/\/sector#correlation$/);
    expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    // Sections stack: navigating does not unmount the earlier section.
    await expect(page.getByTestId("sector-section-overview")).toBeAttached();
    await expect(page.getByTestId("sector-table-container")).toBeAttached();
  });

  test("a deep hash mounts the target section directly", async ({ page }) => {
    await page.goto("/sector#rotation", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sector-analysis-view")).toBeVisible();
    await expect(page.getByTestId("sector-section-rotation")).toBeInViewport();
    await expect(page.getByTestId("rotation-tab")).toBeVisible();
    await expect(page.getByTestId("sector-nav-rotation")).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  test("legacy ?tab=rotation maps to the rotation section and drops tab", async ({ page }) => {
    await page.goto("/sector?tab=rotation", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sector-analysis-view")).toBeVisible();
    await expect(page.getByTestId("sector-section-rotation")).toBeInViewport();
    await expect(page.getByTestId("rotation-tab")).toBeVisible();
    await expect(page).toHaveURL(/\/sector#rotation$/);
    expect(new URL(page.url()).searchParams.has("tab")).toBe(false);
    await expect(page.getByTestId("sector-nav-rotation")).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  test("unknown ?tab values and hashes resolve to overview", async ({ page }) => {
    await page.goto("/sector?tab=does-not-exist", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/sector#overview$/);
    expect(new URL(page.url()).searchParams.has("tab")).toBe(false);

    await page.goto("/sector#does-not-exist", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sector-nav-overview")).toHaveAttribute(
      "aria-current",
      "location",
    );
  });
});

test.describe("Sector Dashboard - Market Selector", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should have India and US buttons visible and toggle between them", async ({ page }) => {
    await gotoSector(page);
    const header = page.getByTestId("sector-header");
    const indiaBtn = header.getByRole("button", { name: "India" });
    const usBtn = header.getByRole("button", { name: "US" });
    await expect(indiaBtn).toHaveAttribute("aria-pressed", "true");
    await usBtn.click();
    await expect(usBtn).toHaveAttribute("aria-pressed", "true");
    await expect(indiaBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("sector-analysis-view")).toBeVisible();
    await indiaBtn.click();
    await expect(indiaBtn).toHaveAttribute("aria-pressed", "true");
    await expect(usBtn).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("Sector Dashboard - Refresh Button", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should display refresh button and be clickable", async ({ page }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-table-container").locator("table")).toBeVisible({
      timeout: 15000,
    });
    const refreshBtn = page.getByTestId("sector-refresh-btn");
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();
    await refreshBtn.click();
    await expect(refreshBtn).toBeVisible();
  });
});

test.describe("Sector Dashboard - Responsive Layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should display properly on desktop and tablet viewports", async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoSector(page);
      await expect(page.getByTestId("sector-analysis-view")).toContainText("Sector Dashboard");
      await expect(page.getByTestId("sector-section-nav")).toBeVisible();
      await expect(page.getByTestId("sector-section-overview")).toBeVisible();
    }
  });

  test("390 keeps the summary strip, header and Refresh fully visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSector(page);
    const strip = page.getByTestId("sector-summary-strip");
    await expect(strip).toContainText("Top Sector");
    await expect(strip).toContainText("Market Breadth");
    await expect(strip).toContainText("Weakest Sector");
    await expect(page.getByTestId("sector-refresh-btn")).toBeVisible();

    const layout = await page.evaluate(() => {
      type Box = {
        left: number;
        right: number;
        top: number;
        width: number;
        height: number;
        scrollWidth: number;
        clientWidth: number;
      };
      const box = (element: Element | null): Box | null => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      };
      const nav = document.querySelector('[data-testid="sector-section-nav"]');
      return {
        viewportWidth: window.innerWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        header: box(document.querySelector('[data-testid="sector-header"]')),
        refresh: box(document.querySelector('[data-testid="sector-refresh-btn"]')),
        summaryGroups: Array.from(
          document.querySelectorAll('[data-testid="sector-summary-strip"] > div'),
        ).map(box),
        nav: box(nav),
        navOverflowX: nav ? getComputedStyle(nav).overflowX : "",
        anchors: Array.from(nav?.querySelectorAll("a") ?? []).map(box),
      };
    });

    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    for (const element of [layout.header, layout.refresh]) {
      expect(element).not.toBeNull();
      expect(element!.left).toBeGreaterThanOrEqual(-1);
      expect(element!.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    }
    expect(layout.refresh!.width).toBeGreaterThan(40);
    expect(layout.summaryGroups).toHaveLength(3);
    for (const group of layout.summaryGroups) {
      expect(group.width).toBeGreaterThan(0);
      expect(group.left).toBeGreaterThanOrEqual(-1);
      expect(group.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1);
    }
    expect(layout.navOverflowX).toBe("auto");
    expect(layout.anchors).toHaveLength(4);
    expect(layout.nav!.height).toBeLessThanOrEqual(40);
    expect(new Set(layout.anchors.map((anchor) => Math.round(anchor.top))).size).toBe(1);
  });
});

test.describe("Sector Dashboard - Navigation State", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should update navigation active state when navigating to sector view", async ({ page }) => {
    await navigateToSectorViaSidebar(page);
    await expect(page.getByTestId("sector-nav-overview")).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  test("should navigate to sector view from other views", async ({ page }) => {
    await page.goto("/paper", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("nav-sector").click();
    await expect(page.getByTestId("sector-analysis-view")).toBeVisible();
    expect(page.url()).toContain("/sector");
  });

  test("should navigate away from sector view to other views", async ({ page }) => {
    await gotoSector(page);
    await page.getByRole("button", { name: "Screener", exact: true }).click();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page).not.toHaveURL(/\/sector/);
  });
});

// --- Gated evidence captures -------------------------------------------------

const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1";
const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "screenshots", "sector-single-page");
const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;
const STATE_COVERS: Record<SectionId, string> = {
  overview: "Overview at the top of /sector: summary strip, MOVE table and alerts.",
  rotation: "Rotation section after anchor navigation: regime, board and matrix.",
  correlation: "Correlation section after anchor navigation: heatmap and relative strength.",
  history: "History section after anchor navigation: lazy chunk mounted with overview data.",
};
const STATE_READY: Record<SectionId, string> = {
  overview: "sector-summary-strip",
  rotation: "rotation-tab",
  correlation: "sector-correlation-header",
  history: "sector-history-overview",
};

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

/** Rotation and history own endpoints outside setupSectorMocks; keep panels non-blank. */
async function mockLazySectionApis(page: Page) {
  const periods = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];
  const names = ["Technology", "Financials", "Energy", "Healthcare", "Industrials", "Materials"];
  const rows = names.map((name, index) => ({
    id: `sector-${index}`,
    name,
    kind: "sector",
    members: 12 + index,
    covered: 12 + index,
    returns: Object.fromEntries(periods.map((period, i) => [period, (index + i) % 5 - 2])),
    rs_1m: 1.2 - index * 0.3,
    rs_1w: 0.4 - index * 0.2,
    rs_pct: 60 - index * 6,
    mom_pct: 2.4 - index * 0.7,
    rank: index + 1,
    rank_delta: index % 2 === 0 ? 1 : -1,
    breadth: 0.6 - index * 0.05,
    rel_volume: 1.1 - index * 0.1,
    quadrant: index < 3 ? "leading" : "improving",
    status: index < 2 ? "booming" : index < 4 ? "heating" : "neutral",
    top_movers: [
      { symbol: "TCS", change: 1.5 },
      { symbol: "INFY", change: 0.8 },
    ],
  }));
  await page.route(apiRoute("rotation/overview"), (route) =>
    route.fulfill(
      json({
        market: "india",
        kind: "sector",
        period: "1M",
        benchmark: "NIFTY 50",
        last_updated: new Date().toISOString(),
        regime: {
          benchmark: "NIFTY 50",
          benchmark_change: 0.4,
          benchmark_1m: 1.1,
          vix: 13.5,
          vix_change: -0.2,
          breadth: 0.55,
          label: "Risk-on",
        },
        counts: { booming: 2, heating: 2, cooling: 0, dumping: 0, neutral: 2 },
        rows,
      }),
    ),
  );

  const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
  const names3 = ["Technology", "Financials", "Energy"];
  const series = names3.map((name, index) => ({
    name,
    is_benchmark: false,
    monthly_returns: months.map((_, month) => ((index + month) % 7) - 3),
    ranks: months.map((_, month) => ((index + month) % 3) + 1),
  }));
  series.push({
    name: "NIFTY 50",
    is_benchmark: true,
    monthly_returns: months.map(() => 1),
    ranks: months.map(() => null),
  });
  await page.route(apiRoute("sector/history**"), (route) =>
    route.fulfill(
      json({
        market: "india",
        years: 3,
        cached: false,
        months,
        as_of: "2026-06-30",
        last_updated: "2026-01-01T00:00:00Z",
        source: "evidence-fixture",
        disclaimer: "Past performance is not indicative of future results.",
        universe: names3,
        series,
        risk: names3.map((name, index) => ({
          name,
          max_drawdown: -10 - index,
          current_drawdown: index === 0 ? -2 : 0,
          recovery_days: index,
          sharpe: index === 2 ? null : 0.5 + index,
          volatility: index === 2 ? null : 15 + index,
        })),
        seasonality: names3.flatMap((name) =>
          Array.from({ length: 12 }, (_, month) => ({
            name,
            month: month + 1,
            avg_return: ((month + name.length) % 5) - 2,
            hit_rate: 0.5,
            n: 3,
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
      }),
    ),
  );
}

test.describe.serial("Sector single-page evidence", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await setupSectorTest(page);
    await mockLazySectionApis(page);
    await gotoSector(page);
    await expect(page.getByTestId("sector-table-container").locator("table")).toBeVisible({
      timeout: 20000,
    });
  });

  for (const viewport of VIEWPORTS) {
    test(`captures ${viewport.width}x${viewport.height} overview, rotation, correlation and history`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      for (const state of SECTION_IDS) {
        await page.locator("#sector-page").evaluate((node) => {
          node.scrollTop = 0;
        });
        if (state === "overview") {
          await expect(page.getByTestId("sector-nav-overview")).toHaveAttribute(
            "aria-current",
            "location",
          );
        } else {
          await page.getByTestId(`sector-nav-${state}`).click();
          await expect(page.getByTestId(`sector-section-${state}`)).toBeInViewport();
          await expect(page.getByTestId(`sector-nav-${state}`)).toHaveAttribute(
            "aria-current",
            "location",
          );
          await expect(page.getByTestId(`${STATE_READY[state]}`)).toBeVisible({ timeout: 20000 });
        }

        // Reject an evidence frame whose panel body never mounted.
        if (state === "overview") {
          expect(
            await page.getByTestId("sector-table-container").locator("tbody tr").count(),
          ).toBeGreaterThan(0);
        } else if (state === "rotation") {
          await expect(page.getByTestId("rotation-grid")).toBeVisible();
          await expect(page.getByTestId("rotation-empty")).toHaveCount(0);
        } else if (state === "correlation") {
          const matrix = page
            .getByTestId("sector-correlation-heatmap")
            .getByTestId("correlation-matrix-board");
          await expect(matrix).toBeVisible();
          await expect(matrix.locator('[data-diagonal="true"]').first()).toBeVisible();
          expect(
            await page
              .getByTestId("relative-strength-table")
              .locator('[data-testid^="correlation-rs-row-"]')
              .count(),
          ).toBeGreaterThan(0);
        } else {
          await expect(page.getByTestId("sector-history-error-details")).toHaveCount(0);
          await expect(page.getByTestId("sector-history-overview")).toBeVisible();
        }

        await page.waitForLoadState("networkidle");
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, `${state}-${viewport.width}.png`),
          animations: "disabled",
        });
      }
    });
  }

  test("writes the manifest for the eight captured frames", async () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const sha256 = Object.fromEntries(
      VIEWPORTS.flatMap((viewport) =>
        SECTION_IDS.map((state) => {
          const name = `${state}-${viewport.width}.png`;
          const digest = createHash("sha256")
            .update(readFileSync(path.join(EVIDENCE_DIR, name)))
            .digest("hex");
          return [name, digest] as const;
        }),
      ),
    );
    const states = SECTION_IDS.map((state) => ({
      id: `${state}-loaded`,
      files: Object.fromEntries(VIEWPORTS.map((viewport) => [String(viewport.width), `${state}-${viewport.width}.png`])),
      covers: STATE_COVERS[state],
    }));
    writeFileSync(
      path.join(EVIDENCE_DIR, "manifest.json"),
      `${JSON.stringify(
        {
          feature: "sector-single-page",
          route: "/sector",
          head,
          viewports: VIEWPORTS.map((viewport) => viewport.width),
          sha256,
          states,
        },
        null,
        2,
      )}\n`,
    );
    expect(Object.keys(sha256)).toHaveLength(8);
  });
});
