import type { Page } from "@playwright/test";
import { apiRoute } from "../../mocks/routeHelper";

export const AGRI_FIXTURE = {
  ok: true,
  as_of: "2026-11-17",
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
  chg1w: number;
  chg1m: number;
  chg6m: number;
  msp: number | null;
  distanceToMsp: number | null;
}

const SEEDS: Record<string, CommoditySeed> = {
  onion: {
    label: "Onion",
    base: 2200,
    min: 1980,
    max: 2310,
    arrivals: 18340,
    chg1w: 1.2,
    chg1m: -3.4,
    chg6m: 8.9,
    msp: 2185,
    distanceToMsp: 0.7,
  },
  wheat: {
    label: "Wheat",
    base: 2450,
    min: 2230,
    max: 2560,
    arrivals: 22100,
    chg1w: 0.8,
    chg1m: 2.4,
    chg6m: -1.1,
    msp: 2425,
    distanceToMsp: 1.0,
  },
  tomato: {
    label: "Tomato",
    base: 1850,
    min: 1650,
    max: 2050,
    arrivals: 12400,
    chg1w: -2.1,
    chg1m: 5.6,
    chg6m: -4.3,
    msp: null,
    distanceToMsp: null,
  },
};

// Two years of daily sessions so every gated EDA view (rolling, seasonality,
// distribution, heatmap, supplyDemand) has enough data to render.
const SESSION_COUNT = 730;

function isoDaysAgo(days: number): string {
  const date = new Date(`${AGRI_FIXTURE.as_of}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function buildSeries(seed: CommoditySeed) {
  return Array.from({ length: SESSION_COUNT }, (_, index) => {
    const daysAgo = SESSION_COUNT - 1 - index;
    const drift = Math.round(18 * Math.sin(index / 46) + 9 * Math.sin(index / 11));
    const modal = daysAgo === 0 ? seed.base : seed.base + drift;
    const arrivals = daysAgo === 0
      ? seed.arrivals
      : Math.max(100, seed.arrivals + Math.round(600 * Math.sin(index / 9) + 220 * Math.sin(index / 23)));
    return {
      date: isoDaysAgo(daysAgo),
      modal,
      min: modal - (seed.base - seed.min),
      max: modal + (seed.max - seed.base),
      arrivals_qtl: arrivals,
      market_count: 42,
    };
  });
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

export function agriPricesPayload(params: Record<string, string> = {}) {
  const key = params.commodity ?? "onion";
  const seed = SEEDS[key] ?? SEEDS.onion;
  const state = params.state || "Maharashtra";
  const district = params.district || "Nashik";
  const market = params.market || "Lasalgaon";
  const series = buildSeries(seed);
  const last = series[series.length - 1];
  const compareKeys = params.compare
    ? params.compare.split(",").filter(Boolean)
    : ["wheat", "onion", "tomato"];

  return {
    ok: true,
    as_of: AGRI_FIXTURE.as_of,
    freshness_days: AGRI_FIXTURE.freshness_days,
    data_source: "db",
    filters: echoFilters(params),
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
        date: AGRI_FIXTURE.as_of,
        state,
        district,
        market,
        variety: seed.label,
        grade: "A",
        min: last.min,
        modal: last.modal,
        max: last.max,
        arrivals_qtl: last.arrivals_qtl,
      },
      {
        date: AGRI_FIXTURE.as_of,
        state,
        district,
        market,
        variety: seed.label,
        grade: "B",
        min: last.min - 20,
        modal: last.modal - 30,
        max: last.max - 40,
        arrivals_qtl: 900,
      },
    ],
    comparison: compareKeys.map((compareKey) => {
      const compareSeed = SEEDS[compareKey] ?? SEEDS.onion;
      return {
        key: compareKey,
        label: compareSeed.label,
        points: series.map((point, index) => ({
          date: point.date,
          modal: compareSeed.base + Math.round(16 * Math.sin(index / 41 + compareKey.length)),
        })),
      };
    }),
    warnings: [],
  };
}

export function agriEmptyPayload(params: Record<string, string> = {}) {
  return {
    ...agriPricesPayload(params),
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
