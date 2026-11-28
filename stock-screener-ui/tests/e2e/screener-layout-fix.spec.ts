/**
 * Screener layout regression: narrow results must be readable without sideways
 * hunting, and the wide GROUPS rail must not leave a blank body or a clipped
 * SECTOR column. Screenshots are written to the task artifact dir when
 * SCREENER_FIX_PHASE is set (before/after) for visual comparison.
 */
import { test, expect, type Page } from "@playwright/test";
import { loginAsTestUser, setupApiMocks } from "../mocks/apiResponses";
import {
  SCREENER_EVIDENCE_PATH,
  setupScreenerEvidenceMocks,
} from "../mocks/screenerEvidence";

const TABLE_ROWS = '[data-testid="screener-table"] tbody tr';
const FIX_DIR = "/workspaces/test-rag/.agent-artifacts/ui-a-plus/fixes";
const PHASE = process.env.SCREENER_FIX_PHASE;

async function openScreener(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupScreenerEvidenceMocks(page);
  await page.goto(SCREENER_EVIDENCE_PATH);
  await page.waitForSelector(TABLE_ROWS, { timeout: 20000 });
  await expect(page.locator(TABLE_ROWS).first()).toBeVisible();
  if (width >= 900) {
    await expect(page.getByTestId("group-performance-panel")).toBeVisible();
  } else {
    await expect(page.getByTestId("group-performance-panel")).toHaveCount(1);
  }
}

/** Geometry in one browser round-trip: nulls make missing nodes observable. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
    };
    const wrapper = document.querySelector('[data-testid="screener-table-scroll-wrapper"]');
    const panel = document.querySelector('[data-testid="screener-panel"]');
    const groups = document.querySelector('[data-testid="group-performance-panel"]');
    const headerCells = Array.from(document.querySelectorAll('[data-testid="screener-table"] thead th')).map((th) => ({
      id: th.id.replace("paper-tanstack-header-", ""),
      text: (th.textContent ?? "").trim(),
      x: th.getBoundingClientRect().x,
      right: th.getBoundingClientRect().right,
      clipped: th.scrollWidth > th.clientWidth + 1,
    }));
    return {
      viewport: window.innerWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panel: panel ? { x: panel.getBoundingClientRect().x, w: panel.getBoundingClientRect().width } : null,
      groups: groups ? { w: groups.getBoundingClientRect().width, h: groups.getBoundingClientRect().height, collapsed: groups.getAttribute("data-collapsed") } : null,
      groupsList: rect('[data-testid="group-performance-list"]'),
      groupsEmpty: rect('[data-testid="group-performance-empty"]'),
      wrapper: wrapper
        ? {
            w: wrapper.clientWidth,
            scrollWidth: wrapper.scrollWidth,
            scrollLeft: wrapper.scrollLeft,
            overflow: wrapper.scrollWidth - wrapper.clientWidth,
          }
        : null,
      table: rect('[data-testid="screener-table"]'),
      headerCells,
      firstRowCells: Array.from(
        document.querySelectorAll('[data-testid="screener-table"] tbody tr:first-child td'),
      ).map((td) => ({
        text: (td.textContent ?? "").trim().slice(0, 24),
        clipped: td.scrollWidth > td.clientWidth + 1,
      })),
      cue: rect('[data-testid="screener-table-scroll-cue"]'),
      firstSymbol: rect('[data-testid^="symbol-link-"]'),
    };
  });
}

async function capture(page: Page, width: number) {
  if (!PHASE) return;
  const fs = await import("node:fs/promises");
  await fs.mkdir(FIX_DIR, { recursive: true });
  await page.screenshot({ path: `${FIX_DIR}/screener-${PHASE}-${width}.png` });
}

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  test(`screener layout @ ${width}`, async ({ page }) => {
    await openScreener(page, width, height);
    await page.waitForLoadState("networkidle");
    const m = await measure(page);
    console.log(`[screener-layout ${width}] ${JSON.stringify(m)}`);
    await capture(page, width);

    if (width === 390) {
      expect(m.pageOverflow).toBeLessThanOrEqual(0);
      // Narrow results own the full width: no 248px GROUPS rail beside them.
      expect(m.panel?.w ?? 0).toBeGreaterThan(350);
      // Symbol and the primary metrics must be readable at initial scroll.
      const visibleHeaders = m.headerCells.filter((c) => c.x >= 0 && c.right <= width + 1);
      expect(visibleHeaders.map((c) => c.id)).toEqual(
        expect.arrayContaining(["symbol", "day_change", "upstox_price", "sector"]),
      );
      expect(visibleHeaders.filter((c) => c.clipped).map((c) => c.text)).toEqual([]);
      expect(m.firstSymbol?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((m.firstSymbol?.right ?? Infinity) <= width + 1).toBe(true);
      // No hidden horizontal scroll to find the money columns.
      expect(m.wrapper?.overflow ?? 0).toBeLessThanOrEqual(2);
    } else {
      expect(m.pageOverflow).toBeLessThanOrEqual(0);
      const sector = m.headerCells.find((c) => c.id === "sector");
      expect(sector).toBeDefined();
      expect(sector!.clipped).toBe(false);
      expect(sector!.right).toBeLessThanOrEqual(width);
      expect(sector!.right).toBeLessThanOrEqual((m.panel?.x ?? 0) + (m.panel?.w ?? 0));
      expect(m.wrapper?.overflow ?? 0).toBeLessThanOrEqual(2);
      expect(m.firstRowCells.filter((cell) => cell.clipped).map((cell) => cell.text)).toEqual([]);
    }
  });
}

test("1600: empty GROUPS body collapses to a compact empty state", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupScreenerEvidenceMocks(page);
  await page.route(/api\/sector\/groups/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ classify: "sector", period: "1D", groups: [] }),
    }),
  );
  await page.goto(SCREENER_EVIDENCE_PATH);
  await page.waitForSelector(TABLE_ROWS, { timeout: 20000 });

  const groups = page.getByTestId("group-performance-panel");
  await expect(groups).toHaveAttribute("data-collapsed", "true");
  const height = await groups.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeLessThan(120);
});
