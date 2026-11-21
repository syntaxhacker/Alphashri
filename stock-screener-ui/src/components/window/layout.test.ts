// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import {
  CASCADE_STEP,
  DEFAULT_MIN_SIZE,
  MIN_VISIBLE_X,
  cascadeRect,
  clampToCanvas,
  fitAllToScreen,
  geometryOf,
  maximize,
  parseLayout,
  raiseToFront,
  resizeRect,
  restore,
  sameRect,
  serializeLayout,
} from "./layout";
import type { WindowState } from "./types";

const CANVAS = { w: 1280, h: 800 };

const win = (over: Partial<WindowState> = {}): WindowState => ({
  id: "a",
  type: "report.chart",
  title: "CHART",
  x: 10,
  y: 20,
  w: 300,
  h: 200,
  z: 1,
  ...over,
});

describe("window layout — focus / z-order", () => {
  it("(a) raiseToFront sets max z + 1 and leaves every other window byte-identical", () => {
    const a = win({ id: "a", z: 1 });
    const b = win({ id: "b", z: 4 });
    const c = win({ id: "c", z: 2 });
    const next = raiseToFront([a, b, c], "a");

    expect(next.find((w) => w.id === "a")!.z).toBe(5);
    expect(next.find((w) => w.id === "b")).toEqual(b);
    expect(next.find((w) => w.id === "c")).toEqual(c);
    expect([a, b, c].map((w) => w.z)).toEqual([1, 4, 2]);
  });

  it("raiseToFront is deterministic for tied z and a missing id is a no-op", () => {
    const a = win({ id: "a", z: 3 });
    const b = win({ id: "b", z: 3 });
    expect(raiseToFront([a, b], "b")[1].z).toBe(4);
    expect(raiseToFront([a, b], "b")[0].z).toBe(3);

    const unchanged = raiseToFront([a, b], "ghost");
    expect(unchanged).not.toBe([a, b]);
    expect(unchanged.map((w) => w.z)).toEqual([3, 3]);
  });
});

describe("window layout — geometry invariants", () => {
  it("(b) clampToCanvas keeps the title bar reachable from a far-negative rect", () => {
    const r = clampToCanvas({ x: -5000, y: -900, w: 300, h: 200 }, CANVAS);
    expect(r.x).toBeGreaterThanOrEqual(-(300 - MIN_VISIBLE_X));
    expect(r.y).toBe(0);
    expect(r.w).toBe(300);
    expect(r.h).toBe(200);
  });

  it("clampToCanvas leaves a grab strip on the right and keeps the bottom title bar on screen", () => {
    const topRight = clampToCanvas({ x: 9000, y: 9000, w: 300, h: 200 }, CANVAS);
    expect(topRight.x).toBe(CANVAS.w - MIN_VISIBLE_X);
    expect(topRight.y).toBe(CANVAS.h - 28);
  });

  it("clampToCanvas enforces the minimum size instead of inverting it", () => {
    const r = clampToCanvas({ x: 0, y: 0, w: -5, h: 0 }, CANVAS);
    expect(r.w).toBe(DEFAULT_MIN_SIZE.w);
    expect(r.h).toBe(DEFAULT_MIN_SIZE.h);
  });

  it("(c) resizeRect enforces the minimum and cannot invert w/h on the west edge", () => {
    const start = { x: 400, y: 100, w: 300, h: 200 };
    const r = resizeRect(start, "w", 1000, 0, CANVAS, { w: 240, h: 120 });
    expect(r.w).toBe(240);
    // Opposite (east) edge must stay pinned while the west edge is dragged past it.
    expect(r.x + r.w).toBe(start.x + start.w);
  });

  it("resizeRect pins the opposite edge on the north edge and clamps a corner", () => {
    const start = { x: 400, y: 100, w: 300, h: 200 };
    const north = resizeRect(start, "n", 0, 1000, CANVAS, { w: 240, h: 120 });
    expect(north.h).toBe(120);
    expect(north.y + north.h).toBe(start.y + start.h);

    const nw = resizeRect(start, "nw", 1000, 1000, CANVAS, { w: 240, h: 120 });
    expect(nw.w).toBe(240);
    expect(nw.h).toBe(120);
    expect(nw.x + nw.w).toBe(start.x + start.w);
    expect(nw.y + nw.h).toBe(start.y + start.h);
  });

  it("resizeRect grows from the east/south edges without moving the origin", () => {
    const r = resizeRect({ x: 100, y: 100, w: 300, h: 200 }, "se", 50, 30, CANVAS);
    expect(r).toEqual({ x: 100, y: 100, w: 350, h: 230 });
  });
});

describe("window layout — maximize / restore", () => {
  it("(e) maximize fills the canvas and restore returns the exact prior rect", () => {
    const original = win({ x: 33, y: 77, w: 321, h: 199 });
    const before = [original, win({ id: "b", z: 2 })];
    const maximized = maximize(before, "a", CANVAS);

    expect(maximized.find((w) => w.id === "a")!.maximized).toBe(true);
    expect(geometryOf(maximized.find((w) => w.id === "a")!, CANVAS)).toEqual({
      x: 0, y: 0, w: CANVAS.w, h: CANVAS.h,
    });
    // x/y/w/h are always the restore rect, so restore is exact, not approximate.
    expect(maximized.find((w) => w.id === "a")!.x).toBe(33);

    const restored = restore(maximized, "a");
    const back = restored.find((w) => w.id === "a")!;
    expect(back.maximized).toBe(false);
    expect({ x: back.x, y: back.y, w: back.w, h: back.h }).toEqual({
      x: 33, y: 77, w: 321, h: 199,
    });
  });
});

describe("window layout — off-screen recovery", () => {
  it("(f) fitAllToScreen scales and translates an off-canvas window back into view", () => {
    const off = win({ id: "off", x: 5000, y: 4000, w: 385, h: 305, z: 9 });
    const next = fitAllToScreen([off], CANVAS);
    const r = next[0];

    expect(r.x).toBeGreaterThanOrEqual(-(r.w - MIN_VISIBLE_X));
    expect(r.x + r.w).toBeLessThanOrEqual(CANVAS.w - MIN_VISIBLE_X + r.w);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(CANVAS.h - 28);
    expect(r.z).toBe(1);
    expect(next[0].maximized).toBe(false);
  });

  it("fitAllToScreen re-stacks deterministically by prior z", () => {
    const a = win({ id: "a", x: 5000, z: 7 });
    const b = win({ id: "b", x: 6000, z: 2 });
    const next = fitAllToScreen([a, b], CANVAS);
    expect(next.find((w) => w.id === "b")!.z).toBe(1);
    expect(next.find((w) => w.id === "a")!.z).toBe(2);
  });
});

describe("window layout — saved state degrades", () => {
  const KNOWN = new Set(["report.chart", "report.walls"]);

  it("(g) parseLayout drops an unknown window type and clamps an absurd rect", () => {
    const parsed = parseLayout(
      {
        v: 1,
        name: "Main",
        windows: [
          { id: "ghost", type: "removed.panel", title: "GONE", x: 1, y: 2, w: 3, h: 4, z: 1 },
          { id: "kept", type: "report.walls", title: "WALLS", x: 9000, y: -9000, w: -5, h: 0, z: 2 },
        ],
      },
      KNOWN,
      CANVAS,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.windows.map((w) => w.id)).toEqual(["kept"]);
    expect(parsed!.windows[0].w).toBe(DEFAULT_MIN_SIZE.w);
    expect(parsed!.windows[0].h).toBe(DEFAULT_MIN_SIZE.h);
    expect(parsed!.windows[0].x).toBe(CANVAS.w - MIN_VISIBLE_X);
    expect(parsed!.windows[0].y).toBe(0);
    expect(parsed!.name).toBe("Main");
  });

  it("parseLayout never throws on garbage and round-trips a serialized layout", () => {
    expect(parseLayout("not json", KNOWN, CANVAS)).toBeNull();
    expect(parseLayout(null, KNOWN, CANVAS)).toBeNull();
    expect(parseLayout({ windows: "nope" }, KNOWN, CANVAS)).toBeNull();

    const src: WindowState[] = [win({ x: 12, y: 34, w: 385, h: 305, z: 3 })];
    const parsed = parseLayout(serializeLayout({ windows: src, name: "Main" }), KNOWN, CANVAS);
    expect(parsed!.windows[0]).toMatchObject({
      id: "a", type: "report.chart", title: "CHART", x: 12, y: 34, w: 385, h: 305, z: 3,
    });
    expect(parsed!.name).toBe("Main");
  });

  it("sameRect distinguishes a moved gesture from a no-op click", () => {
    const a = { x: 10, y: 20, w: 300, h: 200 };
    expect(sameRect(a, { ...a })).toBe(true);
    expect(sameRect(a, { ...a, x: 11 })).toBe(false);
    expect(sameRect(a, { ...a, h: 199 })).toBe(false);
  });

  it("cascadeRect gives each new window a distinct cascaded offset", () => {
    const a = cascadeRect(0, CANVAS);
    const b = cascadeRect(1, CANVAS);
    expect(b.x - a.x).toBe(CASCADE_STEP);
    expect(b.y - a.y).toBe(CASCADE_STEP);
    expect(cascadeRect(6, CANVAS).x).toBe(a.x);
  });
});
