// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  direction: [],
  status: [],
  quality: null,
  formed_within_bars: null,
  volume_confirmed: null,
  min_rr: null,
  symbol: null,
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
    ],
    filters: { ...FILTERS },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
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
    expect(screen.getByTestId("patterns-family-reversal")).toHaveTextContent("Reversal (1)");
    expect(screen.getByTestId("patterns-direction-bullish")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-direction-bearish")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-status-filter-forming")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-quality-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-formed-within")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-volume-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-reset")).toBeInTheDocument();
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

  test("toggles volume confirmed and resets", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-volume-confirmed"));
    expect(props.setFilter).toHaveBeenCalledWith("volume_confirmed", true);
    await userEvent.click(screen.getByTestId("patterns-reset"));
    expect(props.resetFilters).toHaveBeenCalledTimes(1);
  });
});
