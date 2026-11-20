import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPanelSpec,
  WINDOW_PANEL_TYPES,
} from "../../components/window/panelRegistry";
import type { CanvasSize } from "../../components/window/layout";
import type { WindowState } from "../../components/window/types";
import {
  createWindowFor,
  defaultHomeConfig,
  HOME_PANELS,
  normalizeHomeConfig,
  PRESETS,
  presetWindows,
  serializeHomeConfig,
} from "./homePanels";

const overlaps = (a: WindowState, b: WindowState): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const areaFraction = (win: WindowState, canvas: CanvasSize): number =>
  (win.w * win.h) / (canvas.w * canvas.h);

const seedWindows = (canvas: CanvasSize): WindowState[] =>
  defaultHomeConfig(canvas).layouts[0].windows;

afterEach(() => vi.unstubAllGlobals());

/**
 * The live app shell is narrower and shorter than the browser viewport (164px
 * sidebar plus the desk toolbar). A no-canvas seed must never inherit it.
 */
const stubViewport = (w: number, h: number) =>
  vi.stubGlobal("window", { innerWidth: w, innerHeight: h });

const CANVASES: CanvasSize[] = [
  { w: 1280, h: 800 },
  { w: 1600, h: 900 },
  { w: 1920, h: 950 },
  { w: 2560, h: 1440 },
];

describe("home picker panels", () => {
  it("(d) lists the real market heatmap as a pickable window", () => {
    expect(HOME_PANELS.map((spec) => spec.id)).toContain("market.heatmap");
    expect(WINDOW_PANEL_TYPES.has("market.heatmap")).toBe(true);
    expect(getPanelSpec("market.heatmap")).toBeDefined();
    expect(createWindowFor("market.heatmap", 1)).toMatchObject({
      type: "market.heatmap",
      title: "MARKET HEATMAP",
    });
  });

  it("(f) registers the catalyst radar without a context requirement", () => {
    expect(getPanelSpec("catalyst.radar")?.title).toBe("CATALYST RADAR");
    expect(HOME_PANELS.find((spec) => spec.id === "catalyst.radar")?.requires).toEqual([]);
    expect(WINDOW_PANEL_TYPES.has("catalyst.radar")).toBe(true);
    expect(createWindowFor("catalyst.radar", 1)).toMatchObject({
      type: "catalyst.radar",
      title: "CATALYST RADAR",
    });
  });

  it("(e) the removed paper.positions panel is no longer pickable", () => {
    expect(HOME_PANELS.map((spec) => spec.id)).not.toContain("paper.positions");
    expect(WINDOW_PANEL_TYPES.has("paper.positions")).toBe(false);
    expect(getPanelSpec("paper.positions")).toBeUndefined();
    expect(createWindowFor("paper.positions", 1)).toBeNull();
  });
});

describe("monitor desk preset", () => {
  const monitor = () => PRESETS.find((preset) => preset.id === "monitor");
  const MONITOR_TYPES = ["catalyst.radar", "market.heatmap", "sector.heatmap", "news.feed"];

  it("(a) exists as a desk layout over radar, price/sector and news", () => {
    expect(monitor()?.label).toBe("Monitor");
    expect(monitor()?.cells.map((cell) => cell.panel)).toEqual(MONITOR_TYPES);
    expect(MONITOR_TYPES.every((type) => getPanelSpec(type) !== undefined)).toBe(true);
  });

  it("(b) resolves every cell to a real, non-overlapping window on each canvas", () => {
    const preset = monitor();
    expect(preset).toBeDefined();
    for (const canvas of CANVASES) {
      const windows = presetWindows(preset!, canvas);
      expect(windows.map((win) => win.type), `types at ${canvas.w}`).toEqual(MONITOR_TYPES);
      for (const win of windows) {
        expect(win.x, `${win.type} x at ${canvas.w}`).toBeGreaterThanOrEqual(0);
        expect(win.y, `${win.type} y at ${canvas.w}`).toBeGreaterThanOrEqual(0);
        expect(win.x + win.w, `${win.type} right edge at ${canvas.w}`).toBeLessThanOrEqual(canvas.w);
        expect(win.y + win.h, `${win.type} bottom edge at ${canvas.h}`).toBeLessThanOrEqual(canvas.h);
      }
      for (let i = 0; i < windows.length; i += 1) {
        for (let j = i + 1; j < windows.length; j += 1) {
          expect(overlaps(windows[i], windows[j]), `${windows[i].type} / ${windows[j].type} at ${canvas.w}`)
            .toBe(false);
        }
      }
    }
  });

  it("(c) preset ids are unique so a saved tab name maps to one layout", () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PRESETS.map((preset) => preset.label)).size).toBe(PRESETS.length);
  });
});

describe("home default desk seed", () => {
  it("(a) the no-canvas seed fits entirely inside canvases of 1280..2560 widths", () => {
    stubViewport(1920, 950);
    const windows = defaultHomeConfig().layouts[0].windows;
    for (const canvas of CANVASES) {
      for (const win of windows) {
        expect(win.x + win.w, `${win.type} right edge at canvas ${canvas.w}`)
          .toBeLessThanOrEqual(canvas.w);
        expect(win.y + win.h, `${win.type} bottom edge at canvas ${canvas.h}`)
          .toBeLessThanOrEqual(canvas.h);
      }
    }
  });

  it("(a) a seed built from a measured canvas also fits it exactly", () => {
    for (const canvas of [...CANVASES, { w: 1740, h: 765 }]) {
      for (const win of seedWindows(canvas)) {
        expect(win.x + win.w, `${win.type} right edge at ${canvas.w}`).toBeLessThanOrEqual(canvas.w);
        expect(win.y + win.h, `${win.type} bottom edge at ${canvas.h}`).toBeLessThanOrEqual(canvas.h);
      }
    }
  });

  it("(a) the first-run seed never overlaps at 1280, 1920 or 2560 canvas widths", () => {
    for (const w of [1280, 1920, 2560]) {
      const canvas = { w, h: w === 2560 ? 1440 : 800 };
      const [heatmap, options] = seedWindows(canvas);
      expect(overlaps(heatmap, options), `overlap at ${w}`).toBe(false);
    }
  });

  it("(b) every seeded window fills at least ~35% of the canvas", () => {
    for (const w of [1280, 1920, 2560]) {
      const canvas = { w, h: w === 2560 ? 1440 : 800 };
      for (const win of seedWindows(canvas)) {
        expect(areaFraction(win, canvas), `${win.type} at ${w}`).toBeGreaterThanOrEqual(0.35);
      }
    }
  });

  it("(c) the seed is byte-stable after a serialize/normalize round-trip", () => {
    const canvas = { w: 1280, h: 800 };
    const original = defaultHomeConfig(canvas);
    const roundTrip = normalizeHomeConfig(serializeHomeConfig(original), canvas);
    expect(roundTrip).toEqual(original);
  });

  it("(d) below 1200 the seed still yields valid, non-inverted rects", () => {
    for (const w of [1000, 800]) {
      const canvas = { w, h: 800 };
      for (const win of seedWindows(canvas)) {
        expect(Number.isFinite(win.x), `x at ${w}`).toBe(true);
        expect(Number.isFinite(win.y), `y at ${w}`).toBe(true);
        expect(win.w, `w at ${w}`).toBeGreaterThan(0);
        expect(win.h, `h at ${w}`).toBeGreaterThan(0);
        expect(win.x + win.w, `right edge at ${w}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("home saved-layout degradation", () => {
  it("(e) a saved layout with the removed paper.positions window drops it and keeps the rest", () => {
    const saved = JSON.stringify({
      v: 1,
      active: "Main",
      layouts: [
        {
          name: "Main",
          windows: [
            {
              id: "paper.positions-1",
              type: "paper.positions",
              title: "PAPER POSITIONS",
              x: 8, y: 8, w: 420, h: 260, z: 1,
            },
            {
              id: "market.heatmap-1",
              type: "market.heatmap",
              title: "MARKET HEATMAP",
              x: 500, y: 8, w: 620, h: 500, z: 2,
            },
            {
              id: "options.chain-1",
              type: "options.chain",
              title: "OPTIONS CHAIN",
              x: 8, y: 300, w: 420, h: 400, z: 3,
            },
          ],
        },
      ],
    });

    const normalized = normalizeHomeConfig(saved);

    expect(normalized).not.toBeNull();
    const windows = normalized!.layouts[0].windows;
    expect(windows.map((win) => win.type)).toEqual(["market.heatmap", "options.chain"]);
    expect(windows.every((win) => WINDOW_PANEL_TYPES.has(win.type))).toBe(true);
  });
});

describe("home window panel settings", () => {
  const CANVAS: CanvasSize = { w: 1280, h: 800 };

  it("(a) a window's panel settings survive a serialize -> parse round-trip", () => {
    const base = defaultHomeConfig(CANVAS);
    const settings = { sizeBy: "rsi", colorBy: "pe_ratio", universe: "nifty50" };
    base.layouts[0].windows[0] = { ...base.layouts[0].windows[0], settings } as WindowState;

    const wire = serializeHomeConfig(base);
    const roundTrip = normalizeHomeConfig(wire, CANVAS);

    expect(roundTrip).not.toBeNull();
    expect(roundTrip!.layouts[0].windows[0].settings).toEqual(settings);
    // Geometry still round-trips byte-exact alongside the bag.
    expect(roundTrip).toEqual(base);
  });

  it("(b) an old saved layout with no settings loads unchanged", () => {
    const base = defaultHomeConfig(CANVAS);
    const wire = serializeHomeConfig(base) as {
      layouts: { windows: Record<string, unknown>[] }[];
    };
    const windowsOnWire = wire.layouts[0].windows;
    expect(windowsOnWire.every((w) => !("settings" in w))).toBe(true);

    const parsed = normalizeHomeConfig(wire, CANVAS);
    expect(parsed).toEqual(base);
    expect(parsed!.layouts[0].windows.every((w) => w.settings === undefined)).toBe(true);
  });

  it("(c) a malformed settings bag is dropped while the window is kept", () => {
    const raw = {
      v: 1,
      active: "Main",
      layouts: [{
        name: "Main",
        windows: [
          {
            id: "hm-string", type: "market.heatmap", title: "HEATMAP",
            x: 10, y: 10, w: 500, h: 400, z: 1,
            settings: "not-an-object",
          },
          {
            id: "hm-json", type: "market.heatmap", title: "HEATMAP 2",
            x: 10, y: 10, w: 500, h: 400, z: 2,
            settings: { ok: 1, fn: () => 1, nested: { nan: Number.NaN, keep: "yes" } },
          },
        ],
      }],
    };

    const parsed = normalizeHomeConfig(raw, CANVAS);
    expect(parsed).not.toBeNull();
    expect(parsed!.layouts[0].windows).toHaveLength(2);
    // The non-object bag is dropped whole; the window itself survives.
    expect(parsed!.layouts[0].windows[0].settings).toBeUndefined();
    // Non-JSON values (function, NaN) are stripped; the rest survives.
    expect(parsed!.layouts[0].windows[1].settings).toEqual({ ok: 1, nested: { keep: "yes" } });
  });
});
