/**
 * Additive fixtures for the `/patterns` route evidence capture.
 *
 * `setupHomePatternMocks` supplies the bootstrap catalog and an empty result
 * set, which is honest for the home desk but leaves this page with no rows (and
 * invites its empty-view auto-scan). These handlers are registered after it —
 * Playwright gives later routes priority — and add the results, summary and
 * matrix payloads the default matrix view consumes. Without them the page logs
 * "Failed to fetch" and paints an error alert instead of the result grid.
 */
import type { Page } from "@playwright/test";
import { apiRoute } from "./routeHelper";

export const PATTERNS_EVIDENCE_PATH = "/patterns";

/** Default view is the symbol matrix; `patterns-matrix-row-*` are the real rows. */
export const PATTERNS_EVIDENCE_RESULTS =
  '[data-testid="patterns-symbol-matrix"] [data-testid^="patterns-matrix-row-"]';
export const PATTERNS_EVIDENCE_SCROLL_REGION = "patterns-matrix-scroll-region";
export const PATTERNS_EVIDENCE_SCROLL_CUE = "patterns-matrix-scroll-cue";

const DATA_THROUGH = "2026-11-20";
// Recent timestamp keeps `maybeAutoScan()` from replacing the results with a
// scanning state while the evidence frame is being taken.
const LAST_SCAN_AT = new Date().toISOString();

interface EvidenceHit {
  id: number;
  symbol: string;
  name: string;
  timeframe: string;
  pattern_id: string;
  pattern_name: string;
  family: string;
  direction: string;
  status: string;
  quality: string;
  confidence: number;
  breakout_score: number;
  start_date: string;
  end_date: string;
  start_price: number;
  end_price: number;
  breakout_level: number;
  target: number;
  stop: number;
  rr: number;
  bars_ago: number;
  volume_confirmed: boolean;
  last_close: number;
  day_change_pct: number;
  range_pos: number;
  to_52w_high: number;
  trendlines: Array<Array<{ t: string; price: number }>>;
  notes: string;
}

const HITS: EvidenceHit[] = [
  {
    id: 101,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    breakout_score: 62.1,
    start_date: "2026-04-26",
    end_date: "2026-11-19",
    start_price: 129.8,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 1,
    volume_confirmed: true,
    last_close: 114.2,
    day_change_pct: 1.42,
    range_pos: 68,
    to_52w_high: 12.3,
    trendlines: [
      [{ t: "2026-04-26", price: 129.8 }, { t: "2026-11-19", price: 112.6 }],
      [{ t: "2026-04-26", price: 118.2 }, { t: "2026-11-19", price: 108.9 }],
    ],
    notes: "Converging wedge with volume on the breakout.",
  },
  {
    id: 102,
    symbol: "TCS",
    name: "Tata Consultancy Services Ltd.",
    timeframe: "1D",
    pattern_id: "cup_handle",
    pattern_name: "Cup & Handle",
    family: "curve_cup",
    direction: "bullish",
    status: "forming",
    quality: "fair",
    confidence: 66.2,
    breakout_score: 41.8,
    start_date: "2026-06-10",
    end_date: "2026-11-19",
    start_price: 3800,
    end_price: 4120,
    breakout_level: 4150,
    target: 4600,
    stop: 3950,
    rr: 2.1,
    bars_ago: 2,
    volume_confirmed: false,
    last_close: 4136.5,
    day_change_pct: 0.4,
    range_pos: 81,
    to_52w_high: 3.1,
    trendlines: [[{ t: "2026-06-10", price: 3800 }, { t: "2026-11-19", price: 4120 }]],
    notes: "Handle forming below the rim.",
  },
  {
    id: 103,
    symbol: "INFY",
    name: "Infosys Ltd.",
    timeframe: "1D",
    pattern_id: "head_shoulders",
    pattern_name: "Head & Shoulders",
    family: "reversal",
    direction: "bearish",
    status: "confirmed",
    quality: "fair",
    confidence: 64.0,
    breakout_score: 55.4,
    start_date: "2026-07-02",
    end_date: "2026-11-18",
    start_price: 1900,
    end_price: 1820,
    breakout_level: 1815,
    target: 1680,
    stop: 1885,
    rr: 1.4,
    bars_ago: 3,
    volume_confirmed: true,
    last_close: 1811.4,
    day_change_pct: -0.86,
    range_pos: 24,
    to_52w_high: 18.7,
    trendlines: [[{ t: "2026-07-02", price: 1900 }, { t: "2026-11-18", price: 1820 }]],
    notes: "Neckline break confirmed on volume.",
  },
];

const SUMMARY = {
  scanned: 500,
  patterns: HITS.length,
  in_view: HITS.length,
  confirmed: 2,
  bullish: 2,
  bearish: 1,
  data_through: DATA_THROUGH,
  last_scan_at: LAST_SCAN_AT,
};

// The matrix endpoint is filter-agnostic; the page joins these rows with the
// result hits, so the symbols must match the hits above exactly.
const MATRIX = {
  universe: "nifty50",
  timeframes: ["1D"],
  data_through: DATA_THROUGH,
  rows: HITS.map((hit) => ({
    symbol: hit.symbol,
    name: hit.name,
    ltp: hit.last_close,
    day_change_pct: hit.day_change_pct,
    timeframes: {
      "1D": {
        direction: hit.direction,
        status: hit.status,
        count: 1,
        confidence: hit.confidence,
        patterns: [hit.pattern_name],
        best_id: hit.id,
      },
    },
    hits: [hit],
    best: hit,
    hit_count: 1,
  })),
};

const TIMEFRAMES = {
  timeframes: [
    { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
    { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
  ],
};

const PATTERN_CATALOG = {
  families: [
    { id: "reversal", label: "Reversal" },
    { id: "continuation", label: "Continuation" },
    { id: "curve_cup", label: "Curve / Cup" },
  ],
  patterns: HITS.map((hit) => ({
    pattern_id: hit.pattern_id,
    name: hit.pattern_name,
    family: hit.family,
    direction: hit.direction,
    description: hit.notes,
  })),
};

// A finite SSE body: `meta` then one `item` per hit then `done`, so the store
// takes its streaming path instead of falling back to GET /results.
const STREAM_BODY = [
  `event: meta\ndata: ${JSON.stringify({ total: HITS.length, summary: SUMMARY, data_through: DATA_THROUGH })}\n\n`,
  ...HITS.map((hit) => `event: item\ndata: ${JSON.stringify(hit)}\n\n`),
  "event: done\ndata: {}\n\n",
].join("");

const json = (body: object) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Call after `setupApiMocks` + `loginAsTestUser` + `setupHomePatternMocks`. */
export async function setupPatternEvidenceMocks(page: Page): Promise<void> {
  await page.route(apiRoute("chart-patterns/timeframes"), (route) => route.fulfill(json(TIMEFRAMES)));
  await page.route(apiRoute("chart-patterns/patterns"), (route) => route.fulfill(json(PATTERN_CATALOG)));
  await page.route(apiRoute("chart-patterns/summary"), (route) => route.fulfill(json(SUMMARY)));
  await page.route(apiRoute("chart-patterns/matrix"), (route) => route.fulfill(json(MATRIX)));
  // Registered after `setupHomePatternMocks`' `/results` handler so this one
  // wins for both the stream and its plain-GET fallback.
  await page.route(apiRoute("chart-patterns/results"), async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/stream")) {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: STREAM_BODY });
      return;
    }
    await route.fulfill(json({ items: HITS, total: HITS.length, summary: SUMMARY, data_through: DATA_THROUGH }));
  });
}
