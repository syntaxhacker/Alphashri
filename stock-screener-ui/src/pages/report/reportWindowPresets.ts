import { clampToCanvas, type CanvasSize } from "../../components/window/layout";
import type { WindowState } from "../../components/window/types";
import {
  REPORT_PANEL_TITLES,
  isReportWindowKey,
  type ReportWindowKey,
} from "./reportWindowTypes";

/**
 * Presets are geometry only. A window's x/y/w/h are FRACTIONS of the canvas
 * (0..1), never pixels: the same preset fills a 1280 laptop and a 2560 desk,
 * and `resolveReportPreset` is the single place that turns fractions into a
 * `WindowState` for a measured canvas. No panel data or store lives here.
 */
export interface ReportPresetWindow {
  type: ReportWindowKey;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReportPreset {
  id: string;
  label: string;
  windows: ReportPresetWindow[];
}

export const REPORT_PRESET_CANVAS: CanvasSize = { w: 1280, h: 800 };
const GUTTER = 0.012;

interface Cell {
  key: ReportWindowKey;
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}

/** Unit-square grid: gutters are subtracted up front so cells cannot overlap. */
function grid(id: string, label: string, cols: number, rows: number, cells: Cell[]): ReportPreset {
  const unitW = (1 - GUTTER * (cols - 1)) / cols;
  const unitH = (1 - GUTTER * (rows - 1)) / rows;
  return {
    id,
    label,
    windows: cells.map(({ key, col, row, colSpan = 1, rowSpan = 1 }) => ({
      type: key,
      x: col * (unitW + GUTTER),
      y: row * (unitH + GUTTER),
      w: unitW * colSpan + GUTTER * (colSpan - 1),
      h: unitH * rowSpan + GUTTER * (rowSpan - 1),
    })),
  };
}

/** Adding a desk is data: append here, never touch the desk chrome. */
const PRESETS: ReportPreset[] = [
  grid("focus", "Focus", 1, 1, [{ key: "chart", col: 0, row: 0 }]),
  grid("desk", "Desk", 2, 2, [
    { key: "chart", col: 0, row: 0, rowSpan: 2 },
    { key: "chain", col: 1, row: 0 },
    { key: "walls", col: 1, row: 1 },
  ]),
  grid("flow", "Flow", 2, 2, [
    { key: "chart", col: 0, row: 0, rowSpan: 2 },
    { key: "flow", col: 1, row: 0 },
    { key: "analytics", col: 1, row: 1 },
  ]),
  grid("full", "Full desk", 3, 3, [
    { key: "chart", col: 0, row: 0, colSpan: 2, rowSpan: 2 },
    { key: "chain", col: 2, row: 0 },
    { key: "walls", col: 2, row: 1 },
    { key: "flow", col: 0, row: 2 },
    { key: "analytics", col: 1, row: 2 },
    { key: "movers", col: 2, row: 2 },
  ]),
];

export function reportPresets(): ReportPreset[] {
  return PRESETS.map((preset) => ({
    ...preset,
    windows: preset.windows.map((window) => ({ ...window })),
  }));
}

export function getReportPreset(id: string): ReportPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Fractions -> committed geometry. Titles come from the registry, not the preset. */
export function resolveReportPreset(preset: ReportPreset, canvas?: CanvasSize): WindowState[] {
  const w = Math.max(0, finite(canvas?.w, REPORT_PRESET_CANVAS.w));
  const h = Math.max(0, finite(canvas?.h, REPORT_PRESET_CANVAS.h));
  return preset.windows.map((window, index) => ({
    id: `${window.type}-${index + 1}`,
    type: window.type,
    title: REPORT_PANEL_TITLES[window.type],
    ...clampToCanvas(
      {
        x: window.x * w,
        y: window.y * h,
        w: window.w * w,
        h: window.h * h,
      },
      { w, h },
    ),
    z: index + 1,
    minimized: false,
    maximized: false,
  }));
}

/** First visit is a populated desk, not an empty canvas or a dead end. */
export function reportPresetLayout(id = "desk", canvas?: CanvasSize): WindowState[] {
  const preset = getReportPreset(id) ?? getReportPreset("desk")!;
  return resolveReportPreset(preset, canvas);
}

/** Guard for untrusted preset ids coming from saved config or a URL. */
export function isReportPresetId(value: unknown): boolean {
  return typeof value === "string" && PRESETS.some((preset) => preset.id === value);
}

/** Exposed so a guard test can assert a preset never references a removed key. */
export function reportPresetKeys(preset: ReportPreset): ReportWindowKey[] {
  return preset.windows.filter((window) => isReportWindowKey(window.type)).map((window) => window.type);
}
