// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getColumnsForScreener } from "./columns";
import { narrowMetricColumns, screenerColumnWidths, SCREENER_NARROW_QUERY } from "./narrowLayout";

describe("narrow screener layout", () => {
  it("uses a sub-900px breakpoint", () => {
    expect(SCREENER_NARROW_QUERY).toBe("(max-width: 899px)");
  });

  it("keeps symbol and primary metrics, dropping decorative columns", () => {
    const cols = narrowMetricColumns(getColumnsForScreener("trending"));
    expect(cols.map((col) => col.key)).toEqual(["symbol", "day_change", "upstox_price", "sector"]);
  });

  it("prefers volume over price when a profile has both", () => {
    const cols = narrowMetricColumns(getColumnsForScreener("buyer_interest_enhanced"));
    expect(cols[0].key).toBe("symbol");
    expect(cols.map((col) => col.key)).toContain("volume_m");
    expect(cols.map((col) => col.key)).toContain("sector");
  });

  it("fits every declared narrow column inside a 390px viewport minus page padding", () => {
    for (const id of ["trending", "buyer_interest_enhanced", "near_52w_breakout"]) {
      const cols = narrowMetricColumns(getColumnsForScreener(id));
      const widths = screenerColumnWidths(cols, 358, true);
      const total = [...widths.values()].reduce((sum, width) => sum + width, 0);
      expect(total, id).toBeLessThanOrEqual(358);
      expect(widths.get("symbol"), id).toBeGreaterThanOrEqual(80);
      expect(widths.has("sector"), id).toBe(true);
    }
  });

  it("sizes the wide table to the panel and reserves room for sector values", () => {
    const cols = getColumnsForScreener("trending");
    const widths = screenerColumnWidths(cols, 1166, false);
    const total = [...widths.values()].reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(1166);
    expect(widths.get("sector")).toBeGreaterThanOrEqual(108);
  });
});
