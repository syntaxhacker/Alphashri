import { describe, expect, it } from "vitest";
import type { CanvasSize } from "../../components/window/layout";
import {
  getReportPreset,
  isReportPresetId,
  reportPresets,
  reportPresetLayout,
  resolveReportPreset,
} from "./reportWindowPresets";
import { REPORT_PANEL_TITLES, REPORT_WINDOW_KEY_SET } from "./reportWindowTypes";

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const WIDTHS = [1280, 1920, 2560];
const canvasFor = (w: number): CanvasSize => ({ w, h: w === 2560 ? 1440 : 800 });

describe("report window presets", () => {
  it("uses unique ids/labels, only contracted keys and registry titles", () => {
    const presets = reportPresets();
    expect(presets.length).toBeGreaterThanOrEqual(2);
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length);
    expect(new Set(presets.map((preset) => preset.label)).size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      for (const window of preset.windows) {
        expect(REPORT_WINDOW_KEY_SET.has(window.type), `${preset.id}:${window.type}`).toBe(true);
      }
      for (const win of resolveReportPreset(preset, canvasFor(1280))) {
        expect(win.title).toBe(REPORT_PANEL_TITLES[win.type as keyof typeof REPORT_PANEL_TITLES]);
      }
    }
  });

  it("produces fractional rects that do not overlap in unit space", () => {
    for (const preset of reportPresets()) {
      const windows = preset.windows;
      for (let i = 0; i < windows.length; i += 1) {
        for (let j = i + 1; j < windows.length; j += 1) {
          expect(overlaps(windows[i], windows[j]), `${preset.id}: ${windows[i].type} / ${windows[j].type}`)
            .toBe(false);
        }
      }
    }
  });

  it("resolves to in-canvas, non-overlapping windows at 1280, 1920 and 2560", () => {
    for (const width of WIDTHS) {
      const canvas = canvasFor(width);
      for (const preset of reportPresets()) {
        const windows = resolveReportPreset(preset, canvas);
        expect(windows).toHaveLength(preset.windows.length);
        for (const win of windows) {
          const label = `${preset.id} @ ${width} (${win.type})`;
          expect(win.x, label).toBeGreaterThanOrEqual(0);
          expect(win.y, label).toBeGreaterThanOrEqual(0);
          expect(win.x + win.w, label).toBeLessThanOrEqual(canvas.w);
          expect(win.y + win.h, label).toBeLessThanOrEqual(canvas.h);
        }
        for (let i = 0; i < windows.length; i += 1) {
          for (let j = i + 1; j < windows.length; j += 1) {
            expect(overlaps(windows[i], windows[j]), `${preset.id} @ ${width}: ${windows[i].type} / ${windows[j].type}`)
              .toBe(false);
          }
        }
      }
    }
  });

  it("seeds a first-run layout that never overlaps and round-trips its geometry", () => {
    for (const width of WIDTHS) {
      const canvas = canvasFor(width);
      const windows = reportPresetLayout("desk", canvas);
      for (let i = 0; i < windows.length; i += 1) {
        for (let j = i + 1; j < windows.length; j += 1) {
          expect(overlaps(windows[i], windows[j]), `seed overlap at ${width}`).toBe(false);
        }
      }
    }
    expect(reportPresetLayout("desk").map((win) => win.type)).toEqual(["chart", "chain", "walls"]);
  });

  it("resolves unknown ids safely and guards untrusted preset ids", () => {
    expect(getReportPreset("desk")?.label).toBe("Desk");
    expect(getReportPreset("removed")).toBeUndefined();
    expect(isReportPresetId("full")).toBe(true);
    expect(isReportPresetId("removed")).toBe(false);
    expect(reportPresetLayout("removed").map((win) => win.type)).toEqual(["chart", "chain", "walls"]);
  });
});
