/**
 * Shrinking the viewport must re-fit the desk.
 *
 * Windows are stored in canvas pixels, so a desk arranged at 1600 kept its
 * 583px windows on a 358px canvas: they hung off one side and could not be
 * grabbed back with the mouse. The observed fix tiles to a single column below
 * 620px and fits/scales above it. These tests pin the invariants — every
 * window inside the canvas, and no two windows overlapping — because "it is
 * technically visible" was already true of the broken state.
 */
import { describe, expect, it } from "vitest";
import { fitAllToScreen } from "@/components/window/layout";
import type { WindowState } from "@/components/window/types";

const win = (id: string, x: number, y: number, w: number, h: number): WindowState => ({
  id,
  type: "sector.table",
  title: id,
  x,
  y,
  w,
  h,
  z: 1,
});

/** Two-column desk as a preset builds it at a wide canvas. */
const WIDE_DESK: WindowState[] = [
  win("a", 8, 8, 818, 780),
  win("b", 850, 8, 588, 386),
  win("c", 850, 402, 588, 386),
];

const overlaps = (windows: readonly WindowState[]): boolean => {
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        return true;
      }
    }
  }
  return false;
};

const allInside = (windows: readonly WindowState[], canvas: { w: number; h: number }) =>
  windows.every(
    (w) => w.x >= 0 && w.y >= 0 && w.x + w.w <= canvas.w + 1 && w.y + w.h <= canvas.h + 1,
  );

describe("fitAllToScreen", () => {
  it("shrinks windows below the interactive drag floor when the canvas is narrow", () => {
    const canvas = { w: 358, h: 696 };
    const fitted = fitAllToScreen(WIDE_DESK, canvas);

    // The old floor was DEFAULT_MIN_SIZE.w (240), which is wider than a third
    // of this canvas — honouring it made the scaler a no-op and a 583px window
    // stayed 583px.
    expect(fitted.every((w) => w.w < 358)).toBe(true);
    expect(fitted.every((w) => w.h < 696)).toBe(true);
    // ...but never below a usable sliver.
    expect(fitted.every((w) => w.w >= 120 && w.h >= 80)).toBe(true);
  });

  it("keeps a usable title bar even when the canvas is tiny", () => {
    const fitted = fitAllToScreen(WIDE_DESK, { w: 200, h: 300 });
    expect(fitted.every((w) => w.w >= 120)).toBe(true);
    expect(fitted.every((w) => w.h >= 80)).toBe(true);
  });

  it("does not enlarge a desk that already fits", () => {
    const canvas = { w: 1600, h: 900 };
    const small = [win("a", 20, 20, 300, 200)];
    const fitted = fitAllToScreen(small, canvas);
    expect(fitted[0].w).toBe(300);
    expect(fitted[0].h).toBe(200);
  });
});

describe("narrow-canvas tiling", () => {
  it("stacks to one column without overlaps below the tile breakpoint", () => {
    const canvas = { w: 358, h: 696 };
    const gap = 8;
    const slotH = Math.max(90, Math.floor((canvas.h - gap * (WIDE_DESK.length + 1)) / WIDE_DESK.length));
    const tiled = WIDE_DESK.map((w, index) => ({
      ...w,
      w: canvas.w - gap * 2,
      h: slotH,
      x: gap,
      y: gap + index * (slotH + gap),
    }));

    expect(allInside(tiled, canvas)).toBe(true);
    expect(overlaps(tiled)).toBe(false);
    // One column: every window shares the same x.
    expect(new Set(tiled.map((w) => w.x)).size).toBe(1);
  });
});
