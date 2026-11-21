/**
 * Sector page state, hoisted out of `SectorPage.tsx`.
 *
 * The page owns its data and view state in `createSignal`s, split across two
 * components in one file. A docked panel has no page-local signal to read, so
 * this module holds that state instead: any component can attach, read and
 * write it without reaching into another component's scope.
 *
 * The URL seeds the tab/dashboard on reset (a bookmarked `?tab=rotation` must
 * still land on Rotation), and polling is owned here so it can be torn down
 * when the page unmounts — a store that outlives the page must not keep a
 * timer alive.
 */

import { createSubscriber } from "./createSubscriber";
import { asApiError, isAbortError, type ApiError } from "../api/apiError";
import { fetchSectorPerformance } from "../api/sector";
import type { SectorAlert } from "../components/sector/sectorUtils";
import type { SectorResponse } from "../types/sector";

const { subscribe, notify } = createSubscriber();
export { subscribe };

/** Tab ids the page understands; a stale `?tab=` falls back to the dashboard. */
const SECTOR_TABS = ["dashboard", "rotation", "correlation"] as const;
export type SectorTab = (typeof SECTOR_TABS)[number];

const DASHBOARD_VIEWS = ["table", "visual"] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];
export type SectorViewMode = "sector" | "stock";
export type SectorMarket = "india" | "america";

export interface SectorState {
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  /** Typed failure detail for status-aware Retry. Additive; `error` stays a string. */
  apiError: ApiError | null;
  market: SectorMarket;
  activeTab: SectorTab;
  alerts: SectorAlert[];
  viewMode: SectorViewMode;
  dashboardView: DashboardView;
  heatmapMetric: string;
  stockSectorFilter: string | null;
}

function readTabFromUrl(): SectorTab {
  if (typeof window === "undefined") return "dashboard";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return (SECTOR_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as SectorTab)
    : "dashboard";
}

function readDashboardView(): DashboardView {
  if (typeof window === "undefined") return "table";
  const view = new URLSearchParams(window.location.search).get("dash");
  return (DASHBOARD_VIEWS as readonly string[]).includes(view ?? "")
    ? (view as DashboardView)
    : "table";
}

function initialState(): SectorState {
  return {
    data: null,
    loading: true,
    error: null,
    apiError: null,
    market: "india",
    activeTab: readTabFromUrl(),
    alerts: [],
    viewMode: "sector",
    dashboardView: readDashboardView(),
    heatmapMetric: "change_pct",
    stockSectorFilter: null,
  };
}

let state: SectorState = initialState();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollKey: string | null = null;

/** Fresh snapshot. Callers that render should read through `subscribe`. */
export function getSectorState(): SectorState {
  return state;
}

function patch(partial: Partial<SectorState>): void {
  state = { ...state, ...partial };
  notify();
}

export function setMarket(market: SectorMarket): void {
  patch({ market });
}

export function setActiveTab(activeTab: SectorTab): void {
  patch({ activeTab });
}

export function setViewMode(viewMode: SectorViewMode): void {
  patch({ viewMode });
}

export function setDashboardView(dashboardView: DashboardView): void {
  patch({ dashboardView });
}

export function setHeatmapMetric(heatmapMetric: string): void {
  patch({ heatmapMetric });
}

export function setStockSectorFilter(stockSectorFilter: string | null): void {
  patch({ stockSectorFilter });
}

export function setAlertList(alerts: SectorAlert[]): void {
  patch({ alerts });
}

export function setSectorData(data: SectorResponse | null): void {
  patch({ data });
}

export function setLoading(loading: boolean): void {
  patch({ loading });
}

export function setError(error: string | null, apiError: ApiError | null = null): void {
  patch({ error, apiError });
}

/**
 * Load the active market's sector performance. Never throws: a failure lands in
 * `error` so the page can show it rather than an empty grid.
 */
export async function loadSectorData(market: SectorMarket = state.market): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const response = await fetchSectorPerformance(market);
    setSectorData(response);
    setError(null);
  } catch (err) {
    if (isAbortError(err)) return;
    setError(
      err instanceof Error ? err.message : "Failed to fetch sector performance",
      asApiError(err, "Failed to fetch sector performance"),
    );
  } finally {
    setLoading(false);
  }
}

/**
 * Own the page's refresh timer. Repeating the same `(tab, market)` is a no-op so
 * a reactive caller cannot stack intervals; `resetSectorState` clears it.
 */
export function configurePolling(tab: SectorTab, market: SectorMarket, intervalMs = 60_000): void {
  const key = `${tab}|${market}`;
  if (key === pollKey) return;
  stopPolling();
  pollKey = key;
  pollTimer = setInterval(() => {
    void loadSectorData(market);
  }, intervalMs);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollKey = null;
}

/**
 * Reset to a clean slate and tear down timers. Called on page unmount and by
 * tests; leaving an interval running would keep fetching after navigation.
 */
export function resetSectorState(): void {
  stopPolling();
  state = initialState();
  notify();
}
