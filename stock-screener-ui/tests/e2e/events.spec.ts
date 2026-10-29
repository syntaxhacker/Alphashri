import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupValueScanMocks } from "../mocks/apiResponses";
import {
  MOCK_EVENT_COUNT,
  ORCL_EVENT_ID,
  ORCL_LEAD_DAYS,
  buildAnomalyFixtures,
  setupEventsMocks,
  type EventsMockOptions,
} from "../mocks/eventResponses";

/**
 * Event Radar tab (`GET /api/events/calendar` + `GET /api/events/anomalies`).
 *
 * The panel is fully mocked — no network, no backend required. Mocks are
 * registered per test (inside `openEventsTab`) because the error-state and
 * anomalies tests need different payloads for the same two routes.
 *
 * Note on past events: `EventsPanel` seeds `upcoming_only: true` and
 * `EventsFilters` exposes no toggle for it, so the UI never asks the server for
 * a past row. The "3d ago" branch of `formatDaysUntil` is therefore covered by
 * `src/components/events/EventsTable.test.tsx` (unit), and the E2E asserts the
 * query flag plus the absence of past copy instead of faking a payload the
 * backend would never send.
 */
test.describe("Event Radar tab", () => {
  const consoleErrors: string[] = [];
  /**
   * The error-state test deliberately mocks a 500, and Chromium logs an
   * unsuppressable "Failed to load resource" for it. Only that test may waive
   * resource-load noise; every other test still fails on any console error.
   */
  let allowResourceErrors = false;

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    allowResourceErrors = false;
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        const text = msg.text();
        if (
          text.includes("ws/") ||
          text.includes("WebSocket") ||
          text.includes("ERR_CONNECTION_REFUSED") ||
          text.includes("hydration error") ||
          text.includes("Maximum update depth") ||
          // pre-existing repo-wide: the @/ui Tabs.Tab wrapper does not consume
          // `leftSection`, so React logs an unknown-prop warning for every tab
          // (dashboard / screener / correlation / config already do this).
          text.includes("React does not recognize")
        ) {
          return;
        }
        consoleErrors.push(text);
      }
    });
    await setupApiMocks(page);
    await setupValueScanMocks(page);
    await loginAsTestUser(page);
  });

  test.afterEach(() => {
    const unexpected = allowResourceErrors
      ? consoleErrors.filter((text) => !text.includes("Failed to load resource"))
      : consoleErrors;
    expect(unexpected).toEqual([]);
  });

  /** Register the events mocks, open the tab and wait for the panel shell. */
  async function openEventsTab(page: Page, options: EventsMockOptions = {}) {
    await setupEventsMocks(page, options);
    await page.goto("/?tab=events");
    await page.waitForSelector('[data-testid="events-panel"]', { timeout: 15000 });
  }

  test("opens on the events tab and renders the calendar", async ({ page }) => {
    await openEventsTab(page);

    await expect(page.locator('[data-testid="tab-events"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator('[data-testid="events-tab-label"]')).toBeVisible();
    await expect(page.locator('[data-testid="events-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible();

    const rows = page.locator('[data-testid^="event-row-"]');
    await expect(rows).toHaveCount(MOCK_EVENT_COUNT);

    // The investor-day row: alpha badge + relative-day copy.
    const orclRow = page.locator(`[data-testid="event-row-${ORCL_EVENT_ID}"]`);
    await expect(orclRow).toBeVisible();
    await expect(orclRow).toContainText("ORCL");
    await expect(orclRow).toContainText("Investor Day");
    await expect(page.locator(`[data-testid="event-days-${ORCL_EVENT_ID}"]`)).toHaveText(
      "in 3d",
    );
  });

  test("prints today / in 3d and never asks for past events", async ({ page }) => {
    const [calendarRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes("/api/events/calendar"), {
        timeout: 15000,
      }),
      openEventsTab(page),
    ]);

    // `upcoming_only` is what keeps the past branch out of the table entirely.
    const query = new URL(calendarRequest.url()).searchParams;
    expect(query.get("upcoming_only")).toBe("true");
    expect(query.get("market")).toBe("us");

    await expect(page.locator('[data-testid="event-days-evt-aapl-analyst-day"]')).toHaveText(
      "today",
    );
    await expect(page.locator(`[data-testid="event-days-${ORCL_EVENT_ID}"]`)).toHaveText(
      "in 3d",
    );
    await expect(page.locator('[data-testid="event-days-evt-msft-earnings"]')).toHaveText(
      "in 10d",
    );

    // No row is in the past, so nothing renders the "Nd ago" copy.
    await expect(page.locator('[data-testid^="event-days-"]', { hasText: "3d ago" })).toHaveCount(0);
  });

  test("opens the detail drawer with the announcement lead time", async ({ page }) => {
    await openEventsTab(page);
    await page.locator(`[data-testid="event-row-${ORCL_EVENT_ID}"]`).click();

    const drawer = page.locator('[data-testid="event-detail-drawer"]');
    await expect(drawer).toBeVisible();
    await expect(page.locator('[data-testid="event-detail-title"]')).toHaveText(
      "Oracle Investor Day 2026",
    );
    await expect(page.locator('[data-testid="event-detail-lead"]')).toHaveText(
      `announced ${ORCL_LEAD_DAYS} days before`,
    );
    await expect(page.locator('[data-testid="event-detail-announced"]')).toBeVisible();

    const link = page.locator('[data-testid="event-detail-source-link"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("href", /sec\.gov/);
  });

  test("switching market and toggling alpha-only refetch with the right query", async ({
    page,
  }) => {
    await openEventsTab(page);

    const [marketRequest] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes("/api/events/calendar") && req.url().includes("market=all"),
        { timeout: 15000 },
      ),
      page.locator('[data-testid="events-market-select"]').click(),
      page.getByRole("option", { name: "All", exact: true }).click(),
    ]);
    expect(new URL(marketRequest.url()).searchParams.get("market")).toBe("all");

    const [alphaRequest] = await Promise.all([
      page.waitForRequest(
        (req) => {
          if (!req.url().includes("/api/events/calendar")) return false;
          const types = new URL(req.url()).searchParams.get("types");
          return Boolean(types && types.includes("investor_day"));
        },
        { timeout: 15000 },
      ),
      page.locator('[data-testid="events-alpha-only"]').click(),
    ]);

    const types = new URL(alphaRequest.url()).searchParams.get("types") ?? "";
    expect(types).toContain("investor_day");
    expect(types).toContain("guidance");
    expect(types).not.toContain("earnings");
    await expect(page.locator('[data-testid="events-alpha-only"]')).toBeChecked();
  });

  test("shows the unexplained-moves strip when the tripwire has rows", async ({ page }) => {
    await openEventsTab(page);

    const [orcl] = buildAnomalyFixtures();
    const strip = page.locator('[data-testid="events-anomalies"]');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Unexplained moves");

    const orclStat = page.locator(`[data-testid="events-anomaly-${orcl.symbol}"]`);
    await expect(orclStat).toBeVisible();
    await expect(orclStat).toContainText(orcl.symbol);
    await expect(orclStat).toContainText(`+${orcl.ret_pct.toFixed(2)}%`);
  });

  test("hides the strip when the tripwire is empty", async ({ page }) => {
    await openEventsTab(page, { anomalies: [] });

    // The calendar still renders — only the strip is gone.
    await expect(page.locator('[data-testid="events-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="events-anomalies"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="events-anomaly-ORCL"]')).toHaveCount(0);
  });

  test("surfaces a calendar failure without breaking the other tabs", async ({ page }) => {
    allowResourceErrors = true;
    await openEventsTab(page, { calendarStatus: 500 });

    const alert = page.locator('[data-testid="events-error"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Could not load the event calendar.");
    await expect(alert).toContainText("HTTP 500");

    // With no rows and an error, the table is replaced by the alert.
    await expect(page.locator('[data-testid="events-table"]')).toHaveCount(0);

    // The rest of the screener still works.
    await page.locator('[data-testid="tab-dashboard"]').click();
    await expect(page.locator('[data-testid="tab-dashboard"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator('[data-testid="dashboard-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="screener-page"]')).toBeVisible();
  });
});
