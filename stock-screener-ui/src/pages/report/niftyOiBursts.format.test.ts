import { describe, expect, test } from "vitest";
import { compact } from "./niftyOiBursts.format";
import type { OiBurst } from "./niftyOiBursts.types";

describe("compact — a missing reading is not a metric", () => {
  test("null, undefined and non-finite readings render an em dash", () => {
    expect(compact(null)).toBe("—");
    expect(compact(undefined)).toBe("—");
    expect(compact(Number.NaN)).toBe("—");
    expect(compact(Number.POSITIVE_INFINITY)).toBe("—");
    expect(compact(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  test("finite values keep their signed format, including a genuine zero", () => {
    expect(compact(0)).toBe("+0");
    expect(compact(60_000)).toBe("+60.0K");
    expect(compact(-1_480_000)).toBe("-1.48M");
    expect(compact(1_500_000)).toBe("+1.50M");
    expect(compact(-999)).toBe("-999");
  });

  test("a wall event with no OI readings prints dashes, not fake zeros", () => {
    const wall: OiBurst = {
      id: "wall-1",
      side: "call",
      t: "14:03",
      baseline: 0,
      score: 0,
      severity: "watch",
      spot: 25_000,
      type: "wall_test",
    };

    expect(wall.delta ?? null).toBeNull();
    expect(compact(wall.delta)).toBe("—");
    expect(compact(wall.cumDoi)).toBe("—");
    expect(compact(wall.tickVol)).toBe("—");
  });
});
