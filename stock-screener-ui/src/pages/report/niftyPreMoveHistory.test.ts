import { describe, expect, test } from "vitest";
import { appendPreMove, armedSpans, type PreMovePoint } from "./niftyPreMoveHistory";

const T0 = Date.parse("2026-10-26T13:10:00+05:30");
const step = (i: number) => T0 + i * 10_000;
const pt = (i: number, score: number): PreMovePoint => ({ t: step(i), score, spot: 22_600 + i, comps: [] });

describe("appendPreMove", () => {
  test("dedupes the same timestamp and caps the ring", () => {
    let h: PreMovePoint[] = [];
    h = appendPreMove(h, pt(0, 1));
    h = appendPreMove(h, pt(0, 9));
    expect(h).toHaveLength(1);
    expect(h[0].score).toBe(1);
    for (let i = 1; i < 10; i++) h = appendPreMove(h, pt(i, i), 5);
    expect(h).toHaveLength(5);
    expect(h[4].score).toBe(9);
  });
});

describe("armedSpans", () => {
  test("a single armed read latches for 10 minutes (the 13:10 → 13:19 case)", () => {
    // Armed at 13:10, then the score fades to 3-4 (the put window ages out).
    const points = [pt(0, 5), pt(1, 4), pt(2, 3), pt(3, 4), pt(4, 4)];
    const spans = armedSpans(points);
    expect(spans).toHaveLength(1);
    expect(spans[0].from).toBe(step(0));
    // still open at the last sample: the latch has not expired
    expect(spans[0].to).toBe(step(4));
  });

  test("a collapse to 2 resets immediately", () => {
    const points = [pt(0, 5), pt(1, 4), pt(2, 2), pt(3, 4), pt(4, 6)];
    const spans = armedSpans(points);
    expect(spans).toHaveLength(2);
    expect(spans[0].from).toBe(step(0));
    expect(spans[0].to).toBe(step(2));
    expect(spans[1].from).toBe(step(4));
  });

  test("never armed returns no spans", () => {
    expect(armedSpans([pt(0, 1), pt(1, 3), pt(2, 4)])).toEqual([]);
  });
});
