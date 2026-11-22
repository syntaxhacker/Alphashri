import type { Page } from "@playwright/test";
import { apiRoute } from "../../mocks/routeHelper";

const AS_OF = "2026-11-21";
const HISTORICAL_START = "2025-10-27";
const HISTORICAL_END = "2026-05-31";
// The collector stopped on 2026-05-31 and resumed on 2026-11-21. That leaves
// 173 missing arrival dates (2026-06-01 → 2026-11-20); the observed boundary
// span is 174 days. The fixture keeps the hole so gap-aware views are exercised.
const GAP_FIRST_MISSING = "2026-06-01";
const GAP_LAST_MISSING = "2026-11-20";
const GAP_MISSING_DAYS = 173;
const RECENT_DATES = [AS_OF];
const PARTIAL_ROWS = 3_942;
const API_TOTAL_ROWS = 15_843;

export const AGRI_GAP = {
  firstMissing: GAP_FIRST_MISSING,
  lastMissing: GAP_LAST_MISSING,
  missingDays: GAP_MISSING_DAYS,
  boundaryStart: HISTORICAL_END,
  boundaryEnd: AS_OF,
} as const;

export const AGRI_FIXTURE = {
  ok: true,
  as_of: AS_OF,
  freshness_days: 1,
  commodities: [
    { key: "wheat", label: "Wheat", group: "cereals", unit: "INR/quintal" },
    { key: "onion", label: "Onion", group: "vegetables", unit: "INR/quintal" },
  ],
  groups: [
    { key: "cereals", label: "Cereals" },
    { key: "vegetables", label: "Vegetables" },
  ],
  states: ["Maharashtra"],
  districts: ["Nashik"],
  markets: ["Lasalgaon"],
  state_districts: { Maharashtra: ["Nashik"] },
  district_markets: { "Maharashtra||Nashik": ["Lasalgaon"] },
};

export type AgriScenario = "ok" | "empty" | "error" | "error-once";

export interface AgriPricesCall {
  url: string;
  params: Record<string, string>;
}

export interface AgriMockHandle {
  pricesCalls: AgriPricesCall[];
  filtersCalls: number;
  setScenario(scenario: AgriScenario): void;
}

interface CommoditySeed {
  label: string;
  base: number;
  min: number;
  max: number;
  arrivals: number;
  chg1w: number | null;
  chg1m: number | null;
  chg6m: number | null;
  msp: number | null;
  distanceToMsp: number | null;
  priceUnit: string;
  productForm: string;
}

const SEEDS: Record<string, CommoditySeed> = {
  onion: {
    label: "Onion",
    base: 2200,
    min: 1980,
    max: 2310,
    arrivals: 18340,
    chg1w: null,
    chg1m: null,
    chg6m: 8.9,
    msp: null,
    distanceToMsp: null,
    priceUnit: "Rs./Quintal",
    productForm: "common",
  },
  wheat: {
    label: "Wheat",
    base: 2450,
    min: 2230,
    max: 2560,
    arrivals: 22100,
    chg1w: null,
    chg1m: null,
    chg6m: -1.1,
    msp: null,
    distanceToMsp: null,
    priceUnit: "Rs./Quintal",
    productForm: "common",
  },
  tomato: {
    label: "Tomato",
    base: 1850,
    min: 1650,
    max: 2050,
    arrivals: 12400,
    chg1w: null,
    chg1m: null,
    chg6m: -4.3,
    msp: null,
    distanceToMsp: null,
    priceUnit: "Rs./Quintal",
    productForm: "common",
  },
};

const RANGE_DAYS: Record<string, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

function isoDaysAfter(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const SESSION_DATES = [
  ...isoRange(HISTORICAL_START, HISTORICAL_END),
  ...RECENT_DATES,
];

function rangeCutoff(range: string | undefined): string | null {
  if (!range || range === "max") return null;
  const days = RANGE_DAYS[range];
  return days ? isoDaysAfter(AS_OF, -days) : null;
}

function buildSeries(seed: CommoditySeed, range?: string) {
  const cutoff = rangeCutoff(range);
  return SESSION_DATES.map((date, index) => {
    const isRecent = date > HISTORICAL_END;
    const drift = isRecent ? 0 : Math.round(18 * Math.sin(index / 46) + 9 * Math.sin(index / 11));
    const modal = seed.base + drift;
    // The official data.gov.in feed publishes prices but not arrivals; the CKAN
    // seed carries arrivals only for the historical leg.
    const arrivals = isRecent
      ? null
      : Math.max(100, seed.arrivals + Math.round(600 * Math.sin(index / 9) + 220 * Math.sin(index / 23)));
    return {
      date,
      modal,
      min: modal - (seed.base - seed.min),
      max: modal + (seed.max - seed.base),
      arrivals_qtl: arrivals,
      market_count: 42,
      price_unit: seed.priceUnit,
      source: isRecent ? "agmarknet_daily" : "agmarknet_ckan",
      product_form: seed.productForm,
    };
  }).filter((point) => cutoff == null || point.date >= cutoff);
}

function echoFilters(params: Record<string, string>) {
  return {
    commodity: params.commodity ?? null,
    group: params.group ?? null,
    state: params.state ?? null,
    district: params.district ?? null,
    market: params.market ?? null,
    range: params.range ?? null,
    compare: params.compare ? params.compare.split(",").filter(Boolean) : [],
  };
}

function partialRowLabel(value: number): string {
  return value.toLocaleString("en-IN");
}

export function agriPricesPayload(params: Record<string, string> = {}) {
  const key = params.commodity ?? "onion";
  const seed = SEEDS[key] ?? SEEDS.onion;
  const state = params.state || "Maharashtra";
  const district = params.district || "Nashik";
  const market = params.market || "Lasalgaon";
  const series = buildSeries(seed, params.range);
  const last = series[series.length - 1];
  const compareKeys = params.compare
    ? params.compare.split(",").filter(Boolean)
    : ["wheat", "onion", "tomato"];

  return {
    ok: true,
    as_of: AS_OF,
    freshness_days: AGRI_FIXTURE.freshness_days,
    data_source: "mixed",
    filters: echoFilters(params),
    quotes_total: PARTIAL_ROWS,
    partial: {
      as_of: AS_OF,
      status: "partial",
      fetched_rows: PARTIAL_ROWS,
      expected_total: API_TOTAL_ROWS,
      gap_missing_days: GAP_MISSING_DAYS,
    },
    kpis: {
      modal: last.modal,
      min: last.min,
      max: last.max,
      unit: "INR/quintal",
      chg_1w_pct: seed.chg1w,
      chg_1m_pct: seed.chg1m,
      chg_6m_pct: seed.chg6m,
      market_count: 42,
      arrivals_qtl: last.arrivals_qtl,
      arrivals_unit: "qtl",
      msp: seed.msp,
      distance_to_msp_pct: seed.distanceToMsp,
    },
    series,
    snapshot: [],
    quotes: [
      {
        date: AS_OF,
        state,
        district,
        market,
        variety: seed.label,
        grade: "A",
        min: last.min,
        modal: last.modal,
        max: last.max,
        arrivals_qtl: null,
        price_unit: seed.priceUnit,
        source: "agmarknet_daily",
        product_form: seed.productForm,
      },
      {
        date: AS_OF,
        state,
        district,
        market,
        variety: seed.label,
        grade: "B",
        min: last.min - 20,
        modal: last.modal - 30,
        max: last.max - 40,
        arrivals_qtl: null,
        price_unit: seed.priceUnit,
        source: "agmarknet_daily",
        product_form: seed.productForm,
      },
    ],
    comparison: compareKeys.map((compareKey) => {
      const compareSeed = SEEDS[compareKey] ?? SEEDS.onion;
      return {
        key: compareKey,
        label: compareSeed.label,
        price_unit: compareSeed.priceUnit,
        source: "mixed",
        product_form: compareSeed.productForm,
        points: buildSeries(compareSeed, params.range).map((point) => ({
          date: point.date,
          modal: point.modal,
        })),
      };
    }),
    warnings: [
      `data has a ${GAP_MISSING_DAYS}-day gap (${GAP_FIRST_MISSING} → ${GAP_LAST_MISSING}); short-window changes and rolling metrics skip it`,
      `${AS_OF} is partial: ${partialRowLabel(PARTIAL_ROWS)} of ${partialRowLabel(API_TOTAL_ROWS)} API rows`,
    ],
  };
}

export function agriEmptyPayload(params: Record<string, string> = {}) {
  return {
    ...agriPricesPayload(params),
    quotes_total: 0,
    partial: null,
    kpis: {
      modal: null,
      min: null,
      max: null,
      unit: "INR/quintal",
      chg_1w_pct: null,
      chg_1m_pct: null,
      chg_6m_pct: null,
      market_count: 0,
      arrivals_qtl: null,
      arrivals_unit: "qtl",
      msp: null,
      distance_to_msp_pct: null,
    },
    series: [],
    quotes: [],
    comparison: [],
    warnings: ["No rows in the cache for this selection"],
  };
}

export async function setupAgriMocks(
  page: Page,
  options: { scenario?: AgriScenario } = {},
): Promise<AgriMockHandle> {
  let scenario = options.scenario ?? "ok";
  const handle: AgriMockHandle = {
    pricesCalls: [],
    filtersCalls: 0,
    setScenario(next) {
      scenario = next;
    },
  };

  await page.route(apiRoute("agri/filters"), async (route) => {
    handle.filtersCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(AGRI_FIXTURE),
    });
  });

  await page.route(apiRoute("agri/prices"), async (route) => {
    const url = new URL(route.request().url());
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    handle.pricesCalls.push({ url: url.toString(), params });

    if (scenario === "error" || scenario === "error-once") {
      if (scenario === "error-once") scenario = "ok";
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "agri cache unavailable" }),
      });
      return;
    }

    const payload = scenario === "empty" ? agriEmptyPayload(params) : agriPricesPayload(params);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  return handle;
}
