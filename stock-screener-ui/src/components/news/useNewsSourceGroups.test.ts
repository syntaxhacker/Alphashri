import { describe, it, expect, vi } from "vitest";
import { getSourceOptions, sortSourceNamesByLatest } from "./useNewsSourceGroups";
import type { NewsItem } from "./news-types";

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

function article(id: string, publishedAt: string): NewsItem {
  return {
    id,
    headline: id,
    description: "",
    source: "src",
    sourceUrl: "https://example.com",
    publishedAt,
    fetchedAt: publishedAt,
  };
}

describe("sortSourceNamesByLatest", () => {
  it("orders sources newest-first by their leading article", () => {
    const grouped = {
      Old: [article("1", "2025-01-01T08:00:00Z")],
      Newest: [article("2", "2025-01-03T08:00:00Z")],
      Middle: [article("3", "2025-01-02T08:00:00Z")],
    };
    expect(sortSourceNamesByLatest(grouped)).toEqual(["Newest", "Middle", "Old"]);
  });

  it("parses each source's timestamp once, not once per sort comparison", () => {
    const grouped: Record<string, NewsItem[]> = {};
    for (let i = 0; i < 24; i += 1) {
      grouped[`source-${i}`] = [article(String(i), new Date(Date.UTC(2025, 0, 1, i)).toISOString())];
    }
    const toTime = vi.fn((iso: string) => new Date(iso).getTime());
    const result = sortSourceNamesByLatest(grouped, toTime);

    // The comparator runs O(n log n) times; parsing in the comparator would
    // call toTime ~2n log n times. Hoisting it caps the count at one per source.
    expect(toTime).toHaveBeenCalledTimes(Object.keys(grouped).length);
    expect(result).toHaveLength(24);
    expect(result[0]).toBe("source-23");
    expect(result[23]).toBe("source-0");
  });

  it("keeps insertion order when every timestamp is missing", () => {
    const grouped = {
      First: [article("1", "")],
      Second: [article("2", "")],
      Third: [article("3", "")],
    };
    expect(sortSourceNamesByLatest(grouped)).toEqual(["First", "Second", "Third"]);
  });
});
