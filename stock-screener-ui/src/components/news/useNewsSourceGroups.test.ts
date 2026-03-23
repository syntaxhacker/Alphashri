import { describe, it, expect, vi } from "vitest";
import { getSourceOptions } from "./useNewsSourceGroups";

describe("getSourceOptions", () => {
  it("returns only 'All Sources' when sources array is empty", () => {
    const result = getSourceOptions([]);
    expect(result).toEqual([{ value: "all", label: "All Sources" }]);
  });

  it("returns 'All Sources' plus each source option", () => {
    const sources = [
      { id: "reuters", name: "Reuters" },
      { id: "bloomberg", name: "Bloomberg" },
    ];
    const result = getSourceOptions(sources);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ value: "all", label: "All Sources" });
    expect(result[1]).toEqual({ value: "reuters", label: "Reuters" });
    expect(result[2]).toEqual({ value: "bloomberg", label: "Bloomberg" });
  });

  it("returns 'All Sources' with single source", () => {
    const sources = [{ id: "moneycontrol", name: "Moneycontrol" }];
    const result = getSourceOptions(sources);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ value: "all", label: "All Sources" });
    expect(result[1]).toEqual({ value: "moneycontrol", label: "Moneycontrol" });
  });
});
