import { typeSize } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import { CATALYST_RADAR_PANEL } from "./panels/catalystRadar";
import { lazyPanelSpec } from "./panels/lazyPanel";
import { NEWS_FEED_PANEL } from "./panels/newsFeed";
import { SECTOR_MOVERS_PANEL } from "./panels/sectorMovers";

/**
 * Only the three Monitor panels are eager — they mount on the first paint of
 * `/home`. Every desk/picker-only panel resolves its metadata synchronously but
 * defers its component graph until a window actually mounts it.
 */
const MARKET_HEATMAP_PANEL = lazyPanelSpec(
  {
    id: "market.heatmap",
    page: "screener",
    title: "MARKET HEATMAP",
    size: 1.2,
    minWidth: 360,
    singleton: true,
    requires: [],
    data: () => ({ universe: "all_equity", currency: "INR" }),
  },
  () => import("./panels/marketHeatmap").then((mod) => mod.MARKET_HEATMAP_PANEL),
);

const OPTIONS_ANALYTICS_PANEL = lazyPanelSpec(
  {
    id: "options.analytics",
    page: "report",
    title: "OPTIONS ANALYTICS",
    size: 1,
    minWidth: 420,
    singleton: false,
    requires: [],
  },
  () => import("./panels/optionsAnalytics").then((mod) => mod.OPTIONS_ANALYTICS_PANEL),
);

const OPTIONS_CHAIN_PANEL = lazyPanelSpec(
  {
    id: "options.chain",
    page: "report",
    title: "OPTIONS CHAIN",
    size: 1,
    minWidth: 360,
    singleton: false,
    requires: [],
  },
  () => import("./panels/optionsChain").then((mod) => mod.OPTIONS_CHAIN_PANEL),
);

const OPTIONS_POSITIONING_PANEL = lazyPanelSpec(
  {
    id: "options.positioning",
    page: "report",
    title: "OPTIONS POSITIONING",
    size: 1,
    minWidth: 360,
    singleton: false,
    requires: [],
  },
  () => import("./panels/optionsPositioning").then((mod) => mod.OPTIONS_POSITIONING_PANEL),
);

const PATTERN_RESULTS_PANEL = lazyPanelSpec(
  {
    id: "patterns.results",
    page: "patterns",
    title: "PATTERNS",
    size: 1.2,
    minWidth: 360,
    singleton: true,
    requires: [],
  },
  () => import("./panels/patternResults").then((mod) => mod.PATTERN_RESULTS_PANEL),
);

const SECTOR_CORRELATION_PANEL = lazyPanelSpec(
  {
    id: "sector.correlation",
    page: "sector",
    title: "SECTOR CORRELATION",
    size: 1,
    minWidth: 360,
    singleton: false,
    requires: [],
  },
  () => import("./panels/sectorCorrelation").then((mod) => mod.SECTOR_CORRELATION_PANEL),
);

const SECTOR_DETAIL_PANEL = lazyPanelSpec(
  {
    id: "sector.detail",
    page: "sector",
    title: "SECTOR DETAIL",
    size: 1,
    minWidth: 260,
    singleton: false,
    requires: [],
  },
  () => import("./panels/sectorDetail").then((mod) => mod.SECTOR_DETAIL_PANEL),
);

const SECTOR_HEATMAP_PANEL = lazyPanelSpec(
  {
    id: "sector.heatmap",
    page: "sector",
    title: "SECTOR HEATMAP",
    size: 1,
    minWidth: 320,
    singleton: false,
    requires: [],
  },
  () => import("./panels/sectorHeatmap").then((mod) => mod.SECTOR_HEATMAP_PANEL),
);

const SECTOR_TABLE_PANEL = lazyPanelSpec(
  {
    id: "sector.table",
    page: "sector",
    title: "SECTOR PERFORMANCE",
    size: 1,
    minWidth: 320,
    singleton: false,
    requires: [],
  },
  () => import("./panels/sectorTable").then((mod) => mod.SECTOR_TABLE_PANEL),
);

const SECTOR_ROTATION_PANEL = lazyPanelSpec(
  {
    id: "sector.rotation",
    page: "sector",
    title: "SECTOR ROTATION",
    size: 1,
    minWidth: 320,
    singleton: false,
    requires: [],
  },
  () => import("./panels/sectorRotation").then((mod) => mod.SECTOR_ROTATION_PANEL),
);

/** Windows mount exactly the specs DockHost mounts — no parallel panel shape. */
export const WINDOW_PANELS: DockPanelSpec[] = [
  CATALYST_RADAR_PANEL,
  MARKET_HEATMAP_PANEL,
  NEWS_FEED_PANEL,
  OPTIONS_ANALYTICS_PANEL,
  OPTIONS_CHAIN_PANEL,
  OPTIONS_POSITIONING_PANEL,
  PATTERN_RESULTS_PANEL,
  SECTOR_CORRELATION_PANEL,
  SECTOR_DETAIL_PANEL,
  SECTOR_HEATMAP_PANEL,
  SECTOR_TABLE_PANEL,
  SECTOR_MOVERS_PANEL,
  SECTOR_ROTATION_PANEL,
];
/**
 * Live set: dynamic panels join the same registry the desk and normalizer read.
 * A saved layout may pin a section that has since been deleted. Those ids must
 * survive normalization so the desk can render a named empty state instead of
 * silently dropping the window (the generic unknown-panel fallback is not one).
 */
class PanelTypeSet extends Set<string> {
  has(value: string): boolean {
    return value.startsWith("section:") || super.has(value);
  }
}

export const WINDOW_PANEL_TYPES: Set<string> = new PanelTypeSet(
  WINDOW_PANELS.map((spec) => spec.id),
);

const BY_TYPE = new Map(WINDOW_PANELS.map((spec) => [spec.id, spec]));

export function getPanelSpec(type: string): DockPanelSpec | undefined {
  return BY_TYPE.get(type);
}

/**
 * The only write path to the desk registry. User sections register their specs
 * here instead of mounting a second window manager; re-registering an id replaces
 * the spec in place so an open window picks up a renamed section on its next
 * layout commit without being torn down.
 */
export function registerPanelSpecs(specs: readonly DockPanelSpec[]): void {
  for (const spec of specs) {
    const existing = BY_TYPE.get(spec.id);
    if (existing) {
      const index = WINDOW_PANELS.findIndex((candidate) => candidate.id === spec.id);
      if (index >= 0) WINDOW_PANELS[index] = spec;
    } else {
      WINDOW_PANELS.push(spec);
      WINDOW_PANEL_TYPES.add(spec.id);
    }
    BY_TYPE.set(spec.id, spec);
  }
}

/** Test/isolation seam — never called from a live page while windows are open. */
export function unregisterPanelSpecs(ids: readonly string[]): void {
  for (const id of ids) {
    const index = WINDOW_PANELS.findIndex((candidate) => candidate.id === id);
    if (index >= 0) WINDOW_PANELS.splice(index, 1);
    WINDOW_PANEL_TYPES.delete(id);
    BY_TYPE.delete(id);
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch] ?? ch);

/**
 * A dock panel cannot cross a window boundary: its `mount` needs a live context
 * accessor and host-injected `{data, commands}`. Rather than ship a dead export
 * button, pop out a self-contained page carrying the panel title and the context
 * snapshot it was rendering with. System colours keep it theme-independent
 * without hardcoding a palette value outside `src/ui/palette.ts`.
 */
export function openPanelPopOut(
  spec: DockPanelSpec | undefined,
  title: string,
  context: DockPanelContext,
): boolean {
  if (!spec) return false;
  const open = globalThis.open;
  if (typeof open !== "function") return false;

  const rows = (["symbol", "market", "expiry", "timeframe"] as const)
    .filter((key) => typeof context[key] === "string" && context[key].length > 0)
    .map((key) => `<li>${escapeHtml(key)}: ${escapeHtml(String(context[key]))}</li>`)
    .join("");
  const html = [
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
    `<title>${escapeHtml(title)}</title>`,
    `<style>body{font:${typeSize("label")}px system-ui,sans-serif;background:Canvas;color:CanvasText;padding:24px}`,
    `h1{font-size:${typeSize("heading")}px}li{margin:4px 0}p{opacity:.7}</style></head><body>`,
    `<h1>${escapeHtml(title)}</h1>`,
    rows ? `<ul>${rows}</ul>` : "",
    "<p>Alphashri desk snapshot. Live panel data stays in the main window.</p>",
    "</body></html>",
  ].join("");

  let url = "";
  try {
    if (typeof Blob === "function" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    }
  } catch {
    url = "";
  }
  if (!url) url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  try {
    open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}
