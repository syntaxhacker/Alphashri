import { REPORT_PANELS } from "../../components/dock/reportPanels";
import type { DockPage, DockPanelContext, DockPanelSpec } from "../../components/dock/types";
import { MARKET_HEATMAP_PANEL } from "../../components/window/panels/marketHeatmap";
import { NEWS_FEED_PANEL } from "../../components/window/panels/newsFeed";
import { OPTIONS_ANALYTICS_PANEL } from "../../components/window/panels/optionsAnalytics";
import { OPTIONS_CHAIN_PANEL } from "../../components/window/panels/optionsChain";
import { OPTIONS_POSITIONING_PANEL } from "../../components/window/panels/optionsPositioning";
import { PATTERN_RESULTS_PANEL } from "../../components/window/panels/patternResults";
import { SECTOR_CORRELATION_PANEL } from "../../components/window/panels/sectorCorrelation";
import { SECTOR_HEATMAP_PANEL } from "../../components/window/panels/sectorHeatmap";
import { SECTOR_MOVERS_PANEL } from "../../components/window/panels/sectorMovers";
import { SECTOR_TABLE_PANEL } from "../../components/window/panels/sectorTable";
import { SECTOR_ROTATION_PANEL } from "../../components/window/panels/sectorRotation";
import {
  CASCADE_STEP,
  FIT_PADDING,
  cascadeRect,
  clampToCanvas,
  parseLayout,
  serializeLayout,
  type CanvasSize,
  type Rect,
} from "../../components/window/layout";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../../components/window/panelRegistry";
import type { WindowLayout, WindowState } from "../../components/window/types";

/** Group labels come from the panel's source page, not from a HOME-specific id. */
export const PAGE_LABEL: Record<DockPage, string> = {
  patterns: "PATTERNS",
  screener: "SCREENER",
  sector: "SECTOR",
  report: "REPORT",
};

export const PAGE_ORDER: DockPage[] = ["patterns", "screener", "sector", "report"];

/** One stable, non-editable context. Panels read fixed defaults or their own fallback. */
export const HOME_PANEL_CONTEXT: DockPanelContext = {
  symbol: "NIFTY",
  market: "india",
  timeframe: "1m",
};

/**
 * The desk supplies context itself, so no panel may declare a requirement that
 * would have to be typed into the app chrome. Ids stay aligned with the window
 * registry because the picker and the window manager both consume this list.
 */
export const HOME_PANELS: DockPanelSpec[] = [
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
].map((spec) => ({
  ...spec,
  requires: [],
}));

export const HOME_WINDOW_SCOPE = "window.home";
export const HOME_WINDOW_VERSION = 1;
export const DEFAULT_LAYOUT_NAMES = ["Main", "Blank", "Macro"] as const;
const DEFAULT_CANVAS: CanvasSize = { w: 1280, h: 800 };

/**
 * A preset is geometry only: which registered panel goes in which grid cell.
 * Column widths and per-column row heights are fractions of the measured canvas,
 * so the same preset fills a laptop and a wide desk without a pixel literal.
 */
export interface PresetColumn {
  width: number;
  rows: number[];
}

export interface PresetCell {
  panel: string;
  column: number;
  row: number;
}

export interface HomePreset {
  id: string;
  label: string;
  columns: PresetColumn[];
  cells: PresetCell[];
}

const TWO_COLUMNS: PresetColumn[] = [
  { width: 0.58, rows: [1] },
  { width: 0.42, rows: [0.5, 0.5] },
];

/** Adding a desk is data: append an entry here, never touch the menu component. */
export const PRESETS: HomePreset[] = [
  {
    id: "trading",
    label: "Trading",
    columns: TWO_COLUMNS,
    cells: [
      { panel: "market.heatmap", column: 0, row: 0 },
      { panel: "options.chain", column: 1, row: 0 },
      { panel: "options.positioning", column: 1, row: 1 },
    ],
  },
  {
    id: "research",
    label: "Research",
    columns: TWO_COLUMNS,
    cells: [
      { panel: "patterns.results", column: 0, row: 0 },
      { panel: "sector.rotation", column: 1, row: 0 },
      { panel: "sector.correlation", column: 1, row: 1 },
    ],
  },
  {
    id: "macro",
    label: "Macro",
    columns: TWO_COLUMNS,
    cells: [
      { panel: "sector.heatmap", column: 0, row: 0 },
      { panel: "sector.table", column: 1, row: 0 },
      { panel: "news.feed", column: 1, row: 1 },
    ],
  },
  {
    id: "minimal",
    label: "Minimal",
    columns: [{ width: 1, rows: [1] }],
    cells: [{ panel: "market.heatmap", column: 0, row: 0 }],
  },
];

/**
 * Two-column first-run desk. The chain keeps the first cascade slot so a
 * picker-added window still lands exactly one CASCADE_STEP to its right; the
 * heatmap takes the remaining width. Both use canvas fractions, so the seed
 * fills a 1280 and a 2560 canvas alike instead of two 420x260 cascade cards.
 */
const SEED_LEFT_FRACTION = 0.58;
const SEED_INSET = 8;

/**
 * The viewport is NOT the canvas: the app shell removes the sidebar and the
 * desk toolbar. Reading `window.innerWidth/innerHeight` here seeded oversized
 * windows that clipped at the right/bottom edges. With no measured canvas the
 * seed stays conservative; HomePage reseeds once when WindowManager reports
 * the real box.
 */
function seedCanvas(canvas?: CanvasSize): CanvasSize {
  return canvas ?? DEFAULT_CANVAS;
}

/** Guards the one-shot reseed so a saved layout is never overwritten by it. */
export function isDefaultHomeSeed(config: HomeWindowConfig): boolean {
  const reference = JSON.stringify(serializeHomeConfig(defaultHomeConfig()));
  return JSON.stringify(serializeHomeConfig(config)) === reference;
}

function seedRects(canvas: CanvasSize): { heatmap: Rect; options: Rect } {
  const w = Math.max(0, Number.isFinite(canvas.w) ? canvas.w : DEFAULT_CANVAS.w);
  const h = Math.max(0, Number.isFinite(canvas.h) ? canvas.h : DEFAULT_CANVAS.h);
  const x = FIT_PADDING + CASCADE_STEP;
  const y = SEED_INSET;
  const height = Math.max(1, h - SEED_INSET * 2);
  const gutter = Math.max(SEED_INSET, Math.round(w * 0.012));
  const leftRect = clampToCanvas(
    { x, y, w: Math.max(1, Math.round(w * SEED_LEFT_FRACTION)), h: height },
    { w, h },
  );
  const rightX = leftRect.x + leftRect.w + gutter;
  const rightRect = clampToCanvas(
    { x: rightX, y, w: Math.max(1, w - rightX - SEED_INSET), h: height },
    { w, h },
  );
  return { heatmap: rightRect, options: leftRect };
}

function seedWindow(
  type: string,
  ordinal: number,
  rect: Rect,
  z: number,
): WindowState {
  const spec = HOME_PANELS.find((candidate) => candidate.id === type);
  return {
    id: `${type}-${ordinal}`,
    type,
    title: spec?.title ?? type,
    ...rect,
    z,
    minimized: false,
    maximized: false,
  };
}

export interface HomeWindowConfig {
  layouts: WindowLayout[];
  active: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Picker ids are deterministic so a layout can be reasoned about in tests. */
export function createWindowFor(
  type: string,
  ordinal: number,
  canvas: CanvasSize = DEFAULT_CANVAS,
  maxZ = 0,
): WindowState | null {
  const spec = HOME_PANELS.find((candidate) => candidate.id === type);
  if (!spec) return null;
  return {
    id: `${type}-${ordinal}`,
    type,
    title: spec.title,
    ...cascadeRect(ordinal - 1, canvas),
    z: maxZ + 1,
  };
}

/** First visit is a populated Main desk, not an empty canvas or a dead end. */
export function defaultHomeConfig(canvas?: CanvasSize): HomeWindowConfig {
  const { heatmap, options } = seedRects(seedCanvas(canvas));
  return {
    layouts: [
      {
        name: DEFAULT_LAYOUT_NAMES[0],
        // Seed with real, self-contained panels at a deliberate two-column
        // geometry. A cascade belongs to the picker (added windows), not here:
        // two 420x260 cards at cascade offsets overlapped and left 90% of the
        // canvas empty on first load.
        windows: [
          seedWindow("market.heatmap", 1, heatmap, 1),
          seedWindow("options.chain", 2, options, 2),
        ],
      },
      { name: DEFAULT_LAYOUT_NAMES[1], windows: [] },
      { name: DEFAULT_LAYOUT_NAMES[2], windows: [] },
    ],
    active: DEFAULT_LAYOUT_NAMES[0],
  };
}

/**
 * Saved state is untrusted: a layout pointing at a removed panel degrades to a
 * window-less workspace, rects are clamped by `parseLayout`, duplicate names and
 * an unknown active tab are discarded. Never throws.
 */
export function normalizeHomeConfig(
  raw: unknown,
  canvas: CanvasSize = DEFAULT_CANVAS,
): HomeWindowConfig | null {
  let data: unknown = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || !Array.isArray(data.layouts) || data.layouts.length === 0) return null;

  const layouts: WindowLayout[] = [];
  const names = new Set<string>();
  for (const entry of data.layouts) {
    if (!isRecord(entry)) continue;
    const fallbackName = `Screen ${layouts.length + 1}`;
    const name = typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim()
      : fallbackName;
    if (names.has(name)) continue;
    names.add(name);
    const parsed = parseLayout({ windows: entry.windows, name }, WINDOW_PANEL_TYPES, canvas);
    layouts.push(parsed ?? { name, windows: [] });
  }
  if (layouts.length === 0) return null;

  const active = typeof data.active === "string" && layouts.some((l) => l.name === data.active)
    ? data.active
    : layouts[0].name ?? DEFAULT_LAYOUT_NAMES[0];
  return { layouts, active };
}

export function serializeHomeConfig(config: HomeWindowConfig): Record<string, unknown> {
  return {
    v: HOME_WINDOW_VERSION,
    active: config.active,
    layouts: config.layouts.map((layout) =>
      JSON.parse(serializeLayout(layout)) as Record<string, unknown>,
    ),
  };
}

export function nextScreenName(layouts: WindowLayout[]): string {
  let ordinal = layouts.length + 1;
  const taken = new Set(layouts.map((layout) => slug(layout.name ?? "")));
  while (taken.has(slug(`Screen ${ordinal}`))) ordinal += 1;
  return `Screen ${ordinal}`;
}

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Proportional split with a gutter; rounding slack goes to the last cell. */
function splitSpan(total: number, weights: readonly number[], gutter: number): number[] {
  const usable = Math.max(0, total - gutter * Math.max(0, weights.length - 1));
  const sum = weights.reduce((acc, weight) => acc + Math.max(0, finite(weight)), 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  const sizes = weights.map((weight) => Math.round((usable * Math.max(0, finite(weight))) / sum));
  const head = sizes.slice(0, -1).reduce((acc, size) => acc + size, 0);
  sizes[sizes.length - 1] = Math.max(0, usable - head);
  return sizes;
}

function presetTabName(label: string, layouts: WindowLayout[]): string {
  const taken = new Set(layouts.map((layout) => slug(layout.name ?? "")));
  const base = slug(label) ? label : "Preset";
  if (!taken.has(slug(base))) return base;
  let ordinal = 2;
  while (taken.has(slug(`${base} ${ordinal}`))) ordinal += 1;
  return `${base} ${ordinal}`;
}

/**
 * Resolve a preset into windows against the live canvas. Every rect comes from
 * the grid split (canvas fractions + gutter), so cells cannot overlap and never
 * leave the canvas. Titles come from the panel registry — presets own no labels.
 */
export function presetWindows(preset: HomePreset, canvas: CanvasSize): WindowState[] {
  const w = Math.max(0, finite(canvas.w, DEFAULT_CANVAS.w));
  const h = Math.max(0, finite(canvas.h, DEFAULT_CANVAS.h));
  const gutter = Math.max(SEED_INSET, Math.round(w * 0.012));
  const innerW = Math.max(0, w - FIT_PADDING * 2);
  const innerH = Math.max(0, h - FIT_PADDING * 2);

  const widths = splitSpan(innerW, preset.columns.map((column) => column.width), gutter);
  let cursorX = FIT_PADDING;
  const grid: Rect[][] = preset.columns.map((column, columnIndex) => {
    const heights = splitSpan(innerH, column.rows, gutter);
    let y = FIT_PADDING;
    const rows = heights.map((height) => {
      const rect: Rect = { x: cursorX, y, w: widths[columnIndex] ?? 0, h: height };
      y += height + gutter;
      return rect;
    });
    cursorX += (widths[columnIndex] ?? 0) + gutter;
    return rows;
  });

  return preset.cells.flatMap((cell, ordinal) => {
    const rect = grid[cell.column]?.[cell.row];
    if (!rect) return [];
    const spec = getPanelSpec(cell.panel);
    return [{
      id: `${cell.panel}-${ordinal + 1}`,
      type: cell.panel,
      title: spec?.title ?? cell.panel,
      ...clampToCanvas({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, { w, h }),
      z: ordinal + 1,
      minimized: false,
      maximized: false,
    }];
  });
}

/**
 * Apply a preset to a NEW tab and switch to it. Overwriting the current tab
 * would destroy a saved desk with no way back — switching tabs is the undo, so
 * the old tab (and every other tab) stays byte-identical. Unknown panel types
 * are removed by the same normalizer that guards persisted layouts.
 */
export function applyPreset(
  config: HomeWindowConfig,
  preset: HomePreset | undefined,
  canvas: CanvasSize = DEFAULT_CANVAS,
): HomeWindowConfig {
  if (!preset) return config;
  const name = presetTabName(preset.label, config.layouts);
  const draft: HomeWindowConfig = {
    layouts: [
      ...config.layouts.map((layout) => ({
        ...layout,
        windows: layout.windows.map((window) => ({ ...window })),
      })),
      { name, windows: presetWindows(preset, canvas) },
    ],
    active: name,
  };
  return normalizeHomeConfig(serializeHomeConfig(draft), canvas) ?? draft;
}
