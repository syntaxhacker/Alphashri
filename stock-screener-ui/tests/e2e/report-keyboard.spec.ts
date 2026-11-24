/**
 * Keyboard contract for the Index Report, on the same real route and shared
 * mocks as `nifty-report.spec.ts` / `app-a11y.spec.ts`.
 *
 * Gated behind REPORT_KEYBOARD=1: focus order is a browser-level contract, so
 * this stays out of the default smoke tier. Run explicitly with
 * `REPORT_KEYBOARD=1 npx playwright test tests/e2e/report-keyboard.spec.ts`.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  mockNiftyReport,
  setupApiMocks,
  setupNiftyReportMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const KEYBOARD = process.env.REPORT_KEYBOARD === "1";
const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

const CHART_CONTROL_IDS = new Set([
  "nifty-chart-controls-mobile",
  "nifty-chart-controls-desktop",
  "nifty-chart-source",
  "nifty-tf-toggle",
  "nifty-chart-controls-more",
  "nifty-chart-controls-more-desktop",
]);
const DOCK_IDS = new Set(["desk-dock", "desk-dock-region"]);

type FocusStep = { tag: string; testIds: string[]; label: string };

function hasId(step: FocusStep, ids: Set<string>): boolean {
  return step.testIds.some((id) => ids.has(id));
}

function describeSteps(steps: FocusStep[]): string {
  return steps
    .map(
      (step, index) =>
        `${index + 1}: ${step.testIds.join(" > ") || step.tag} [${step.label}]`,
    )
    .join("\n");
}

/** The shared report fixture has no futures/ITM block, so add the two live
 *  panels locally: they are now DESK BAY tabs, not a band above the chart. */
async function setupFlowPanels(page: Page) {
  await page.route(apiRoute("reports/nifty/live"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockNiftyReport,
        futures: {
          symbol: "NIFTY",
          instrument_key: "NSE:INDEX_FUT",
          expiry: "2026-10-14",
          series: [
            { t: "09:16", close: 22400, oi: 12000, volume: 4000 },
            { t: "09:17", close: 22410, oi: 12200, volume: 4200 },
          ],
          change_pts: 10,
          oi_change: 200,
          regime: "long_buildup",
          as_of: "09:17",
        },
        itm_pe_flow: {
          series: [
            { t: "09:16", itm_pe_vol: 1000, total_pe_vol: 5000, share_pct: 20, spot: 22360 },
            { t: "09:17", itm_pe_vol: 1200, total_pe_vol: 5200, share_pct: 23, spot: 22375 },
          ],
          top: [{ strike: 22400, volume: 500, oi: 3000 }],
          as_of: "09:17",
        },
      }),
    });
  });
}

/** The chart's PATTERNS source asks the real /detect endpoint; the shared
 *  mocks do not cover chart patterns, so give it one deterministic hit. */
async function setupPatternDetect(page: Page) {
  await page.route(apiRoute("chart-patterns/detect"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: "NIFTY",
        timeframe: "1m",
        data_through: "2026-10-12T10:00:00",
        count: 1,
        hits: [
          {
            pattern_id: "double-bottom",
            pattern_name: "Double bottom",
            direction: "bullish",
            status: "confirmed",
            breakout_level: 22400,
            target: 22500,
            stop: 22300,
            confidence: 80,
            bars_ago: 0,
          },
        ],
      }),
    });
  });
}

async function openReport(page: Page, width: number, height: number, flowPanels = false) {
  await page.setViewportSize({ width, height });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupNiftyReportMocks(page);
  await setupPatternDetect(page);
  if (flowPanels) await setupFlowPanels(page);
  await page.goto("/report/index");
  await expect(page.getByTestId("nifty-report-panel")).toBeVisible();
  await expect(page.getByTestId("nifty-decision-hero")).toBeVisible();
  await expect(page.getByTestId("nifty-oi-table")).toBeVisible();
}

async function readFocus(page: Page): Promise<FocusStep | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return null;
    const testIds: string[] = [];
    let cursor: HTMLElement | null = active;
    while (cursor && cursor !== document.body) {
      const id = cursor.getAttribute("data-testid");
      if (id) testIds.push(id);
      cursor = cursor.parentElement;
    }
    return {
      tag: active.tagName.toLowerCase(),
      testIds,
      label:
        active.getAttribute("aria-label") ||
        active.getAttribute("title") ||
        (active.textContent || "").trim().slice(0, 40),
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: no positive tabindex anywhere in the report`, async ({ page }) => {
    test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

    await openReport(page, viewport.width, viewport.height);
    const positives = await page
      .locator('[data-testid="nifty-report-panel"] [tabindex]')
      .evaluateAll((elements) =>
        elements
          .map((element) => ({
            testId: element.getAttribute("data-testid"),
            tabindex: element.getAttribute("tabindex"),
          }))
          .filter((item) => Number(item.tabindex) > 0),
      );
    expect(positives, `positive tabindex hijacks focus order: ${JSON.stringify(positives)}`).toEqual([]);
  });
}

test("390px: forward focus from the decision hero reaches chart controls before DESK BAY", async ({ page }) => {
  test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

  await openReport(page, 390, 844, true);
  const order = await page.evaluate(() => {
    const find = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    const chartRow = find("nifty-main-row");
    const dock = find("desk-dock-region");
    if (!(chartRow instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
      return null;
    }
    const follows = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      dockAfterChartDom: follows(chartRow, dock),
      dockBelowChart: dock.getBoundingClientRect().top > chartRow.getBoundingClientRect().top,
    };
  });
  expect(order, "chart row and DESK BAY must both render").not.toBeNull();
  expect(order?.dockAfterChartDom).toBe(true);
  expect(order?.dockBelowChart).toBe(true);
  await expect(page.getByTestId("desk-dock-futures")).toBeVisible();
  await expect(page.getByTestId("desk-dock-itm")).toBeVisible();

  await page.getByTestId("nifty-plan-reasons-button").focus();
  const steps: FocusStep[] = [];
  for (let i = 0; i < 48; i++) {
    await page.keyboard.press("Tab");
    const step = await readFocus(page);
    if (!step) break;
    steps.push(step);
    if (steps.some((entry) => hasId(entry, CHART_CONTROL_IDS)) &&
        steps.some((entry) => hasId(entry, DOCK_IDS))) {
      break;
    }
  }

  const chartIndex = steps.findIndex((step) => hasId(step, CHART_CONTROL_IDS));
  const dockIndex = steps.findIndex((step) => hasId(step, DOCK_IDS));
  const trace = `forward Tab from the decision hero:\n${describeSteps(steps)}`;
  expect(chartIndex, `chart controls not reached by Tab — ${trace}`).toBeGreaterThanOrEqual(0);
  expect(dockIndex, `DESK BAY not reached by Tab — ${trace}`).toBeGreaterThanOrEqual(0);
  expect(chartIndex, `DESK BAY focused before chart controls — ${trace}`).toBeLessThan(dockIndex);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: ALL STATS disclosure opens/closes from the keyboard`, async ({ page }) => {
    test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

    await openReport(page, viewport.width, viewport.height);
    const disclosure = page.getByTestId("nifty-verdict-disclosure");
    const toggle = disclosure.getByTestId("nifty-live-tape-toggle");
    const content = disclosure.getByTestId("nifty-live-tape-content");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("ALL STATS");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(disclosure).toHaveAttribute("data-open", "false");

    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(disclosure).toHaveAttribute("data-open", "true");
    await expect(content).toBeVisible();

    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(disclosure).toHaveAttribute("data-open", "false");
    await expect(content).toBeHidden();
    await expect(toggle).toBeFocused();
  });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: chart DRAW OFF toggles with Enter and Space`, async ({ page }) => {
    test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

    await openReport(page, viewport.width, viewport.height);
    await page
      .getByTestId("nifty-chart-source")
      .getByRole("button", { name: "PATTERNS" })
      .click();
    await expect(page.getByTestId("nifty-patterns-empty")).toBeVisible();
    await page.getByTestId("nifty-patterns-run").click();
    await expect(page.getByTestId("nifty-patterns-strip")).toHaveAttribute("data-status", "ready");

    const draw = page.getByTestId("nifty-patterns-draw");
    await expect(draw).toHaveCount(1);
    await expect(draw).toHaveText("DRAW ON");
    await expect(draw).toHaveAttribute("tabindex", "0");

    await draw.focus();
    await expect(draw).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(draw).toHaveText("DRAW OFF");
    await expect(draw).toHaveAttribute("data-on", "0");
    await expect(draw).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Space");
    await expect(draw).toHaveText("DRAW ON");
    await expect(draw).toHaveAttribute("data-on", "1");
    await expect(draw).toHaveAttribute("aria-pressed", "true");
  });
}

test("390px: option-chain region is focusable and Arrow keys are handled", async ({ page }) => {
  test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

  await openReport(page, 390, 844);
  const chain = page.getByTestId("nifty-oi-wrap");
  await expect(chain).toBeVisible();
  await expect(chain).toHaveAttribute("role", "region");
  await expect(chain).toHaveAttribute("aria-label", "Option chain");
  await expect(chain).toHaveAttribute("data-chain-scroll", "1");
  await expect(chain).toHaveAttribute("tabindex", "0");

  const before = await chain.evaluate((element) => ({
    scrollLeft: element.scrollLeft,
    scrollable: element.scrollWidth - element.clientWidth,
  }));
  // The phone chain hides the SIG columns and fits whole; the region must
  // remain focusable and accept arrows even when there is no horizontal travel.
  expect(before.scrollable).toBe(0);

  await chain.focus();
  await expect(chain).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const afterRight = await chain.evaluate((element) => element.scrollLeft);
  expect(afterRight).toBeGreaterThanOrEqual(before.scrollLeft);

  await page.keyboard.press("ArrowLeft");
  const afterLeft = await chain.evaluate((element) => element.scrollLeft);
  expect(afterLeft).toBeLessThanOrEqual(afterRight);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: F enters in-shell chart focus, Esc restores`, async ({ page }) => {
    test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

    await openReport(page, viewport.width, viewport.height);
    const panel = page.getByTestId("nifty-report-panel");
    await expect(panel).toHaveAttribute("data-chart-focus", "false");
    await page.keyboard.press("f");
    await expect(panel).toHaveAttribute("data-chart-focus", "true");
    await expect(page.getByTestId("nifty-chart-focus-exit")).toBeVisible();
    // Nothing unmounts in LEVEL 1: the chart and chain stay in the tree.
    await expect(page.getByTestId("nifty-main-row")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveAttribute("data-chart-focus", "false");
    await expect(page.getByTestId("nifty-chart-focus-exit")).toHaveCount(0);
  });

  test(`${viewport.width}px: expand is LEVEL 2 fullscreen and Esc closes it`, async ({ page }) => {
    test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

    await openReport(page, viewport.width, viewport.height);
    const expand = page.getByTestId("nifty-chart-controls-desktop").getByRole("button", { name: /expand|fullscreen/i });
    if (await expand.count()) {
      await expand.first().click();
      await expect(page.getByTestId("nifty-chart-fullscreen-body")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("nifty-chart-fullscreen-body")).toHaveCount(0);
    }
  });
}

test("desktop: analytics tabs open in the dock drawer and Alt+1 toggles", async ({ page }) => {
  test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

  await openReport(page, 1600, 1000, true);
  await expect(page.getByTestId("nifty-flow-above-chart")).toHaveCount(0);
  await page.getByTestId("desk-dock-futures").click();
  await expect(page.getByTestId("nifty-futures-panel")).toBeVisible();
  await expect(page.getByTestId("desk-dock-drawer")).toBeVisible();
  await page.keyboard.press("Alt+1");
  await expect(page.getByTestId("desk-dock-drawer")).toHaveCount(0);
});

test("1600px: MONITOR | DESK switch mounts the window desk with a preset picker", async ({ page }) => {
  test.skip(!KEYBOARD, "set REPORT_KEYBOARD=1 to run report keyboard checks");

  await openReport(page, 1600, 1000);
  const toggle = page.getByTestId("nifty-report-view-toggle");
  await expect(toggle.getByTestId("nifty-report-view-monitor")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("window-manager-canvas")).toHaveCount(0);

  await toggle.getByTestId("nifty-report-view-desk").click();
  await expect(page.getByTestId("report-window-desk")).toBeVisible();
  await expect(page.getByTestId("window-manager-canvas")).toBeVisible();
  const picker = page.getByTestId("nifty-report-preset-select");
  await expect(picker).toBeVisible();

  // Focus order: workspace toggle -> preset picker -> window frames, and the
  // desk never steals focus onto the canvas or a frame on mount.
  // DESK is the last button in the toggle, so the next Tab lands on the picker.
  await toggle.getByTestId("nifty-report-view-desk").focus();
  await page.keyboard.press("Tab");
  await expect(picker).toBeFocused();
  await page.keyboard.press("Tab");
  const focused = await readFocus(page);
  expect(focused?.testIds.some((id) => id.startsWith("window-"))).toBe(true);

  await picker.selectOption("full");
  await expect(page.locator('[data-testid^="window-"][data-window-id]')).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("report-window-desk")).toBeVisible();
});
