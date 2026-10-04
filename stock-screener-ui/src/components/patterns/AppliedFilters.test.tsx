// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import type { PatternDef, PatternFilters } from "@/types/chartPatterns";
import { AppliedFilters, buildAppliedFilterChips } from "./AppliedFilters";

const PATTERNS: PatternDef[] = [
  { pattern_id: "double_bottom", name: "Double Bottom", family: "reversal", direction: "bullish", description: "" },
];

function makeFilters(overrides: Partial<PatternFilters> = {}): PatternFilters {
  return { ...DEFAULT_PATTERN_FILTERS, ...overrides };
}

function r(ui: React.ReactElement) {
  return render(ui, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

afterEach(() => cleanup());

describe("buildAppliedFilterChips", () => {
  test("returns nothing when no filters are applied", () => {
    expect(buildAppliedFilterChips(makeFilters(), PATTERNS)).toEqual([]);
  });

  test("renders pattern ids as readable names", () => {
    const chips = buildAppliedFilterChips(makeFilters({ pattern_id: ["double_bottom"] }), PATTERNS);
    expect(chips).toHaveLength(1);
    expect(chips[0].group).toBe("Pattern");
    expect(chips[0].label).toBe("Double Bottom");
  });

  test("omits symbols and q (already shown inline in the toolbar)", () => {
    const chips = buildAppliedFilterChips(makeFilters({ symbols: ["BSE"], q: "foo" }), PATTERNS);
    expect(chips).toEqual([]);
  });

  test("carries the next value for each active value", () => {
    const chips = buildAppliedFilterChips(makeFilters({ direction: ["bullish", "bearish"] }), PATTERNS);
    const bullish = chips.find((c) => c.id === "direction:bullish");
    expect(bullish?.nextValue).toEqual(["bearish"]);
  });

  test("omits the trendlines chip when the view is both", () => {
    expect(buildAppliedFilterChips(makeFilters({ trendlines: "both" }), PATTERNS)).toEqual([]);
  });

  test("builds family / status chips with readable labels and drop-one nextValue", () => {
    const chips = buildAppliedFilterChips(
      makeFilters({ family: ["reversal", "continuation"], status: ["confirmed"] }),
      PATTERNS,
    );
    expect(chips).toMatchObject([
      { id: "family:reversal", group: "Family", label: "Reversal", key: "family" },
      { id: "family:continuation", group: "Family", label: "Continuation", key: "family" },
      { id: "status:confirmed", group: "Status", label: "Confirmed", key: "status" },
    ]);
    expect(chips[0].nextValue).toEqual(["continuation"]);
    expect(chips[2].nextValue).toEqual([]);
  });

  test("falls back to title case for unknown family and pattern ids", () => {
    const chips = buildAppliedFilterChips(
      makeFilters({ family: ["mystery_family"], pattern_id: ["mystery_pattern"] }),
      PATTERNS,
    );
    expect(chips.find((c) => c.id === "family:mystery_family")?.label).toBe("Mystery Family");
    expect(chips.find((c) => c.id === "pattern_id:mystery_pattern")?.label).toBe(
      "Mystery Pattern",
    );
  });

  test("builds scalar chips for quality / formed / volume / R:R / symbol / base / range", () => {
    const chips = buildAppliedFilterChips(
      makeFilters({
        quality: "textbook",
        formed_within_bars: 5,
        volume_confirmed: true,
        min_rr: 1.5,
        symbol: "RELIANCE",
        min_base_days: 90,
        max_range_pct: 20,
      }),
      PATTERNS,
    );
    expect(chips).toMatchObject([
      { id: "quality:textbook", group: "Quality", label: "Textbook", nextValue: null },
      { id: "formed_within_bars", group: "Formed", label: "within 5 bars", nextValue: null },
      { id: "volume_confirmed", group: "Volume", label: "Confirmed", nextValue: null },
      { id: "min_rr", group: "R:R", label: "≥ 1.5", nextValue: null },
      { id: "symbol:RELIANCE", group: "Symbol", label: "RELIANCE", nextValue: null },
      { id: "min_base_days", group: "Base", label: "≥ 90d", nextValue: null },
      { id: "max_range_pct", group: "Range", label: "≤ 20%", nextValue: null },
    ]);
  });

  test("labels an explicit volume-false chip as Unconfirmed", () => {
    const chips = buildAppliedFilterChips(makeFilters({ volume_confirmed: false }), PATTERNS);
    expect(chips).toMatchObject([{ id: "volume_confirmed", label: "Unconfirmed" }]);
  });

  test("builds a sort chip that resets to confidence, omitted for the default", () => {
    const chips = buildAppliedFilterChips(makeFilters({ sort: "newest" }), PATTERNS);
    expect(chips).toMatchObject([
      { id: "sort:newest", group: "Sort", label: "Newest first", nextValue: "confidence" },
    ]);
    expect(buildAppliedFilterChips(makeFilters({ sort: "confidence" }), PATTERNS)).toEqual([]);
  });
});

describe("AppliedFilters", () => {
  test("renders nothing when no filters are applied", () => {
    const { container } = r(
      <AppliedFilters filters={makeFilters()} patterns={PATTERNS} setFilter={vi.fn()} resetFilters={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("shows a chip per applied filter", () => {
    r(
      <AppliedFilters
        filters={makeFilters({ direction: ["bullish"], quality: "strong", min_rr: 2 })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Direction: Bullish")).toBeInTheDocument();
    expect(screen.getByText("Quality: Strong")).toBeInTheDocument();
    expect(screen.getByText("R:R: ≥ 2")).toBeInTheDocument();
  });

  test("removing an array chip drops only that value", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ direction: ["bullish", "bearish"] })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("patterns-applied-filter-direction:bullish");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(setFilter).toHaveBeenCalledWith("direction", ["bearish"]);
  });

  test("removing a scalar chip clears it", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ quality: "strong" })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("patterns-applied-filter-quality:strong");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(setFilter).toHaveBeenCalledWith("quality", null);
  });

  test("Clear all resets every filter", () => {
    const resetFilters = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ status: ["failed"] })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={resetFilters}
      />,
    );
    fireEvent.click(screen.getByTestId("patterns-applied-clear-all"));
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  test("clicking the trendlines chip resets the view to both", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ trendlines: "none" })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Trendlines: Hidden")).toBeInTheDocument();
    const chip = screen.getByTestId("patterns-applied-filter-trendlines");
    fireEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(setFilter).toHaveBeenCalledWith("trendlines", "both");
  });

  test("shows the TLS/TLR trendline labels", () => {
    r(
      <AppliedFilters
        filters={makeFilters({ trendlines: "support" })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Trendlines: TLS only")).toBeInTheDocument();
    cleanup();
    r(
      <AppliedFilters
        filters={makeFilters({ trendlines: "resistance" })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("Trendlines: TLR only")).toBeInTheDocument();
  });

  test("shows one chip per active filter across all groups", () => {
    r(
      <AppliedFilters
        filters={makeFilters({
          family: ["reversal"],
          pattern_id: ["double_bottom"],
          direction: ["bullish"],
          status: ["confirmed"],
          quality: "strong",
          formed_within_bars: 5,
          volume_confirmed: true,
          min_rr: 2,
          symbol: "RELIANCE",
          min_base_days: 90,
          max_range_pct: 20,
          sort: "newest",
          trendlines: "none",
        })}
        patterns={PATTERNS}
        setFilter={vi.fn()}
        resetFilters={vi.fn()}
      />,
    );
    for (const text of [
      "Family: Reversal",
      "Pattern: Double Bottom",
      "Direction: Bullish",
      "Status: Confirmed",
      "Quality: Strong",
      "Formed: within 5 bars",
      "Volume: Confirmed",
      "R:R: ≥ 2",
      "Symbol: RELIANCE",
      "Base: ≥ 90d",
      "Range: ≤ 20%",
      "Sort: Newest first",
      "Trendlines: Hidden",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  test("removing family / pattern / status chips drops only that value", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({
          family: ["reversal", "continuation"],
          pattern_id: ["double_bottom"],
          status: ["confirmed", "forming"],
        })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("patterns-applied-filter-family:reversal").querySelector(
        ".MuiChip-deleteIcon",
      ) as Element,
    );
    expect(setFilter).toHaveBeenCalledWith("family", ["continuation"]);
    fireEvent.click(
      screen.getByTestId("patterns-applied-filter-pattern_id:double_bottom").querySelector(
        ".MuiChip-deleteIcon",
      ) as Element,
    );
    expect(setFilter).toHaveBeenCalledWith("pattern_id", []);
    fireEvent.click(
      screen.getByTestId("patterns-applied-filter-status:confirmed").querySelector(
        ".MuiChip-deleteIcon",
      ) as Element,
    );
    expect(setFilter).toHaveBeenCalledWith("status", ["forming"]);
  });

  test.each([
    ["formed_within_bars", "patterns-applied-filter-formed_within_bars", "formed_within_bars", null],
    ["volume", "patterns-applied-filter-volume_confirmed", "volume_confirmed", null],
    ["min_rr", "patterns-applied-filter-min_rr", "min_rr", null],
    ["symbol", "patterns-applied-filter-symbol:RELIANCE", "symbol", null],
    ["min_base_days", "patterns-applied-filter-min_base_days", "min_base_days", null],
    ["max_range_pct", "patterns-applied-filter-max_range_pct", "max_range_pct", null],
  ])("removing the %s chip clears it", (_name, testId, key, next) => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({
          formed_within_bars: 5,
          volume_confirmed: true,
          min_rr: 2,
          symbol: "RELIANCE",
          min_base_days: 90,
          max_range_pct: 20,
        })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId(testId).querySelector(".MuiChip-deleteIcon") as Element,
    );
    expect(setFilter).toHaveBeenCalledWith(key, next);
  });

  test("removing the sort chip resets to confidence", () => {
    const setFilter = vi.fn();
    r(
      <AppliedFilters
        filters={makeFilters({ sort: "newest" })}
        patterns={PATTERNS}
        setFilter={setFilter}
        resetFilters={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("patterns-applied-filter-sort:newest").querySelector(
        ".MuiChip-deleteIcon",
      ) as Element,
    );
    expect(setFilter).toHaveBeenCalledWith("sort", "confidence");
  });
});
