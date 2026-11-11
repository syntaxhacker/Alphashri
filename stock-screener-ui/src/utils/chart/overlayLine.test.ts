import { describe, expect, it } from "vitest";
import { buildOverlayLineSeries } from "./overlayLine";

describe("buildOverlayLineSeries", () => {
  it("paints a shared line scaffold (id/name/data/z/flags)", () => {
    const series = buildOverlayLineSeries({
      id: "ema",
      name: "EMA 9",
      data: [1, 2, null],
      z: 5,
      color: "#ff0000",
    });
    expect(series).toMatchObject({
      id: "ema",
      name: "EMA 9",
      type: "line",
      data: [1, 2, null],
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 5,
      tooltip: { show: true },
    });
  });

  it("defaults line width to 1 and type to solid", () => {
    const series = buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000" });
    expect(series.lineStyle).toMatchObject({ color: "#000", width: 1, type: "solid" });
  });

  it("normalizes a boolean dash (backtest style) to dashed/solid", () => {
    expect(buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000", dash: true }).lineStyle.type).toBe("dashed");
    expect(buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000", dash: false }).lineStyle.type).toBe("solid");
    expect(buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000" }).lineStyle.type).toBe("solid");
  });

  it("passes a string/array dash straight through (buildOverlays style)", () => {
    expect(buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000", dash: "dashed" }).lineStyle.type).toBe("dashed");
    expect(buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000", dash: [6, 3] }).lineStyle.type).toEqual([6, 3]);
  });

  it("applies width/opacity and omits tooltip for box series", () => {
    const series = buildOverlayLineSeries({
      id: "box_top",
      name: "Box",
      data: [100, 100],
      z: 4,
      color: "#00ff00",
      width: 0.5,
      opacity: 0.5,
      dash: true,
      tooltip: false,
    });
    expect(series).toMatchObject({
      id: "box_top",
      type: "line",
      z: 4,
      lineStyle: { color: "#00ff00", width: 0.5, opacity: 0.5, type: "dashed" },
    });
    expect("tooltip" in series).toBe(false);
  });

  it("attaches label/endLabel only when provided", () => {
    const labeled = buildOverlayLineSeries({
      id: "a", name: "A", data: [], z: 5, color: "#000",
      label: { show: true, position: "end" },
      endLabel: { show: true, formatter: "A" },
    });
    expect(labeled.label).toMatchObject({ show: true, position: "end" });
    expect(labeled.endLabel).toMatchObject({ show: true, formatter: "A" });

    const unlabeled = buildOverlayLineSeries({ id: "a", name: "A", data: [], z: 5, color: "#000" });
    expect(unlabeled.label).toBeUndefined();
    expect(unlabeled.endLabel).toBeUndefined();
  });
});
