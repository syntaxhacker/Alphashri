import { describe, expect, test } from "vitest";
import { MAX_PAIN_TOUCH_TOL, maxPainTouches, maxPainTouchTol, type MaxPainPoint } from "./maxPainTouches";

function p(value: number, maxPain: number | null | undefined): MaxPainPoint {
  return { value, maxPain };
}

function makeReport(spot: number, strikeStep: number): { spot: number; strikes: Array<{ strike: number }> } {
  const strikes: Array<{ strike: number }> = [];
  for (let i = -2; i <= 2; i++) {
    strikes.push({ strike: spot + i * strikeStep });
  }
  return { spot, strikes };
}

describe("maxPainTouches", () => {
  test("default tolerance is 10 pts (NIFTY legacy)", () => {
    expect(MAX_PAIN_TOUCH_TOL).toBe(10);
    // 22,995 vs 23,000 — the 5.05-pt close that a 5-pt window missed.
    expect(maxPainTouches([p(22995, 23000)])).toHaveLength(1);
  });

  test("exact touch counts as a touch", () => {
    const touches = maxPainTouches([p(25700, 25700)]);
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ index: 0, value: 25700, maxPain: 25700, distance: 0 });
  });

  test("±10 points is the inclusive boundary (NIFTY default)", () => {
    const rows = [p(25710, 25700), p(25690, 25700), p(25711, 25700), p(25689, 25700)];
    const touches = maxPainTouches(rows);
    expect(touches.map((t) => t.value)).toEqual([25710, 25690]);
    expect(touches.map((t) => t.distance)).toEqual([10, 10]);
  });

  test("custom tolerance widens / narrows the window", () => {
    expect(maxPainTouches([p(25710, 25700)], 20)).toHaveLength(1);
    expect(maxPainTouches([p(25710, 25700)], 5)).toHaveLength(0);
  });

  test("missing max pain never touches", () => {
    expect(maxPainTouches([p(25700, null), p(25700, undefined), p(25700, NaN)])).toHaveLength(0);
  });

  test("multiple touches keep source order and original index", () => {
    const rows = [p(25700, 25700), p(25800, 25600), p(25698, 25700), p(25702, 25700)];
    const touches = maxPainTouches(rows);
    expect(touches.map((t) => t.index)).toEqual([0, 2, 3]);
  });

  test("no touch when every point is out of range", () => {
    expect(maxPainTouches([p(25750, 25700), p(25800, 25700)])).toHaveLength(0);
  });

  test("non-finite prices are ignored", () => {
    expect(maxPainTouches([p(NaN, 25700), p(Infinity, 25700)])).toHaveLength(0);
  });

  // --- Report-derived tolerance (new) ---

  test("maxPainTouchTol derives 20% of strike step (NIFTY: 50 -> 10)", () => {
    const report = makeReport(22_800, 50);
    expect(maxPainTouchTol(report)).toBe(10);
  });

  test("maxPainTouchTol derives 20% of strike step (SENSEX: 100 -> 20)", () => {
    const report = makeReport(79_000, 100);
    expect(maxPainTouchTol(report)).toBe(20);
  });

  test("maxPainTouchTol derives 20% of strike step (RELIANCE: 50 -> 10)", () => {
    const report = makeReport(1_400, 50);
    expect(maxPainTouchTol(report)).toBe(10);
  });

  test("maxPainTouches accepts report-derived tolerance", () => {
    // SENSEX: 100-pt step -> tol=20
    const sensexReport = makeReport(79_000, 100);
    const touches = maxPainTouches([p(79_015, 79_000)], sensexReport);
    expect(touches).toHaveLength(1); // 15 pts away, within 20
    expect(maxPainTouches([p(79_025, 79_000)], sensexReport)).toHaveLength(0); // 25 pts away, outside 20
  });

  test("maxPainTouches with explicit tol still works (backward compat)", () => {
    expect(maxPainTouches([p(25710, 25700)], 20)).toHaveLength(1);
    expect(maxPainTouches([p(25710, 25700)], 5)).toHaveLength(0);
  });

  test("SENSEX fixture: 79k spot, 100-pt step, tol=20", () => {
    const report = makeReport(79_000, 100);
    const tol = maxPainTouchTol(report);
    expect(tol).toBe(20);

    // 15 pts from max pain = touch
    expect(maxPainTouches([p(79_015, 79_000)], report)).toHaveLength(1);
    // 25 pts from max pain = no touch
    expect(maxPainTouches([p(79_025, 79_000)], report)).toHaveLength(0);
  });

  test("RELIANCE fixture: 1.4k spot, 50-pt step, tol=10", () => {
    const report = makeReport(1_400, 50);
    const tol = maxPainTouchTol(report);
    expect(tol).toBe(10);

    expect(maxPainTouches([p(1_405, 1_400)], report)).toHaveLength(1);
    expect(maxPainTouches([p(1_415, 1_400)], report)).toHaveLength(0);
  });

  test("NIFTY fixture: 22.8k spot, 50-pt step, tol=10 (unchanged behavior)", () => {
    const report = makeReport(22_800, 50);
    const tol = maxPainTouchTol(report);
    expect(tol).toBe(10);

    expect(maxPainTouches([p(22_805, 22_800)], report)).toHaveLength(1);
    expect(maxPainTouches([p(22_815, 22_800)], report)).toHaveLength(0);
  });
});