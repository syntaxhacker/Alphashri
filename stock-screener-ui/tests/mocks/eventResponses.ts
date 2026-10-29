// Mock API responses for the Event Radar (corporate events + tripwire) specs.
//
// Same conventions as `apiResponses.ts`:
//   * every handler goes through `apiRoute()` so only localhost:8765 is
//     intercepted — a broad `**/api/...` glob also swallows Vite's module
//     requests for `src/api/` and blanks the page;
//   * Playwright gives higher priority to handlers registered LATER, so the
//     specific `/events/calendar` + `/events/anomalies` routes are registered
//     here and nothing broad competes with them.
//
// The shapes below mirror `src/types/events.ts`, which in turn mirrors
// `api/event_radar/contract.py`. `days_until` is derived from `event_date` in
// the SAME local-date arithmetic the UI uses (`isoDate` in
// `src/state/events.ts`), so a fixture never disagrees with the row copy it is
// supposed to prove.

import { apiRoute } from "./routeHelper";

/** The subset of `EventDTO` the panel actually renders. */
export interface MockEvent {
  id: string;
  symbol: string;
  event_type:
    | "investor_day"
    | "analyst_day"
    | "capital_markets_day"
    | "strategy_day"
    | "rnd_day"
    | "business_update"
    | "guidance"
    | "shareholder_meeting"
    | "earnings"
    | "dividend"
    | "split"
    | "other";
  title: string;
  event_date: string;
  source: "seed" | "edgar" | "ir" | "wire" | "tv";
  exchange: string | null;
  name: string | null;
  announced_at: string | null;
  source_url: string | null;
  confidence: number;
  recurring: boolean;
  notes: string | null;
  days_until: number;
  is_alpha: boolean;
}

/** The subset of `AnomalyDTO` the anomalies strip renders. */
export interface MockAnomaly {
  symbol: string;
  ts: string;
  price: number;
  ret_pct: number;
  ret_sigma: number;
  vol_ratio: number;
  has_known_event: boolean;
  suspected: string | null;
  exchange: string | null;
}

/** `YYYY-MM-DD` from LOCAL date parts (never `toISOString`, which shifts a day). */
export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Shift a date by whole days without mutating it. */
export function addDays(date: Date, days: number): string {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return isoDate(next);
}

/** Whole days between two `YYYY-MM-DD` strings (the server's `days_until`). */
function daysBetween(from: string, to: string): number {
  const parse = (value: string): number => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** ORCL is the worked example: an investor day announced 8 days ahead. */
export const ORCL_EVENT_ID = "evt-orcl-investor-day";
/** `event_date - announced_at` for the ORCL fixture, as the drawer prints it. */
export const ORCL_LEAD_DAYS = 8;

/**
 * Five events, one per behaviour the table has a column for:
 *
 *   ORCL   investor_day, +3 days  -> alpha badge, "in 3d", announced 8 days ahead
 *   AAPL   analyst_day,  today    -> "today"
 *   NVDA   guidance,     +6 days  -> alpha (warning tone), inside the 7d window
 *   MSFT   earnings,     +10 days -> muted badge, "in 10d"
 *   CVX    dividend,     +21 days -> muted badge
 *
 * Nothing in the fixture is in the past: the panel's default query carries
 * `upcoming_only=true`, so a past row is not something the real backend would
 * ever return. See `events.spec.ts` for how the past branch is covered.
 */
export function buildEventFixtures(now: Date = new Date()): MockEvent[] {
  const today = isoDate(now);
  const make = (event: Omit<MockEvent, "days_until">): MockEvent => ({
    ...event,
    days_until: daysBetween(today, event.event_date),
  });

  return [
    make({
      id: ORCL_EVENT_ID,
      symbol: "ORCL",
      event_type: "investor_day",
      title: "Oracle Investor Day 2026",
      event_date: addDays(now, 3),
      source: "edgar",
      exchange: "NYSE",
      name: "Oracle Corp",
      announced_at: addDays(now, 3 - ORCL_LEAD_DAYS),
      source_url:
        "https://www.sec.gov/Archives/edgar/data/1341439/000119312526000001/d123456dex991.htm",
      confidence: 0.9,
      recurring: true,
      notes: "SEC 8-K · CIK 1341439",
      is_alpha: true,
    }),
    make({
      id: "evt-aapl-analyst-day",
      symbol: "AAPL",
      event_type: "analyst_day",
      title: "Apple Analyst Day",
      event_date: today,
      source: "ir",
      exchange: "NASDAQ",
      name: "Apple Inc.",
      announced_at: addDays(now, -4),
      source_url: null,
      confidence: 0.7,
      recurring: false,
      notes: null,
      is_alpha: true,
    }),
    make({
      id: "evt-nvda-guidance",
      symbol: "NVDA",
      event_type: "guidance",
      title: "Nvidia Updates Guidance",
      event_date: addDays(now, 6),
      source: "wire",
      exchange: "NASDAQ",
      name: "NVIDIA Corp",
      announced_at: addDays(now, -1),
      source_url: null,
      confidence: 0.55,
      recurring: false,
      notes: null,
      is_alpha: true,
    }),
    make({
      id: "evt-msft-earnings",
      symbol: "MSFT",
      event_type: "earnings",
      title: "Microsoft Q2 FY27 Results",
      event_date: addDays(now, 10),
      source: "tv",
      exchange: "NASDAQ",
      name: "Microsoft Corp",
      announced_at: null,
      source_url: null,
      confidence: 0.5,
      recurring: true,
      notes: null,
      is_alpha: false,
    }),
    make({
      id: "evt-cvx-dividend",
      symbol: "CVX",
      event_type: "dividend",
      title: "Chevron Ex-Dividend",
      event_date: addDays(now, 21),
      source: "tv",
      exchange: "NYSE",
      name: "Chevron Corp",
      announced_at: null,
      source_url: null,
      confidence: 0.5,
      recurring: true,
      notes: null,
      is_alpha: false,
    }),
  ];
}

/** Row count the default fixture yields — asserted by the first spec. */
export const MOCK_EVENT_COUNT = 5;

/** Tripwire rows: one up, one down, both above the 4σ / 8x thresholds. */
export function buildAnomalyFixtures(today: string = isoDate(new Date())): MockAnomaly[] {
  return [
    {
      symbol: "ORCL",
      ts: `${today}T14:19:00-04:00`,
      price: 131.27,
      ret_pct: 9.42,
      ret_sigma: 24.5,
      vol_ratio: 12.3,
      has_known_event: false,
      suspected: "see 14:19 wire",
      exchange: "NYSE",
    },
    {
      symbol: "MRNA",
      ts: `${today}T11:02:00-04:00`,
      price: 41.18,
      ret_pct: -6.15,
      ret_sigma: -9.8,
      vol_ratio: 9.1,
      has_known_event: false,
      suspected: null,
      exchange: "NASDAQ",
    },
  ];
}

/** The `meta` block `GET /api/events/anomalies` returns. */
export function anomaliesEnvelope(anomalies: MockAnomaly[], today = isoDate(new Date())) {
  return {
    anomalies,
    meta: {
      as_of: `${today}T10:00:00-04:00`,
      date: today,
      scanned: anomalies.length,
      thresholds: { ret_sigma: 4, vol_mult: 8, min_abs_ret: 1, cooldown_min: 30 },
      warnings: [],
    },
  };
}

export interface EventsMockOptions {
  /** Override the calendar rows. Defaults to `buildEventFixtures()`. */
  events?: MockEvent[];
  /** Override the tripwire rows. `[]` exercises the empty strip. */
  anomalies?: MockAnomaly[];
  /** Force the calendar handler to fail (e.g. 500) to prove the error state. */
  calendarStatus?: number;
  /** Fail the anomalies handler too — the panel shares one error slot. */
  anomaliesStatus?: number;
}

/**
 * Register `/api/events/*` mocks.
 *
 * Must be called BEFORE `page.goto()`: `EventsPanel` is mounted (lazily, but
 * eagerly enough) by `ScreenerPage` on every tab, so the calendar request
 * fires even when a test opens `?tab=dashboard`.
 */
export async function setupEventsMocks(
  page: import("@playwright/test").Page,
  options: EventsMockOptions = {},
) {
  const events = options.events ?? buildEventFixtures();
  const anomalies = options.anomalies ?? buildAnomalyFixtures();
  const calendarStatus = options.calendarStatus ?? 200;
  const anomaliesStatus = options.anomaliesStatus ?? 200;

  await page.route(apiRoute("events/calendar"), async (route) => {
    if (calendarStatus !== 200) {
      await route.fulfill({
        status: calendarStatus,
        contentType: "application/json",
        body: JSON.stringify({ detail: "event_calendar_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events,
        meta: {
          as_of: new Date().toISOString(),
          scanned: events.length,
          sources: { edgar: 1, ir: 1, wire: 1, tv: 2 },
          warnings: [],
        },
      }),
    });
  });

  await page.route(apiRoute("events/anomalies"), async (route) => {
    if (anomaliesStatus !== 200) {
      await route.fulfill({
        status: anomaliesStatus,
        contentType: "application/json",
        body: JSON.stringify({ detail: "event_anomalies_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(anomaliesEnvelope(anomalies)),
    });
  });

  // Manual refresh: a no-op upsert, i.e. `{ok: true, inserted: 0}` (§ router).
  await page.route(apiRoute("events/refresh"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, inserted: 0 }),
    });
  });
}
