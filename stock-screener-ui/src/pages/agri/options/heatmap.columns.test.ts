// @vitest-environment node
import { describe, expect, it } from "vitest";
import { heatmapColumns } from "./heatmap.columns";

describe("heatmapColumns", () => {
  it("returns sorted, de-duplicated month keys across all rows", () => {
    const byRow = [
      new Map([["2024-03", 1], ["2024-01", 2]]),
      new Map([["2024-02", 3], ["2024-01", 4]]),
    ];
    expect(heatmapColumns(byRow)).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("returns an empty axis when no row has a month", () => {
    expect(heatmapColumns([new Map(), new Map()])).toEqual([]);
  });
});
