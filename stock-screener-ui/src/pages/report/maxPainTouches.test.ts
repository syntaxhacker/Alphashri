import { describe, expect, test } from "vitest";
import { MAX_PAIN_TOUCH_TOL, maxPainTouches, type MaxPainPoint } from "./maxPainTouches";

function p(value: number, maxPain: number | null | undefined): MaxPainPoint {
  return { value, maxPain };
}

describe("maxPainTouches", () => {
  test("default tolerance is 10 pts", () => {
    expect(MAX_PAIN_TOUCH_TOL).toBe(10);
    // 22,995 vs 23,000 — the 5.05-pt close that a 5-pt window missed.
    expect(maxPainTouches([p(22995, 23000)])).toHaveLength(1);
  });

  test("exact touch counts as a touch", () => {
    const touches = maxPainTouches([p(25700, 25700)]);
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ index: 0, value: 25700, maxPain: 25700, distance: 0 });
  });

  test("±10 points is the inclusive boundary", () => {
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
});
