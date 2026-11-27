/**
 * Loading / error / empty evidence matrix for the A+ gate.
 *
 * Drives the real app routes with the existing mock/login harness at 1600x1000
 * and 390x844 and writes viewport screenshots under
 * the writable UI artifact root (`states/`). No assertions gate a
 * capture: the job is to record what the UI actually renders in each state,
 * including an honest `not-applicable` row when a screen has no such state UI.
 *
 * A catch-all route for /api requests -> `{}` is registered before every specific
 * handler, so an unmocked backend call cannot masquerade as a real payload.
 * Specific fixtures (later registrations win in Playwright) then supply the
 * meaningful data for each screen and state.
 */
import { test, type Page, type Route } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  loginAsTestUser,
  mockNiftyReport,
  setupApiMocks,
  setupHomeDeskMocks,
  setupNiftyTapeMocks,
  setupSectorMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { setupHomePatternMocks } from "../mocks/homeDeskFixtures";
import { setupPatternEvidenceMocks } from "../mocks/patternEvidence";
import { setupScreenerEvidenceMocks } from "../mocks/screenerEvidence";
import { setupNewsMocks } from "./helpers/newsHelpers";
import { uiArtifactRoot } from "./helpers/artifactRoot";

const ARTIFACT_ROOT = uiArtifactRoot("states");
const MANIFEST_PATH = path.join(ARTIFACT_ROOT, "manifest.json");
const HEAD = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();

const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

const STATES = ["loading", "error", "empty"] as const;
type State = (typeof STATES)[number];

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

type WaitSpec = {
  testId?: string;
  text?: string;
  selector?: string;
  /** Human-readable label recorded in the manifest. */
  label: string;
};

type StateSetupResult = {
  wait: WaitSpec | WaitSpec[];
  notes: string[];
  /** Delay used by a loading mock, so the run can let the route settle afterwards. */
  delayMs?: number;
  /** Keeps a pending state alive for this long before the screenshot is taken. */
  preScreenshotDelayMs?: number;
  /** Holds a feed open until the screenshot has been written. */
  release?: () => void;
};

type ScreenSpec = {
  slug: string;
  path: string;
  ready: string;
  setup: (page: Page) => Promise<void>;
  afterGoto?: (page: Page) => Promise<void>;
  /** Per-state path override (e.g. a restrictive filter that suppresses auto-scan). */
  pathForState?: Partial<Record<State, string>>;
  states: Record<State, (page: Page) => Promise<StateSetupResult>>;
};

type CaptureRecord = {
  screen: string;
  route: string;
  state: State;
  width: number;
  height: number;
  status: "captured" | "not-applicable";
  screenshot: string | null;
  sha256: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  head: string;
  stateConfirmed: boolean;
  waitedFor: string[];
  finalUrl: string;
  notes: string[];
  consoleErrors: string[];
  visibleStateTestIds: Array<{ testid: string; text: string }>;
};

const records: CaptureRecord[] = [];

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Latest registration wins in Playwright, so the catch-all is registered first. */
async function setupApiCatchAll(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    // Vite dev serves app modules under /src/api/... — those are not backend calls.
    if (!pathname.startsWith("/api/")) return route.fallback();
    await route.fulfill(json({}));
  });
}

const LOADING_DELAY_MS = 5000;

async function delayThenFulfill(route: Route, body: unknown, ms = LOADING_DELAY_MS) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await route.fulfill(json(body));
}

function fulfill500(route: Route, detail: string) {
  return route.fulfill(json({ detail, message: detail, error: detail }, 500));
}

/** Same chain fixture as design-evidence.spec.ts so the report heatmap paints. */
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
          sentiment: peChange >= 0 ? "Bullish" : "Bearish",
        },
      };
    }),
  };
}

/** Honest empty report: every collection is an empty array, no missing fields. */
function emptyNiftyReport() {
  return {
    ...mockNiftyReport,
    strikes: [],
    timeline: [],
    candles: [],
    intraday: [],
    walls: { calls: [], puts: [] },
    walls_near: { calls: [], puts: [] },
    fetched_at: new Date().toISOString(),
  };
}

/** Auxiliary report feeds from design-evidence.spec.ts (not the primary payload). */
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

const EMPTY_PATTERN_SUMMARY = {
  scanned: 0,
  patterns: 0,
  in_view: 0,
  confirmed: 0,
  bullish: 0,
  bearish: 0,
  data_through: "2026-11-20",
  last_scan_at: new Date().toISOString(),
};

const EMPTY_PATTERN_STREAM = [
  `event: meta\ndata: ${JSON.stringify({
    total: 0,
    summary: EMPTY_PATTERN_SUMMARY,
    data_through: EMPTY_PATTERN_SUMMARY.data_through,
  })}\n\n`,
  "event: done\ndata: {}\n\n",
].join("");

/** `/api/screener?...` exactly — apiRoute("screener") would also eat /screener/dashboard. */
const SCREENER_EXACT = /localhost:8765\/api\/screener\?/;
/** `/api/sector?...` exactly — avoids /sector/correlation, /sector/groups and history. */
const SECTOR_EXACT = /localhost:8765\/api\/sector\?/;

const HOME_SNAPSHOT = {
  as_of: new Date().toISOString(),
  universe: "all_equity",
  total: 3,
  update_mode: "streaming",
  rows: [
    { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
    { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
    { symbol: "INFY", name: "Infosys", sector: "IT", close: 1534.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 780000, cap_tier: "large", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  ],
};

const EMPTY_SNAPSHOT = {
  as_of: new Date().toISOString(),
  universe: "all_equity",
  total: 0,
  update_mode: "streaming",
  rows: [],
};

const EMPTY_SCREENER = {
  approaching: [],
  touched: [],
  last_updated: new Date().toISOString(),
  provider: "upstox",
  mode: "intraday",
  screener: "trending",
};

const EMPTY_SECTOR = {
  sectors: [],
  top_stock_movers: [],
  last_updated: null,
  market: "india",
};

const SCREENS: readonly ScreenSpec[] = [
  {
    slug: "home",
    path: "/home",
    ready: '[data-testid="window-manager-canvas"]',
    setup: async (page) => {
      await setupNewsMocks(page);
      await setupHomeDeskMocks(page);
    },
    afterGoto: async (page) => {
      await expectVisible(page, '[data-testid="home-view-desk"]', 10000);
      await page.getByTestId("home-view-desk").click();
    },
    states: {
      loading: async (page) => {
        await page.route(apiRoute("market/snapshot"), (route) =>
          delayThenFulfill(route, HOME_SNAPSHOT),
        );
        return {
          wait: { testId: "market-heatmap-loading", label: "market-heatmap-loading skeleton" },
          notes: [
            "Primary feed GET /api/market/snapshot delayed 5000ms; captured while the heatmap panel shows its loading skeleton.",
          ],
          delayMs: LOADING_DELAY_MS,
        };
      },
      error: async (page) => {
        await page.route(apiRoute("market/snapshot"), (route) =>
          fulfill500(route, "market snapshot exploded"),
        );
        return {
          wait: { testId: "market-heatmap-error", label: "market-heatmap-error with Retry" },
          notes: [
            "Primary feed GET /api/market/snapshot fulfilled with HTTP 500 and detail 'market snapshot exploded'.",
          ],
        };
      },
      empty: async (page) => {
        await page.route(apiRoute("market/snapshot"), (route) =>
          route.fulfill(json(EMPTY_SNAPSHOT)),
        );
        return {
          wait: { testId: "market-heatmap-empty", label: "market-heatmap-empty" },
          notes: [
            "Primary feed GET /api/market/snapshot fulfilled with total=0 and rows:[] (honest empty payload).",
          ],
        };
      },
    },
  },
  {
    slug: "screener",
    path: "/screener",
    ready: '[data-testid="screener-page"]',
    setup: (page) => setupScreenerEvidenceMocks(page),
    afterGoto: async (page) => {
      // /screener lands on the Market tab; switch to the real Screener tab that
      // screener-evidence.spec.ts drives (/screener/screener).
      await expectVisible(page, '[data-testid="tab-screener"]', 10000);
      await page.getByTestId("tab-screener").click();
      await page.waitForURL(/\/screener\/screener/, { timeout: 10000 }).catch(() => undefined);
    },
    states: {
      loading: async (page) => {
        await page.route(SCREENER_EXACT, (route) => delayThenFulfill(route, EMPTY_SCREENER));
        return {
          wait: { testId: "screener-loading", label: "screener-loading skeleton" },
          notes: [
            "Primary feed GET /api/screener?... delayed 5000ms; captured while ScreenerContent shows 'Loading screener'.",
            "Navigated from /screener to its Screener tab (/screener/screener) using tab-screener.",
          ],
          delayMs: LOADING_DELAY_MS,
        };
      },
      error: async (page) => {
        await page.route(SCREENER_EXACT, (route) =>
          fulfill500(route, "screener feed exploded"),
        );
        return {
          wait: { testId: "screener-error-container", label: "screener-error-container with Retry" },
          notes: [
            "Primary feed GET /api/screener?... fulfilled with HTTP 500 and detail 'screener feed exploded'.",
          ],
        };
      },
      empty: async (page) => {
        await page.route(SCREENER_EXACT, (route) => route.fulfill(json(EMPTY_SCREENER)));
        return {
          wait: { testId: "screener-empty", label: "screener-empty" },
          notes: [
            "Primary feed GET /api/screener?... fulfilled with approaching:[] and touched:[] (honest empty payload).",
          ],
        };
      },
    },
  },
  {
    slug: "patterns",
    path: "/patterns",
    ready: '[data-testid="patterns-page"]',
    setup: async (page) => {
      await setupHomePatternMocks(page);
      await setupPatternEvidenceMocks(page);
    },
    pathForState: {
      // Canonical URL: the non-canonical form rewrites search params on mount,
      // which aborts the gated bootstrap fetch and drops the skeleton.
      loading: "/patterns?avgvol=150&universe=nifty50&family=reversal",
      error: "/patterns?family=reversal",
      empty: "/patterns?family=reversal",
    },
    states: {
      loading: async (page) => {
        // The skeleton is gated by the catalog bootstrap AND the results load.
        // Holding only /results lets loadCatalog finish and drop the skeleton,
        // so gate every feed the bootstrap awaits, then fall through to the
        // existing specific mocks once the frame is captured.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
          setTimeout(resolve, 20000);
        });
        const gated = [
          apiRoute("chart-patterns/timeframes"),
          apiRoute("chart-patterns/universes"),
          apiRoute("chart-patterns/patterns"),
          apiRoute("chart-patterns/summary"),
          apiRoute("chart-patterns/matrix"),
          apiRoute("chart-patterns/jobs"),
          apiRoute("chart-patterns/results"),
        ];
        for (const matcher of gated) {
          await page.route(matcher, async (route) => {
            await gate;
            await route.fallback();
          });
        }
        return {
          wait: { testId: "patterns-loading", label: "patterns-loading skeleton grid" },
          notes: [
            "Catalog/results feeds (timeframes, universes, patterns, summary, matrix, jobs, results/stream) held pending with page.route + setTimeout (20s safety cap); screenshot taken 6s into the delay while still pending.",
            "Opened the canonical /patterns?avgvol=150&universe=nifty50&family=reversal URL: the non-canonical form rewrites search params on mount and aborts the gated bootstrap fetch. The non-default family filter suppresses auto-scan.",
          ],
          preScreenshotDelayMs: 6000,
          release,
        };
      },
      error: async (page) => {
        await page.route(apiRoute("chart-patterns/results"), (route) =>
          fulfill500(route, "pattern results feed exploded"),
        );
        return {
          wait: { testId: "patterns-error", label: "patterns-error alert" },
          notes: [
            "Primary feed GET /api/chart-patterns/results/stream and /results fulfilled with HTTP 500 and detail 'pattern results feed exploded'.",
            "Opened /patterns?family=reversal: a non-default restrictive filter suppresses the auto-scan whose error-clearing side effect would otherwise hide the error alert.",
          ],
        };
      },
      empty: async (page) => {
        await page.route(apiRoute("chart-patterns/results"), (route) => {
          if (new URL(route.request().url()).pathname.endsWith("/stream")) {
            return route.fulfill({
              status: 200,
              contentType: "text/event-stream",
              body: EMPTY_PATTERN_STREAM,
            });
          }
          return route.fulfill(
            json({
              items: [],
              total: 0,
              summary: EMPTY_PATTERN_SUMMARY,
              data_through: EMPTY_PATTERN_SUMMARY.data_through,
            }),
          );
        });
        return {
          wait: { testId: "patterns-empty", label: "patterns-empty with relax chips" },
          notes: [
            "Primary feed GET /api/chart-patterns/results fulfilled with items:[] and total=0 (honest empty payload).",
            "Opened /patterns?family=reversal: a restrictive filter is the documented way to keep a genuinely empty result set from auto-triggering a scan.",
          ],
        };
      },
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
    states: {
      loading: async (page) => {
        await page.route(apiRoute("reports/nifty/live"), (route) =>
          delayThenFulfill(route, evidenceReport()),
        );
        return {
          wait: { testId: "nifty-report-loading", label: "nifty-report-loading" },
          notes: [
            "Primary feed GET /api/reports/nifty/live delayed 5000ms; captured while 'Loading index report' is visible.",
          ],
          delayMs: LOADING_DELAY_MS,
        };
      },
      error: async (page) => {
        await page.route(apiRoute("reports/nifty/live"), (route) =>
          fulfill500(route, "Nifty report feed down"),
        );
        return {
          wait: { text: "Nifty report feed down", label: "page-level ErrorAlert with Retry" },
          notes: [
            "Primary feed GET /api/reports/nifty/live fulfilled with HTTP 500 and detail 'Nifty report feed down'.",
          ],
        };
      },
      empty: async (page) => {
        await page.route(apiRoute("reports/nifty/live"), (route) =>
          route.fulfill(json(emptyNiftyReport())),
        );
        return {
          wait: [
            { testId: "report-chain-window-empty", label: "report-chain-window-empty" },
            { testId: "nifty-report-empty", label: "nifty-report-empty" },
            { testId: "nifty-report-content", label: "nifty-report-content with empty collections" },
          ],
          notes: [
            "Primary feed GET /api/reports/nifty/live fulfilled with strikes:[], candles:[], intraday:[], timeline:[] and empty walls (honest empty payload).",
            "The shell has a no-report banner only when no report object exists; with a valid empty report the honest empty UI is the per-window 'No strikes for this expiry' notice.",
          ],
        };
      },
    },
  },
  {
    slug: "sector",
    path: "/sector",
    ready: '[data-testid="sector-analysis-view"]',
    setup: (page) => setupSectorMocks(page),
    states: {
      loading: async (page) => {
        await page.route(SECTOR_EXACT, (route) =>
          delayThenFulfill(route, { ...EMPTY_SECTOR, sectors: [] }),
        );
        return {
          wait: { text: "Fetching sector performance", label: "sector LoadingPanel" },
          notes: [
            "Primary feed GET /api/sector?market=india delayed 5000ms; captured while 'Fetching sector performance' is visible.",
          ],
          delayMs: LOADING_DELAY_MS,
        };
      },
      error: async (page) => {
        await page.route(SECTOR_EXACT, (route) => fulfill500(route, "sector feed exploded"));
        return {
          wait: { text: "sector feed exploded", label: "sector ErrorPanel with Retry" },
          notes: [
            "Primary feed GET /api/sector?market=india fulfilled with HTTP 500 and detail 'sector feed exploded'.",
          ],
        };
      },
      empty: async (page) => {
        await page.route(SECTOR_EXACT, (route) => route.fulfill(json(EMPTY_SECTOR)));
        return {
          wait: {
            text: "No sector data available for this market.",
            label: "sector EmptyPanel",
          },
          notes: [
            "Primary feed GET /api/sector?market=india fulfilled with sectors:[], top_stock_movers:[] and last_updated:null (honest empty payload).",
          ],
        };
      },
    },
  },
];

/** Small helper used where we want a selector probe without failing the capture. */
async function expectVisible(page: Page, selector: string, timeout: number): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function waitForState(page: Page, wait: WaitSpec | WaitSpec[]): Promise<{
  confirmed: boolean;
  labels: string[];
  found: string[];
}> {
  const list = Array.isArray(wait) ? wait : [wait];
  const found: string[] = [];
  for (const item of list) {
    let visible = false;
    try {
      if (item.testId) {
        visible = await page
          .getByTestId(item.testId)
          .first()
          .isVisible()
          .catch(() => false);
      } else if (item.text) {
        visible = await page
          .getByText(item.text, { exact: false })
          .first()
          .isVisible()
          .catch(() => false);
      } else if (item.selector) {
        visible = await page.locator(item.selector).first().isVisible().catch(() => false);
      }
    } catch {
      visible = false;
    }
    if (visible) found.push(item.label);
  }
  return { confirmed: found.length > 0, labels: list.map((item) => item.label), found };
}

async function probeVisibleStateIds(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ testid: string; text: string }> = [];
    for (const node of Array.from(document.querySelectorAll("[data-testid]"))) {
      const testid = node.getAttribute("data-testid") ?? "";
      if (!/loading|skeleton|error|empty|retry|failed/i.test(testid)) continue;
      if (node.getClientRects().length === 0) continue;
      out.push({ testid, text: (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 140) });
    }
    return out.slice(0, 40);
  });
}

function pngDimensions(file: string) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

for (const viewport of VIEWPORTS) {
  for (const screen of SCREENS) {
    for (const state of STATES) {
      test(`${screen.slug} ${state} @ ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
        test.setTimeout(120000);
        fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });

        const filename = `${screen.slug}-${state}-${viewport.width}.png`;
        const screenshotPath = path.join(ARTIFACT_ROOT, filename);
        const record: CaptureRecord = {
          screen: screen.slug,
          route: screen.pathForState?.[state] ?? screen.path,
          state,
          width: viewport.width,
          height: viewport.height,
          status: "captured",
          screenshot: screenshotPath,
          sha256: null,
          imageWidth: null,
          imageHeight: null,
          head: HEAD,
          stateConfirmed: false,
          waitedFor: [],
          finalUrl: "",
          notes: [],
          consoleErrors: [],
          visibleStateTestIds: [],
        };
        records.push(record);

        page.on("console", (message) => {
          if (message.type() !== "error") return;
          const text = message.text();
          // The news WebSocket is absent under mocks; that noise is unrelated
          // to the state under test and is recorded separately if it appears.
          if (text.includes("/ws/news") || text.includes("News WebSocket error")) return;
          record.consoleErrors.push(text.slice(0, 300));
        });
        page.on("pageerror", (error) => {
          const text = error.message;
          if (text.includes("/ws/news")) return;
          record.consoleErrors.push(`pageerror: ${text.slice(0, 300)}`);
        });

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setupApiCatchAll(page);
        await setupApiMocks(page);
        await loginAsTestUser(page);
        await screen.setup(page);
        const result = await screen.states[state](page);
        record.notes.push(...result.notes);
        record.waitedFor = (Array.isArray(result.wait) ? result.wait : [result.wait]).map(
          (item) => item.label,
        );

        const targetPath = screen.pathForState?.[state] ?? screen.path;
        await page.goto(targetPath, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (screen.afterGoto) {
          try {
            await screen.afterGoto(page);
          } catch (error) {
            record.notes.push(`afterGoto failed: ${String(error).slice(0, 200)}`);
          }
        }
        try {
          await page.locator(screen.ready).first().waitFor({ state: "visible", timeout: 20000 });
        } catch {
          record.notes.push(`ready selector not visible within 20s: ${screen.ready}`);
        }
        await page.addStyleTag({ content: FREEZE_CSS });
        await page.mouse.move(0, 0);

        // Poll briefly, then screenshot in the same tick the indicator is seen:
        // a state can be replaced by its resolved state before a later frame.
        let screenshotTaken = false;
        for (let attempt = 0; attempt < 12; attempt++) {
          const check = await waitForState(page, result.wait);
          if (check.confirmed) {
            record.stateConfirmed = true;
            record.notes.push(`Confirmed visible: ${check.found.join("; ")}.`);
            if (result.preScreenshotDelayMs) await page.waitForTimeout(result.preScreenshotDelayMs);
            await page.screenshot({ path: screenshotPath, fullPage: false });
            screenshotTaken = true;
            break;
          }
          await page.waitForTimeout(100);
        }
        if (!record.stateConfirmed) {
          record.notes.push(
            `State indicator not observed within its window (waited for ${record.waitedFor.join(" / ")}); frame captured honestly as whatever rendered.`,
          );
        }

        record.finalUrl = page.url();
        record.visibleStateTestIds = await probeVisibleStateIds(page);

        if (!screenshotTaken) await page.screenshot({ path: screenshotPath, fullPage: false });
        const dimensions = pngDimensions(screenshotPath);
        record.imageWidth = dimensions?.width ?? null;
        record.imageHeight = dimensions?.height ?? null;
        record.sha256 = crypto.createHash("sha256").update(fs.readFileSync(screenshotPath)).digest("hex");

        if (result.release) {
          result.release();
          await page.waitForTimeout(400);
        }
        if (result.delayMs) {
          // Let the delayed route settle so teardown does not interrupt it.
          await page.waitForTimeout(result.delayMs + 400);
        }
        testInfo.attach(`${screen.slug}-${state}-${viewport.width}`, {
          path: screenshotPath,
          contentType: "image/png",
        });
      });
    }
  }
}

test.afterAll(() => {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });

  // A targeted rerun (or a worker restart after a page crash) must not erase
  // captures from earlier cells of the matrix.
  const key = (record: CaptureRecord) => `${record.screen}:${record.state}:${record.width}`;
  let all = records;
  try {
    const previous = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const merged = new Map<string, CaptureRecord>();
    for (const record of previous.records ?? []) merged.set(key(record), record);
    for (const record of records) merged.set(key(record), record);
    all = Array.from(merged.values());
  } catch {
    // No prior manifest.
  }
  all.sort((a, b) => a.width - b.width || a.screen.localeCompare(b.screen) || STATES.indexOf(a.state) - STATES.indexOf(b.state));

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        branch: "feat/ui-a-plus",
        head: HEAD,
        baseURL: "http://127.0.0.1:5173",
        generatedAt: new Date().toISOString(),
        total: all.length,
        captured: all.filter((record) => record.status === "captured").length,
        notApplicable: all.filter((record) => record.status === "not-applicable").length,
        records: all,
      },
      null,
      2,
    ),
  );
});
