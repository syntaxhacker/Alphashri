// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildMarketColumns } from "./marketColumns";
import {
  applyMarketNarrowLayout,
  MARKET_NARROW_PRIMARY_WIDTH,
  MARKET_NARROW_QUERY,
  MARKET_PRIMARY_IDS,
  narrowMarketColumns,
} from "./marketNarrowLayout";

const ids = (columns: { id: string }[]) => columns.map((col) => col.id);

describe("narrow Market layout", () => {
  it("uses a sub-900px breakpoint", () => {
    expect(MARKET_NARROW_QUERY).toBe("(max-width: 899px)");
  });

  it("leads with symbol, LTP, CHG% and sector, then leaves the rest scrollable", () => {
    const columns = buildMarketColumns();
    const narrow = applyMarketNarrowLayout(narrowMarketColumns(columns));
    expect(ids(narrow).slice(0, 4)).toEqual([...MARKET_PRIMARY_IDS]);
    expect(ids(narrow)).toHaveLength(ids(columns).length);
    expect(ids(narrow)).toContain("name");
    expect(ids(narrow).indexOf("name")).toBeGreaterThan(3);
  });

  it("uses short complete headers that fit their narrow cells", () => {
    const narrow = applyMarketNarrowLayout(narrowMarketColumns(buildMarketColumns()));
    const primary = narrow.slice(0, 4);
    expect(primary.map((col) => col.header)).toEqual(["SYMBOL", "LTP", "CHG%", "SECTOR"]);
    for (const col of primary) {
      // 12px monospace, ~7.6px per uppercase glyph plus dense cell padding.
      expect((col.header as string).length * 7.6 + 12, col.id).toBeLessThanOrEqual(col.size!);
    }
  });

  it("fits the four leading columns in a 390px viewport minus page padding", () => {
    const narrow = applyMarketNarrowLayout(narrowMarketColumns(buildMarketColumns()));
    const primaryWidth = narrow
      .slice(0, 4)
      .reduce((sum, col) => sum + (col.size ?? 0), 0);
    expect(primaryWidth).toBe(MARKET_NARROW_PRIMARY_WIDTH);
    expect(primaryWidth).toBeLessThanOrEqual(358);
  });

  it("keeps the wide column order, labels and sizes untouched", () => {
    const columns = buildMarketColumns();
    expect(ids(narrowMarketColumns(columns, false))).toEqual(ids(columns));
    const applied = applyMarketNarrowLayout(columns, false);
    expect(applied.every((col, i) => col.header === columns[i].header && col.size === columns[i].size)).toBe(true);
    expect(applied.find((col) => col.id === "day_change")?.header).toBe("DAY %");
  });

  it("still works when sector is hidden by a pinned sector filter", () => {
    const columns = buildMarketColumns({ hideSector: true });
    const narrow = applyMarketNarrowLayout(narrowMarketColumns(columns));
    expect(ids(narrow).slice(0, 3)).toEqual(["symbol", "close", "day_change"]);
    expect(ids(narrow)).not.toContain("sector");
  });
});
