import { describe, expect, it } from "vitest";
import { sortTapeRows } from "./tapeOrder";

interface Row { t?: string; v?: number };

describe("sortTapeRows", () => {
  it("resolves bucketMin from opts with a fallback default", () => {
    expect(sortTapeRows([{ t: "09:15" }], 30, { bucketMin: 30 }).bucketMin).toBe(30);
    expect(sortTapeRows([{ t: "09:15" }], 15).bucketMin).toBe(15);
    expect(sortTapeRows([{ t: "09:15" }], 15, { bucketMin: 0 }).bucketMin).toBe(15);
  });

  it("returns empty ordered for empty input", () => {
    expect(sortTapeRows([], 30, { bucketMin: 30 }).ordered).toEqual([]);
    expect(sortTapeRows([], 15)).toMatchObject({ bucketMin: 15, ordered: [] });
  });

  it("sorts ascending by clock, keeping original order on ties", () => {
    const rows: Row[] = [
      { t: "09:30", v: 3 },
      { t: "09:15", v: 1 },
      { t: "09:15", v: 2 },
      { t: "09:45", v: 4 },
    ];
    const { ordered } = sortTapeRows(rows, 15, { bucketMin: 15 });
    expect(ordered.map((r) => r.v)).toEqual([1, 2, 3, 4]);
  });

  it("puts unparseable timestamps last in input order", () => {
    const rows: Row[] = [
      { t: "09:15", v: 1 },
      { t: "nope", v: 2 },
      { t: "", v: 3 },
      { t: "09:10", v: 4 },
    ];
    const { ordered } = sortTapeRows(rows, 15, { bucketMin: 15 });
    expect(ordered.map((r) => r.v)).toEqual([4, 1, 2, 3]);
  });

  it("does not mutate the input array", () => {
    const rows: Row[] = [{ t: "09:30" }, { t: "09:15" }];
    sortTapeRows(rows, 15, { bucketMin: 15 });
    expect(rows.map((r) => r.t)).toEqual(["09:30", "09:15"]);
  });
});
