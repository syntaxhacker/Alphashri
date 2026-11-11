import { test, expect, type WebSocketRoute } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupNiftyTapeMocks,
  mockNiftyTape,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

test.describe("Index Report - OI tape panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyTapeMocks(page);
    await page.goto("/report/index");
    await page.locator('[data-testid="nifty-desk-toggle"]').getByText("RESEARCH").click();
    await page.waitForSelector('[data-testid="nifty-tape-panel"]', { timeout: 10000 });
  });

  test("@smoke tape panel renders header stats", async ({ page }) => {
    const panel = page.locator('[data-testid="nifty-tape-panel"]');
    await expect(panel).toBeVisible({ timeout: 10000 });

    const head = panel.locator('[data-testid="nifty-tape-head"]');
    // Labels sit on the field wrappers (nifty-tape-<field>); the -head-* spans
    // carry only the value. Assert each label where it actually is. Regexes are
    // case-insensitive because the labels are uppercased via CSS text-transform,
    // which text assertions may or may not reflect.
    await expect(head.locator('[data-testid="nifty-tape-pcr"]')).toContainText(/PCR OI/i);
    await expect(head.locator('[data-testid="nifty-tape-max-pain"]')).toContainText(/MAX PAIN/i);
    await expect(head.locator('[data-testid="nifty-tape-flip"]')).toContainText(/FLIP/i);
    await expect(head.locator('[data-testid="nifty-tape-walls"]')).toContainText(/WALLS/i);
    // Spot-check values derived from the last chronological fixture row (09:19).
    await expect(head.locator('[data-testid="nifty-tape-head-pcr-oi"]')).toContainText("0.62");
    await expect(head.locator('[data-testid="nifty-tape-head-max-pain"]')).toContainText(
      "22,400",
    );
    await expect(head.locator('[data-testid="nifty-tape-head-flip"]')).toContainText("22,350");
    await expect(head.locator('[data-testid="nifty-tape-head-walls"]')).toContainText(
      "22,500 / 22,200",
    );
  });

  test("tape rows render latest-first", async ({ page }) => {
    const table = page.locator('[data-testid="nifty-tape-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.getByTestId("nifty-tape-row");
    await expect(rows).toHaveCount(mockNiftyTape.rows.length, { timeout: 10000 });
    // Fixture is served chronological (09:16 first); the panel sorts latest-first.
    // Row testids carry no time suffix (NiftyTapeTable getRowTestId is constant),
    // so ordering is asserted via each row's IST time cell instead.
    await expect(rows.first().getByTestId("nifty-tape-time")).toContainText("09:19");
    await expect(rows.last().getByTestId("nifty-tape-time")).toContainText("09:16");
  });
});

test.describe("Index Report - OI tape empty state", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyTapeMocks(page);
    // Override the tape endpoint with an empty payload AFTER the base mocks
    // (later handlers take priority in Playwright).
    await page.route(apiRoute("reports/nifty/tape"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rows: [] }),
      });
    });
    await page.goto("/report/index");
    await page.locator('[data-testid="nifty-desk-toggle"]').getByText("RESEARCH").click();
    await page.waitForSelector('[data-testid="nifty-tape-panel"]', { timeout: 10000 });
  });

  test("empty tape shows empty state with no table", async ({ page }) => {
    await expect(page.locator('[data-testid="nifty-tape-empty"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="nifty-tape-table"]')).toHaveCount(0);
  });
});

test.describe("Index Report - OI tape auto-refresh", () => {
  test("live tape updates arrive over the report WebSocket", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupNiftyTapeMocks(page);

    // Live tape is pushed over the report WebSocket (the single live source);
    // the REST tape endpoint only paints the first frame. Intercept the socket
    // and hold it so the push can be timed AFTER the REST paint — otherwise
    // the two writers race and the assertion is flaky.
    let reportSocket: WebSocketRoute | null = null;
    await page.routeWebSocket(/\/ws\/nifty\/report/, (ws) => {
      reportSocket = ws;
      ws.onMessage(() => {
        /* the client sends no frames on this socket */
      });
    });

    await page.goto("/report/index");
    await page.locator('[data-testid="nifty-desk-toggle"]').getByText("RESEARCH").click();
    await page.waitForSelector('[data-testid="nifty-tape-panel"]', { timeout: 10000 });

    const rows = page.locator('[data-testid="nifty-tape-row"]');
    // The REST paint lands first (the fixture's four rows).
    await expect(rows).toHaveCount(mockNiftyTape.rows.length, { timeout: 10000 });

    await expect.poll(() => reportSocket !== null, { timeout: 10000 }).toBe(true);

    // Now push a frame with an extra row the REST fixture never had.
    const pushedRow = {
      t: "09:20",
      spot: 22370,
      call_doi: 13000,
      put_doi: 19000,
      net: 6000,
      net_pct: 1.6,
      call_tick: 44,
      put_tick: 58,
      pcr_vol: 1.22,
      pcr_oi: 0.64,
      pcr_doi: 0.08,
      spot_flip: 6,
      max_pain: 22400,
      flip: 22360,
      walls: { call: 22500, put: 22200 },
    };
    reportSocket?.send(
      JSON.stringify({
        type: "aux",
        tape: {
          date: mockNiftyTape.date,
          interval_sec: 60,
          rows: [...mockNiftyTape.rows, pushedRow],
        },
        sensex: null,
      }),
    );

    await expect(rows).toHaveCount(mockNiftyTape.rows.length + 1, { timeout: 10000 });
    await expect(rows.first().getByTestId("nifty-tape-time")).toContainText("09:20");
  });
});
