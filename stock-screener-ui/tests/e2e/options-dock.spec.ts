import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupOptionDockMocks } from "../mocks/apiResponses";
import { ANALYTICS_EXPIRIES, ANALYTICS_STRIKES, analyticsBody } from "../mocks/analyticsResponse";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";

/**
 * Options dock (P1): chain → legs → payoff, opened from a symbol.
 *
 * Fully mocked: E1 (`/api/options/underlying/{symbol}`) and E2
 * (`/api/options/chain/{symbol}`). The mock reports `market_state: closed`,
 * so the dock does one fetch and never polls — that is what makes the request
 * counts exact rather than "roughly two".
 */

const SNAPSHOT_PATH = "/?tab=market";

const MOCK_ROWS = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "Energy",
    close: 1417.4,
    change: 0.8,
    relative_volume: 1.4,
    market_cap_cr: 1900000,
    cap_tier: "large",
    rsi: 58,
    adx: 24,
    pos_52w: 0.72,
    fno: true,
    etf: false,
    exchange: "NSE",
  },
];

async function mockMarketSnapshot(page: Page) {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        universe: "all_equity",
        total: MOCK_ROWS.length,
        update_mode: "streaming",
        rows: MOCK_ROWS,
      }),
    });
  });
}

/** The PATTERNS column lookups would otherwise hit the real API and log a 401. */
async function mockPatternLookup(page: Page) {
  await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "1D",
        session: "2026-11-16",
        source: "stored",
        data_through: "2026-11-14",
        items: [],
      }),
    });
  });
}

/**
 * The in-dock pillars read `GET /api/options/analytics/{symbol}`. The shared
 * `analyticsBody()` fixture carries the volatility/term/surface/RND blocks the
 * defaults render; POSITIONING additionally needs the raw per-strike arrays.
 */
function pillarsBody() {
  const strikes = [...ANALYTICS_STRIKES];
  const base = analyticsBody();
  return {
    ...base,
    expiries: base.expiries.map((expiry, index) =>
      index === 0
        ? {
            ...expiry,
            positioning: {
              pcr: 1.05,
              strikes,
              ceOi: strikes.map((_, i) => 22_000 + i * 3_000),
              peOi: strikes.map((_, i) => 18_000 + i * 2_000),
              ceOiChange: strikes.map((_, i) => (i % 2 === 0 ? 1_200 : -800)),
              peOiChange: strikes.map((_, i) => (i % 2 === 0 ? -1_000 : 700)),
              ceVolume: strikes.map((_, i) => 4_000 - i * 200),
              peVolume: strikes.map((_, i) => 3_500 - i * 150),
              maxPainCurve: strikes.map((strike, i) => ({ strike, payout: 1_000 - i * 100 })),
            },
          }
        : expiry,
    ),
  };
}

async function mockPillarsDashboard(page: Page) {
  const counts = { analytics: 0 };
  await page.route(apiRoute("options/analytics/**"), async (route) => {
    counts.analytics += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pillarsBody()),
    });
  });
  return { counts };
}

async function enterWithDock(
  page: Page,
  options: Parameters<typeof setupOptionDockMocks>[1] = {},
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page);
  await mockPatternLookup(page);
  const dock = await setupOptionDockMocks(page, options);
  return dock;
}

async function openDock(page: Page) {
  await page.goto(SNAPSHOT_PATH);
  await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="symbol-options-RELIANCE"]').first().click();
  await expect(page.locator('[data-testid="options-dock"]')).toBeVisible({ timeout: 15000 });
}

/**
 * Pick a chain price without letting Chrome park the row under the sticky
 * header. Once a leg mounts PAPER ORDER and PAYOFF, the chain band can hold
 * only two dense rows; `scrollIntoViewIfNeeded` scrolls the bare minimum and
 * leaves an off-ATM row beneath the header, so the click is intercepted.
 */
async function clickChainPrice(page: Page, testId: string) {
  const cell = page.locator(`[data-testid="${testId}"]`);
  // A leg mounts new bands and the chain re-centres with a smooth scroll. Wait
  // for that scroll to stop, or it would overwrite the position set below.
  let lastTop: number | null = null;
  await expect
    .poll(async () => {
      const top = await page.evaluate(() => {
        const scroller = document.querySelector(
          '[data-testid="options-chain-table"] .paper-tanstack-scroll',
        ) as HTMLElement | null;
        return scroller ? Math.round(scroller.scrollTop) : -1;
      });
      const stable = lastTop === top;
      lastTop = top;
      return stable;
    }, { timeout: 5000, intervals: [100] })
    .toBe(true);
  await cell.evaluate((node) => {
    const scroller = node.closest(".paper-tanstack-scroll") as HTMLElement | null;
    const row = node.closest("tr") as HTMLElement | null;
    if (!scroller || !row) return;
    const scrollTop = scroller.scrollTop;
    const rowTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scrollTop;
    scroller.scrollTop = rowTop - (scroller.clientHeight - row.getBoundingClientRect().height) / 2;
  });
  await cell.evaluate((node) => (node as HTMLElement).click());
}

/** Header labels with the sort-direction arrow stripped (strike sorts ▲ by default). */
async function chainHeaders(page: Page): Promise<string[]> {
  const raw = await page.locator('[data-testid="options-chain"] thead th').allTextContents();
  return raw.map((text) => text.replace(/[▲▼]/g, "").trim());
}

/** The chain owns one `.paper-tanstack-scroll`; it must never scroll sideways. */
async function chainScrollFits(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroller = document.querySelector(
      '[data-testid="options-chain-table"] .paper-tanstack-scroll',
    ) as HTMLElement;
    return scroller.scrollWidth <= scroller.clientWidth;
  });
}

/** True only when the ATM cell's rect is fully inside the chain scroller's band. */
async function atmCellInBand(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroller = document.querySelector(
      '[data-testid="options-chain-table"] .paper-tanstack-scroll',
    );
    const cell = document.querySelector('[data-testid="options-strike-cell-1420"]');
    if (!scroller || !cell) return false;
    const band = scroller.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    return band.height > 0 && rect.top >= band.top && rect.bottom <= band.bottom;
  });
}

async function setChainScrollTop(page: Page, top: number): Promise<void> {
  await page.evaluate((value) => {
    const el = document.querySelector(
      '[data-testid="options-chain-table"] .paper-tanstack-scroll',
    ) as HTMLElement;
    el.scrollTop = value;
  }, top);
}

/**
 * Bounce the scroller away from the target edge first, so every call dispatches
 * a scroll event even when the scroller is already parked there. The component
 * holds a programmatic-scroll guard until `scrollend` (or its fallback cap);
 * polling keeps nudging until that guard releases and follow is actually off.
 */
async function scrollUntilUnfollowed(page: Page, edge: "top" | "bottom"): Promise<void> {
  const host = page.locator('[data-testid="options-chain-table"]');
  await expect.poll(
    async () => {
      await page.evaluate((which) => {
        const el = document.querySelector(
          '[data-testid="options-chain-table"] .paper-tanstack-scroll',
        ) as HTMLElement;
        const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
        if (which === "top") el.scrollTop = el.scrollTop === 0 ? bottom : 0;
        else el.scrollTop = el.scrollTop >= bottom - 1 ? 0 : bottom;
      }, edge);
      return host.getAttribute("data-following");
    },
    { timeout: 8000, intervals: [200] },
  ).toBe("false");
}

test.describe("Options dock", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("opens from a symbol, costs two requests and lands on the nearest expiry", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-dock-symbol"]')).toHaveText("RELIANCE");

    // Nearest listed expiry, not the far one.
    await expect(page.locator('[data-testid="options-expiry-select"]')).toHaveValue("2026-11-26");

    expect(dock.counts.underlying).toBe(1);
    expect(dock.counts.chain).toBe(1);
  });

  test("adds two legs from the chain with zero extra requests, then renders payoff and POP", async ({
    page,
  }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    const before = dock.counts.underlying + dock.counts.chain;

    await page.locator('[data-testid="options-ce-1420"]').click();
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("1/4");
    await clickChainPrice(page, "options-pe-1400");

    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("2/4");
    expect(dock.counts.underlying + dock.counts.chain).toBe(before);

    // The payoff panel only exists once a leg exists.
    await expect(page.locator('[data-testid="options-payoff"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-pop"]')).toContainText("%");
    await expect(page.locator('[data-testid="options-breakevens"]')).toContainText("BE");
    await expect(page.locator('[data-testid="options-payoff-chart"]')).toBeVisible();

    // Four labelled footer cells, not one run-on line, and the footer starts
    // below the chart — the x-axis tick labels must not collide with it.
    const footer = page.locator('[data-testid="options-payoff-footer"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator("> *")).toHaveCount(4);
    await expect(page.locator('[data-testid="options-max-pnl"]')).toContainText("MAX P/L");
    await expect(page.locator('[data-testid="options-expected-pnl"]')).toContainText("MODEL E[P&L]");
    await expect(page.locator('[data-testid="options-expected-move"]')).toContainText("±1σ");
    const boxes = await page.evaluate(() => {
      const chart = document.querySelector('[data-testid="options-payoff-chart"]')!.getBoundingClientRect();
      const foot = document.querySelector('[data-testid="options-payoff-footer"]')!.getBoundingClientRect();
      return { chartBottom: chart.bottom, footerTop: foot.top, footerHeight: foot.height };
    });
    expect(boxes.footerTop).toBeGreaterThanOrEqual(Math.floor(boxes.chartBottom));
    expect(boxes.footerHeight).toBeLessThanOrEqual(28);
  });

  test("the dock's sections carry headers and are separated by hairlines", async ({ page }) => {
    await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="dock-section-chain"]')).toContainText(/CHAIN · RELIANCE/);
    await expect(page.locator('[data-testid="dock-section-strategy"]')).toHaveText("STRATEGY");
    await expect(page.locator('[data-testid="dock-section-legs"]')).toContainText("LEGS");

    await page.locator('[data-testid="options-ce-1420"]').click();
    // The analytics strip owns its labels — the section header band is empty.
    await expect(page.locator('[data-testid="analytics-tab-strip"]')).toBeVisible();
    await expect(page.locator('[data-testid="analytics-tab-payoff"]')).toHaveText("PAYOFF");
    await expect(page.locator('[data-testid="analytics-tab-smile"]')).toHaveText("IV BY STRIKE");

    await expect(page.locator('[data-testid="dock-section-paper-order"]')).toContainText("PAPER ORDER");

    const sections = page.locator("[data-dock-section]");
    // Clicking a chain price adds a leg, which reveals the PAPER ORDER band.
    await expect(sections).toHaveCount(5);
    const borders = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-dock-section]")).map((el) => ({
        id: el.getAttribute("data-testid"),
        borderTop: parseFloat(getComputedStyle(el).borderTopWidth),
        rounded: parseFloat(getComputedStyle(el).borderTopLeftRadius),
      })),
    );
    // Chain opens the column under the summary strip's own rule; the four below
    // it each add exactly one separator. No section is a rounded nested card.
    expect(borders.map((b) => b.borderTop)).toEqual([0, 1, 1, 1, 1]);
    for (const b of borders) expect(b.rounded).toBe(0);
  });

  test("strategy preset builds an iron condor and survives an expiry change", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    await page.locator('[data-testid="options-strategy"]').click();
    await page.locator('[data-testid="options-strategy-iron_condor"]').click();

    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("4/4");
    await expect(page.locator('[data-testid="options-leg-chips"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-strategy"]')).toContainText("Iron condor");
    await expect(page.locator('[data-testid="options-strategy-risk"]')).toHaveText("defined risk");

    // The preset prices from the in-memory frame: no extra chain request.
    expect(dock.counts.underlying).toBe(1);
    expect(dock.counts.chain).toBe(1);

    await expect(page.locator('[data-testid="options-payoff"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-pop"]')).toContainText("%");
    const points = await page
      .locator('[data-testid="options-payoff-chart"]')
      .getAttribute("data-points");
    expect(Number(points)).toBeGreaterThan(0);

    const before = dock.counts.chain;
    await page.locator('[data-testid="options-expiry-select"]').selectOption("2026-12-31");
    await expect.poll(() => dock.counts.chain, { timeout: 15000 }).toBe(before + 1);

    // Rebuilt against the new frame rather than left stale on the old expiry.
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("4/4");
    await expect(page.locator('[data-testid="options-legs-expiry-mismatch"]')).toBeHidden();
    await expect(page.locator('[data-testid="options-strategy"]')).toContainText("Iron condor");
  });

  test("No strategy clears the preset's legs", async ({ page }) => {
    await enterWithDock(page);
    await openDock(page);

    await page.locator('[data-testid="options-strategy"]').click();
    await page.locator('[data-testid="options-strategy-bull_call_spread"]').click();
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("2/4");

    await page.locator('[data-testid="options-strategy"]').click();
    await page.locator('[data-testid="options-strategy-none"]').click();

    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("0/4");
    await expect(page.locator('[data-testid="options-legs-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-strategy"]')).toContainText("No strategy");
  });

  test("changing expiry refetches the chain exactly once", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    const before = dock.counts.chain;

    await page.locator('[data-testid="options-expiry-select"]').selectOption("2026-12-31");

    await expect.poll(() => dock.counts.chain, { timeout: 15000 }).toBe(before + 1);
    expect(dock.counts.underlying).toBe(1);
  });

  test("a non-F&O underlying shows the dock's own empty state", async ({ page }) => {
    await enterWithDock(page, { fno: false });
    await openDock(page);

    await expect(page.locator('[data-testid="options-dock-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-dock-empty"]')).toContainText(
      "No listed options for RELIANCE",
    );
  });

  test("429 on refresh keeps the chain painted and shows the paused chip", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    dock.setChainStatus(429);
    await page.locator('[data-testid="options-refresh"]').click();

    await expect(page.locator('[data-testid="options-refresh-paused"]')).toBeVisible({
      timeout: 15000,
    });
    // The last frame is still there — a 429 must never blank the chain.
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-chain-row-1420"]')).toBeVisible();
  });

  test("closing the dock aborts polling and clears the surface", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    await page.locator('[data-testid="options-close"]').click();
    await expect(page.locator('[data-testid="options-dock"]')).toBeHidden({ timeout: 10000 });

    // Give any stray refresh timer a window to fire; the counter must stay put.
    const settled = dock.counts.chain;
    let ticks = 0;
    await expect
      .poll(
        () => {
          ticks += 1;
          expect(dock.counts.chain).toBe(settled);
          return ticks >= 6 ? "stable" : "waiting";
        },
        { timeout: 2000, intervals: [200] },
      )
      .toBe("stable");
  });

  test("narrow viewport opens a bottom sheet and the page never scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="options-dock-sheet"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    // One-sided CE control, defaulted to CE.
    const ce = page.locator('[data-testid="options-chain-side-ce"]');
    const pe = page.locator('[data-testid="options-chain-side-pe"]');
    await expect(ce).toBeVisible();
    await expect(pe).toBeVisible();
    await expect(ce).toHaveAttribute("aria-pressed", "true");
    await expect(pe).toHaveAttribute("aria-pressed", "false");

    // Exactly the five CE columns, in wireframe order, with no PE price cells.
    await expect(page.locator('[data-testid="options-chain"] thead th')).toHaveCount(5);
    expect(await chainHeaders(page)).toEqual(["OI", "IV", "Δ", "LTP", "STRIKE"]);
    await expect(page.locator('[data-testid="options-ce-1420"]')).toBeVisible();
    await expect(page.locator('[data-testid^="options-pe-"]')).toHaveCount(0);
    // The ATM row is the strike nearest spot (1417.4 → 1420).
    await expect(page.locator('[data-testid="options-chain-row-1420"]')).toHaveAttribute(
      "data-atm",
      "true",
    );
    await expect(page.locator('[data-testid="options-atm-marker-1420"]')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector(
        '[data-testid="options-chain-table"] .paper-tanstack-scroll',
      ) as HTMLElement;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        chainScrollWidth: scroller.scrollWidth,
        chainClientWidth: scroller.clientWidth,
        sheetHeight: Math.round(
          document.querySelector('[data-testid="options-dock-sheet"]')!.getBoundingClientRect().height,
        ),
      };
    });
    // A horizontal page scrollbar under 400 px is the class of bug a desktop
    // screenshot never shows — and neither should the chain's own scroller.
    expect(metrics.scrollWidth).toBe(metrics.clientWidth);
    expect(metrics.chainScrollWidth).toBeLessThanOrEqual(metrics.chainClientWidth);
    // 62vh of 844 = 523 px, ±2 px for rounding.
    expect(Math.abs(metrics.sheetHeight - 844 * 0.62)).toBeLessThan(3);
  });

  test("narrow chain: tapping PE flips the columns and keeps the ATM row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterWithDock(page);
    await openDock(page);

    const ce = page.locator('[data-testid="options-chain-side-ce"]');
    const pe = page.locator('[data-testid="options-chain-side-pe"]');
    await expect(ce).toHaveAttribute("aria-pressed", "true");
    await expect(pe).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-testid="options-ce-1420"]')).toBeVisible();

    await pe.click();

    await expect(ce).toHaveAttribute("aria-pressed", "false");
    await expect(pe).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-testid="options-chain"] thead th')).toHaveCount(5);
    await expect.poll(() => chainHeaders(page), { timeout: 10000 }).toEqual([
      "STRIKE",
      "LTP",
      "Δ",
      "IV",
      "OI",
    ]);
    await expect(page.locator('[data-testid="options-pe-1420"]')).toBeVisible();
    await expect(page.locator('[data-testid^="options-ce-"]')).toHaveCount(0);
    // Same strike/ATM row survives the side switch.
    await expect(page.locator('[data-testid="options-chain-row-1420"]')).toHaveAttribute(
      "data-atm",
      "true",
    );
    await expect(page.locator('[data-testid="options-atm-marker-1420"]')).toBeVisible();
    await expect.poll(() => chainScrollFits(page), { timeout: 10000 }).toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
  });

  test("wide viewport hides the side toggle and keeps the nine-column chain", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-chain-side-ce"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="options-chain-side-pe"]')).toHaveCount(0);

    await expect(page.locator('[data-testid="options-chain"] thead th')).toHaveCount(9);
    expect(await chainHeaders(page)).toEqual([
      "OI",
      "IV",
      "Δ",
      "LTP",
      "STRIKE",
      "LTP",
      "Δ",
      "IV",
      "OI",
    ]);
    await expect(page.locator('[data-testid="options-ce-1420"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-pe-1420"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-atm-marker-1420"]')).toBeVisible();

    // Sorting is unchanged: strike is the initial ascending primary sort.
    await expect(page.locator("#paper-tanstack-header-strike")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(page.locator('[data-testid="options-chain"] tbody tr').first()).toHaveAttribute(
      "data-testid",
      "options-chain-row-1340",
    );
    // Clicking a numeric OI header promotes it to a descending primary sort.
    await page.locator("#paper-tanstack-header-ce_oi").click();
    await expect(page.locator("#paper-tanstack-header-ce_oi")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(page.locator('[data-testid="options-chain"] tbody tr').first()).toHaveAttribute(
      "data-testid",
      "options-chain-row-1420",
    );
    // ATM is pinned to the strike nearest spot, not to a row position.
    await expect(page.locator('[data-testid="options-atm-marker-1420"]')).toBeVisible();
  });

  test("wide: the chain opens centred on ATM and a manual scroll stops following", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await enterWithDock(page);
    await openDock(page);

    const host = page.locator('[data-testid="options-chain-table"]');
    // The initial centre is a real scroll of the chain, not the page — a short
    // ladder that fits the scroller could not exercise follow at all. Sample
    // "centred" and follow in one atomic read: a trailing easing frame can no
    // longer slip between the two checks and be sampled as a manual scroll.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const scroller = document.querySelector(
              '[data-testid="options-chain-table"] .paper-tanstack-scroll',
            );
            const cell = document.querySelector('[data-testid="options-strike-cell-1420"]');
            const table = document.querySelector('[data-testid="options-chain-table"]');
            if (!scroller || !cell || !table) return null;
            const band = scroller.getBoundingClientRect();
            const rect = cell.getBoundingClientRect();
            const centred =
              scroller.scrollTop > 0 &&
              band.height > 0 &&
              rect.top >= band.top &&
              rect.bottom <= band.bottom;
            return centred ? table.getAttribute("data-following") : null;
          }),
        { timeout: 10000 },
      )
      .toBe("true");

    await scrollUntilUnfollowed(page, "top");
    await setChainScrollTop(page, 0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector(
              '[data-testid="options-chain-table"] .paper-tanstack-scroll',
            ) as HTMLElement).scrollTop,
        ),
      )
      .toBe(0);
    await expect(host).toHaveAttribute("data-following", "false");
  });

  test("wide: Center restores following and brings the ATM row back into view", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await enterWithDock(page);
    await openDock(page);

    const host = page.locator('[data-testid="options-chain-table"]');
    await expect.poll(() => atmCellInBand(page), { timeout: 10000 }).toBe(true);

    await scrollUntilUnfollowed(page, "bottom");
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="options-chain-table"] .paper-tanstack-scroll',
      ) as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });
    // Away from centre the ATM cell really is out of the visible band.
    await expect.poll(() => atmCellInBand(page), { timeout: 10000 }).toBe(false);
    await expect(host).toHaveAttribute("data-following", "false");

    await page.locator('[data-testid="options-chain-center"]').click();

    await expect(host).toHaveAttribute("data-following", "true");
    await expect.poll(() => atmCellInBand(page), { timeout: 10000 }).toBe(true);
  });

  test("narrow: the chain opens centred on ATM with no sideways page scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterWithDock(page);
    await openDock(page);

    await expect.poll(() => atmCellInBand(page), { timeout: 10000 }).toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
  });

  test("wide: level badges render on their strike cell and the summary echoes them", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await enterWithDock(page);
    await openDock(page);

    const wideBadges: Array<[number, string]> = [
      [1420, "MP"],
      [1470, "CW"],
      [1390, "PW"],
      [1400, "SUP"],
      [1450, "RES"],
    ];
    for (const [strike, code] of wideBadges) {
      const badge = page.locator(`[data-testid="options-strike-badge-${strike}"]`);
      await expect(badge).toHaveAttribute("data-code", code);
      await expect(badge).toHaveText(code);
      await expect(page.locator(`[data-testid="options-strike-cell-${strike}"]`)).toContainText(code);
    }

    const line = page.locator('[data-testid="options-levels-line"]');
    await expect(line).toBeVisible();
    for (const label of ["SUP", "RES", "PW", "CW"]) {
      await expect(line).toContainText(label);
    }
    await expect(page.locator('[data-testid="options-stat-max-pain"]')).toContainText("1,420");
  });

  test("narrow 390: strike badges are one-letter rails, never multi-letter chips", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterWithDock(page);
    await openDock(page);

    const narrowBadges: Array<[number, string]> = [
      [1420, "M"],
      [1470, "C"],
      [1390, "P"],
      [1400, "S"],
      [1450, "R"],
    ];
    for (const [strike, letter] of narrowBadges) {
      const badge = page.locator(`[data-testid="options-strike-badge-${strike}"]`);
      await expect(badge).toHaveAttribute("role", "img");
      await expect(badge).toHaveAttribute("data-letter", letter);
      await expect(badge).toHaveText(letter);
      await expect(page.locator(`[data-testid="options-strike-cell-${strike}"]`)).toContainText(letter);
      const railWidth = await badge
        .locator('[aria-hidden="true"]')
        .first()
        .evaluate((el) => (el as HTMLElement).style.width);
      expect(railWidth).toBe("2px");
    }

    // No multi-letter chip survives at 390 px: every badge carries one letter.
    const badges = page.locator('[data-testid^="options-strike-badge-"]');
    await expect(badges).toHaveCount(5);
    await expect(badges.filter({ hasText: /MP|CW|PW|SUP|RES/ })).toHaveCount(0);

    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
  });

  test("narrow 390: level rails, five analytics tabs and a stable header when analytics opens", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    // Narrow one-letter markers + 2px rails on the five level strikes.
    const narrowBadges: Array<[number, string]> = [
      [1420, "M"],
      [1470, "C"],
      [1390, "P"],
      [1400, "S"],
      [1450, "R"],
    ];
    for (const [strike, letter] of narrowBadges) {
      const badge = page.locator(`[data-testid="options-strike-badge-${strike}"]`);
      await expect(badge).toHaveAttribute("role", "img");
      await expect(badge).toHaveAttribute("data-letter", letter);
      await expect(badge).toHaveText(letter);
      await expect(page.locator(`[data-testid="options-strike-cell-${strike}"]`)).toContainText(
        letter,
      );
      const railWidth = await badge
        .locator('[aria-hidden="true"]')
        .first()
        .evaluate((el) => (el as HTMLElement).style.width);
      expect(railWidth).toBe("2px");
    }
    const badges = page.locator('[data-testid^="options-strike-badge-"]');
    await expect(badges).toHaveCount(5);
    await expect(badges.filter({ hasText: /MP|CW|PW|SUP|RES/ })).toHaveCount(0);

    // Real narrow summary: the level line keeps SUP/RES only, and max pain is
    // the PAIN stat value rather than an "MP" chip.
    const levelLine = page.locator('[data-testid="options-levels-line"]');
    await expect(levelLine).toBeVisible();
    await expect(levelLine).toContainText("SUP");
    await expect(levelLine).toContainText("RES");
    await expect(levelLine).not.toContainText("PW");
    await expect(levelLine).not.toContainText("CW");
    await expect(page.locator('[data-testid="options-stat-max-pain"]')).toContainText("1,420");

    const noBodyOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    await expect.poll(noBodyOverflow, { timeout: 10000 }).toBe(true);

    // Measure the band geometry before analytics mounts — tab reachability
    // below scrolls the dock and would otherwise move the chain table top.
    const geometry = () =>
      page.evaluate(() => {
        const rect = (id: string) =>
          Math.round((document.querySelector(`[data-testid="${id}"]`) as HTMLElement)
            .getBoundingClientRect()
            .top);
        const height = (id: string) =>
          Math.round((document.querySelector(`[data-testid="${id}"]`) as HTMLElement)
            .getBoundingClientRect()
            .height);
        return {
          headerHeight: height("options-dock-header"),
          summaryHeight: height("options-summary"),
          chainTop: rect("options-chain-table"),
        };
      });
    const before = await geometry();

    // Selecting a strike adds a leg and mounts the analytics band + tab strip.
    await page.locator('[data-testid="options-ce-1420"]').click();
    await expect(page.locator('[data-testid="analytics-tab-payoff"]')).toHaveText("PAYOFF");
    await expect(page.locator('[data-testid="options-payoff-chart"]')).toBeVisible();

    const after = await geometry();
    expect(after.headerHeight).toBe(before.headerHeight);
    expect(after.summaryHeight).toBe(before.summaryHeight);
    expect(after.chainTop).toBe(before.chainTop);

    // All five tabs stay reachable at 390px; the strip owns overflow when they don't fit.
    const strip = page.locator('[data-testid="analytics-tabs-list"]');
    await expect(strip).toBeVisible();
    const tabs: Array<[string, string]> = [
      ["payoff", "PAYOFF"],
      ["smile", "IV BY STRIKE"],
      ["term", "IV BY EXPIRY"],
      ["surface", "IV MAP"],
      ["prob", "POSITION ODDS"],
    ];
    for (const [id, label] of tabs) {
      const tab = page.locator(`[data-testid="analytics-tab-${id}"]`);
      await expect(tab).toHaveText(label);
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeInViewport();
    }
    await expect(page.locator('[data-testid="analytics-tab-prob"]')).toBeInViewport();

    await expect.poll(noBodyOverflow, { timeout: 10000 }).toBe(true);
  });

  test("Analytics opens the four pillars inside the dock without a route hop", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const dock = await enterWithDock(page);
    // Registered after the app mocks so it wins over the broad `/api/**` handler.
    const dashboard = await mockPillarsDashboard(page);
    await openDock(page);

    // A leg mounts the analytics strip, which owns the pillars entry point.
    await page.locator('[data-testid="options-ce-1420"]').click();
    await expect(page.locator('[data-testid="analytics-tab-strip"]')).toBeVisible();

    const before = new URL(page.url());
    const openPillars = page.locator('[data-testid="analytics-pillars-open"]');
    await expect(openPillars).toBeVisible();
    await expect(openPillars).toContainText("Analytics");
    await openPillars.click();

    await expect(page.locator('[data-testid="dock-pillars"]')).toBeVisible({ timeout: 15000 });

    // The dock stays the surface: no `/options/analytics` hop, same pathname.
    const after = new URL(page.url());
    expect(after.pathname).toBe(before.pathname);
    expect(after.href).not.toContain("/options/analytics");
    // The pillars view mounts in its loading state, so the dashboard read is
    // async — poll rather than read the counter on the visibility frame.
    await expect.poll(() => dashboard.counts.analytics, { timeout: 15000 }).toBeGreaterThan(0);

    for (const key of ["volatility", "positioning", "dealer", "liquidity"]) {
      await expect(page.locator(`[data-testid="dock-pillar-tab-${key}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="dock-pillar-tab-volatility"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Expiry chips come from the dashboard payload, front contract pre-selected.
    await expect(page.locator('[data-testid="dock-pillars-expiry-row"]')).toBeVisible();
    for (const date of ANALYTICS_EXPIRIES) {
      await expect(page.locator(`[data-testid="dock-pillars-expiry-${date}"]`)).toBeVisible();
    }
    await expect(
      page.locator(`[data-testid="dock-pillars-expiry-${ANALYTICS_EXPIRIES[0]}"]`),
    ).toHaveAttribute("aria-pressed", "true");

    await page.locator('[data-testid="dock-pillar-tab-positioning"]').click();
    await expect(page.locator('[data-testid="pillar-positioning"]')).toBeVisible();
    await expect(page.locator('[data-testid="dock-pillar-tab-positioning"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator('[data-testid="positioning-expiry"]')).toBeVisible();
    await expect(page.locator('[data-testid="positioning-chart-grid"]')).toBeVisible();

    await page.locator('[data-testid="dock-pillars-back"]').click();
    await expect(page.locator('[data-testid="dock-pillars"]')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('[data-testid="options-chain-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    // Same dock, same mocked frame — no extra underlying/chain traffic.
    expect(dock.counts.underlying).toBe(1);
    expect(dock.counts.chain).toBe(1);
  });

  test("a chain with no levels renders no strike badges or level line", async ({ page }) => {
    await enterWithDock(page, { levels: false });
    await openDock(page);

    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-strike-cell-1420"]')).toContainText("1,420");
    await expect(page.locator('[data-testid^="options-strike-badge-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="options-levels-line"]')).toHaveCount(0);
  });
});
