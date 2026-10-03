// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternFilters } from "@/types/chartPatterns";
import { PatternFilterRail, type PatternFilterRailProps } from "./PatternFilterRail";

// MUI `<Select>` is unreliable in happy-dom — swap it for a native `<select>`.
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: ({ value, onChange, data = [], "data-testid": testId }: any) => (
      <select
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {(data as Array<{ value: string; label: string }>).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  };
});

const FILTERS: PatternFilters = {
  family: [],
  pattern_id: [],
  direction: [],
  status: [],
  quality: null,
  formed_within_bars: null,
  volume_confirmed: null,
  min_rr: null,
  symbol: null,
  min_base_days: null,
  max_range_pct: null,
  sort: "confidence",
};

function makeProps(overrides: Partial<PatternFilterRailProps> = {}): PatternFilterRailProps {
  return {
    patterns: [
      { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "" },
    ],
    results: [
      {
        id: 1,
        symbol: "IRCON",
        name: null,
        timeframe: "1D",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        family: "reversal",
        direction: "bullish",
        status: "confirmed",
        quality: "strong",
        confidence: 70,
        start_date: "2026-01-01",
        end_date: "2026-02-01",
        start_price: 100,
        end_price: 110,
        breakout_level: 110,
        target: 120,
        stop: 95,
        rr: 2,
        bars_ago: 1,
        volume_confirmed: true,
        trendlines: [],
        notes: "",
      },
      {
        id: 2,
        symbol: "TCS",
        name: null,
        timeframe: "1D",
        pattern_id: "ascending_channel",
        pattern_name: "Ascending Channel",
        family: "continuation",
        direction: "bullish",
        status: "forming",
        quality: "fair",
        confidence: 60,
        start_date: "2026-01-01",
        end_date: "2026-02-01",
        start_price: 100,
        end_price: 110,
        breakout_level: 110,
        target: 120,
        stop: 95,
        rr: 2,
        bars_ago: 2,
        volume_confirmed: false,
        trendlines: [],
        notes: "",
      },
    ],
    filters: { ...FILTERS },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    timeframes: [],
    timeframe: "1D",
    setTimeframe: vi.fn(),
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternFilterRail", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders all control groups", () => {
    r(<PatternFilterRail {...makeProps()} />);
    expect(screen.getByTestId("patterns-filter-rail")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-presets")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-preset-fresh_reversals")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-family-reversal")).toHaveTextContent("Reversal (1)");
    expect(screen.getByTestId("patterns-direction-bullish")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-direction-bearish")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-status-filter-forming")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-formed-within")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-formed-within")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-sort")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-sort-confidence")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-sort-newest")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-min-base")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-max-range")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-volume-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-reset")).toBeInTheDocument();
  });

  test("renders all 19 catalog pattern sub-filter chips", () => {
    r(<PatternFilterRail {...makeProps()} />);
    expect(screen.getAllByTestId(/^patterns-filter-pattern-/)).toHaveLength(19);
    expect(screen.getByTestId("patterns-filter-pattern-ascending_channel")).toHaveTextContent(
      "Ascending Channel (1)",
    );
    expect(screen.getByTestId("patterns-filter-pattern-bull_flag")).toHaveTextContent("Bull Flag (0)");
  });

  test("prefers summary counts for pattern chips beyond the current page", () => {
    const props = makeProps({
      summary: {
        scanned: 500,
        patterns: 312,
        in_view: 312,
        confirmed: 200,
        bullish: 150,
        bearish: 80,
        data_through: "2026-09-26",
        pattern_counts: { bull_flag: 12, falling_wedge: 300 },
        family_counts: { reversal: 300, continuation: 12 },
      },
    });
    r(<PatternFilterRail {...props} />);
    // Not present in `results` (first page) but counted across the whole set.
    expect(screen.getByTestId("patterns-filter-pattern-bull_flag")).toHaveTextContent("Bull Flag (12)");
    // Prefers the summary total over the page-derived count.
    expect(screen.getByTestId("patterns-filter-pattern-falling_wedge")).toHaveTextContent(
      "Falling Wedge (300)",
    );
  });

  test("prefers summary family counts and falls back to page counts per family", () => {
    const props = makeProps({
      summary: {
        scanned: 500,
        patterns: 312,
        in_view: 312,
        confirmed: 200,
        bullish: 150,
        bearish: 80,
        data_through: "2026-09-26",
        pattern_counts: { falling_wedge: 300, ascending_channel: 12 },
        family_counts: { reversal: 300, continuation: 12 },
      },
    });
    r(<PatternFilterRail {...props} />);
    expect(screen.getByTestId("patterns-family-reversal")).toHaveTextContent("Reversal (300)");
    expect(screen.getByTestId("patterns-family-continuation")).toHaveTextContent("Continuation (12)");
    // No summary entry -> falls back to the (zero) page-derived count.
    expect(screen.getByTestId("patterns-family-curve_cup")).toHaveTextContent("Curve & Cup (0)");
  });

  test("falls back to page counts when no summary is provided", () => {
    r(<PatternFilterRail {...makeProps({ summary: null })} />);
    expect(screen.getByTestId("patterns-family-reversal")).toHaveTextContent("Reversal (1)");
    expect(screen.getByTestId("patterns-filter-pattern-ascending_channel")).toHaveTextContent(
      "Ascending Channel (1)",
    );
  });

  test("toggles a specific pattern into pattern_id", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-pattern-ascending_channel"));
    expect(props.setFilter).toHaveBeenCalledWith("pattern_id", ["ascending_channel"]);
  });

  test("removes an already-selected specific pattern", async () => {
    const props = makeProps({ filters: { ...FILTERS, pattern_id: ["ascending_channel"] } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-pattern-ascending_channel"));
    expect(props.setFilter).toHaveBeenCalledWith("pattern_id", []);
  });

  test("toggles family / direction / status filters", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-family-reversal"));
    expect(props.setFilter).toHaveBeenCalledWith("family", ["reversal"]);
    await userEvent.click(screen.getByTestId("patterns-direction-bearish"));
    expect(props.setFilter).toHaveBeenCalledWith("direction", ["bearish"]);
    await userEvent.click(screen.getByTestId("patterns-status-filter-confirmed"));
    expect(props.setFilter).toHaveBeenCalledWith("status", ["confirmed"]);
  });

  test("removes an already-selected family", async () => {
    const props = makeProps({ filters: { ...FILTERS, family: ["reversal"] } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-family-reversal"));
    expect(props.setFilter).toHaveBeenCalledWith("family", []);
  });

  test("changes quality and formed-within", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-quality-select"), "strong");
    expect(props.setFilter).toHaveBeenCalledWith("quality", "strong");
    await userEvent.click(screen.getByTestId("patterns-formed-within-5"));
    expect(props.setFilter).toHaveBeenCalledWith("formed_within_bars", 5);
  });

  test("formed-within presets include 1 and 60", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-formed-within-1"));
    expect(props.setFilter).toHaveBeenCalledWith("formed_within_bars", 1);
    await userEvent.click(screen.getByTestId("patterns-formed-within-60"));
    expect(props.setFilter).toHaveBeenCalledWith("formed_within_bars", 60);
  });

  test("selects the newest-first sort", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-sort-newest"));
    expect(props.setFilter).toHaveBeenCalledWith("sort", "newest");
  });

  test("selects the confidence sort", async () => {
    const props = makeProps({ filters: { ...FILTERS, sort: "newest" } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-sort-confidence"));
    expect(props.setFilter).toHaveBeenCalledWith("sort", "confidence");
  });

  test("toggles volume confirmed and resets", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-volume-confirmed"));
    expect(props.setFilter).toHaveBeenCalledWith("volume_confirmed", true);
    await userEvent.click(screen.getByTestId("patterns-reset"));
    expect(props.resetFilters).toHaveBeenCalledTimes(1);
  });

  test("sets the base-length preset", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-min-base-90"));
    expect(props.setFilter).toHaveBeenCalledWith("min_base_days", 90);
  });

  test("clears the base-length preset back to Any", async () => {
    const props = makeProps({ filters: { ...FILTERS, min_base_days: 90 } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-min-base-any"));
    expect(props.setFilter).toHaveBeenCalledWith("min_base_days", null);
  });

  test("enters a max range percentage", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-max-range")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "20" } });
    expect(props.setFilter).toHaveBeenLastCalledWith("max_range_pct", 20);
  });
});
