/**
 * Shared machinery for the Market → Vis evidence spec: real QA login, the exact
 * capture matrix, layout measurement and the metrics dump. Kept in one helper so
 * the spec stays a thin sequence of captures and every mocked state is declared
 * once with `mock: true` for the manifest.
 *
 * `realLogin` installs a page-level route for `market.filters` before navigation.
 * It serves the backend's unsaved default envelope on GET and fulfils PUT/DELETE
 * locally, so a capture never writes (or deletes) a shared user's config row —
 * which is what made a live browser's stale `If-Match` autosave 409.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { apiRoute } from "../../mocks/routeHelper";
import { waitForSettled } from "./evidenceFast";

export const EVIDENCE_ENABLED = process.env.SCREENSHOT_EVIDENCE === "1";
export const SHOT_DIR = process.env.SCREENSHOT_EVIDENCE_DIR ?? "docs/screenshots/market-vis";
export const METRICS_PATH =
  process.env.MARKET_VIS_METRICS_PATH ?? "/tmp/opencode/market-vis-metrics.json";
const METRICS_DIR = `${METRICS_PATH}.d`;

export const MARKET_VIS_PATH = "/screener?view=vis";
const API_ORIGIN = "http://127.0.0.1:8765";
const QA_CREDENTIALS = { email: "qa@test.com", password: "qa123" };

export const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
] as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface VisModeSpec {
  mode: string;
  label: string;
  slug: string;
  rootTestId: string;
  primaryTestId: string;
  legendTestId?: string;
  /** Only views that render a "showing X of Y" count own one to assert. */
  expectCount: boolean;
}

/** Mirrors VIS_OPTIONS in src/components/market/MarketMapView.tsx, in display order. */
export const VIS_MODES: VisModeSpec[] = [
  { mode: "heatmap", label: "Heatmap", slug: "heatmap", rootTestId: "market-map-view", primaryTestId: "market-map-canvas", legendTestId: "market-map-legend", expectCount: false },
  { mode: "sector", label: "Sector treemap", slug: "sector-treemap", rootTestId: "market-sector-map-view", primaryTestId: "market-sector-map-canvas", legendTestId: "market-sector-map-legend", expectCount: false },
  { mode: "themes", label: "Themes", slug: "themes", rootTestId: "theme-board-view", primaryTestId: "theme-board", legendTestId: "theme-board-legend", expectCount: false },
  { mode: "flow", label: "Money flow", slug: "money-flow", rootTestId: "market-flow-view", primaryTestId: "market-flow-svg", legendTestId: "market-flow-legend", expectCount: false },
  { mode: "range52", label: "52W range", slug: "range52", rootTestId: "range52-view", primaryTestId: "range52-list", expectCount: true },
  { mode: "sector52", label: "Sector 52W", slug: "sector52", rootTestId: "sector-52w-breadth-view", primaryTestId: "sector-52w-breadth", expectCount: false },
  { mode: "rsiadx", label: "RSI × ADX", slug: "rsi-adx", rootTestId: "rsi-adx-view", primaryTestId: "rsi-adx-canvas", legendTestId: "rsi-adx-legend", expectCount: false },
  { mode: "trend", label: "Trend alignment", slug: "trend", rootTestId: "trend-alignment-view", primaryTestId: "trend-scroll", legendTestId: "trend-legend", expectCount: true },
  { mode: "relvol", label: "Relative volume", slug: "relvol", rootTestId: "relvol-view", primaryTestId: "relvol-list", legendTestId: "relvol-legend", expectCount: true },
  { mode: "sectorperiod", label: "Sector × period", slug: "sector-period", rootTestId: "sector-period-view", primaryTestId: "sector-period-grid", legendTestId: "sector-period-legend", expectCount: false },
  { mode: "corrmatrix", label: "Correlation", slug: "corrmatrix", rootTestId: "correlation-matrix-view", primaryTestId: "correlation-scroll", legendTestId: "correlation-legend", expectCount: false },
];

export interface MockedState {
  id: string;
  mode: string;
  rootTestId: string;
  signalTestId: string;
  retryTestId?: string;
  endpoint: string;
  behavior: string;
  note: string;
  mock: true;
  expectCount: boolean;
  /**
   * The loading/error belongs to the shared MarketScreenerPanel region, not to
   * a per-view component. The skeleton/error replaces the whole Vis region, so
   * the mode selector is absent and the frame is captured straight after goto.
   */
  panelLevel?: boolean;
  /** One sentence for the manifest lane, published through the metrics entry. */
  covers?: string;
}

/**
 * Snapshot-level loading/error is the shared MarketScreenerPanel region: the
 * whole Vis area becomes `market-skeleton` / `market-error` while the request
 * is pending or has failed. There is no per-view skeleton/error for these
 * modes, so two shared states honestly cover them instead of nine byte-identical
 * per-mode copies. Themes and Correlation own real per-view loading/error and
 * keep their own states below.
 */
const PANEL_COVERS =
  "Panel-level skeleton/error while the snapshot request is stalled/failing — the Vis region is replaced entirely, so this one state covers all snapshot-driven modes (heatmap, sector treemap, Money flow, RSI × ADX, Sector 52W, Sector × period, 52W range, Trend, Relative volume).";

const SHARED_PANEL_STATES: MockedState[] = [
  {
    id: "panel-loading",
    mode: "panel",
    rootTestId: "market-screener",
    signalTestId: "market-skeleton",
    endpoint: "/api/market/snapshot",
    behavior: "delay 4000 ms, then 200",
    note: "The live snapshot cache answers too fast to photograph the shared skeleton.",
    mock: true,
    expectCount: false,
    panelLevel: true,
    covers: PANEL_COVERS,
  },
  {
    id: "panel-error",
    mode: "panel",
    rootTestId: "market-screener",
    signalTestId: "market-error",
    // The retry inside `market-error` is `market-retry`; `market-error-banner-retry`
    // belongs to the refresh banner, which needs rows and never shows on a 503.
    retryTestId: "market-retry",
    endpoint: "/api/market/snapshot",
    behavior: "503",
    note: "The live snapshot endpoint does not fail on demand.",
    mock: true,
    expectCount: false,
    panelLevel: true,
    covers: PANEL_COVERS,
  },
];

/**
 * Every capture that is not reachable from the live backend. The manifest must
 * mark these `mock: true`; all eleven mode captures use real market/snapshot and
 * real sector/groups data.
 */
export const MOCKED_STATES: MockedState[] = [
  {
    id: "corrmatrix-loading",
    mode: "corrmatrix",
    rootTestId: "correlation-matrix-view",
    signalTestId: "correlation-loading",
    endpoint: "/api/sector/correlation",
    behavior: "delay 4000 ms, then 200",
    note: "A slow response is not reproducible from the warm live cache.",
    mock: true,
    expectCount: false,
  },
  {
    id: "corrmatrix-error",
    mode: "corrmatrix",
    rootTestId: "correlation-matrix-view",
    signalTestId: "correlation-error",
    retryTestId: "correlation-retry",
    endpoint: "/api/sector/correlation",
    behavior: "503",
    note: "The live upsector endpoint does not fail on demand.",
    mock: true,
    expectCount: false,
  },
  {
    id: "corrmatrix-empty",
    mode: "corrmatrix",
    rootTestId: "correlation-matrix-view",
    signalTestId: "correlation-empty",
    endpoint: "/api/sector/correlation",
    behavior: "200 with sector_names: [] and correlation_matrix: []",
    note: "The normalizer keys off sector_names/correlation_matrix, not sectors.",
    mock: true,
    expectCount: false,
  },
  {
    id: "themes-loading",
    mode: "themes",
    rootTestId: "theme-board-view",
    signalTestId: "theme-board-loading",
    endpoint: "/api/sector/groups",
    behavior: "delay 4000 ms, then 200",
    note: "The live groups cache answers too fast to photograph its skeleton.",
    mock: true,
    expectCount: false,
  },
  {
    id: "themes-error",
    mode: "themes",
    rootTestId: "theme-board-view",
    signalTestId: "theme-board-error",
    retryTestId: "theme-board-retry",
    endpoint: "/api/sector/groups",
    behavior: "503",
    note: "The live groups endpoint does not fail on demand.",
    mock: true,
    expectCount: false,
  },
  {
    id: "range52-empty",
    mode: "range52",
    rootTestId: "range52-view",
    signalTestId: "range52-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with rows: []",
    note: "An empty 52W universe is not present in the live 3,602-row universe.",
    mock: true,
    expectCount: true,
  },
  {
    id: "relvol-empty",
    mode: "relvol",
    rootTestId: "relvol-view",
    signalTestId: "relvol-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with relative_volume: null on every row",
    note: "Live rows always carry relative volume.",
    mock: true,
    expectCount: true,
  },
  {
    id: "trend-empty",
    mode: "trend",
    rootTestId: "trend-alignment-view",
    signalTestId: "trend-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with sma20/sma50/sma200 null on every row",
    note: "Live rows always carry moving averages.",
    mock: true,
    expectCount: true,
  },
  {
    id: "heatmap-empty",
    mode: "heatmap",
    rootTestId: "market-map-view",
    signalTestId: "market-map-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with rows: [] and total: 0",
    note: "The live equity universe always has rows to tile.",
    mock: true,
    expectCount: false,
  },
  {
    id: "sector-treemap-empty",
    mode: "sector",
    rootTestId: "market-sector-map-view",
    signalTestId: "market-sector-map-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with rows: [] and total: 0",
    note: "The live universe always yields sector tiles; the Canvas fallback has no real trigger.",
    mock: true,
    expectCount: false,
  },
  {
    id: "rsi-adx-empty",
    mode: "rsiadx",
    rootTestId: "rsi-adx-view",
    signalTestId: "rsi-adx-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with rsi/adx null on every row",
    note: "Live rows always carry both indicators; eligibility filters them all out.",
    mock: true,
    expectCount: false,
  },
  {
    id: "money-flow-empty",
    mode: "flow",
    rootTestId: "market-flow-view",
    signalTestId: "market-flow-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with sector: null and change: null on every row",
    note: "aggregateSectorFlow skips non-finite changes, so no sector group can form.",
    mock: true,
    expectCount: false,
  },
  {
    id: "sector52-empty",
    mode: "sector52",
    rootTestId: "sector-52w-breadth-view",
    signalTestId: "sector-52w-breadth-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with to_52w_high_pct/from_52w_low_pct null on every row",
    note: "computeSectorBreadth drops a sector whose cohort has no usable high reading.",
    mock: true,
    expectCount: false,
  },
  {
    id: "sector-period-empty",
    mode: "sectorperiod",
    rootTestId: "sector-period-view",
    signalTestId: "sector-period-empty",
    endpoint: "/api/market/snapshot",
    behavior: "200 with sector: null and perf_w/perf_1m/change null on every row",
    note: "computeSectorPeriods skips rows without a sector, so no period grid can form.",
    mock: true,
    expectCount: false,
  },
  ...SHARED_PANEL_STATES,
  {
    id: "themes-empty",
    mode: "themes",
    rootTestId: "theme-board-view",
    signalTestId: "theme-board-empty",
    endpoint: "/api/sector/groups",
    behavior: "200 with classify: theme, period: 1D, market: india and groups: []",
    note: "The live theme board always has groups; an empty theme period cannot be produced from live data.",
    mock: true,
    expectCount: false,
    covers: "Themes board with an empty groups payload: the no-themes-for-this-period fallback.",
  },
];

/** Live (unmocked) capture for the Themes detail surface at both widths. */
export interface DetailStateSpec {
  id: string;
  mode: string;
  rootTestId: string;
  boardTestId: string;
  rowSelector: string;
  detailTestId: string;
  mobileCardTestId: string;
  desktopPaneTestId: string;
  loadingTestId: string;
  readyTestId: string;
  mock: false;
  expectCount: boolean;
}

export const DETAIL_STATES: DetailStateSpec[] = [
  {
    id: "themes-detail",
    mode: "themes",
    rootTestId: "theme-board-view",
    boardTestId: "theme-board",
    rowSelector: 'button[data-testid^="theme-board-row-"]',
    detailTestId: "theme-board-detail",
    mobileCardTestId: "theme-board-detail-card",
    desktopPaneTestId: "theme-board-detail-pane",
    loadingTestId: "theme-board-detail-loading",
    readyTestId: "theme-board-member-tiles",
    mock: false,
    expectCount: false,
  },
];

/**
 * Live (unmocked) captures that operate a non-default option of a control the
 * mode already owns. Each id becomes `market-vis-<id>-<width>.png`; `covers` is
 * published through the metrics entry so the manifest lane can describe it.
 */
export interface AlternateStateSpec {
  id: string;
  mode: string;
  covers: string;
  controlTestId: string;
  controlKind: "native-select" | "segmented" | "checkbox" | "button";
  /** Option to select on a native select or a segmented control. */
  value?: string;
  /** Attribute that witnesses the control's own active state. */
  pressedAttribute: "value" | "aria-pressed" | "aria-checked";
  /** DOM that must react once the control's data has been applied. */
  witnessSelector?: string;
  witnessRead: "none" | "attribute" | "styles" | "text" | "count-drop";
  witnessAttribute?: string;
  /** A row selector that must still render after the control changes. */
  rowsVisibleSelector?: string;
  /** A showing X of Y count that must remain visible after the change. */
  countTestId?: string;
}

export const ALTERNATE_STATES: AlternateStateSpec[] = [
  {
    id: "heatmap-size-relvol",
    mode: "heatmap",
    covers: "Heatmap sized by relative volume instead of the shipped Day Change default.",
    controlTestId: "market-map-metric",
    controlKind: "native-select",
    value: "relative_volume",
    pressedAttribute: "value",
    witnessSelector: '[data-testid="market-map-legend"]',
    witnessRead: "attribute",
    witnessAttribute: "title",
  },
  {
    id: "themes-period-1w",
    mode: "themes",
    covers: "Themes period switched to 1W, re-fetched and redrawn as diverging bars.",
    controlTestId: "theme-board-period",
    controlKind: "native-select",
    value: "1W",
    pressedAttribute: "value",
    witnessSelector: '[data-testid^="theme-board-bar-"]',
    witnessRead: "styles",
  },
  {
    id: "range52-within5",
    mode: "range52",
    covers: "52-week range narrowed to names within 5% of their high.",
    controlTestId: "range52-filter-selector",
    controlKind: "segmented",
    value: "5",
    pressedAttribute: "aria-pressed",
    witnessSelector: '[data-testid="range52-count"]',
    witnessRead: "count-drop",
  },
  {
    id: "sector52-near-low",
    mode: "sector52",
    covers: "Sector 52-week breadth switched from Near high to the Near low measure.",
    controlTestId: "sector-52w-breadth-toggle",
    controlKind: "segmented",
    value: "low",
    pressedAttribute: "aria-pressed",
    witnessSelector: '[data-testid^="sector-52w-bar-"]',
    witnessRead: "styles",
    rowsVisibleSelector: '[data-testid^="sector-52w-row-"]',
  },
  {
    id: "relvol-ge2",
    mode: "relvol",
    covers: "Relative volume restricted to the 2× threshold chip.",
    controlTestId: "relvol-filter-gte2",
    controlKind: "checkbox",
    pressedAttribute: "aria-checked",
    witnessRead: "none",
    countTestId: "relvol-count",
  },
  {
    id: "trend-3of3",
    mode: "trend",
    covers: "Trend alignment narrowed to the 3/3 filter.",
    controlTestId: "trend-filter-3/3",
    controlKind: "button",
    pressedAttribute: "aria-pressed",
    witnessRead: "none",
    rowsVisibleSelector: '[data-testid="trend-row"]',
  },
];

export function isMockedCapture(id: string): boolean {
  return MOCKED_STATES.some((state) => state.id === id);
}

/** A measureLayout spec for a panel-level skeleton/error frame. */
export function panelLevelSpec(state: MockedState): VisModeSpec {
  return {
    mode: state.mode,
    label: state.mode,
    slug: state.id,
    rootTestId: state.rootTestId,
    primaryTestId: state.signalTestId,
    expectCount: false,
  };
}

export function captureFileName(id: string, width: number): string {
  return `market-vis-${id}-${width}.png`;
}

export function ensureShotDir(): void {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

const MARKET_CONFIG_SCOPE = "market.filters";
const MARKET_CONFIG_URL = "**/api/user-configs/market.filters";

/**
 * Exact `MarketFiltersV1().model_dump()` from api/user_configs.py: the `config`
 * inside `_envelope(spec, spec.default(), saved=False)` for a scope with no row.
 * The store merges its own defaults over this when `saved` is false, so the
 * capture starts chip-free with the shipped `Market Cap` sort and `Day Change`
 * sizing — without deleting anyone's row.
 */
const DEFAULT_MARKET_CONFIG: Record<string, unknown> = {
  universe: "all_equity",
  sectors: [],
  capTiers: [],
  priceMin: null,
  priceMax: null,
  dayChangeMin: null,
  dayChangeMax: null,
  mcapMinCr: null,
  mcapMaxCr: null,
  rsiMin: null,
  rsiMax: null,
  relVolMin: null,
  relVolMax: null,
  gapMin: null,
  gapMax: null,
  rangeVsAtrMin: null,
  to52wHighMin: null,
  to52wHighMax: null,
  from52wLowMin: null,
  from52wLowMax: null,
  volumeMin: null,
  valueTradedMin: null,
  pePctMax: null,
  roePctMin: null,
  dePctMax: null,
  peMax: null,
  psMax: null,
  pbMax: null,
  roeMin: null,
  divYieldMin: null,
  fcfYieldMin: null,
  debtToEquityMax: null,
  revYoyMin: null,
  epsYoyMin: null,
  aboveSma20: false,
  aboveSma50: false,
  aboveSma200: false,
  fnoOnly: false,
  etfOnly: false,
  sort: "mcap_desc",
  view: "table",
  colorBy: "change_pct",
};

/** `_envelope(spec, spec.default(), saved=False)` — no `warning`, no `updated_at`. */
const UNSAVED_CONFIG_ENVELOPE = {
  scope: MARKET_CONFIG_SCOPE,
  version: 1,
  saved: false,
  updated_at: null,
  config: DEFAULT_MARKET_CONFIG,
};

export interface ConfigIsolationStats {
  get: number;
  put: number;
  del: number;
  preflight: number;
  other: number;
}

const configIsolation = new WeakMap<Page, ConfigIsolationStats>();

function corsHeaders(origin: string | undefined): Record<string, string> {
  // The dev API is cross-origin; mirror api_server_fastapi.DynamicCORSMiddleware
  // so `fetchWithAuth` can read the fulfilled body and the preflight can pass.
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Expose-Headers": "ETag, Retry-After",
        Vary: "Origin",
      }
    : {};
}

/**
 * Answer every `market.filters` request inside the page. GET is the backend's
 * unsaved envelope; PUT/DELETE are acknowledged without touching the DB, so a
 * capture cannot invalidate the ETag a user's live browser holds for that row.
 * `table.market.grid` and every other scope keep using the real API.
 */
async function installConfigIsolation(page: Page): Promise<void> {
  const stats: ConfigIsolationStats = { get: 0, put: 0, del: 0, preflight: 0, other: 0 };
  configIsolation.set(page, stats);
  await page.route(MARKET_CONFIG_URL, async (route) => {
    const method = route.request().method();
    const headers = corsHeaders(route.request().headers()["origin"]);
    if (method === "OPTIONS") {
      stats.preflight += 1;
      await route.fulfill({
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Requested-With, If-Match, If-None-Match, If-Modified-Since, Cache-Control, Pragma",
          "Access-Control-Max-Age": "86400",
        },
      });
      return;
    }
    if (method === "GET") stats.get += 1;
    else if (method === "PUT") stats.put += 1;
    else if (method === "DELETE") stats.del += 1;
    else stats.other += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(
        method === "DELETE"
          ? { scope: MARKET_CONFIG_SCOPE, deleted: false }
          : UNSAVED_CONFIG_ENVELOPE,
      ),
    });
  });
}

/** All config traffic on the capture page was fulfilled in-page, never by the API. */
export function assertConfigIsolation(page: Page): ConfigIsolationStats {
  const stats = configIsolation.get(page);
  expect(stats, "realLogin did not install the market.filters isolation route").toBeTruthy();
  expect(
    stats!.other,
    `${stats!.other} request(s) to ${MARKET_CONFIG_SCOPE} were not fulfilled in-page`,
  ).toBe(0);
  console.log(
    `[config-isolation] ${MARKET_CONFIG_SCOPE}: GET=${stats!.get} PUT=${stats!.put} ` +
      `DELETE=${stats!.del} PREFLIGHT=${stats!.preflight} — all fulfilled in-page, no DB write`,
  );
  return { ...stats! };
}

/** Real login over APIRequestContext; no auth routes are intercepted. */
export async function realLogin(page: Page, request: APIRequestContext): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/api/auth/login`, { data: QA_CREDENTIALS });
  expect(response.ok(), `QA login failed with HTTP ${response.status()}`).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string; refresh_token?: string };
  expect(tokens.access_token, "login response has no access_token").toBeTruthy();

  const me = await request.get(`${API_ORIGIN}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  expect(me.ok(), `/api/auth/me failed with HTTP ${me.status()}`).toBeTruthy();
  const user = await me.json();

  // Installed before goto: both the store's mount GET and any later autosave
  // PUT must be answered in-page, never by the shared QA row in the DB.
  await installConfigIsolation(page);

  // Keys and user shape are the ones read by src/state/auth.ts.
  await page.addInitScript((seed) => {
    localStorage.setItem("alphashri_token", seed.accessToken);
    localStorage.setItem("alphashri_refresh_token", seed.refreshToken);
    localStorage.setItem("alphashri_user", JSON.stringify(seed.user));
  }, {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token ?? "",
    user,
  });
}

/** A previous navigation in the same worker must not paint a cached mocked snapshot. */
export async function clearCachedSnapshots(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key?.startsWith("alphashri.market_snapshot.v1.")) sessionStorage.removeItem(key);
      }
    } catch {
      // sessionStorage is optional; absence means there is nothing stale to clear.
    }
  });
}

const VALID_CORRELATION = {
  sector_names: ["NIFTY 50", "NIFTY BANK", "NIFTY IT"],
  correlation_matrix: [
    [1, 0.82, 0.64],
    [0.82, 1, 0.71],
    [0.64, 0.71, 1],
  ],
  sectors: [
    { name: "NIFTY 50", beta_vs_index: 1, rank_current: 1 },
    { name: "NIFTY BANK", beta_vs_index: 1.2, rank_current: 2 },
    { name: "NIFTY IT", beta_vs_index: 0.9, rank_current: 3 },
  ],
  last_updated: "2026-11-28T09:15:00+05:30",
};

const VALID_GROUPS = {
  groups: [
    { name: "AI Infrastructure", change: 2.4, stock_count: 12 },
    { name: "Power", change: 1.1, stock_count: 9 },
  ],
  last_updated: "2026-11-28T09:15:00+05:30",
};

function snapshotBody(rows: Record<string, unknown>[]): string {
  return JSON.stringify({
    as_of: "2026-11-28T09:15:00+05:30",
    universe: "all_equity",
    total: rows.length,
    update_mode: "intraday",
    rows,
  });
}

type SnapshotFixtureKind =
  | "empty"
  | "no-relvol"
  | "no-sma"
  | "no-rsiadx"
  | "no-flow"
  | "no-52w"
  | "no-period";

function snapshotRows(kind: SnapshotFixtureKind): Record<string, unknown>[] {
  if (kind === "empty") return [];
  const base = ["ALPHA", "BETA", "GAMMA", "DELTA"].map((symbol, index) => ({
    symbol,
    name: `${symbol} Ltd`,
    sector: index % 2 === 0 ? "Technology" : "Finance",
    exchange: "NSE",
    close: 100 + index * 10,
    change: index % 2 === 0 ? 1.2 : -0.8,
    high_52w: 150 + index * 10,
    low_52w: 60 + index * 10,
    pos_52w: 70 - index * 5,
    to_52w_high_pct: -4 - index * 3,
    from_52w_low_pct: 40 + index * 5,
    rsi: 55 + index,
    adx: 20 + index,
    relative_volume: 2.4 - index * 0.3,
    market_cap_cr: 10000 + index * 5000,
    perf_w: 1.4 + index * 0.2,
    perf_1m: 3.2 + index * 0.4,
    sma20: 98 + index * 10,
    sma50: 95 + index * 10,
    sma200: 90 + index * 10,
  }));
  if (kind === "no-relvol") {
    return base.map((row) => ({ ...row, relative_volume: null }));
  }
  if (kind === "no-rsiadx") {
    return base.map((row) => ({ ...row, rsi: null, adx: null }));
  }
  if (kind === "no-flow") {
    return base.map((row) => ({ ...row, sector: null, change: null }));
  }
  if (kind === "no-52w") {
    return base.map((row) => ({
      ...row,
      high_52w: null,
      low_52w: null,
      pos_52w: null,
      to_52w_high_pct: null,
      from_52w_low_pct: null,
    }));
  }
  if (kind === "no-period") {
    return base.map((row) => ({
      ...row,
      sector: null,
      change: null,
      perf_w: null,
      perf_1m: null,
    }));
  }
  return base.map((row) => ({ ...row, sma20: null, sma50: null, sma200: null }));
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Install exactly one route override; the main ten captures install none. */
export async function installStateMock(page: Page, stateId: string): Promise<MockedState> {
  const state = MOCKED_STATES.find((item) => item.id === stateId);
  if (!state) throw new Error(`Unknown mocked Vis state: ${stateId}`);

  if (state.panelLevel) {
    if (stateId === "panel-loading") {
      // Hold the response open so `showInitialLoading()` keeps the panel-level
      // skeleton on screen long enough to photograph it.
      await page.route(apiRoute("market/snapshot"), async (route) => {
        await delay(4000);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: snapshotBody(snapshotRows("no-sma")),
        });
      });
    } else {
      await page.route(apiRoute("market/snapshot"), (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Deliberate evidence mock" }),
        }),
      );
    }
    return state;
  }

  if (stateId === "corrmatrix-loading" || stateId === "themes-loading") {
    const routePattern = stateId.startsWith("corrmatrix")
      ? apiRoute("sector/correlation")
      : apiRoute("sector/groups");
    const body = stateId.startsWith("corrmatrix") ? VALID_CORRELATION : VALID_GROUPS;
    await page.route(routePattern, async (route) => {
      await delay(4000);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    return state;
  }

  if (stateId === "corrmatrix-error" || stateId === "themes-error") {
    const routePattern = stateId.startsWith("corrmatrix")
      ? apiRoute("sector/correlation")
      : apiRoute("sector/groups");
    await page.route(routePattern, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Deliberate evidence mock" }),
      }),
    );
    return state;
  }

  if (stateId === "corrmatrix-empty") {
    await page.route(apiRoute("sector/correlation"), (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sector_names: [], correlation_matrix: [], sectors: [] }),
      }),
    );
    return state;
  }

  if (stateId === "themes-empty") {
    await page.route(apiRoute("sector/groups"), (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          classify: "theme",
          period: "1D",
          market: "india",
          last_updated: "2026-11-28T09:15:00+05:30",
          groups: [],
        }),
      }),
    );
    return state;
  }

  const kind: SnapshotFixtureKind =
    stateId === "range52-empty" ||
    stateId === "heatmap-empty" ||
    stateId === "sector-treemap-empty"
      ? "empty"
      : stateId === "relvol-empty"
        ? "no-relvol"
        : stateId === "rsi-adx-empty"
          ? "no-rsiadx"
          : stateId === "money-flow-empty"
            ? "no-flow"
            : stateId === "sector52-empty"
              ? "no-52w"
              : stateId === "sector-period-empty"
                ? "no-period"
                : "no-sma";
  await page.route(apiRoute("market/snapshot"), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: snapshotBody(snapshotRows(kind)) }),
  );
  return state;
}

export async function selectVisMode(page: Page, mode: string): Promise<void> {
  const option = page.getByTestId("market-vis-selector").locator(`[data-value="${mode}"]`);
  await expect(option).toBeVisible();
  await option.click();
}

export async function waitForVisMode(page: Page, rootTestId: string): Promise<void> {
  await expect(page.getByTestId(rootTestId)).toBeVisible();
  await waitForSettled(page, `[data-testid="${rootTestId}"]`);
}

async function witnessValue(page: Page, state: AlternateStateSpec): Promise<string> {
  return page.evaluate(
    (args) => {
      if (args.read === "styles") {
        return [...document.querySelectorAll(args.selector)]
          .map((node) => node.getAttribute("style") ?? "")
          .join("|");
      }
      const element = document.querySelector(args.selector);
      if (!element) return "";
      if (args.read === "attribute") return element.getAttribute(args.attribute ?? "") ?? "";
      return element.textContent ?? "";
    },
    {
      selector: state.witnessSelector!,
      read: state.witnessRead,
      attribute: state.witnessAttribute,
    },
  );
}

function parseShowing(text: string): { shown: number; total: number } | null {
  const match = /showing\s+([\d,]+)\s+of\s+([\d,]+)/i.exec(text);
  if (!match) return null;
  return {
    shown: Number(match[1]!.replace(/,/g, "")),
    total: Number(match[2]!.replace(/,/g, "")),
  };
}

/** Operate one non-default control option and prove the view reacted to it. */
export async function applyAlternateState(page: Page, state: AlternateStateSpec): Promise<void> {
  const control = page.getByTestId(state.controlTestId);
  await expect(control, `${state.id}: control ${state.controlTestId} missing`).toBeVisible({
    timeout: 30_000,
  });

  let target = control;
  if (state.controlKind === "native-select") {
    target = control.locator("select");
  } else if (state.controlKind === "segmented") {
    target = control.locator(`[data-value="${state.value}"]`);
  }
  await expect(target, `${state.id}: target ${state.value ?? state.controlTestId} missing`).toBeVisible();

  const hasWitness = state.witnessRead !== "none";
  const before = hasWitness ? await witnessValue(page, state) : "";
  const beforeCount = state.witnessRead === "count-drop" ? parseShowing(before) : null;
  if (hasWitness) {
    expect(before, `${state.id}: witness ${state.witnessSelector} is empty before the change`).not.toBe("");
  }

  if (state.controlKind === "native-select") {
    await target.selectOption(state.value!);
    await expect(target, `${state.id}: select did not adopt ${state.value}`).toHaveValue(state.value!);
  } else {
    await target.click();
    await expect(
      target,
      `${state.id}: ${state.pressedAttribute} never became true`,
    ).toHaveAttribute(state.pressedAttribute, "true");
  }

  if (hasWitness) {
    await expect
      .poll(
        async () => {
          const after = await witnessValue(page, state);
          // Bars unmount while a new period loads; an empty frame is not a redraw.
          if (state.witnessRead === "styles" && after === "") return false;
          if (after === before) return false;
          if (state.witnessRead === "count-drop") {
            const parsed = parseShowing(after);
            return (
              !!beforeCount &&
              !!parsed &&
              parsed.total < beforeCount.total &&
              parsed.shown <= beforeCount.shown
            );
          }
          return true;
        },
        {
          timeout: 30_000,
          message: `${state.id}: witness ${state.witnessSelector} did not react to the control change`,
        },
      )
      .toBe(true);
  }

  if (state.countTestId) {
    await expect(
      page.getByTestId(state.countTestId),
      `${state.id}: count ${state.countTestId} is no longer visible`,
    ).toBeVisible({ timeout: 30_000 });
  }
  if (state.rowsVisibleSelector) {
    const row = page.locator(state.rowsVisibleSelector).first();
    await expect(row, `${state.id}: no rows rendered after the change`).toBeVisible({ timeout: 30_000 });
  }
}

/** Wait until the full real (or deliberately mocked) snapshot has been painted. */
export async function waitForLoadedCount(page: Page, allowEmpty = false): Promise<void> {
  // Fail fast on the wrong route: the legacy /screener/screener page never mounts
  // the Vis selector or the snapshot count, so a bare poll would only time out.
  try {
    await expect(page.getByTestId("market-vis-selector")).toBeVisible({ timeout: 5_000 });
  } catch {
    throw new Error(
      `Market Vis page did not mount at "${MARKET_VIS_PATH}" — market-vis-selector never became visible. ` +
        "Check the route: the legacy /screener/screener page has no Vis selector and never loads market/snapshot.",
    );
  }
  await expect
    .poll(async () => {
      const text = (await page.getByTestId("market-result-count").textContent()) ?? "";
      const match = /^\s*([\d,]+)\s*\/\s*([\d,]+)\s*$/.exec(text);
      if (!match) return false;
      const loaded = Number(match[2]!.replace(/,/g, ""));
      return allowEmpty ? loaded >= 0 : loaded > 0;
    })
    .toBe(true);
}

/**
 * Pure UI assertion — no writes of any kind. The isolated GET already handed the
 * page the unsaved defaults, so a chip here means the store ignored them. Never
 * press Reset from the harness: it schedules an autosave PUT, which would write
 * a config row even when the response is fulfilled locally.
 */
export async function resetFiltersAndAssert(page: Page, allowEmpty = false): Promise<void> {
  await expect(
    page.getByTestId("market-reset"),
    `market-reset is missing at "${MARKET_VIS_PATH}" — wrong route / page did not mount`,
  ).toBeVisible();
  await expect(page.locator('[data-testid^="market-filter-chip-"]')).toHaveCount(0);

  const count = page.getByTestId("market-result-count");
  if ((await count.count()) === 0) {
    throw new Error(
      `market-result-count is missing at "${MARKET_VIS_PATH}" — wrong route / Market Vis page did not mount, ` +
        "not a genuine filter-state mismatch.",
    );
  }

  let observed = "<no text>";
  try {
    await expect
      .poll(async () => {
        observed = (await count.textContent()) ?? "";
        const match = /^\s*([\d,]+)\s*\/\s*([\d,]+)\s*$/.exec(observed);
        if (!match) return false;
        const shown = Number(match[1]!.replace(/,/g, ""));
        const loaded = Number(match[2]!.replace(/,/g, ""));
        if (!allowEmpty && loaded <= 0) return false;
        return shown === loaded;
      })
      .toBe(true);
  } catch (error) {
    throw new Error(
      `at "${MARKET_VIS_PATH}", market-result-count never reached matching counts — ` +
        `genuine filter-state mismatch (shown !== loaded). Last observed: ${JSON.stringify(observed)}`,
      { cause: error },
    );
  }
}

export interface LayoutMeasurement {
  panelRect: Rect | null;
  chartRect: Rect | null;
  legendRect: Rect | null;
  overflow: number;
  countVisible: boolean;
  /** Testid actually measured as the primary visual (ready mode or mocked signal). */
  primary: string;
  violations: string[];
}

export async function measureLayout(
  page: Page,
  spec: VisModeSpec,
  width: number,
  primaryTestIdOverride?: string,
): Promise<LayoutMeasurement> {
  const primary = primaryTestIdOverride ?? spec.primaryTestId;
  const measured = await page.evaluate((args) => {
    const rectOf = (element: Element | null): Rect | null => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
      };
    };

    const violations: string[] = [];
    const panel = document.querySelector(`[data-testid="${args.rootTestId}"]`);
    const panelRect = rectOf(panel);
    const chartRect = rectOf(document.querySelector(`[data-testid="${args.primary}"]`));
    const legendRect = args.legendTestId
      ? rectOf(document.querySelector(`[data-testid="${args.legendTestId}"]`))
      : null;
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

    if (!panelRect) violations.push(`missing panel [${args.rootTestId}]`);
    if (!chartRect) violations.push(`missing primary visual [${args.primary}]`);

    // Only a "showing X of Y" count is a count here; the other toolbar chips
    // name totals or dimensions and are intentionally compact.
    const countNodes = panel
      ? [...panel.querySelectorAll<HTMLElement>("[data-testid]")].filter((node) => {
          const id = node.dataset.testid ?? "";
          return (
            (id.endsWith("-count") || id === "trend-showing") &&
            /showing/i.test(node.textContent ?? "")
          );
        })
      : [];
    const countVisible =
      countNodes.length > 0 &&
      countNodes.every((node) => {
        const r = node.getBoundingClientRect();
        const id = node.dataset.testid;
        if (r.width <= 0 || r.height <= 0) {
          violations.push(`count [${id}] has zero width/height`);
          return false;
        }
        if (!panelRect || r.left < panelRect.left - 1 || r.right > panelRect.right + 1) {
          violations.push(`count [${id}] escapes the panel horizontally`);
          return false;
        }
        return true;
      });

    // A horizontal scroller owns the offscreen buttons of the eleven-mode selector;
    // those are deliberate and must not be reported as panel overflow.
    if (panel && panelRect) {
      for (const element of panel.querySelectorAll("*")) {
        const r = element.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right <= panelRect.right + 1) continue;
        let ancestor = element.parentElement;
        let insideScroller = false;
        while (ancestor && ancestor !== panel) {
          const overflowX = getComputedStyle(ancestor).overflowX;
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") {
            insideScroller = true;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        if (insideScroller) continue;
        const id = element.getAttribute("data-testid");
        violations.push(
          `${element.tagName.toLowerCase()}${id ? `[${id}]` : ""} right=${r.right.toFixed(1)} exceeds panel right ${panelRect.right.toFixed(1)}`,
        );
        if (violations.length >= 12) break;
      }
    }

    if (args.width === 1600 && panelRect && chartRect) {
      if (chartRect.width <= 0 || chartRect.height <= 0) {
        violations.push("primary visual has zero size at 1600");
      } else if (chartRect.height < panelRect.height * 0.5) {
        violations.push(
          `primary visual height ${chartRect.height.toFixed(1)} fills less than half of panel ${panelRect.height.toFixed(1)}`,
        );
      }
      if (chartRect.right > panelRect.right + 2 || chartRect.bottom > panelRect.bottom + 2) {
        violations.push("primary visual extends past the panel at 1600");
      }
    }

    return { panelRect, chartRect, legendRect, overflow, countVisible, violations };
  }, {
    rootTestId: spec.rootTestId,
    primary,
    legendTestId: spec.legendTestId ?? null,
    width,
  });

  return { ...measured, primary };
}

export function assertLayout(
  measurement: LayoutMeasurement,
  width: number,
  expectCount: boolean,
): void {
  expect(measurement.violations, measurement.violations.join("\n")).toEqual([]);
  if (width === 390) {
    expect(
      measurement.overflow,
      `document overflows the 390px viewport by ${measurement.overflow}px`,
    ).toBeLessThanOrEqual(0);
  }
  expect(
    measurement.countVisible,
    expectCount
      ? "a showing X of Y count is not visible inside the panel"
      : "a showing X of Y count was found where this view owns none",
  ).toBe(expectCount);
}

/** Checks that fail a capture even though they are not general layout rules. */
export async function assertModeSpecific(
  page: Page,
  mode: string,
  width: number,
  height: number,
): Promise<void> {
  if (mode === "rsiadx" && width === 390) {
    const canvas = page.getByTestId("rsi-adx-canvas");
    await expect(canvas).toBeVisible();
    const canvasHeight = await canvas.evaluate((element) => element.getBoundingClientRect().height);
    expect(canvasHeight, `RSI canvas is only ${canvasHeight}px tall at 390`).toBeGreaterThanOrEqual(320);
  }

  if (mode === "corrmatrix" && width === 390) {
    const refresh = page.getByTestId("correlation-refresh");
    await expect(refresh).toBeVisible();
    await expect(refresh).toBeEnabled();
    const box = await refresh.boundingBox();
    expect(box, "correlation Refresh has no layout box").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    const hittable = await page.evaluate(() => {
      const target = document.querySelector('[data-testid="correlation-refresh"]');
      if (!target) return false;
      const r = target.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === target || target.contains(top));
    });
    expect(hittable, "correlation Refresh is covered at 390").toBe(true);
  }
}

export const FORBIDDEN_CONSOLE = [
  /Failed to fetch/i,
  /Cannot read properties/i,
  /undefined/i,
  /NaN/i,
];

export function collectVisConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  // The deliberate 503 fixtures always log a browser resource-load message.
  const ignored = ["ws/", "WebSocket", "ERR_CONNECTION_REFUSED", "status of 503"];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const text = message.text();
    if (ignored.some((pattern) => text.includes(pattern))) return;
    errors.push(text);
  });
  return errors;
}

export function assertNoForbiddenConsole(errors: string[]): void {
  const forbidden = errors.filter((text) => FORBIDDEN_CONSOLE.some((pattern) => pattern.test(text)));
  expect(forbidden, forbidden.join("\n")).toEqual([]);
}

export interface MetricsEntry extends LayoutMeasurement {
  mode: string;
  width: number;
  mock: boolean;
  capture: string;
  /** `market.filters` was served by an in-page route; no user config row was written. */
  configIsolated: true;
  /** Whether this view owns a "showing X of Y" count (assertLayout outcome). */
  expectCount?: boolean;
  /** Present on alternate-selector captures: the id of the new state. */
  stateId?: string;
  /** Present on alternate-selector captures: one sentence for the manifest lane. */
  covers?: string;
}

/**
 * Each capture owns one JSON file; every write re-publishes the combined array
 * with an atomic rename so parallel workers cannot leave a partial document.
 */
export function recordMetric(entry: MetricsEntry): void {
  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  const name = `${entry.mode}-${entry.width}`.replace(/[^a-z0-9-]+/gi, "-") + ".json";
  fs.writeFileSync(path.join(METRICS_DIR, name), JSON.stringify(entry, null, 2));

  const files = fs.readdirSync(METRICS_DIR).filter((file) => file.endsWith(".json")).sort();
  const entries = files.map((file) =>
    JSON.parse(fs.readFileSync(path.join(METRICS_DIR, file), "utf8")) as MetricsEntry,
  );
  const temporary = `${METRICS_PATH}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2));
  fs.renameSync(temporary, METRICS_PATH);
}
