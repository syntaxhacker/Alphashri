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
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    await expect(page.getByTestId("sector-heatmap-view")).toBeVisible({
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

  test("should default to the visual overview with the heatmap and no performance table", async ({
    page,
  }) => {
    await gotoSector(page);
    await expect(page.getByTestId("sector-heatmap-view")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("sector-visual-layout")).toBeVisible();
    await expect(page.getByTestId("sector-table-container")).toHaveCount(0);
  });

  test("heatmap canvas keeps a real height at 1600 and 390", async ({ page }) => {
    for (const viewport of [
      { width: 1600, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoSector(page);
      const chart = page.getByTestId("sector-heatmap-chart");
      const canvas = chart.locator("canvas").first();
      await expect(chart).toBeVisible({ timeout: 15000 });
      await expect(canvas).toBeVisible({ timeout: 15000 });

      const chartBox = await chart.boundingBox();
      expect(chartBox, `chart box at ${viewport.width}`).not.toBeNull();
      expect(chartBox!.height, `chart height at ${viewport.width}`).toBeGreaterThan(100);

      const canvasBox = await canvas.boundingBox();
      expect(canvasBox, `canvas box at ${viewport.width}`).not.toBeNull();
      expect(canvasBox!.height, `canvas height at ${viewport.width}`).toBeGreaterThan(100);

      if (viewport.width === 1600) {
        expect(chartBox!.height).toBeGreaterThanOrEqual(300);
      }
    }
  });

  test("should display sector performance table with headers in table mode", async ({ page }) => {
    await gotoSector(page);
    await page
      .getByTestId("sector-dashboard-view-toggle")
      .getByRole("button", { name: "Table", exact: true })
      .click();
    const table = page.getByTestId("sector-table-container").locator("table");
    await expect(table).toBeVisible();
    for (const header of ["Sector", "Change", "A/D", "ADX"]) {
      await expect(table.locator("th", { hasText: header }).first()).toBeVisible();
    }
  });

  test("should show a MOVE scale and signed deltas on the bars in table mode", async ({ page }) => {
    await gotoSector(page);
    await page
      .getByTestId("sector-dashboard-view-toggle")
      .getByRole("button", { name: "Table", exact: true })
      .click();
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
    await expect(page.getByTestId("sector-visual-layout")).toBeAttached();
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
    await expect(page.getByTestId("sector-heatmap-view")).toBeVisible({
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

const REAL_EVIDENCE = process.env.SECTOR_EVIDENCE_REAL === "1";
const EVIDENCE = process.env.SCREENSHOT_EVIDENCE === "1" && !REAL_EVIDENCE;
const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "screenshots", "sector-single-page");
const REAL_EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "screenshots", "sector-single-page-real");
const REAL_API_BASE = process.env.SECTOR_E2E_API_BASE ?? "http://127.0.0.1:8765";
const REAL_API_EMAIL = process.env.SECTOR_E2E_EMAIL ?? "qa@test.com";
const REAL_API_PASSWORD = process.env.SECTOR_E2E_PASSWORD ?? "";
const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

type CaptureMode = "loaded" | "loading" | "error" | "empty";
type EvidenceStateId =
  | SectionId
  | "rotation-themes-empty"
  | "rotation-board"
  | "correlation-rs"
  | "history-risk"
  | "overview-table"
  | "rotation-themes-3m"
  | "correlation-us-1y"
  | "history-3y"
  | "history-lab"
  | `${SectionId}-loading`
  | `${SectionId}-error`
  | `${SectionId}-empty`;

interface EvidenceState {
  id: EvidenceStateId;
  section: SectionId;
  ready: string;
  covers: string;
  mode: CaptureMode;
  kind?: string;
  period?: string;
}

const EVIDENCE_STATES: readonly EvidenceState[] = [
  {
    id: "overview",
    section: "overview",
    ready: "sector-summary-strip",
    mode: "loaded",
    covers:
      "Overview at the top of /sector: summary strip, full-width sector heatmap and the alerts/movers column.",
  },
  {
    id: "rotation",
    section: "rotation",
    ready: "rotation-tab",
    mode: "loaded",
    covers: "Rotation section after anchor navigation: regime, board and matrix.",
  },
  {
    id: "rotation-board",
    section: "rotation",
    ready: "rotation-board-panel",
    mode: "loaded",
    covers:
      "Rotation board after scrolling it into view: every RRG quadrant and the sorted group rows.",
  },
  {
    id: "correlation",
    section: "correlation",
    ready: "sector-correlation-header",
    mode: "loaded",
    covers: "Correlation section after anchor navigation: heatmap and relative strength.",
  },
  {
    id: "correlation-rs",
    section: "correlation",
    ready: "relative-strength-table",
    mode: "loaded",
    covers:
      "Relative Strength Rankings after scrolling the board into view: rank, 5D/1M/3M RS and beta.",
  },
  {
    id: "history",
    section: "history",
    ready: "sector-history-overview",
    mode: "loaded",
    covers: "History section after anchor navigation: lazy chunk mounted with overview data.",
  },
  {
    id: "history-risk",
    section: "history",
    ready: "sector-history-risk-panel",
    mode: "loaded",
    covers:
      "History risk panel after scrolling it into view: max/current drawdown, recovery, Sharpe and volatility.",
  },
  {
    id: "overview-table",
    section: "overview",
    ready: "sector-table-container",
    mode: "loaded",
    covers:
      "Overview in Table view (dash=table): performance table, MOVE scale and the summary strip.",
  },
  {
    id: "rotation-themes-3m",
    section: "rotation",
    ready: "rotation-grid",
    mode: "loaded",
    covers:
      "Rotation with Themes kind and 3M period from the query string: RRG, matrix and board under changed selectors.",
  },
  {
    id: "correlation-us-1y",
    section: "correlation",
    ready: "relative-strength-table",
    mode: "loaded",
    covers:
      "Correlation after selecting US market and 1Y lookback: matrix, beta, rotation timeline and RS rankings.",
  },
  {
    id: "history-3y",
    section: "history",
    ready: "sector-history-overview",
    mode: "loaded",
    covers: "History with the 3Y lookback from hyears=3: rank overview, seasonality and risk panels.",
  },
  {
    id: "history-lab",
    section: "history",
    ready: "sector-history-lab",
    mode: "loaded",
    covers: "History Rotation Lab view (hview=lab): transition matrix and lab boards.",
  },
  {
    id: "rotation-themes-empty",
    section: "rotation",
    ready: "rotation-empty",
    mode: "empty",
    kind: "theme",
    period: "3M",
    covers:
      "Rotation Themes selector (kind=theme, period=3M) from the real API: empty because backend returned 0 theme rows.",
  },
  {
    id: "overview-loading",
    section: "overview",
    ready: "sector-section-overview",
    mode: "loading",
    covers: "Overview while /api/sector is delayed: loading panel replaces the heatmap and summary strip.",
  },
  {
    id: "overview-error",
    section: "overview",
    ready: "sector-section-overview",
    mode: "error",
    covers: "Overview when /api/sector returns 500: error panel with Retry.",
  },
  {
    id: "overview-empty",
    section: "overview",
    ready: "sector-section-overview",
    mode: "empty",
    covers: "Overview when /api/sector returns an empty sector list: no-data panel.",
  },
  {
    id: "rotation-loading",
    section: "rotation",
    ready: "rotation-loading",
    mode: "loading",
    covers: "Rotation while /api/rotation/overview is delayed: loading panel.",
  },
  {
    id: "rotation-error",
    section: "rotation",
    ready: "rotation-error",
    mode: "error",
    covers: "Rotation when /api/rotation/overview returns 500: error alert with Retry.",
  },
  {
    id: "rotation-empty",
    section: "rotation",
    ready: "rotation-empty",
    mode: "empty",
    covers: "Rotation when /api/rotation/overview returns no rows: empty panel.",
  },
  {
    id: "correlation-loading",
    section: "correlation",
    ready: "sector-correlation-loading",
    mode: "loading",
    covers: "Correlation while /api/sector/correlation is delayed: loading panel.",
  },
  {
    id: "correlation-error",
    section: "correlation",
    ready: "sector-correlation-error",
    mode: "error",
    covers: "Correlation when /api/sector/correlation returns 500: error panel with Retry.",
  },
  {
    id: "correlation-empty",
    section: "correlation",
    ready: "sector-correlation-empty",
    mode: "empty",
    covers: "Correlation when /api/sector/correlation returns empty names: no-data panel.",
  },
  {
    id: "history-loading",
    section: "history",
    ready: "sector-history-loading",
    mode: "loading",
    covers: "History while /api/sector/history is delayed: loading panel.",
  },
  {
    id: "history-error",
    section: "history",
    ready: "sector-history-error",
    mode: "error",
    covers: "History when /api/sector/history returns 500: error panel with Retry and Details.",
  },
  {
    id: "history-empty",
    section: "history",
    ready: "sector-history-empty",
    mode: "empty",
    covers: "History when /api/sector/history returns an empty payload: no-history panel.",
  },
];

const SECTION_STATE_STATES = EVIDENCE_STATES.filter((state) =>
  [
    "overview-loading",
    "overview-error",
    "overview-empty",
    "rotation-loading",
    "rotation-error",
    "rotation-empty",
    "correlation-loading",
    "correlation-error",
    "correlation-empty",
    "history-loading",
    "history-error",
    "history-empty",
  ].includes(state.id),
);
const REAL_STATES = EVIDENCE_STATES.filter((state) =>
  [
    "overview",
    "rotation",
    "rotation-board",
    "correlation",
    "correlation-rs",
    "correlation-us-1y",
    "history",
    "history-risk",
    "overview-table",
    "history-3y",
    "history-lab",
    "rotation-themes-empty",
  ].includes(state.id),
);

const REAL_VARIANT_URL: Partial<Record<EvidenceStateId, string>> = {
  "overview-table": "/sector?dash=table",
  "history-3y": "/sector?hyears=3#history",
  "history-lab": "/sector?hview=lab#history",
  "rotation-themes-empty": "/sector?kind=theme&period=3M#rotation",
};

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

const SECTION_API_PATH: Record<SectionId, string> = {
  overview: "/api/sector",
  rotation: "/api/rotation/overview",
  correlation: "/api/sector/correlation",
  history: "/api/sector/history",
};

const SECTION_URL: Record<SectionId, string> = {
  overview: "/sector",
  rotation: "/sector#rotation",
  correlation: "/sector#correlation",
  history: "/sector#history",
};

const SECTION_TITLE: Record<SectionId, string> = {
  overview: "Overview",
  rotation: "Rotation",
  correlation: "Correlation",
  history: "History",
};

const EMPTY_PAYLOADS: Record<SectionId, unknown> = {
  overview: {
    market: "india",
    sectors: [],
    top_stock_movers: [],
    last_updated: new Date().toISOString(),
  },
  rotation: {
    market: "india",
    kind: "sector",
    period: "1M",
    rows: [],
    last_updated: new Date().toISOString(),
  },
  correlation: {
    sectors: [],
    sector_names: [],
    correlation_matrix: [],
    last_updated: new Date().toISOString(),
  },
  history: {
    market: "india",
    years: 5,
    months: [],
    universe: [],
    series: [],
    risk: [],
    seasonality: [],
    persistence: { transition_matrix: [] },
    cached: false,
    as_of: "",
    last_updated: "",
    source: "evidence-empty-fixture",
    disclaimer: "",
  },
};

/** Exact-path matching keeps the broad /api/sector mock out of the section overrides. */
function routePath(pathname: string) {
  return (url: URL) => url.pathname === pathname;
}

/** Holds a response until the frame is captured, so loading never needs a sleep. */
function deferredGate() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

async function registerSectionState(
  page: Page,
  section: SectionId,
  mode: "loading" | "error" | "empty",
): Promise<() => void> {
  const pathname = SECTION_API_PATH[section];
  if (mode === "loading") {
    const { gate, release } = deferredGate();
    await page.route(routePath(pathname), async (route) => {
      await gate;
      // Navigation can abort the held request before the gate opens.
      await route.fulfill(json(EMPTY_PAYLOADS[section])).catch(() => {});
    });
    return release;
  }
  await page.route(routePath(pathname), (route) =>
    mode === "error"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "evidence fixture: upstream 500" }),
        })
      : route.fulfill(json(EMPTY_PAYLOADS[section])),
  );
  return () => {};
}

async function gotoPath(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("sector-analysis-view")).toBeVisible();
}

/** The correlation store survives same-document hash navigation, so a repeated
 *  selectOption on the current value emits no change event. Step through a real
 *  option first, then let each refetch finish before driving the next control. */
async function selectCorrelationUsOneYear(page: Page) {
  const lookback = page.getByTestId("lookback-segment").getByRole("combobox");
  const market = page.getByTestId("market-segment").getByRole("combobox");
  const responseFor = (m: string, days: string) =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/sector/correlation" &&
        url.searchParams.get("market") === m &&
        url.searchParams.get("lookback_days") === days &&
        response.status() === 200
      );
    });
  const settled = async (days: string, m: string) => {
    await expect(page.getByTestId("sector-correlation-loading")).toHaveCount(0);
    await expect(page.getByTestId("sector-correlation-header")).toBeVisible();
    await expect(lookback).toBeEnabled();
    await expect(market).toBeEnabled();
    await expect(lookback).toHaveValue(days);
    await expect(market).toHaveValue(m);
  };

  const currentMarket = await market.inputValue();
  // The real API rejects lookbacks below 30 days, so step through 90/132 only.
  const alternate = (await lookback.inputValue()) === "90" ? "132" : "90";
  const reset = responseFor(currentMarket, alternate);
  await lookback.selectOption(alternate);
  await reset;
  await settled(alternate, currentMarket);

  const lookbackResponse = responseFor(currentMarket, "252");
  await lookback.selectOption("252");
  await lookbackResponse;
  await settled("252", currentMarket);

  if (currentMarket !== "america") {
    const marketResponse = responseFor("america", "252");
    await market.selectOption("america");
    await marketResponse;
    await settled("252", "america");
  }
  await expect(market).toHaveValue("america");
  await expect(lookback).toHaveValue("252");
}

/** State panels sit below the overview at 390; center them clear of the sticky nav. */
async function scrollStateIntoView(page: Page, state: EvidenceState) {
  const nav = page.getByTestId(`sector-nav-${state.section}`);
  const section = page.getByTestId(`sector-section-${state.section}`);
  await expect(nav).toHaveAttribute("aria-current", "location");
  await expect(section).toBeInViewport();
  await expect(section.getByText(SECTION_TITLE[state.section], { exact: true }).first()).toBeVisible();
  const locator = state.section === "overview" ? section : page.getByTestId(state.ready);
  await page.locator("#sector-page").evaluate(
    (scroller, sectionId) => {
      const target = scroller.querySelector(`section[data-section="${sectionId}"]`);
      if (!target) return;
      const delta =
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 48;
      scroller.scrollTop += delta;
    },
    state.section,
  );
  await expect(locator).toBeInViewport({ ratio: state.section === "overview" ? 0 : 1 });
  // The section must win the active-link observer, not the preceding section.
  await expect(nav).toHaveAttribute("aria-current", "location");
}

async function frame(
  page: Page,
  dir: string,
  id: string,
  width: number,
  waitForNetwork = true,
) {
  if (waitForNetwork) await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: path.join(dir, `${id}-${width}.png`),
    animations: "disabled",
  });
}

async function waitStateReady(page: Page, state: EvidenceState) {
  const section = page.getByTestId(`sector-section-${state.section}`);
  switch (state.id) {
    case "overview-loading":
      await expect(section.getByText("Fetching sector performance")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-summary-strip")).toHaveCount(0);
      break;
    case "overview-error":
      await expect(section.getByText("Error", { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(section.getByRole("button", { name: "Retry" })).toBeVisible();
      break;
    case "overview-empty":
      await expect(section.getByText("No sector data available for this market.")).toBeVisible({
        timeout: 20000,
      });
      break;
    case "rotation-loading":
      await expect(page.getByTestId("rotation-loading")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("rotation-grid")).toHaveCount(0);
      break;
    case "rotation-error":
      await expect(page.getByTestId("rotation-error")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("rotation-error")).toContainText("Rotation data unavailable");
      break;
    case "rotation-empty":
      await expect(page.getByTestId("rotation-empty")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("rotation-grid")).toHaveCount(0);
      break;
    case "correlation-loading":
      await expect(page.getByTestId("sector-correlation-loading")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-correlation-header")).toHaveCount(0);
      break;
    case "correlation-error":
      await expect(page.getByTestId("sector-correlation-error")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-correlation-header")).toHaveCount(0);
      break;
    case "correlation-empty":
      await expect(page.getByTestId("sector-correlation-empty")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-correlation-header")).toHaveCount(0);
      break;
    case "history-loading":
      await expect(page.getByTestId("sector-history-loading")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-history-overview")).toHaveCount(0);
      break;
    case "history-error":
      await expect(page.getByTestId("sector-history-error")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-history-retry")).toBeVisible();
      break;
    case "history-empty":
      await expect(page.getByTestId("sector-history-empty")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("sector-history-overview")).toHaveCount(0);
      break;
    default:
      await expect(page.getByTestId(state.ready)).toBeVisible({ timeout: 20000 });
  }
}

function writeEvidenceManifest(
  dir: string,
  feature: string,
  states: readonly EvidenceState[],
  mock: boolean,
) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const sha256 = Object.fromEntries(
    VIEWPORTS.flatMap((viewport) =>
      states.map((state) => {
        const name = `${state.id}-${viewport.width}.png`;
        const digest = createHash("sha256")
          .update(readFileSync(path.join(dir, name)))
          .digest("hex");
        return [name, digest] as const;
      }),
    ),
  );
  const manifestStates = states.map((state) => ({
    id: state.mode === "loaded" ? `${state.id}-loaded` : state.id,
    files: Object.fromEntries(
      VIEWPORTS.map((viewport) => [String(viewport.width), `${state.id}-${viewport.width}.png`]),
    ),
    covers: state.covers,
    mock,
    ...(state.kind ? { kind: state.kind } : {}),
    ...(state.period ? { period: state.period } : {}),
  }));
  const keep = new Set(Object.keys(sha256));
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".png") && !keep.has(name)) rmSync(path.join(dir, name));
  }
  writeFileSync(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(
      {
        feature,
        route: "/sector",
        head,
        viewports: VIEWPORTS.map((viewport) => viewport.width),
        sha256,
        states: manifestStates,
        source: mock ? "route-mocks" : "real-api",
      },
      null,
      2,
    )}\n`,
  );
  return { sha256, states: manifestStates };
}

/** Rotation and history own endpoints outside setupSectorMocks; keep panels non-blank. */
async function mockLazySectionApis(page: Page) {
  const periods = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];
  const names = ["Technology", "Financials", "Energy", "Healthcare", "Industrials", "Materials"];
  // RRG coordinates are percentiles (0–100), not percent changes: keep the
  // groups spread across all four quadrants instead of clustering at zero.
  const rrg: Array<[rs: number, mom: number, quadrant: string, status: string]> = [
    [72, 68, "leading", "booming"],
    [58, 55, "leading", "heating"],
    [45, 52, "improving", "heating"],
    [38, 44, "lagging", "dumping"],
    [62, 35, "weakening", "cooling"],
    [28, 20, "lagging", "neutral"],
  ];
  const rows = names.map((name, index) => {
    const [rsPct, momPct, quadrant, status] = rrg[index] ?? [50, 50, "neutral", "neutral"];
    return {
      id: `sector-${index}`,
      name,
      kind: "sector",
      members: 12 + index,
      covered: 12 + index,
      returns: Object.fromEntries(periods.map((period, i) => [period, (index + i) % 5 - 2])),
      rs_1m: 1.2 - index * 0.3,
      rs_1w: 0.4 - index * 0.2,
      rs_pct: rsPct,
      mom_pct: momPct,
      rank: index + 1,
      rank_delta: index % 2 === 0 ? 1 : -1,
      breadth: 0.6 - index * 0.05,
      rel_volume: 1.1 - index * 0.1,
      quadrant,
      status,
      top_movers: [
        { symbol: "TCS", change: 1.5 },
        { symbol: "INFY", change: 0.8 },
      ],
    };
  });
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
        counts: { booming: 1, heating: 2, cooling: 1, dumping: 1, neutral: 1 },
        rows,
      }),
    ),
  );

  // setupSectorMocks only supplies three sectors; a six-sector board keeps the
  // visual overview evidence from looking artificially sparse. Registered
  // before the correlation/history routes so their specific matches win.
  await page.route(apiRoute("sector"), (route) =>
    route.fulfill(
      json({
        market: "india",
        sectors: [
          { sector: "Technology", avg_change: 2.45, stock_count: 45, advances: 35, declines: 10, avg_rsi: 62.5, avg_adx: 28.3, top_movers: "TCS(+3.2%) INFY(+2.8%) WIPRO(+1.9%)" },
          { sector: "Finance", avg_change: 1.2, stock_count: 38, advances: 25, declines: 13, avg_rsi: 58.0, avg_adx: 22.1, top_movers: "HDFC(+2.1%) ICICI(+1.5%) SBI(+0.8%)" },
          { sector: "Energy", avg_change: -0.85, stock_count: 22, advances: 8, declines: 14, avg_rsi: 45.2, avg_adx: 18.5, top_movers: "RELIANCE(+0.5%) ONGC(-1.2%) BPCL(-2.0%)" },
          { sector: "Healthcare", avg_change: 0.65, stock_count: 28, advances: 16, declines: 12, avg_rsi: 54.0, avg_adx: 21.4, top_movers: "SUNPHARMA(+1.8%) CIPLA(+0.9%) DRREDDY(-0.4%)" },
          { sector: "Auto", avg_change: 1.75, stock_count: 24, advances: 18, declines: 6, avg_rsi: 60.2, avg_adx: 25.7, top_movers: "MARUTI(+2.4%) M&M(+1.9%) TATAMOTORS(+1.2%)" },
          { sector: "Metals", avg_change: -1.4, stock_count: 20, advances: 7, declines: 13, avg_rsi: 42.8, avg_adx: 17.9, top_movers: "TATASTEEL(-1.8%) HINDALCO(-1.4%) JSWSTEEL(-0.9%)" },
        ],
        top_stock_movers: [
          { symbol: "TCS", change: 3.2 },
          { symbol: "INFY", change: 2.8 },
          { symbol: "HDFC", change: 2.1 },
          { symbol: "MARUTI", change: 1.9 },
          { symbol: "ICICI", change: 1.5 },
          { symbol: "RELIANCE", change: 0.5 },
        ],
        last_updated: new Date().toISOString(),
      }),
    ),
  );

  const correlationNames = [
    "NIFTY 50",
    "NIFTY BANK",
    "NIFTY IT",
    "NIFTY FMCG",
    "NIFTY AUTO",
    "NIFTY PHARMA",
    "NIFTY METAL",
  ];
  const correlationMatrix = [
    [1.0, 0.88, 0.64, 0.52, 0.71, 0.43, 0.66],
    [0.88, 1.0, 0.55, 0.41, 0.67, 0.32, 0.58],
    [0.64, 0.55, 1.0, 0.47, 0.38, 0.34, 0.29],
    [0.52, 0.41, 0.47, 1.0, 0.36, 0.44, 0.22],
    [0.71, 0.67, 0.38, 0.36, 1.0, 0.31, 0.63],
    [0.43, 0.32, 0.34, 0.44, 0.31, 1.0, 0.18],
    [0.66, 0.58, 0.29, 0.22, 0.63, 0.18, 1.0],
  ];
  const correlationRows = [
    { name: "NIFTY 50", beta_vs_index: 1.0, relative_strength_5d: 0.42, relative_strength_1m: 1.15, relative_strength_3m: 2.3, rank_current: 3, rank_change_1m: 0 },
    { name: "NIFTY BANK", beta_vs_index: 1.18, relative_strength_5d: 1.05, relative_strength_1m: 2.4, relative_strength_3m: 3.8, rank_current: 1, rank_change_1m: 1 },
    { name: "NIFTY IT", beta_vs_index: 0.92, relative_strength_5d: -0.28, relative_strength_1m: 0.65, relative_strength_3m: 1.45, rank_current: 4, rank_change_1m: -1 },
    { name: "NIFTY FMCG", beta_vs_index: 0.74, relative_strength_5d: 0.18, relative_strength_1m: 0.55, relative_strength_3m: 0.95, rank_current: 5, rank_change_1m: 0 },
    { name: "NIFTY AUTO", beta_vs_index: 1.09, relative_strength_5d: 0.86, relative_strength_1m: 1.72, relative_strength_3m: 2.6, rank_current: 2, rank_change_1m: 2 },
    { name: "NIFTY PHARMA", beta_vs_index: 0.68, relative_strength_5d: -0.35, relative_strength_1m: -0.8, relative_strength_3m: -1.2, rank_current: 6, rank_change_1m: -1 },
    { name: "NIFTY METAL", beta_vs_index: 1.22, relative_strength_5d: -0.95, relative_strength_1m: -1.85, relative_strength_3m: -2.7, rank_current: 7, rank_change_1m: 0 },
  ];
  await page.route(apiRoute("sector/correlation"), (route) =>
    route.fulfill(
      json({
        sectors: correlationRows,
        correlation_matrix: correlationMatrix,
        sector_names: correlationNames,
        last_updated: new Date().toISOString(),
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

test.describe.serial("Sector single-page evidence (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EVIDENCE, "set SCREENSHOT_EVIDENCE=1 to write mocked evidence captures");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await setupSectorTest(page);
    await mockLazySectionApis(page);
  });

  for (const state of SECTION_STATE_STATES) {
    test(`captures the ${state.id} ${state.mode} state at 1600 and 390`, async ({ browser }) => {
      // Each viewport needs an isolated page: a same-document navigation reuses
      // the module store, so a delayed/error/empty response would not re-fire.
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({ viewport });
        const freshPage = await context.newPage();
        try {
          await setupSectorTest(freshPage);
          await mockLazySectionApis(freshPage);
          const release = await registerSectionState(
            freshPage,
            state.section,
            state.mode as Exclude<CaptureMode, "loaded">,
          );
          try {
            await gotoPath(freshPage, SECTION_URL[state.section]);
            if (state.section !== "overview") {
              const nav = freshPage.getByTestId(`sector-nav-${state.section}`);
              await nav.click();
              await expect(nav).toHaveAttribute("aria-current", "location");
              await expect(freshPage.getByTestId(`sector-section-${state.section}`)).toBeInViewport();
            }
            await waitStateReady(freshPage, state);
            await scrollStateIntoView(freshPage, state);
            await frame(
              freshPage,
              EVIDENCE_DIR,
              state.id,
              viewport.width,
              state.mode !== "loading",
            );
          } finally {
            release();
          }
        } finally {
          await context.close();
        }
      }
    });
  }

  test("writes the manifest for the twenty-four mocked state frames", async () => {
    const { sha256, states } = writeEvidenceManifest(
      EVIDENCE_DIR,
      "sector-single-page",
      SECTION_STATE_STATES,
      true,
    );
    expect(states).toHaveLength(12);
    expect(Object.keys(sha256)).toHaveLength(24);
    for (const state of states) expect(state.mock).toBe(true);
  });
});

test.describe.serial("Sector single-page evidence (real API)", () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(
      !REAL_EVIDENCE || !REAL_API_PASSWORD,
      "set SECTOR_EVIDENCE_REAL=1 and SECTOR_E2E_PASSWORD to capture real-API evidence",
    );
    mkdirSync(REAL_EVIDENCE_DIR, { recursive: true });
    const login = await request.post(`${REAL_API_BASE}/api/auth/login`, {
      data: { email: REAL_API_EMAIL, password: REAL_API_PASSWORD },
    });
    if (!login.ok()) {
      throw new Error(
        `Real API login failed (${login.status()}): ${(await login.text()).slice(0, 500)}`,
      );
    }
    const credentials = await login.json();
    const token = credentials.access_token;
    const refreshToken = credentials.refresh_token;
    if (!token || !refreshToken) {
      throw new Error("Real API login response is missing access_token or refresh_token");
    }
    const me = await request.get(`${REAL_API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!me.ok()) {
      throw new Error(`Real API /auth/me failed (${me.status()}): ${(await me.text()).slice(0, 500)}`);
    }
    const user = await me.json();
    await page.addInitScript((session) => {
      localStorage.setItem("alphashri_token", session.token);
      localStorage.setItem("alphashri_refresh_token", session.refreshToken);
      localStorage.setItem("alphashri_user", JSON.stringify(session.user));
    }, { token, refreshToken, user });
  });

  for (const viewport of VIEWPORTS) {
    test(`captures real-API ${viewport.width}x${viewport.height} overview and section boards`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/sector", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("sector-analysis-view")).toBeVisible({ timeout: 30000 });
      for (const state of REAL_STATES) {
        await page.locator("#sector-page").evaluate((node) => {
          node.scrollTop = 0;
        });
        const variantUrl = REAL_VARIANT_URL[state.id];
        if (variantUrl) {
          await gotoPath(page, variantUrl);
          if (state.section !== "overview") {
            const nav = page.getByTestId(`sector-nav-${state.section}`);
            await nav.click();
            await expect(nav).toHaveAttribute("aria-current", "location");
            await expect(page.getByTestId(`sector-section-${state.section}`)).toBeInViewport();
          }
          switch (state.id) {
            case "overview-table":
              await expect(
                page
                  .getByTestId("sector-dashboard-view-toggle")
                  .getByRole("button", { name: "Table", exact: true }),
              ).toHaveAttribute("aria-pressed", "true");
              await expect(page.getByTestId("sector-table-container")).toBeVisible({
                timeout: 30000,
              });
              break;
            case "rotation-themes-empty":
              await expect(
                page.getByTestId("rotation-kind").getByRole("button", { name: "Themes" }),
              ).toHaveAttribute("aria-pressed", "true");
              await expect(
                page.getByTestId("rotation-period").getByRole("button", { name: "3M" }),
              ).toHaveAttribute("aria-pressed", "true");
              await expect(page.getByTestId("rotation-empty")).toBeVisible({ timeout: 30000 });
              await expect(page.getByTestId("rotation-empty")).toContainText(
                "No theme groups with at least 3 members.",
              );
              break;
            case "history-3y":
              await expect(page.getByTestId("sector-history-years").locator("select")).toHaveValue(
                "3",
              );
              break;
            case "history-lab":
              await expect(
                page
                  .getByTestId("sector-history-view-toggle")
                  .getByRole("button", { name: "Rotation Lab" }),
              ).toHaveAttribute("aria-pressed", "true");
              await expect(page.getByTestId("sector-history-lab")).toBeVisible({ timeout: 30000 });
              break;
          }
        } else if (state.section === "overview") {
          await expect(page.getByTestId("sector-nav-overview")).toHaveAttribute(
            "aria-current",
            "location",
          );
        } else {
          await page.getByTestId(`sector-nav-${state.section}`).click();
          await expect(page.getByTestId(`sector-section-${state.section}`)).toBeInViewport();
          await expect(page.getByTestId(`sector-nav-${state.section}`)).toHaveAttribute(
            "aria-current",
            "location",
          );
          await expect(page.getByTestId(state.ready)).toBeVisible({ timeout: 30000 });
        }

        if (state.section === "overview") {
          await expect(page.getByTestId("sector-summary-strip")).toBeVisible();
          if (state.id === "overview-table") {
            await expect(page.getByTestId("sector-table-container")).toBeVisible();
          } else {
            await expect(page.getByTestId("sector-heatmap-view")).toBeVisible();
            await expect(
              page.getByTestId("sector-heatmap-chart").locator("canvas").first(),
            ).toBeVisible({ timeout: 30000 });
            await expect(page.getByTestId("sector-alerts-card")).toBeAttached();
          }
        } else if (state.section === "rotation") {
          if (state.id === "rotation-themes-empty") {
            await expect(page.getByTestId("rotation-empty")).toBeVisible();
          } else {
            await expect(page.getByTestId("rotation-grid")).toBeVisible();
            await expect(page.getByTestId("rotation-empty")).toHaveCount(0);
          }
        } else if (state.section === "correlation") {
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
            "Real API returned no relative-strength rows",
          ).toBeGreaterThan(0);
        } else {
          await expect(page.getByTestId("sector-history-error-details")).toHaveCount(0);
          if (state.id === "history-lab") {
            await expect(page.getByTestId("sector-history-lab")).toBeVisible();
          } else {
            await expect(page.getByTestId("sector-history-overview")).toBeVisible();
          }
        }

        if (state.id === "rotation-board") {
          const board = page.getByTestId("rotation-board-panel");
          if (viewport.width === 1600) {
            await board.evaluate((node) =>
              node.scrollIntoView({ block: "start", inline: "nearest" }),
            );
          } else {
            await board.scrollIntoViewIfNeeded();
          }
          await expect(board).toBeInViewport();
        } else if (state.id === "correlation-rs") {
          const rsBoard = page.getByTestId("relative-strength-table");
          if (viewport.width === 1600) {
            await rsBoard.evaluate((node) =>
              node.scrollIntoView({ block: "start", inline: "nearest" }),
            );
          } else {
            await rsBoard.scrollIntoViewIfNeeded();
          }
          await expect(rsBoard).toBeInViewport();
        } else if (state.id === "history-risk") {
          const historyScroller = page.getByTestId("sector-history-overview");
          await historyScroller.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
          });
          const riskPanel = page.getByTestId("sector-history-risk-panel");
          // Real data has more rows than fit on a 390px screen: align the top of
          // the panel on narrow viewports so the first graded row is on screen.
          await riskPanel.evaluate(
            (node, align) => node.scrollIntoView({ block: align, inline: "nearest" }),
            viewport.width === 1600 ? "end" : "start",
          );
          await expect(riskPanel).toBeInViewport();
          const riskRows = riskPanel.locator('[data-testid^="sector-history-risk-row-"]');
          await expect(riskRows.first()).toBeVisible();
          const riskRowCount = await riskRows.count();
          expect(riskRowCount, "Real API returned no history risk rows").toBeGreaterThan(0);
          await expect(riskRows.first()).toBeInViewport({ ratio: 1 });
        }

        if (state.id === "correlation-us-1y") {
          await page.getByTestId("sector-correlation-scroll").evaluate((node) => {
            node.scrollTop = 0;
          });
          await selectCorrelationUsOneYear(page);
          await expect(page.getByTestId("sector-correlation-header")).toBeVisible();
          const matrix = page
            .getByTestId("sector-correlation-heatmap")
            .getByTestId("correlation-matrix-board");
          await expect(matrix).toBeVisible();
          await expect(matrix.locator('[data-diagonal="true"]').first()).toBeVisible();
        }

        await frame(page, REAL_EVIDENCE_DIR, state.id, viewport.width);
      }
    });
  }

  test("writes the real-API manifest for twenty-four captured frames", async () => {
    const { sha256, states } = writeEvidenceManifest(
      REAL_EVIDENCE_DIR,
      "sector-single-page-real",
      REAL_STATES,
      false,
    );
    expect(states).toHaveLength(12);
    expect(Object.keys(sha256)).toHaveLength(24);
    for (const state of states) expect(state.mock).toBe(false);
  });
});
