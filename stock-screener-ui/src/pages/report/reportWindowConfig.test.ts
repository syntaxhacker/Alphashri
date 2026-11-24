import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_SIZE,
  MIN_VISIBLE_X,
  TITLE_BAR_H,
  type CanvasSize,
} from "../../components/window/layout";
import {
  defaultReportLayout,
  normalizeReportLayout,
  sanitizeReportSettings,
  serializeReportLayout,
} from "./reportWindowConfig";
import {
  REPORT_WINDOW_SCOPE,
  REPORT_WINDOW_VERSION,
} from "./reportWindowTypes";

const CANVAS: CanvasSize = { w: 1280, h: 800 };

describe("report window config", () => {
  it("owns a version 1 scope and a populated first-run layout", () => {
    expect(REPORT_WINDOW_SCOPE).toBe("window.report");
    expect(REPORT_WINDOW_VERSION).toBe(1);
    const layout = defaultReportLayout(CANVAS);
    expect(layout.name).toBe("Main");
    expect(layout.windows.map((win) => win.type)).toEqual(["chart", "chain", "walls"]);
  });

  it("round-trips geometry byte-exact through serialize -> normalize", () => {
    const original = defaultReportLayout(CANVAS);
    const wire = serializeReportLayout(original);
    expect(() => JSON.stringify(wire)).not.toThrow();
    expect(normalizeReportLayout(wire, CANVAS)).toEqual(original);
    // A stringified wire is the shape the saved-config transport actually stores.
    expect(normalizeReportLayout(JSON.stringify(wire), CANVAS)).toEqual(original);
  });

  it("round-trips a sanitized settings bag alongside the geometry", () => {
    const original = defaultReportLayout(CANVAS);
    original.windows[0] = {
      ...original.windows[0],
      settings: {
        sizeBy: "oi",
        nested: { keep: "yes", drop: () => 1, nan: Number.NaN },
      },
    };
    const wire = serializeReportLayout(original);
    const expected = {
      ...original,
      windows: original.windows.map((win, index) =>
        index === 0
          ? { ...win, settings: { sizeBy: "oi", nested: { keep: "yes" } } }
          : win,
      ),
    };
    expect(normalizeReportLayout(wire, CANVAS)).toEqual(expected);
  });

  it("drops unknown windows, duplicate ids and non-JSON settings without throwing", () => {
    const raw = {
      v: 1,
      name: "Main",
      windows: [
        { id: "bad", type: "removed.panel", x: 0, y: 0, w: 400, h: 300, z: 1 },
        { id: "c1", type: "chart", x: Number.NaN, y: Infinity, w: -5, h: 0, z: Number.NaN },
        { id: "c1", type: "chart", x: 999999, y: 999999, w: 400, h: 300, z: 2 },
        {
          id: "w1", type: "walls", x: 10, y: 10, w: 500, h: 400, z: 3,
          settings: { ok: 1, fn: () => 1, nested: { keep: "yes", nan: Number.NaN } },
        },
      ],
    };
    const parsed = normalizeReportLayout(raw, CANVAS);
    expect(parsed).not.toBeNull();
    expect(parsed!.windows.map((win) => win.type)).toEqual(["chart", "walls"]);
    expect(parsed!.windows[1].settings).toEqual({ ok: 1, nested: { keep: "yes" } });

    const chart = parsed!.windows[0];
    for (const value of [chart.x, chart.y, chart.w, chart.h, chart.z]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(chart.w).toBeGreaterThanOrEqual(DEFAULT_MIN_SIZE.w);
    expect(chart.h).toBeGreaterThanOrEqual(DEFAULT_MIN_SIZE.h);
    expect(chart.x).toBeGreaterThanOrEqual(-(chart.w - MIN_VISIBLE_X));
    expect(chart.x).toBeLessThanOrEqual(CANVAS.w - MIN_VISIBLE_X);
    expect(chart.y).toBeGreaterThanOrEqual(0);
    expect(chart.y).toBeLessThanOrEqual(CANVAS.h - TITLE_BAR_H);
  });

  it("keeps an empty desk valid but rejects malformed envelopes", () => {
    expect(normalizeReportLayout({ v: 1, windows: [] }, CANVAS)).toEqual({ windows: [] });
    expect(normalizeReportLayout("not json", CANVAS)).toBeNull();
    expect(normalizeReportLayout("   ", CANVAS)).toBeNull();
    expect(normalizeReportLayout(null, CANVAS)).toBeNull();
    expect(normalizeReportLayout({}, CANVAS)).toBeNull();
    expect(normalizeReportLayout({ windows: "nope" }, CANVAS)).toBeNull();
  });

  it("sanitizes settings bags at the untrusted boundary", () => {
    expect(sanitizeReportSettings("nope")).toBeUndefined();
    expect(sanitizeReportSettings({ fn: () => 1 })).toEqual({});
    expect(sanitizeReportSettings({ nan: Number.NaN, inf: Infinity, keep: 1 })).toEqual({ keep: 1 });
    expect(sanitizeReportSettings({ deep: { deeper: { ok: true } } })).toEqual({
      deep: { deeper: { ok: true } },
    });
    expect(sanitizeReportSettings({ huge: "x".repeat(4096) })).toBeUndefined();
  });
});
