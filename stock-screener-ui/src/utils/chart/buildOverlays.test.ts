import { describe, expect, it } from "vitest";
import { buildOverlays } from "./buildOverlays";
import type { UnifiedOverlay } from "./types";

describe("buildOverlays", () => {
  const mockCandles = [
    { time: "2025-01-15T09:30:00", date: "2025-01-15" },
    { time: "2025-01-15T09:31:00", date: "2025-01-15" },
    { time: "2025-01-15T09:32:00", date: "2025-01-15" },
  ];

  const createLineOverlay = (overrides: Partial<UnifiedOverlay> = {}): UnifiedOverlay => ({
    id: "overlay1",
    label: "Test Line",
    type: "line",
    color: "#FF0000",
    levels: [{ value: 100 }],
    showLabel: true,
    ...overrides,
  });

  const identityExtend = (data: (number | null)[]) => data;

  describe("line overlays", () => {
    it("creates line series for line overlay", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("line");
    });

    it("uses overlay label as series name", () => {
      const overlay = createLineOverlay({ label: "My EMA" });
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].name).toBe("My EMA");
    });

    it("uses overlay id as series id", () => {
      const overlay = createLineOverlay({ id: "ema-fast" });
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].id).toBe("ema-fast");
    });

    it("maps level values to candles", () => {
      const overlay = createLineOverlay({ levels: [{ value: 150 }] });
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].data).toEqual([150, 150, 150]);
    });

    it("shows label on line when showLabel is true", () => {
      const overlay = createLineOverlay({ showLabel: true, levels: [{ value: 100 }] });
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].label).toBeDefined();
      expect(result[0].label.show).toBe(true);
      expect(result[0].endLabel).toBeDefined();
    });

    it("hides labels when showLabel is false", () => {
      const overlay = createLineOverlay({ showLabel: false });
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].label).toBeUndefined();
      expect(result[0].endLabel).toBeUndefined();
    });

    it("applies dash pattern when provided", () => {
      const overlay = createLineOverlay({ dash: [6, 3] });
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].lineStyle.type).toEqual([6, 3]);
    });

    it("uses solid line when dash not provided", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].lineStyle.type).toBe("solid");
    });

    it("sets line width to 1", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].lineStyle.width).toBe(1);
    });

    it("does not show symbols on line", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].showSymbol).toBe(false);
    });

    it("does not connect nulls", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].connectNulls).toBe(false);
    });

    it("sets z-index to 5", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].z).toBe(5);
    });

    it("enables tooltip", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].tooltip.show).toBe(true);
    });
  });

  describe("date-based level values", () => {
    it("maps levels with date to specific candles", () => {
      const overlay: UnifiedOverlay = {
        id: "overlay1",
        label: "Test",
        type: "line",
        color: "#FF0000",
        levels: [
          { date: "2025-01-15", value: 200 },
          { date: "2025-01-16", value: 250 },
        ],
      };
      const candles = [
        { time: "2025-01-15T09:30:00", date: "2025-01-15" },
        { time: "2025-01-16T09:30:00", date: "2025-01-16" },
        { time: "2025-01-17T09:00:00", date: "2025-01-17" },
      ];
      const result = buildOverlays([overlay], candles, [], identityExtend);
      expect(result[0].data).toEqual([200, 250, null]);
    });

    it("returns null for dates not in levels", () => {
      const overlay: UnifiedOverlay = {
        id: "overlay1",
        label: "Test",
        type: "line",
        color: "#FF0000",
        levels: [{ date: "2025-01-15", value: 100 }],
      };
      const candles = [
        { time: "2025-01-15T09:30:00", date: "2025-01-15" },
        { time: "2025-01-16T09:30:00", date: "2025-01-16" },
      ];
      const result = buildOverlays([overlay], candles, [], identityExtend);
      expect(result[0].data).toEqual([100, null]);
    });
  });

  describe("box overlays", () => {
    it("creates one line series for box type", () => {
      const overlay: UnifiedOverlay = {
        id: "box1",
        label: "Box",
        type: "box",
        color: "#00FF00",
        levels: [{ value: 100 }],
      };
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result).toHaveLength(1);
    });

    it("creates top line for box", () => {
      const overlay: UnifiedOverlay = {
        id: "box1",
        label: "Box",
        type: "box",
        color: "#00FF00",
        levels: [{ value: 100 }],
      };
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      const topLine = result.find((s) => s.id === "box1_top");
      expect(topLine).toBeDefined();
      expect(topLine.data).toEqual([100, 100, 100]);
    });

    it("sets box lines with lower z-index and transparency", () => {
      const overlay: UnifiedOverlay = {
        id: "box1",
        label: "Box",
        type: "box",
        color: "#00FF00",
        levels: [{ value: 100 }],
      };
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      const topLine = result.find((s) => s.id === "box1_top");
      expect(topLine.z).toBe(4);
      expect(topLine.lineStyle.opacity).toBe(0.5);
      expect(topLine.lineStyle.width).toBe(0.5);
    });

    it("skips box if top value is null", () => {
      const overlay: UnifiedOverlay = {
        id: "box1",
        label: "Box",
        type: "box",
        color: "#00FF00",
        levels: [{ value: null }],
      };
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      // Should return empty array because top value is null
      expect(result).toEqual([]);
    });
  });

  describe("EMA data integration", () => {
    it("adds EMA series when emaData is provided", () => {
      const emaData = [
        { label: "EMA 9", color: "#00FF00", data: [10, 11, 12] },
        { label: "EMA 21", color: "#FF0000", data: [9, 10, 11] },
      ];
      const result = buildOverlays([], mockCandles, [], identityExtend, emaData);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("EMA 9");
      expect(result[1].name).toBe("EMA 21");
    });

    it("extends EMA data when function provided", () => {
      const emaData = [{ label: "EMA", color: "#000", data: [10, null, 12] }];
      const extendFn = (data: (number | null)[]) => data; // identity for simplicity
      const result = buildOverlays([], mockCandles, [], extendFn, emaData);
      expect(result[0].data).toEqual([10, null, 12]);
    });

    it("connects nulls for EMA lines", () => {
      const emaData = [{ label: "EMA", color: "#000", data: [10, null, 12] }];
      const result = buildOverlays([], mockCandles, [], identityExtend, emaData);
      expect(result[0].connectNulls).toBe(true);
    });

    it("sets smooth for EMA lines", () => {
      const emaData = [{ label: "EMA", color: "#000", data: [10, 11, 12] }];
      const result = buildOverlays([], mockCandles, [], identityExtend, emaData);
      expect(result[0].smooth).toBe(true);
    });

    it("sets EMA z-index to 5", () => {
      const emaData = [{ label: "EMA", color: "#000", data: [10, 11, 12] }];
      const result = buildOverlays([], mockCandles, [], identityExtend, emaData);
      expect(result[0].z).toBe(5);
    });

    it("handles empty emaData", () => {
      const result = buildOverlays([], mockCandles, [], identityExtend, []);
      expect(result).toEqual([]);
    });

    it("handles undefined emaData", () => {
      const result = buildOverlays([], mockCandles, [], identityExtend, undefined);
      expect(result).toEqual([]);
    });
  });

  describe("extendSeriesData function", () => {
    it("uses extendSeriesData to transform overlay data", () => {
      const overlay = createLineOverlay({ levels: [{ value: 100 }] });
      const extendFn = (data: (number | null)[]) => data.map((v) => (v !== null ? v * 2 : null));
      const result = buildOverlays([overlay], mockCandles, [], extendFn);
      expect(result[0].data).toEqual([200, 200, 200]);
    });

    it("extends data for holiday gaps scenario", () => {
      const overlay = createLineOverlay({ levels: [{ value: 100 }] });
      const rawCandles = mockCandles;
      const extendFn = (data: (number | null)[]) => {
        // Simulate extension with gaps
        const extended = [...data, null, null];
        return extended;
      };
      const result = buildOverlays([overlay], mockCandles, [], extendFn, undefined, rawCandles);
      expect(result[0].data.length).toBe(5);
    });
  });

  describe("multiple overlays", () => {
    it("combines results from multiple overlays", () => {
      const overlays = [
        createLineOverlay({ id: "line1", label: "Line 1" }),
        createLineOverlay({ id: "line2", label: "Line 2" }),
      ];
      const result = buildOverlays(overlays, mockCandles, [], identityExtend);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Line 1");
      expect(result[1].name).toBe("Line 2");
    });

    it("preserves order", () => {
      const overlays = [
        createLineOverlay({ id: "a", label: "A" }),
        createLineOverlay({ id: "b", label: "B" }),
        createLineOverlay({ id: "c", label: "C" }),
      ];
      const result = buildOverlays(overlays, mockCandles, [], identityExtend);
      expect(result.map((s: any) => s.id)).toEqual(["a", "b", "c"]);
    });
  });

  describe("edge cases", () => {
    it("handles empty overlays array", () => {
      const result = buildOverlays([], mockCandles, [], identityExtend);
      expect(result).toEqual([]);
    });

    it("handles overlay with empty levels", () => {
      const overlay: UnifiedOverlay = {
        id: "empty",
        label: "Empty",
        type: "line",
        color: "#F00",
        levels: [],
      };
      const result = buildOverlays([overlay], mockCandles, [], identityExtend);
      expect(result[0].data).toEqual([null, null, null]);
    });

    it("handles undefined candles", () => {
      const overlay = createLineOverlay();
      const result = buildOverlays([overlay], [], [], identityExtend);
      expect(result[0].data).toEqual([]);
    });
  });
});
