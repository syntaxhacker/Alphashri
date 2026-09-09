import { describe, expect, it, vi } from "vitest";
import {
  ZONE_STYLE, drawZoneBox, drawZones, drawRiskReward, rrGeometry, tradeMarkers,
} from "./overlays";
import type { OverlayCoord } from "./OverlayCanvas";
import type { ReplayTrade } from "./types";

const ctxStub = () => ({
  save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  setLineDash: vi.fn(), fillText: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  clearRect: vi.fn(), setTransform: vi.fn(),
  canvas: {},
}) as unknown as CanvasRenderingContext2D;

const coord = (tx: number | null = 10, px: number | null = 100): OverlayCoord => ({
  timeToX: (t: number) => (tx == null ? null : t * 10),
  priceToY: (p: number) => (px == null ? null : p * 10),
  width: 400,
  height: 300,
});

const trade: ReplayTrade = {
  time: 1000, exit_time: 2000, side: "LONG", kind: "inv",
  entry: 100, sl: 90, tp: 130, exit: 130, result: "TP", pnl: 30, rr: 3,
};

describe("ZONE_STYLE", () => {
  it("covers every zone kind", () => {
    expect(Object.keys(ZONE_STYLE).sort()).toEqual(
      ["demand", "fvg-bear", "fvg-bull", "ifvg", "lrl", "supply"].sort(),
    );
  });
});

describe("rrGeometry", () => {
  it("returns null when coordinates are missing", () => {
    expect(rrGeometry(coord(null), trade)).toBeNull();
    expect(rrGeometry(coord(10, null), trade)).toBeNull();
  });
  it("omits reward line for trail (tp null) but keeps geometry", () => {
    const g = rrGeometry(coord(), { ...trade, tp: null });
    expect(g).not.toBeNull();
    expect(g!.yTp).toBeNull();
  });
  it("computes left/width from time range", () => {
    let n = 0;
    const c: OverlayCoord = {
      timeToX: (t) => (n++, t === 1000 ? 20 : 120),
      priceToY: () => 100, width: 400, height: 300,
    };
    const g = rrGeometry(c, trade);
    expect(g!.left).toBe(20);
    expect(g!.width).toBe(100);
    expect(n).toBeGreaterThan(0);
  });
});

describe("drawRiskReward", () => {
  it("returns false without coordinates, true with paint calls otherwise", () => {
    expect(drawRiskReward(ctxStub(), coord(null), trade)).toBe(false);
    const ctx = ctxStub();
    expect(drawRiskReward(ctx, coord(), trade)).toBe(true);
    expect(ctx.fillRect).toHaveBeenCalled();
  });
  it("skips zero-height BE risk band without crashing", () => {
    const ctx = ctxStub();
    expect(drawRiskReward(ctx, coord(), { ...trade, sl: 100, result: "SL", pnl: 0, rr: 0 })).toBe(true);
  });
});

describe("drawZones", () => {
  it("draws zones + trends, skips missing coords", () => {
    const ctx = ctxStub();
    const n = drawZones(ctx, coord(), [
      { kind: "supply", t1: 1, t2: 2, top: 10, bottom: 9, label: "SUPPLY" },
      { kind: "ifvg", t1: 1, t2: 2, top: 10, bottom: 9 },
    ], [{ t1: 1, p1: 9, t2: 2, p2: 10 }]);
    expect(n).toBe(3);
    expect(drawZones(ctxStub(), coord(null), [
      { kind: "demand", t1: 1, t2: 2, top: 10, bottom: 9 },
    ])).toBe(0);
  });
  it("labels the zone", () => {
    const ctx = ctxStub();
    drawZoneBox(ctx, coord(), 1, 2, 10, 9, "red", "red", "SUPPLY");
    expect(ctx.fillText).toHaveBeenCalledWith("SUPPLY", expect.any(Number), expect.any(Number));
  });
});

describe("tradeMarkers", () => {
  it("marks long entry below, short above", () => {
    expect(tradeMarkers(trade)[0].kind).toBe("entry-long");
    expect(tradeMarkers({ ...trade, side: "SHORT" })[0].kind).toBe("entry-short");
  });
  it("detects BE when sl == entry, TRAIL result, else SL", () => {
    expect(tradeMarkers({ ...trade, sl: 100, result: "SL", pnl: 0, rr: 0 })[1].kind).toBe("exit-be");
    expect(tradeMarkers({ ...trade, result: "TRAIL" })[1].kind).toBe("exit-trail");
    expect(tradeMarkers({ ...trade, result: "SL", pnl: -10, rr: -1 })[1].kind).toBe("exit-sl");
    expect(tradeMarkers(trade)[1].kind).toBe("exit-tp");
  });
});
