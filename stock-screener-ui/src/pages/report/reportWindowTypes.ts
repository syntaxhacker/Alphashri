import type { DockPanelContext } from "../../components/dock/types";
import type { NiftyReportStore } from "./niftyReportStore";

/** Own saved-config scope and wire version — the report desk must never share
 * the home desk's persisted geometry. */
export const REPORT_WINDOW_SCOPE = "window.report";
export const REPORT_WINDOW_VERSION = 1;

export const REPORT_WINDOW_KEYS = [
  "chart",
  "chain",
  "walls",
  "flow",
  "analytics",
  "movers",
] as const;

export type ReportWindowKey = (typeof REPORT_WINDOW_KEYS)[number];

export const REPORT_WINDOW_KEY_SET: ReadonlySet<string> = new Set(REPORT_WINDOW_KEYS);

export function isReportWindowKey(value: unknown): value is ReportWindowKey {
  return typeof value === "string" && REPORT_WINDOW_KEY_SET.has(value);
}

/**
 * Stable, registry-owned titles. Presets, the picker and the window frame all
 * read these, so a rename is one edit and a saved layout never carries a title
 * that disagrees with the panel it points at.
 */
export const REPORT_PANEL_TITLES: Record<ReportWindowKey, string> = {
  chart: "INDEX CHART",
  chain: "OPTIONS CHAIN",
  walls: "OI WALLS",
  flow: "FLOW WINDOWS",
  analytics: "OPTIONS ANALYTICS",
  movers: "INDEX MOVERS",
};

/**
 * The dock context cannot describe a live report store: it only carries plain
 * symbol/market/expiry/timeframe strings. The four report panels whose real
 * components call `useNiftyReport()` (Solid context) therefore take the store
 * through this extended bag. The shell is the only place that owns a
 * `<ReportProvider>`; passing its store here keeps one store per report.
 *
 * `mount` never throws when `reportStore` is missing — it paints an empty state
 * that names the dependency, so a desk restored before the shell is wired up
 * degrades instead of crashing.
 */
export interface ReportWindowContext extends DockPanelContext {
  reportStore?: NiftyReportStore | null;
}

/** Panels that cannot mount standalone without the live store in the bag. */
export const REPORT_STORE_PANEL_KEYS = [
  "chart",
  "walls",
  "flow",
  "movers",
] as const satisfies readonly ReportWindowKey[];

const STORE_DEPENDENT: ReadonlySet<ReportWindowKey> = new Set(REPORT_STORE_PANEL_KEYS);

/** Self-contained panels own their own symbol/expiry controls and fetch. */
export const REPORT_STANDALONE_PANEL_KEYS = [
  "chain",
  "analytics",
] as const satisfies readonly ReportWindowKey[];

export function reportNeedsStore(key: ReportWindowKey): boolean {
  return STORE_DEPENDENT.has(key);
}

export interface ReportPanelAvailability {
  key: ReportWindowKey;
  /** True when the panel needs `ReportWindowContext.reportStore` to render. */
  needsReportStore: boolean;
  /** How a host should source the panel until that dependency is supplied. */
  mountSource: "report-store" | "window-registry";
}

export const REPORT_PANEL_AVAILABILITY: Record<ReportWindowKey, ReportPanelAvailability> =
  Object.fromEntries(
    REPORT_WINDOW_KEYS.map((key) => [
      key,
      {
        key,
        needsReportStore: reportNeedsStore(key),
        mountSource: reportNeedsStore(key) ? "report-store" : "window-registry",
      },
    ]),
  ) as Record<ReportWindowKey, ReportPanelAvailability>;

export const DEFAULT_REPORT_CONTEXT: ReportWindowContext = {
  symbol: "NIFTY",
  market: "india",
  expiry: undefined,
  timeframe: "1m",
  reportStore: null,
};
