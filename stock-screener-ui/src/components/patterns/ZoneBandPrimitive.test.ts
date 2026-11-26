import { describe, expect, it, vi } from "vitest";
import { POSITIVE } from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { ZONE_BORDER_ALPHA, ZONE_FILL_ALPHA, ZoneBandPrimitive } from "./ZoneBandPrimitive";
import type { TVRect } from "./patternTVData";

interface FillCall {
  style: string;
  args: number[];
}

interface StrokeCall {
  style: string;
  args: number[];
}

function makeTarget(width = 400, height = 200) {
  const state = { fillStyle: "", strokeStyle: "", lineWidth: 0 };
  const fills: FillCall[] = [];
  const strokes: StrokeCall[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn((...args: number[]) => fills.push({ style: state.fillStyle, args })),
    strokeRect: vi.fn((...args: number[]) => strokes.push({ style: state.strokeStyle, args })),
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
  };
  const target = {
    useMediaCoordinateSpace: <T>(fn: (scope: unknown) => T): T =>
      fn({ context: ctx, mediaSize: { width, height } }),
  };
  return { target, ctx, fills, strokes, state };
}

function attach(primitive: ZoneBandPrimitive) {
  const times = new Map<number, number>();
  const prices = new Map<number, number>();
  const requestUpdate = vi.fn();
  primitive.attached({
    chart: {
      timeScale: () => ({
        timeToCoordinate: (time: number) => times.get(time) ?? null,
      }),
    },
    series: {
      priceToCoordinate: (price: number) => prices.get(price) ?? null,
    },
    requestUpdate,
    horzScaleBehavior: {},
  } as never);
  return { times, prices, requestUpdate };
}

function zone(overrides: Partial<TVRect> = {}): TVRect {
  return {
    kind: "support",
    top: 120,
    bottom: 100,
    start: 100,
    end: 200,
    touches: 3,
    score: 0.5,
    color: POSITIVE,
    legendName: "Support",
    ...overrides,
  };
}

function draw(primitive: ZoneBandPrimitive, target: unknown): void {
  const view = primitive.paneViews()[0];
  const renderer = view?.renderer();
  renderer?.drawBackground?.(target as never);
}

describe("ZoneBandPrimitive", () => {
  it("draws a band in the background with the fill/border alpha and a solid border", () => {
    const primitive = new ZoneBandPrimitive([zone()]);
    const { times, prices } = attach(primitive);
    times.set(100, 50);
    times.set(200, 150);
    prices.set(120, 20);
    prices.set(100, 100);
    const { target, ctx, fills, strokes, state } = makeTarget();

    draw(primitive, target);

    expect(primitive.paneViews()[0]?.zOrder?.()).toBe("bottom");
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 400, 200);
    expect(fills).toEqual([
      {
        style: withAlpha(POSITIVE, ZONE_FILL_ALPHA),
        args: [50, 20, 100, 80],
      },
    ]);
    expect(strokes).toEqual([
      {
        style: withAlpha(POSITIVE, ZONE_BORDER_ALPHA),
        args: [50.5, 20.5, 99, 79],
      },
    ]);
    expect(state.lineWidth).toBe(1);
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
    expect(ctx.setLineDash).not.toHaveBeenCalledWith([3, 3]);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it("clips rectangles to the pane and drops bands fully outside it", () => {
    const primitive = new ZoneBandPrimitive([
      zone({ start: 100, end: 300, top: 120, bottom: 100 }),
      zone({ kind: "resistance", start: -200, end: -50, top: 140, bottom: 130 }),
    ]);
    const { times, prices } = attach(primitive);
    times.set(100, 300);
    times.set(300, 500);
    times.set(-200, -200);
    times.set(-50, -50);
    prices.set(120, -40);
    prices.set(100, 60);
    prices.set(140, 20);
    prices.set(130, 60);
    const { target, fills, strokes } = makeTarget();

    draw(primitive, target);

    expect(fills).toHaveLength(1);
    expect(fills[0]?.args).toEqual([300, 0, 100, 60]);
    expect(strokes).toHaveLength(1);
  });

  it("widens a single-bar band to a visible sliver without spilling right", () => {
    const primitive = new ZoneBandPrimitive([
      zone({ start: 100, end: 100, top: 120, bottom: 100 }),
    ]);
    const { times, prices } = attach(primitive);
    times.set(100, 399);
    prices.set(120, 20);
    prices.set(100, 100);
    const { target, fills } = makeTarget();

    draw(primitive, target);

    expect(fills[0]?.args).toEqual([399, 20, 1, 80]);
  });

  it("requests a redraw on setZones and detaches cleanly", () => {
    const primitive = new ZoneBandPrimitive();
    const { times, prices, requestUpdate } = attach(primitive);
    times.set(100, 50);
    times.set(200, 150);
    prices.set(120, 20);
    prices.set(100, 100);
    const { target, fills } = makeTarget();

    primitive.setZones([zone()]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    draw(primitive, target);
    expect(fills).toHaveLength(1);

    primitive.detached();
    primitive.setZones([zone()]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);

    draw(primitive, target);
    expect(fills).toHaveLength(1);
  });

  it("skips zones whose price coordinates are unavailable", () => {
    const primitive = new ZoneBandPrimitive([zone()]);
    attach(primitive);
    const { target, fills } = makeTarget();

    draw(primitive, target);

    expect(fills).toHaveLength(0);
  });
});
