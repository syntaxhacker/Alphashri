import { describe, expect, it } from "vitest";
import { detectFVG, detectIFVG, type Bar } from "./smc";

function bar(time: number, open: number, high: number, low: number, close: number): Bar {
  return { time, open, high, low, close };
}

describe("detectFVG", () => {
  it("detects bullish FVG when low[i] > high[i-2]", () => {
    // classic 3-bar bullish gap: bar0 high 100, bar2 low 102
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99.5),
      bar(2, 99.5, 101, 99, 100.5),
      bar(3, 102, 105, 102, 104),
    ];
    const fvgs = detectFVG(bars);
    expect(fvgs).toHaveLength(1);
    expect(fvgs[0].type).toBe("bull");
    expect(fvgs[0].top).toBe(102);
    expect(fvgs[0].bottom).toBe(100);
    expect(fvgs[0].leftIdx).toBe(0);
    expect(fvgs[0].rightIdx).toBe(2);
    expect(fvgs[0].midIdx).toBe(1);
  });

  it("detects bearish FVG when high[i] < low[i-2]", () => {
    const bars: Bar[] = [
      bar(1, 100, 102, 99, 101),
      bar(2, 101, 101.5, 99.5, 100),
      bar(3, 98, 98, 95, 95.5),
    ];
    const fvgs = detectFVG(bars);
    expect(fvgs).toHaveLength(1);
    expect(fvgs[0].type).toBe("bear");
    expect(fvgs[0].top).toBe(99);
    expect(fvgs[0].bottom).toBe(98);
  });

  it("returns empty when bars < 3", () => {
    expect(detectFVG([])).toEqual([]);
    expect(detectFVG([bar(1, 100, 102, 99, 101)])).toEqual([]);
    expect(detectFVG([bar(1, 100, 102, 99, 101), bar(2, 101, 103, 100, 102)])).toEqual([]);
  });

  it("returns empty when no gap", () => {
    const bars: Bar[] = [
      bar(1, 100, 102, 99, 101),
      bar(2, 101, 103, 100, 102),
      bar(3, 102, 104, 101, 103),
    ];
    expect(detectFVG(bars)).toEqual([]);
  });

  it("detects multiple FVGs in longer series", () => {
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99),
      bar(2, 99, 101, 98.5, 100),
      bar(3, 102, 105, 102, 104), // bull FVG [0,2]
      bar(4, 104, 104, 102, 103),
      bar(5, 101, 101, 97, 98), // bear vs bar 3 => bear FVG present somewhere
    ];
    const fvgs = detectFVG(bars);
    expect(fvgs.length).toBeGreaterThanOrEqual(2);
    expect(fvgs[0].type).toBe("bull");
    expect(fvgs.some((f) => f.type === "bear")).toBe(true);
  });

  it("handles null/undefined gracefully", () => {
    expect(detectFVG(null as unknown as Bar[])).toEqual([]);
    expect(detectFVG(undefined as unknown as Bar[])).toEqual([]);
  });

  it("does not create FVG when gap touches exactly (no strict gap)", () => {
    const bars: Bar[] = [
      bar(1, 100, 102, 99, 101),
      bar(2, 101, 103, 100, 102),
      bar(3, 102, 105, 102, 104), // low[2]=102 high[0]=102 => equal, no gap (needs >)
    ];
    // low[2]=102, high[0]=102 => not > => no bull FVG
    expect(detectFVG(bars)).toEqual([]);
  });

  it("excludes mitigated FVG by default false but marks mitigated when price re-enters", () => {
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99),
      bar(2, 99, 101, 98.5, 100),
      bar(3, 102, 105, 102, 104), // bull FVG 100-102
      bar(4, 104, 104, 99, 100), // close 100 enters gap [100,102] => mitigated
    ];
    const fvgs = detectFVG(bars);
    expect(fvgs[0].mitigated).toBe(true);
  });

  it("preserves data coordinates (times) correctly", () => {
    const bars: Bar[] = [
      bar(1000, 99, 100, 98, 99),
      bar(2000, 99, 101, 98.5, 100),
      bar(3000, 102, 105, 102, 104),
    ];
    const fvgs = detectFVG(bars);
    expect(fvgs[0].leftTime).toBe(1000);
    expect(fvgs[0].rightTime).toBe(3000);
  });
});

describe("detectIFVG", () => {
  it("detects inverted FVG when bullish FVG is broken down by close", () => {
    // isolated: only one bull FVG, second bar range avoids extra FVG creation
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99),
      bar(2, 99.2, 100.2, 98.8, 99.5), // keep overlapping so no extra gap at idx2
      bar(3, 102, 103, 102, 102.5), // bull FVG 100-102 (vs bar1)
      bar(4, 102.5, 102.8, 101.5, 102.2),
      bar(5, 99, 99.5, 97, 98), // close 98 < bottom 100 => invert
    ];
    const fvgs = detectFVG(bars);
    expect(fvgs.some((f) => f.type === "bull")).toBe(true);
    const ifvgs = detectIFVG(bars, fvgs);
    expect(ifvgs.length).toBeGreaterThanOrEqual(1);
    expect(ifvgs[0].type).toBe("bear");
    expect(ifvgs[0].origFvg.type).toBe("bull");
  });

  it("detects inverted FVG when bearish FVG is broken up", () => {
    const bars: Bar[] = [
      bar(1, 100, 102, 99, 101),
      bar(2, 101, 101.5, 99.5, 100),
      bar(3, 98, 98, 95, 95.5), // bear FVG top 99 bottom 98
      bar(4, 95, 96, 94, 95),
      bar(5, 100, 101, 99, 100.5), // close 100.5 > top 99 => invert to bull
    ];
    const fvgs = detectFVG(bars);
    const ifvgs = detectIFVG(bars, fvgs);
    expect(ifvgs[0].type).toBe("bull");
  });

  it("returns empty when no inversion occurs", () => {
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99),
      bar(2, 99, 101, 98.5, 100),
      bar(3, 102, 105, 102, 104),
      bar(4, 104, 104, 103, 103.5),
      bar(5, 105, 106, 104, 105), // stays above
    ];
    const fvgs = detectFVG(bars);
    const ifvgs = detectIFVG(bars, fvgs);
    expect(ifvgs).toEqual([]);
  });

  it("handles null/undefined gracefully", () => {
    expect(detectIFVG(null as unknown as Bar[], [])).toEqual([]);
    expect(detectIFVG([], null as unknown as ReturnType<typeof detectFVG>)).toEqual([]);
    expect(detectIFVG(undefined as unknown as Bar[], undefined as unknown as ReturnType<typeof detectFVG>)).toEqual([]);
  });

  it("wick breach alone does not invert (close required)", () => {
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99),
      bar(2, 99, 101, 98.5, 100),
      bar(3, 102, 105, 102, 104), // bull FVG 100-102
      bar(4, 100, 103, 98, 101), // wick low 98 < 100 but close 101 > bottom => no invert
    ];
    const fvgs = detectFVG(bars);
    const ifvgs = detectIFVG(bars, fvgs);
    expect(ifvgs).toEqual([]);
  });

  it("finds earliest inversion only (one per FVG)", () => {
    const bars: Bar[] = [
      bar(1, 99, 100, 98, 99),
      bar(2, 99.2, 100.2, 98.8, 99.5),
      bar(3, 102, 103, 102, 102.5), // bull
      bar(4, 99, 99.5, 97, 98), // first invert
      bar(5, 98, 99, 96, 97), // second would also invert but should still be 1 per FVG
    ];
    const fvgs = detectFVG(bars).filter((f) => f.type === "bull");
    const ifvgs = detectIFVG(bars, fvgs);
    // each bull FVG should produce at most one invert; total still bounded
    expect(ifvgs.length).toBeLessThanOrEqual(fvgs.length);
    expect(ifvgs[0].invertIdx).toBe(3);
  });
});
