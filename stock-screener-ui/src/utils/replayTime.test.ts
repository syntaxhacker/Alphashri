import { describe, expect, it } from "vitest";
import { orRangeLabel } from "./replayTime";

// 2026-09-02 09:30:00 IST = 04:00:00 UTC
const T0 = Date.UTC(2026, 8, 2, 4, 0, 0) / 1000;

describe("orRangeLabel", () => {
  it("formats the OR window in IST", () => {
    expect(orRangeLabel(T0, 15)).toBe("09:30–09:45 IST");
  });

  it("formats other lengths", () => {
    expect(orRangeLabel(T0, 5)).toBe("09:30–09:35 IST");
    expect(orRangeLabel(T0, 30)).toBe("09:30–10:00 IST");
  });
});
