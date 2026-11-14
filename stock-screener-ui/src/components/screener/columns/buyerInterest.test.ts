import { describe, it, expect } from "vitest";
import { createComponent } from "solid-js";
import { render } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { getBuyerInterestColumns } from "./buyerInterest";
import { cellOf, cellText, fmtOf, expectSymbolFirstSectorLast } from "./columnTestFixtures";

const fmt = (key: string) => fmtOf(getBuyerInterestColumns, key);

describe("buyerInterest columns", () => {
  it("7 columns", () => expect(getBuyerInterestColumns().length).toBe(7));
  it("symbol first sector last", () => {
    expectSymbolFirstSectorLast(getBuyerInterestColumns());
  });

  describe("touched_52w badge", () => {
    it.each([
      [true, "Yes"],
      [false, "No"],
    ])("touched %s -> %s", (v, exp) => expect(cellText(() => fmt("touched_52w")(v, {}))).toBe(exp));
    it("true with last_touched -> tooltip carrying the date", () => {
      const iso = new Date(Date.now() - 86400000).toISOString();
      const cell = cellOf(() => fmt("touched_52w")(true, { last_touched: iso }));
      expect(cell.text).toContain("Yes");
      expect(document.body.querySelector("[aria-label^='Touched on']")).not.toBeNull();
    });
    it("badge cells are centred", () => {
      const result = render(() =>
        createComponent(UIProvider, { children: fmt("touched_52w")(false, {}) }),
      );
      expect((result.container.firstElementChild as HTMLElement).className).toContain(
        "justify-center",
      );
    });
  });

  describe("day_change", () => {
    it.each([
      [1.25, "+1.25%", "success"],
      [-0.75, "-0.75%", "error"],
      [0, "+0.00%", "success"],
    ])("day_change %s", (v, ev, ec) => {
      const cell = cellOf(() => fmt("day_change")(v));
      expect(cell.text).toBe(ev);
      expect(cell.tone).toBe(ec);
    });
    it("NaN -> dash", () => expect(cellText(() => fmt("day_change")(NaN))).toBe("—"));
  });

  describe("volume_m", () => {
    it("null -> 0.00", () => expect(cellText(() => fmt("volume_m")(null))).toBe("0.00"));
    it("12.345 -> 12.35", () => expect(cellText(() => fmt("volume_m")(12.345))).toBe("12.35"));
  });

  describe("recent_return_5d via perfW spread (no emoji, just pct)", () => {
    it("3.2 green", () => {
      const cell = cellOf(() => fmt("recent_return_5d")(3.2));
      expect(cell.text).toBe("+3.2%");
      expect(cell.tone).toBe("success");
    });
    it("-1.5 red", () => {
      const cell = cellOf(() => fmt("recent_return_5d")(-1.5));
      expect(cell.text).toBe("-1.5%");
      expect(cell.tone).toBe("error");
    });
    it("0 red", () => expect(cellOf(() => fmt("recent_return_5d")(0)).tone).toBe("error"));
  });

  it("all sortable", () => getBuyerInterestColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
