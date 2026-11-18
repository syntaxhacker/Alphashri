import { REPORT_PANELS } from "../dock/reportPanels";
import { OPTIONS_ANALYTICS_PANEL } from "./panels/optionsAnalytics";
import { OPTIONS_CHAIN_PANEL } from "./panels/optionsChain";
import { OPTIONS_POSITIONING_PANEL } from "./panels/optionsPositioning";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import { MARKET_HEATMAP_PANEL } from "./panels/marketHeatmap";
import { NEWS_FEED_PANEL } from "./panels/newsFeed";
import { PATTERN_RESULTS_PANEL } from "./panels/patternResults";
import { SECTOR_CORRELATION_PANEL } from "./panels/sectorCorrelation";
import { SECTOR_HEATMAP_PANEL } from "./panels/sectorHeatmap";
import { SECTOR_MOVERS_PANEL } from "./panels/sectorMovers";
import { SECTOR_TABLE_PANEL } from "./panels/sectorTable";
import { SECTOR_ROTATION_PANEL } from "./panels/sectorRotation";

/** Windows mount exactly the specs DockHost mounts — no parallel panel shape. */
export const WINDOW_PANELS: DockPanelSpec[] = [
  ...REPORT_PANELS,
  MARKET_HEATMAP_PANEL,
  NEWS_FEED_PANEL,
  OPTIONS_ANALYTICS_PANEL,
  OPTIONS_CHAIN_PANEL,
  OPTIONS_POSITIONING_PANEL,
  PATTERN_RESULTS_PANEL,
  SECTOR_CORRELATION_PANEL,
  SECTOR_HEATMAP_PANEL,
  SECTOR_TABLE_PANEL,
  SECTOR_MOVERS_PANEL,
  SECTOR_ROTATION_PANEL,
];
export const WINDOW_PANEL_TYPES: ReadonlySet<string> = new Set(
  WINDOW_PANELS.map((spec) => spec.id),
);

const BY_TYPE = new Map(WINDOW_PANELS.map((spec) => [spec.id, spec]));

export function getPanelSpec(type: string): DockPanelSpec | undefined {
  return BY_TYPE.get(type);
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
    "<style>body{font:14px system-ui,sans-serif;background:Canvas;color:CanvasText;padding:24px}",
    "h1{font-size:18px}li{margin:4px 0}p{opacity:.7}</style></head><body>",
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
