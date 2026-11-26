import { describe, expect, test } from "vitest";
import { formatNumber, formatExitReason } from "../../utils/ui-helpers";

describe("formatExitReason", () => {
  test("returns original string for unknown reason", () => {
    expect(formatExitReason("unknown_reason")).toBe("unknown_reason");
    expect(formatExitReason("SQUARE_OFF")).toBe("SQUARE_OFF");
    expect(formatExitReason("")).toBe("");
  });

  test("returns original for partial match that is not exact", () => {
    expect(formatExitReason("targets")).toBe("targets");
    expect(formatExitReason("stop_loss_partial")).toBe("stop_loss_partial");
  });
});

describe("formatNumber", () => {
  test("handles boundary at exactly 1000", () => {
    expect(formatNumber(1000)).toBe("1.0K");
  });
});
