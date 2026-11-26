/**
 * A+ visual audit capture matrix (read-only evidence run).
 *
 * Drives the real app routes with the shared E2E mock harness at 1600x1000 and
 * 390x844, writes viewport screenshots and a manifest under the task artifact
 * directory. No source files are modified and no assertions gate the captures:
 * the point is to record what actually renders, including empty/denied/error
 * states, for a separate verifier to grade.
 */
import { test, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  loginAsTestUser,
  mockNiftyReport,
  setupApiMocks,
  setupHomeDeskMocks,
  setupNiftyTapeMocks,
  setupPaperTradingMocks,
  setupSectorMocks,
  setupStrategiesMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { setupScreenerEvidenceMocks } from "../mocks/screenerEvidence";
import { setupPatternEvidenceMocks } from "../mocks/patternEvidence";
import { setupHomePatternMocks } from "../mocks/homeDeskFixtures";
import { setupNewsMocks } from "./helpers/newsHelpers";
import { setupFullBacktestMocks } from "./helpers/backtestHelpers";

const ARTIFACT_ROOT = "/workspaces/react/.agent-artifacts/ui-a-plus";
const CAPTURE_DIR = path.join(ARTIFACT_ROOT, "captures");
const MANIFEST_PATH = path.join(ARTIFACT_ROOT, "manifest.json");
const README_PATH = path.join(CAPTURE_DIR, "README.md");

const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

type CaptureRecord = {
  slug: string;
  route: string;
  viewport: { width: number; height: number };
  status: "captured" | "error";
  finalUrl: string;
  title: string;
  readySelector: string | null;
  readyFound: boolean | null;
  waitStrategy: string;
  consoleErrors: string[];
  visibleTextLength: number;
  rootChildCount: number;
  blankScreen: boolean;
  bodyScrollWidth: number;
  viewportWidth: number;
  horizontalOverflow: boolean;
  visibleErrorTestIds: Array<{ testid: string; text: string }>;
  screenshot: string;
  bytes: number;
  sha256: string;
  storyCount: number;
  loaderVisible: boolean;
  stateNote: string;
  notes: string[];
  error: string | null;
};

const records: CaptureRecord[] = [];

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Per-strike minute chain from design-evidence.spec.ts so the report heatmap paints. */
function evidenceTape() {
  const strikes = [22_100, 22_200, 22_300, 22_400, 22_500];
  const rows = Array.from({ length: 46 }, (_, i) => {
    const minute = 15 + i;
    const t = `${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const spot = 22_300 + i * 1.4;
    const chain = Object.fromEntries(
      strikes.map((strike, k) => {
        const distance = Math.abs(strike - spot) / 50;
        const wave = Math.round(Math.sin((i + k) / 2.2) * 420);
        const ceOi = 1_600 + i * 16 + k * 90 + wave;
        const peOi = 2_100 + i * 10 + (4 - k) * 110 + distance * 40 - wave;
        return [
          String(strike),
          [
            Math.max(8, 180 - Math.abs(strike - spot) * 0.5),
            Math.max(8, 170 - Math.abs(strike - spot) * 0.45),
            ceOi,
            peOi,
            400 + i * 3,
            500 + i * 2,
          ],
        ];
      }),
    );
    return {
      t,
      spot,
      atm_strike: 22_400,
      max_pain: 22_400,
      flip: 22_350,
      walls: { call: 22_500, put: 22_200 },
      chain,
    };
  });
  return { date: "2026-10-12", interval_sec: 60, rows };
}

function evidenceReport() {
  return {
    ...mockNiftyReport,
    strikes: mockNiftyReport.strikes.map((strike, i) => {
      const ceChange = [220, -160, 310, -240, 140][i] ?? 0;
      const peChange = [-90, 180, -220, 260, -130][i] ?? 0;
      return {
        ...strike,
        ce: {
          ...strike.ce,
          oi: 1_800 + i * 120 + ceChange,
          prev_oi: 1_800 + i * 120,
          oi_change: ceChange,
          sentiment: ceChange >= 0 ? "Bullish" : "Bearish",
        },
        pe: {
          ...strike.pe,
          oi: 2_200 + (4 - i) * 110 + peChange,
          prev_oi: 2_200 + (4 - i) * 110,
          oi_change: peChange,
          sentiment: peChange >= 0 ? "Bearish" : "Bearish",
        },
      };
    }),
  };
}

/** Auxiliary report feeds: `{}` is a successful-but-malformed payload for these. */
async function setupReportAuxMocks(page: Page) {
  await page.route(apiRoute("reports/breadth"), (route) =>
    route.fulfill(json({ available: false, rows: [], up: 0, count: 0 })),
  );
  await page.route(apiRoute("reports/nifty/chain10s"), (route) =>
    route.fulfill(json({ date: "2026-10-12", count: 0, summary: [], rows: [] })),
  );
  await page.route(apiRoute("reports/nifty/blasts"), (route) =>
    route.fulfill(json({ blasts: [] })),
  );
  await page.route(apiRoute("reports/nifty/bursts"), (route) =>
    route.fulfill(json({ count: 0, bursts: [] })),
  );
  await page.route(apiRoute("reports/nifty/sensex"), (route) =>
    route.fulfill(
      json({
        spot: 81000,
        pcr_oi: 0.7,
        pcr_vol: 1.0,
        max_pain: 81000,
        walls: { calls: [], puts: [] },
        ohlc: { open: 80500, high: 81200, low: 80400, close: 81000 },
        market: { is_open: false, session_date: "2026-10-12" },
      }),
    ),
  );
  await page.route(apiRoute("reports/options/NIFTY/walls"), (route) =>
    route.fulfill(
      json({
        symbol: "NIFTY",
        date: "2026-10-12",
        expiry: "2026-10-14",
        dte: 2,
        spot: 22363.35,
        max_pain: 22400,
        max_pain_drift: 0,
        atm: 22400,
        net_gex: null,
        flip: 22350,
        gex_degraded: false,
        pin_distance_pts: 150,
        pin_distance_pct: 0.67,
        regime: "SHORT",
        read: "Neutral tape near the call wall",
        nearest_call: null,
        nearest_put: null,
        wall_map: null,
        state: "QUIET",
        expiry_day: false,
        alert_eligible: false,
        alert: null,
        reasons: [],
        call_wall: { strike: 22500, oi: 5000 },
        put_wall: { strike: 22200, oi: 6000 },
        tracked_call_erosion_30m: null,
        tracked_call_erosion_5m: null,
        near: false,
        cross: false,
        calls: [],
        puts: [],
        events: [],
        history: [],
        freshness: { last_t: "2026-10-12T10:00:00", age_sec: 0, stale: false, rows: 0, gaps: [] },
        window_min: 5,
        top: 5,
      }),
    ),
  );
}

/** Registered before every other handler: uncaptured API calls become `{}`. */
async function setupApiCatchAll(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    // Vite dev serves app modules under /src/api/... — those are not backend calls.
    if (!pathname.startsWith("/api/")) return route.fallback();
    await route.fulfill(json({}));
  });
}

async function baseSetup(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

async function minimalPatternMocks(page: Page) {
  // Same payload shape as all-strategies-chart-preview.spec.ts: overlays is
  // required — without it the chart component throws on `overlays.zones`.
  await page.route(apiRoute("chart-patterns/timeframes"), (route) =>
    route.fulfill(
      json({
        timeframes: [
          { id: "1m", label: "1m" },
          { id: "5m", label: "5m" },
          { id: "15m", label: "15m" },
          { id: "1D", label: "1D" },
        ],
      }),
    ),
  );
  await page.route(/chart-patterns\/symbol\/[^/]+\/chart/, (route) =>
    route.fulfill(
      json({
        symbol: "RELIANCE",
        timeframe: new URL(route.request().url()).searchParams.get("timeframe") ?? "15m",
        candles: Array.from({ length: 40 }, (_, i) => ({
          t: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T09:${String(15 + (i % 60)).padStart(2, "0")}:00`,
          o: 1400 + i * 0.5,
          h: 1402 + i * 0.5,
          l: 1398 + i * 0.5,
          c: 1401 + i * 0.5,
          v: 100000 + i * 1000,
        })),
        overlays: [],
        trend_lines: [],
        hits: [],
        data_through: "2026-09-30",
      }),
    ),
  );
}

type MatrixRoute = {
  slug: string;
  path: string;
  ready?: string;
  setup: (page: Page) => Promise<void>;
  afterGoto?: (page: Page) => Promise<void>;
  settle?: (page: Page) => Promise<void>;
  note?: string;
};

const BOT_ID_1 = "550e8400-e29b-41d4-a716-446655440000";
const BOT_ID_2 = "81b1e4e1-de04-4989-8357-96daade0bd86";

const ROUTES: MatrixRoute[] = [
  {
    slug: "home",
    path: "/home",
    ready: '[data-testid="window-manager-canvas"]',
    setup: async (page) => {
      await setupNewsMocks(page);
      await setupHomeDeskMocks(page);
    },
    afterGoto: async (page) => {
      await page.getByTestId("home-view-desk").click({ timeout: 10000 });
    },
  },
  {
    slug: "screener",
    path: "/screener",
    ready: '[data-testid="screener-page"]',
    setup: (page) => setupScreenerEvidenceMocks(page),
  },
  {
    slug: "news",
    path: "/news",
    ready: '[data-testid="news-list-item"]',
    setup: (page) => setupNewsMocks(page),
    settle: async (page) => {
      // The feed mock has a 500 ms delay; the initial skeleton must be gone and
      // all three mocked headlines painted before the evidence frame is taken.
      await page.getByTestId("news-loader").waitFor({ state: "detached", timeout: 20000 });
      await page.getByTestId("news-story-count").filter({ hasText: "3 stories" }).waitFor({
        state: "visible",
        timeout: 20000,
      });
    },
  },
  {
    slug: "backtest",
    path: "/backtest",
    ready: '[data-testid="backtest-view"]',
    setup: (page) => setupFullBacktestMocks(page),
  },
  {
    slug: "paper",
    path: "/paper",
    ready: '[data-testid="paper-trading-view"]',
    setup: async (page) => {
      await setupPaperTradingMocks(page);
      await setupMultiStrategyBotMocks(page);
    },
  },
  {
    slug: "strategy-runner",
    path: "/strategy-runner",
    ready: '[data-testid="strategy-runner-page"]',
    setup: (page) => setupMultiStrategyBotMocks(page),
  },
  {
    slug: "sector",
    path: "/sector",
    ready: '[data-testid="sector-analysis-view"]',
    setup: (page) => setupSectorMocks(page),
  },
  {
    slug: "patterns",
    path: "/patterns",
    ready: '[data-testid="patterns-page"]',
    setup: async (page) => {
      await setupHomePatternMocks(page);
      await setupPatternEvidenceMocks(page);
    },
  },
  {
    slug: "strategies",
    path: "/strategies",
    ready: '[data-testid="strategies-view"]',
    setup: (page) => setupStrategiesMocks(page),
  },
  {
    slug: "bots",
    path: "/bots",
    ready: '[data-testid="bots-view"]',
    setup: async (page) => {
      await page.route(apiRoute("bots"), (route) =>
        route.fulfill(
          json([
            {
              id: BOT_ID_1,
              name: "Default Bot",
              is_active: true,
              running: false,
              pid: null,
              strategies: [],
            },
            {
              id: BOT_ID_2,
              name: "Multi-Strategy Bot",
              is_active: true,
              running: true,
              pid: 12345,
              strategies: [{ id: "strat-1", name: "ORB Conservative", strategy_type: "ORB" }],
            },
          ]),
        ),
      );
      await page.route(apiRoute("bots/available-strategies"), (route) =>
        route.fulfill(
          json([
            {
              id: "strat-1",
              name: "ORB Conservative",
              strategy_type: "ORB",
              is_template: false,
              is_active: true,
            },
          ]),
        ),
      );
    },
  },
  {
    slug: "report-index",
    path: "/report/index",
    ready: '[data-testid="nifty-report-panel"]',
    setup: async (page) => {
      await setupNiftyTapeMocks(page);
      await page.route(apiRoute("reports/nifty/tape"), (route) =>
        route.fulfill(json(evidenceTape())),
      );
      await page.route(apiRoute("reports/nifty/live"), (route) =>
        route.fulfill(json(evidenceReport())),
      );
      await setupReportAuxMocks(page);
    },
  },
  {
    slug: "report-profit",
    path: "/report/profit",
    ready: '[data-testid="profitability-report"]',
    setup: (page) =>
      page.route(apiRoute("reports/profitability"), (route) =>
        route.fulfill(
          json({
            weeks: 4,
            universe: "nifty500",
            as_of: "2026-10-07T15:30:00+05:30",
            cached: false,
            strategies: [
              {
                id: "orb",
                label: "Opening Range Breakout",
                trades: 5,
                win_rate: 0.6,
                net_pnl: 1200.5,
                expectancy: 240.1,
                profit_factor: 2.1,
                max_dd: 300,
                avg_hold_days: 2,
              },
              {
                id: "sr_breakout",
                label: "S/R Breakout",
                trades: 3,
                win_rate: 0.3333,
                net_pnl: -400.25,
                expectancy: -133.42,
                profit_factor: 0.4,
                max_dd: 800,
                avg_hold_days: 5,
              },
            ],
            top_signals: [
              {
                symbol: "RELIANCE",
                strategy: "orb",
                entry_date: "2026-09-20",
                entry: 2850,
                exit: 2890,
                net: 900,
              },
              {
                symbol: "INFY",
                strategy: "sr_breakout",
                entry_date: "2026-09-21",
                entry: 1500,
                exit: 1480,
                net: -1350,
              },
            ],
          }),
        ),
      ),
  },
  {
    slug: "settings",
    path: "/settings",
    ready: '[data-testid="settings-page"]',
    setup: async () => {},
  },
  {
    slug: "admin",
    path: "/admin",
    ready: '[data-testid="admin-page"]',
    setup: async () => {},
    note: "testUser has no is_admin flag; capture is honest non-admin state (no admin faked)",
  },
  {
    slug: "chart-RELIANCE",
    path: "/chart/RELIANCE",
    ready: '[data-testid="chart-view"]',
    setup: async (page) => {
      await setupHomePatternMocks(page);
      await minimalPatternMocks(page);
    },
  },
];

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

async function collectRecord(page: Page, record: CaptureRecord) {
  record.finalUrl = page.url();
  record.title = await page.title().catch(() => "");

  const probe = await page.evaluate(() => {
    const root = document.querySelector("#app") ?? document.body;
    const text = (document.body.innerText ?? "").trim();
    const errorTestIds: Array<{ testid: string; text: string }> = [];
    const storyCount = document.querySelectorAll('[data-testid="news-list-item"]').length;
    const loaderVisible = Array.from(document.querySelectorAll('[data-testid="news-loader"]')).some(
      (node) => node.getClientRects().length > 0,
    );
    for (const node of Array.from(document.querySelectorAll("[data-testid]"))) {
      const testid = node.getAttribute("data-testid") ?? "";
      if (!/error|denied|empty|fail|unauthor|blocked/i.test(testid)) continue;
      const rects = node.getClientRects();
      if (rects.length === 0) continue;
      errorTestIds.push({ testid, text: (node.textContent ?? "").trim().slice(0, 120) });
    }
    return {
      visibleTextLength: text.length,
      rootChildCount: root.children.length,
      bodyScrollWidth: document.body.scrollWidth,
      errorTestIds,
      storyCount,
      loaderVisible,
    };
  });

  record.visibleTextLength = probe.visibleTextLength;
  record.rootChildCount = probe.rootChildCount;
  record.bodyScrollWidth = probe.bodyScrollWidth;
  record.viewportWidth = await page.evaluate(() => window.innerWidth);
  record.horizontalOverflow = record.bodyScrollWidth > record.viewportWidth;
  record.blankScreen = probe.visibleTextLength < 80 || probe.rootChildCount === 0;
  record.visibleErrorTestIds = probe.errorTestIds;
  record.storyCount = probe.storyCount;
  record.loaderVisible = probe.loaderVisible;
}

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`${route.slug} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.setTimeout(120000);
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });

      const record: CaptureRecord = {
        slug: route.slug,
        route: route.path,
        viewport: { width: viewport.width, height: viewport.height },
        status: "error",
        finalUrl: "",
        title: "",
        readySelector: route.ready ?? null,
        readyFound: null,
        waitStrategy: route.ready ? `waitForSelector(${route.ready}, 45s)` : "waitForTimeout(2500)",
        consoleErrors: [],
        visibleTextLength: 0,
        rootChildCount: 0,
        blankScreen: false,
        bodyScrollWidth: 0,
        viewportWidth: viewport.width,
        horizontalOverflow: false,
        visibleErrorTestIds: [],
        screenshot: path.join(CAPTURE_DIR, `${route.slug}-${viewport.width}.png`),
        bytes: 0,
        sha256: "",
        storyCount: 0,
        loaderVisible: false,
        stateNote: "",
        notes: route.note ? [route.note] : [],
        error: null,
      };
      records.push(record);

      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (text.includes("/ws/news") || text.includes("News WebSocket error")) return;
        record.consoleErrors.push(`console: ${text}`);
      });
      page.on("pageerror", (error) => {
        const text = error.message;
        if (text.includes("/ws/news")) return;
        record.consoleErrors.push(`pageerror: ${text}`);
      });
      if (process.env.UI_A_PLUS_DIAG === "1" && route.slug === "report-index") {
        page.on("request", (request) => {
          if (request.url().includes("/api/")) {
            record.notes.push(`request: ${request.method()} ${request.url()}`);
          }
        });
        page.on("console", (message) => {
          record.notes.push(`console[${message.type()}]: ${message.text().slice(0, 800)}`);
        });
        page.on("pageerror", (error) => {
          record.notes.push(`pageerror: ${error.stack?.slice(0, 1200) ?? error.message}`);
        });
      }

      try {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setupApiCatchAll(page);
        await baseSetup(page);
        await route.setup(page);

        await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (route.afterGoto) {
          try {
            await route.afterGoto(page);
          } catch (error) {
            record.notes.push(`afterGoto failed: ${String(error).slice(0, 200)}`);
          }
        }

        if (route.ready) {
          try {
            await page.waitForSelector(route.ready, { timeout: 45000 });
            record.readyFound = true;
          } catch {
            record.readyFound = false;
            record.notes.push(`ready selector not found within 45s: ${route.ready}`);
            await page.waitForTimeout(2500);
          }
        } else {
          await page.waitForTimeout(2500);
        }
        if (route.settle) {
          try {
            await route.settle(page);
          } catch (error) {
            record.notes.push(`settle failed: ${String(error).slice(0, 200)}`);
          }
        }

        await page.addStyleTag({ content: FREEZE_CSS });
        await page.mouse.move(0, 0);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.waitForTimeout(250);

        await collectRecord(page, record);
        await page.screenshot({ path: record.screenshot, fullPage: false });
        record.status = "captured";
      } catch (error) {
        record.error = String(error).slice(0, 500);
        try {
          await page.addStyleTag({ content: FREEZE_CSS });
          await page.mouse.move(0, 0);
          await collectRecord(page, record);
          await page.screenshot({ path: record.screenshot, fullPage: false });
        } catch (secondary) {
          record.notes.push(`fallback screenshot failed: ${String(secondary).slice(0, 200)}`);
        }
      }
    });
  }
}

test.afterAll(() => {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });

  // A targeted rerun refreshes only its own cells; keep every earlier capture
  // so the manifest always describes the full matrix.
  const merged = new Map<string, CaptureRecord>();
  try {
    const previous = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    for (const record of previous.captures ?? []) {
      merged.set(`${record.slug}:${record.viewport.width}`, record);
    }
  } catch {
    // No manifest yet.
  }
  for (const record of records) merged.set(`${record.slug}:${record.viewport.width}`, record);
  const all = Array.from(merged.values());
  for (const record of all) {
    if (fs.existsSync(record.screenshot)) {
      const buffer = fs.readFileSync(record.screenshot);
      record.bytes = buffer.byteLength;
      record.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    }
    record.stateNote =
      record.status !== "captured"
        ? "Capture failed"
        : record.blankScreen
          ? "Blank screen"
          : record.loaderVisible
            ? "Loader/skeleton still visible"
            : record.slug === "news"
              ? `${record.storyCount} stories, loader gone`
              : "Settled content";
  }

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        branch: "feat/ui-a-plus",
        head: "6b1ef043",
        baseURL: "http://127.0.0.1:5173",
        generatedAt: new Date().toISOString(),
        total: all.length,
        captured: all.filter((r) => r.status === "captured").length,
        failed: all.filter((r) => r.status === "error").length,
        captures: all,
      },
      null,
      2,
    ),
  );

  const byRoute = new Map<string, CaptureRecord[]>();
  for (const record of all) {
    const list = byRoute.get(record.slug) ?? [];
    list.push(record);
    byRoute.set(record.slug, list);
  }
  const lines = [
    "# UI A+ capture matrix",
    "",
    "Viewport screenshots (not fullPage) of the in-scope app routes at 1600x1000 and 390x844.",
    "See `../manifest.json` for URL, title, readiness, console errors, overflow and error-testid details.",
    "",
    "| Screen | Routes | 1600 | 390 | State |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [slug, list] of byRoute) {
    const wide = list.find((r) => r.viewport.width === 1600);
    const narrow = list.find((r) => r.viewport.width === 390);
    const states = list.map((r) => {
      if (r.status !== "captured") return "failed";
      if (r.blankScreen) return "blank";
      if (r.readyFound === false) return "ready-missing";
      if (r.visibleErrorTestIds.some((item) => /denied/i.test(item.testid))) return "denied";
      const realErrors = r.visibleErrorTestIds.filter(
        (item) => !/empty($|-)/i.test(item.testid) && !/denied/i.test(item.testid),
      );
      if (realErrors.length > 0) return `error:${realErrors.map((e) => e.testid).join(",")}`;
      if (r.horizontalOverflow) return "overflow";
      if (r.consoleErrors.length > 0) return "console-errors (backend/ws noise, see manifest)";
      if (r.visibleTextLength < 250) return `sparse (${r.visibleTextLength} chars)`;
      return "populated";
    });
    lines.push(
      `| ${slug} | ${wide?.route ?? list[0].route} | ${wide?.status === "captured" ? "captured" : "FAILED"} | ${narrow?.status === "captured" ? "captured" : "FAILED"} | ${states.join(" / ")} |`,
    );
  }
  lines.push("", "Notes:", "");
  for (const record of all) {
    if (record.notes.length === 0) continue;
    lines.push(`- ${record.slug} @ ${record.viewport.width}: ${record.notes.join(" ")}`);
  }
  lines.push("", "News recapture:", "");
  for (const record of all.filter((r) => r.slug === "news")) {
    lines.push(
      `- ${path.basename(record.screenshot)} — ${record.bytes} bytes, sha256 ${record.sha256}, ${record.stateNote}, ${record.visibleTextLength} visible chars`,
    );
  }
  fs.writeFileSync(README_PATH, `${lines.join("\n")}\n`);
});
