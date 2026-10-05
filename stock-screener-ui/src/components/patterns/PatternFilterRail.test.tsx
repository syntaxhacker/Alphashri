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
  trendlines: "both",
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

  test("pattern tiles render the reference image when available", () => {
    const props = makeProps({
      images: { ascending_channel: "/api/chart-patterns/image/ascending_channel" },
    });
    r(<PatternFilterRail {...props} />);
    const img = screen.getByTestId("pattern-image-ascending_channel");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/ascending_channel");
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

  test("ignores partial numeric input instead of storing NaN", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-max-range")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "-" } });
    expect(props.setFilter).not.toHaveBeenCalledWith("max_range_pct", expect.anything());
  });

  test("sort newest option renders as Latest formed", () => {
    r(<PatternFilterRail {...makeProps()} />);
    expect(screen.getByTestId("patterns-filter-sort-newest")).toHaveTextContent("Latest formed");
    expect(screen.getByTestId("patterns-filter-sort-confidence")).toHaveTextContent("Confidence");
  });

  test("enters a 52W gap percentage", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-max-52w-gap")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "3" } });
    expect(props.setFilter).toHaveBeenLastCalledWith("max_52w_gap", 3);
  });

  test("clearing the 52W gap input stores null", () => {
    const props = makeProps({ filters: { ...FILTERS, max_52w_gap: 3 } });
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-max-52w-gap")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("max_52w_gap", null);
  });

  test("ignores partial 52W gap input instead of storing NaN", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-max-52w-gap")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "-" } });
    expect(props.setFilter).not.toHaveBeenCalledWith("max_52w_gap", expect.anything());
  });

  test("panel layout renders the 52W gap control", () => {
    r(<PatternFilterRail {...makeProps({ layout: "panel" })} />);
    expect(screen.getByTestId("patterns-filter-max-52w-gap")).toBeInTheDocument();
  });

  test("labels the trendlines view options TLS/TLR", () => {
    r(<PatternFilterRail {...makeProps()} />);
    const select = screen.getByTestId("patterns-filter-trendlines");
    expect(within(select).getByRole("option", { name: "TLS only" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "TLR only" })).toBeInTheDocument();
  });

  test("changes the trendlines view filter", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-filter-trendlines"), "support");
    expect(props.setFilter).toHaveBeenCalledWith("trendlines", "support");
  });

  test("shows the trendlines control in the panel layout", () => {
    r(<PatternFilterRail {...makeProps({ layout: "panel" })} />);
    expect(screen.getByTestId("patterns-filter-trendlines")).toBeInTheDocument();
  });

  test("trendlines select exposes all four labels with the right values", () => {
    r(<PatternFilterRail {...makeProps()} />);
    const select = screen.getByTestId("patterns-filter-trendlines");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => [o.getAttribute("value"), o.textContent])).toEqual([
      ["both", "Both"],
      ["support", "TLS only"],
      ["resistance", "TLR only"],
      ["none", "None"],
    ]);
  });

  test("changing trendlines to resistance / none / both", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const select = screen.getByTestId("patterns-filter-trendlines");
    await userEvent.selectOptions(select, "resistance");
    expect(props.setFilter).toHaveBeenCalledWith("trendlines", "resistance");
    await userEvent.selectOptions(select, "none");
    expect(props.setFilter).toHaveBeenCalledWith("trendlines", "none");
    await userEvent.selectOptions(select, "both");
    expect(props.setFilter).toHaveBeenCalledWith("trendlines", "both");
  });

  test("clicking a preset calls applyFilters with its patch", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-fresh_reversals"));
    expect(props.applyFilters).toHaveBeenCalledWith({
      family: ["reversal"],
      formed_within_bars: 3,
      sort: "newest",
    });
  });

  test("rail layout shows Reset; panel layout hides it", () => {
    r(<PatternFilterRail {...makeProps()} />);
    expect(screen.getByTestId("patterns-reset")).toBeInTheDocument();
    cleanup();
    r(<PatternFilterRail {...makeProps({ layout: "panel" })} />);
    expect(screen.queryByTestId("patterns-reset")).not.toBeInTheDocument();
  });

  test("panel layout renders every control group", () => {
    r(<PatternFilterRail {...makeProps({ layout: "panel" })} />);
    expect(screen.getByTestId("patterns-filter-rail")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-presets")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-family-reversal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-direction-bullish")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-status-filter-forming")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-formed-within")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-sort")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-trendlines")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-min-base")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-max-range")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-volume-confirmed")).toBeInTheDocument();
  });

  test("clearing quality back to Any stores null", async () => {
    const props = makeProps({ filters: { ...FILTERS, quality: "strong" } });
    r(<PatternFilterRail {...props} />);
    fireEvent.change(screen.getByTestId("patterns-quality-select"), { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("quality", null);
  });

  test("formed-within numeric input sets the value", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-formed-within")).getByRole(
      "spinbutton",
    );
    fireEvent.change(input, { target: { value: "10" } });
    expect(props.setFilter).toHaveBeenCalledWith("formed_within_bars", 10);
  });

  test("clearing the formed-within input stores null", () => {
    const props = makeProps({ filters: { ...FILTERS, formed_within_bars: 10 } });
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-formed-within")).getByRole(
      "spinbutton",
    );
    fireEvent.change(input, { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("formed_within_bars", null);
  });

  test("clicking the active formed-within preset clears it", async () => {
    const props = makeProps({ filters: { ...FILTERS, formed_within_bars: 5 } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-formed-within-5"));
    expect(props.setFilter).toHaveBeenCalledWith("formed_within_bars", null);
  });

  test("toggling volume confirmed off stores null", async () => {
    const props = makeProps({ filters: { ...FILTERS, volume_confirmed: true } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-volume-confirmed"));
    expect(props.setFilter).toHaveBeenCalledWith("volume_confirmed", null);
  });

  test("sets the 30-day base-length preset", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-min-base-30"));
    expect(props.setFilter).toHaveBeenCalledWith("min_base_days", 30);
  });

  test("clicking the active base-length preset clears it", async () => {
    const props = makeProps({ filters: { ...FILTERS, min_base_days: 90 } });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-min-base-90"));
    expect(props.setFilter).toHaveBeenCalledWith("min_base_days", null);
  });

  test("clearing the max range input stores null", () => {
    const props = makeProps({ filters: { ...FILTERS, max_range_pct: 20 } });
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-max-range")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("max_range_pct", null);
  });

  test("removes an already-selected direction and status", async () => {
    const props = makeProps({
      filters: { ...FILTERS, direction: ["bullish"], status: ["confirmed"] },
    });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-direction-bullish"));
    expect(props.setFilter).toHaveBeenCalledWith("direction", []);
    await userEvent.click(screen.getByTestId("patterns-status-filter-confirmed"));
    expect(props.setFilter).toHaveBeenCalledWith("status", []);
  });

  test("enters a range-pos percentage", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-min-range-pos")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "80" } });
    expect(props.setFilter).toHaveBeenLastCalledWith("min_range_pos", 80);
  });

  test("clearing the range-pos input stores null", () => {
    const props = makeProps({ filters: { ...FILTERS, min_range_pos: 80 } });
    r(<PatternFilterRail {...props} />);
    const input = within(screen.getByTestId("patterns-filter-min-range-pos")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("min_range_pos", null);
  });

  test("selects the range_pos (Near breakout) sort", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-sort-range_pos"));
    expect(props.setFilter).toHaveBeenCalledWith("sort", "range_pos");
  });

  test("renders the Volume scan inputs", () => {
    r(<PatternFilterRail {...makeProps()} />);
    expect(screen.getByText("Volume scan")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-min-rel-volume")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-min-volume-m")).toBeInTheDocument();
    expect(screen.getByText("Rel vol ≥")).toBeInTheDocument();
    expect(screen.getByText("Volume ≥ M")).toBeInTheDocument();
  });

  test("enters rel-vol and volume thresholds", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const relVol = within(screen.getByTestId("patterns-filter-min-rel-volume")).getByRole("spinbutton");
    fireEvent.change(relVol, { target: { value: "2" } });
    expect(props.setFilter).toHaveBeenLastCalledWith("min_rel_volume", 2);
    const volM = within(screen.getByTestId("patterns-filter-min-volume-m")).getByRole("spinbutton");
    fireEvent.change(volM, { target: { value: "10" } });
    expect(props.setFilter).toHaveBeenLastCalledWith("min_volume_m", 10);
  });

  test("clearing the volume scan inputs stores null", () => {
    const props = makeProps({ filters: { ...FILTERS, min_rel_volume: 1.5, min_volume_m: 5 } });
    r(<PatternFilterRail {...props} />);
    const relVol = within(screen.getByTestId("patterns-filter-min-rel-volume")).getByRole("spinbutton");
    fireEvent.change(relVol, { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("min_rel_volume", null);
    const volM = within(screen.getByTestId("patterns-filter-min-volume-m")).getByRole("spinbutton");
    fireEvent.change(volM, { target: { value: "" } });
    expect(props.setFilter).toHaveBeenCalledWith("min_volume_m", null);
  });

  test("ignores partial volume scan input instead of storing NaN", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    const relVol = within(screen.getByTestId("patterns-filter-min-rel-volume")).getByRole("spinbutton");
    fireEvent.change(relVol, { target: { value: "-" } });
    expect(props.setFilter).not.toHaveBeenCalledWith("min_rel_volume", expect.anything());
    const volM = within(screen.getByTestId("patterns-filter-min-volume-m")).getByRole("spinbutton");
    fireEvent.change(volM, { target: { value: "-" } });
    expect(props.setFilter).not.toHaveBeenCalledWith("min_volume_m", expect.anything());
  });

  test("panel layout renders both volume scan inputs", () => {
    r(<PatternFilterRail {...makeProps({ layout: "panel" })} />);
    expect(screen.getByTestId("patterns-filter-min-rel-volume")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-min-volume-m")).toBeInTheDocument();
  });
});
