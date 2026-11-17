import { createContext, useContext } from "solid-js";

/** Which surface the right-side dock is showing. */
export type SymbolDockMode = "chart" | "options";

/**
 * Exchange-tag classification shared by every table that links a symbol to a
 * chart or an options chain. Matching trims/cases so feed casing (`NYSE`,
 * ` nyse `) never changes the outcome.
 */
function normalizeExchange(exchange: string | null | undefined): string {
  return String(exchange ?? "").trim().toLowerCase();
}

// US listings have no Upstox/NSE chart data. `usa`/`us` are provider labels the
// chart route also understands, not just exchange tags.
const USA_EXCHANGES = new Set(["nasdaq", "nyse", "amex", "usa", "us"]);
// NSE-indexed instruments (including the `nsi` index-style tag) chart in-app.
const INDIA_CHART_EXCHANGES = new Set(["nse", "bse", "nsi"]);
// Only these exchanges carry a listed Indian options chain (the F&O affordance).
const INDIA_OPTIONS_EXCHANGES = new Set(["nse", "bse"]);

/** True when `market` names a US listing (case-insensitive). */
export function isUsMarket(market: string | undefined): boolean {
  return USA_EXCHANGES.has(normalizeExchange(market));
}

/** True when `market` names an Indian listing that has an in-app chart. */
export function isIndianChartMarket(market: string | undefined): boolean {
  return INDIA_CHART_EXCHANGES.has(normalizeExchange(market));
}

/** True when the symbol has an in-app chart: an Indian listing or a US one. */
export function isInAppChartMarket(market: string | undefined): boolean {
  return isIndianChartMarket(market) || isUsMarket(market);
}

/** True when the exchange has a listed Indian options chain. */
export function hasIndianOptionsChain(exchange: string | null | undefined): boolean {
  return exchange != null && INDIA_OPTIONS_EXCHANGES.has(normalizeExchange(exchange));
}

/**
 * In-app chart destination for a symbol. US rows carry `?market=usa` so the
 * chart route selects the US provider; the symbol is passed through untouched
 * (`BRK.B` stays `BRK.B` — the `.` → `-` rewrite belongs to the provider).
 */
export function chartHrefForSymbol(symbol: string, market?: string): string {
  const path = `/chart/${encodeURIComponent(String(symbol ?? "").trim())}`;
  return isUsMarket(market) ? `${path}?market=usa` : path;
}

/** Imperative API exposed by the app-wide right-side symbol dock. */
export interface SymbolDockApi {
  /**
   * Hover intent: the provider debounces and opens a preview when allowed.
   * US markets are skipped — there is no NSE chart to preview.
   */
  preview: (symbol: string, market?: string) => void;
  /** Pointer left the symbol: the provider dismisses an unpinned preview. */
  endPreview: () => void;
  /**
   * Pin the symbol in the dock. `mode` picks the surface: a chart (default,
   * hover preview / chart icon) or the options chain (the Options icon).
   * `market` lets the provider route US listings to `?market=usa` instead of
   * the NSE dock. Existing one/two-argument calls keep working.
   */
  open: (symbol: string, mode?: SymbolDockMode, market?: string) => void;
  /** Close the dock and clear the selection. */
  close: () => void;
  /** True while the dock holds a user-pinned chart (previews are ignored). */
  pinned: boolean;
  /** Surface currently requested; chart when unset. */
  mode?: () => SymbolDockMode;
  /**
   * Symbol currently shown in the dock, or null. Lists use this to highlight
   * the row behind the chart — a link click opens the dock without touching
   * the list's own selection state.
   */
  symbol?: () => string | null;
  /** Inline mount node; null falls back to the fixed overlay. */
  setOutlet: (el: HTMLElement | null) => void;
}

const noop = () => {};

/**
 * Default is inert so `SymbolLink` stays renderable outside the provider
 * (unit tests, Storybook) without a Router or chart host.
 */
export const SymbolDockContext = createContext<SymbolDockApi>({
  preview: noop,
  endPreview: noop,
  open: noop,
  close: noop,
  pinned: false,
  setOutlet: noop,
});

export function useSymbolDock(): SymbolDockApi {
  return useContext(SymbolDockContext);
}
