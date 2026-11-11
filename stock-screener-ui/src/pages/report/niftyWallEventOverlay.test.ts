import { describe, expect, test } from "vitest";
import { wallEventOverlay } from "./niftyWallEventOverlay";

const TEST_EVENT = {
  type: "wall_test",
  side: "call",
  t: "2026-11-03T11:54:00+05:30",
  strike: 23700,
  target: null,
  spot: 23690,
  label: "CALL WALL 23,700 TESTED",
};

const REJECT = {
  type: "rejection",
  side: "call",
  t: "2026-11-03T12:10:00+05:30",
  strike: 23700,
  target: 23650,
  spot: 23647.7,
  label: "CALL WALL REJECTED 23,700",
};

describe("wallEventOverlay", () => {
  test("maps the 2026-11-03 test + rejection to lines and a marker", () => {
    const out = wallEventOverlay([TEST_EVENT, REJECT]);
    // one line for the tested wall, one for the max-pain target
    expect(out.markLines.map((l) => l.yAxis)).toEqual([23700, 23650]);
    expect(out.markLines[0].label.formatter).toContain("CALL WALL");
    expect(out.markLines[0].lineStyle.type).toBe("dashed");
    expect(out.markLines[1].label.formatter).toContain("TARGET");
    // only the rejection produces a marker; it carries the arrow + label
    expect(out.markers).toHaveLength(1);
    expect(out.markers[0]).toMatchObject({
      time: "2026-11-03T12:10:00+05:30",
      value: 23647.7,
      shape: "arrowDown",
      position: "aboveBar",
      text: "✕ CW 12:10",
    });
  });

  test("dedupes repeated tests of the same wall", () => {
    const out = wallEventOverlay([TEST_EVENT, { ...TEST_EVENT, t: "2026-11-03T11:59:00+05:30" }]);
    expect(out.markLines).toHaveLength(1);
    expect(out.markers).toHaveLength(0);
  });

  test("break and put-wall break produce markers at spot", () => {
    const out = wallEventOverlay([
      { type: "break", side: "call", t: "2026-11-03T13:20:00+05:30", strike: 23700, spot: 23756 },
      { type: "wall_break", side: "put", t: "2026-11-03T14:05:00+05:30", strike: 23500, spot: 23468 },
    ]);
    expect(out.markers.map((m) => m.value)).toEqual([23756, 23468]);
    expect(out.markLines.map((l) => l.label.formatter)).toEqual([
      "CALL WALL 23,700",
      "PUT WALL 23,500",
    ]);
  });

  test("ignores non-wall bursts and malformed levels", () => {
    const out = wallEventOverlay([
      { type: "premium", strike: 23700, t: "2026-11-03T12:00:00+05:30" },
      { type: "wall_test", strike: null, t: "2026-11-03T12:00:00+05:30" },
    ]);
    expect(out.markLines).toHaveLength(0);
    expect(out.markers).toHaveLength(0);
  });
});
