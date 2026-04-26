import { describe, expect, it } from "vitest";
import { buildLivePositionMarker, buildLivePositionMarkLines } from "./buildLivePosition";
import type { UnifiedLivePosition } from "./types";

describe("buildLivePositionMarker", () => {
  const createMockPosition = (
    overrides: Partial<UnifiedLivePosition> = {},
  ): UnifiedLivePosition => ({
    entry_price: 100,
    entry_time: "2025-01-15T10:30:00",
    side: "BUY",
    stop_loss: 95,
    take_profit: 110,
    quantity: 1,
    ...overrides,
  });

  it("returns scatter series with correct structure", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "LIVE",
      type: "scatter",
    });
  });

  it("places marker at correct candle index", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 10);
    expect(result[0].data[0].value[0]).toBe(10);
  });

  it("uses entry_price for y value", () => {
    const pos = createMockPosition({ entry_price: 150.5 });
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].value[1]).toBe(150.5);
  });

  it("sets cyan color for marker", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].itemStyle.color).toBe("#00FFFF");
  });

  it("sets white border with width 3", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].itemStyle.borderColor).toBe("#FFFFFF");
    expect(result[0].data[0].itemStyle.borderWidth).toBe(3);
  });

  it("uses triangle symbol for BUY side", () => {
    const pos = createMockPosition({ side: "BUY" });
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].symbol).toBe("triangle");
  });

  it("uses triangleRotated symbol for SELL side", () => {
    const pos = createMockPosition({ side: "SELL" });
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].symbol).toBe("triangleRotated");
  });

  it("sets symbol size to 22", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].symbolSize).toBe(22);
    expect(result[0].symbolSize).toBe(22);
  });

  it("includes trade object in marker data", () => {
    const pos = createMockPosition({ entry_price: 200 });
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].trade).toEqual(pos);
  });

  it("sets isLive flag to true", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].data[0].isLive).toBe(true);
  });

  it("sets high z-index for layering", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarker(pos, 5);
    expect(result[0].z).toBe(10);
  });
});

describe("buildLivePositionMarkLines", () => {
  const createMockPosition = (
    overrides: Partial<UnifiedLivePosition> = {},
  ): UnifiedLivePosition => ({
    entry_price: 100,
    side: "BUY",
    stop_loss: 95,
    take_profit: 110,
    ...overrides,
  });

  it("returns two mark lines", () => {
    const pos = createMockPosition();
    const result = buildLivePositionMarkLines(pos);
    expect(result).toHaveLength(2);
  });

  it("first mark line is stop loss", () => {
    const pos = createMockPosition({ stop_loss: 95 });
    const result = buildLivePositionMarkLines(pos);
    expect(result[0]).toMatchObject({
      yAxis: 95,
      lineStyle: { color: "#FF00FF", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: "SL 95" },
    });
  });

  it("second mark line is take profit", () => {
    const pos = createMockPosition({ take_profit: 110 });
    const result = buildLivePositionMarkLines(pos);
    expect(result[1]).toMatchObject({
      yAxis: 110,
      lineStyle: { color: "#FFFF00", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: "TP 110" },
    });
  });

  it("formats SL and TP labels with prices", () => {
    const pos = createMockPosition({ stop_loss: 98.75, take_profit: 115.25 });
    const result = buildLivePositionMarkLines(pos);
    expect(result[0].label.formatter).toBe("SL 98.75");
    expect(result[1].label.formatter).toBe("TP 115.25");
  });

  it("handles decimal prices", () => {
    const pos = createMockPosition({ stop_loss: 98.5, take_profit: 110.75 });
    const result = buildLivePositionMarkLines(pos);
    expect(result[0].label.formatter).toBe("SL 98.5");
    expect(result[1].label.formatter).toBe("TP 110.75");
  });
});
