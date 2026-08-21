// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { ReactElement } from "react";

let mockProfileFilters: Record<string, unknown> = {};
let mockProfileMetaById: Record<string, unknown> = {};

vi.mock("../../state", () => {
  const mockSetProfileFilters = vi.fn((f: Record<string, unknown>) => {
    mockProfileFilters = f;
  });
  return {
    get profileFilters() {
      return mockProfileFilters;
    },
    get profileMetaById() {
      return mockProfileMetaById;
    },
    setProfileFilters: mockSetProfileFilters,
    subscribe: vi.fn(() => vi.fn()),
  };
});

vi.mock("../../api", () => ({
  fetchData: vi.fn(),
}));

import {
  ScreenerSidePanel,
  screenerHasSideFilters,
  normalizeSelectFilterOptions,
} from "./ScreenerSidePanel";

const renderWithProvider = (ui: ReactElement) =>
  render(<UIProvider>{ui}</UIProvider>);

const trendingFilters = [
  { key: "min_rsi", label: "Min RSI", type: "number", min: 0, max: 100, default: 30 },
  { key: "trend", label: "Trend", type: "select", options: ["up", "down", "sideways"] },
];

describe("normalizeSelectFilterOptions", () => {
  it("converts numeric options for Mantine Select", () => {
    expect(normalizeSelectFilterOptions([5, 10, 15, 30])).toEqual([
      { value: "5", label: "5" },
      { value: "10", label: "10" },
      { value: "15", label: "15" },
      { value: "30", label: "30" },
    ]);
  });

  it("passes through string options", () => {
    expect(normalizeSelectFilterOptions(["bullish", "bearish"])).toEqual([
      { value: "bullish", label: "bullish" },
      { value: "bearish", label: "bearish" },
    ]);
  });
});

describe("screenerHasSideFilters", () => {
  beforeEach(() => {
    mockProfileMetaById = {};
  });

  it("returns false when profile has no filters", () => {
    mockProfileMetaById = { "52w_high": { filters: [] } };
    expect(screenerHasSideFilters("52w_high")).toBe(false);
  });

  it("returns true when profile has filter defs", () => {
    mockProfileMetaById = { trending: { filters: trendingFilters } };
    expect(screenerHasSideFilters("trending")).toBe(true);
  });
});

describe("ScreenerSidePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileFilters = {};
    mockProfileMetaById = {};
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when profile has no filters", () => {
    mockProfileMetaById = { "52w_high": { filters: [] } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="52w_high"
        screenerOptions={[]}
      />,
    );
    expect(screen.queryByTestId("screener-side-panel")).not.toBeInTheDocument();
  });

  it("renders filter inputs when profile has filters", () => {
    mockProfileMetaById = { trending: { filters: trendingFilters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[]}
      />,
    );
    expect(screen.getByTestId("screener-side-panel")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Min RSI")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("renders number filter with numeric options without crashing", () => {
    mockProfileMetaById = {
      intraday_15m: {
        filters: [
          { key: "min_move_pct", label: "Move % ≥", type: "number", min: 0, max: 20, step: 0.1, default: 0.3 },
        ],
      },
    };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="intraday_15m"
        screenerOptions={[]}
      />,
    );
    expect(screen.getByText("Move % ≥")).toBeInTheDocument();
  });

  it("Apply filters button triggers fetchData", async () => {
      const user = userEvent.setup();
    mockProfileMetaById = { trending: { filters: trendingFilters } };
    renderWithProvider(
      <ScreenerSidePanel
        activeScreener="trending"
        screenerOptions={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /apply filters/i }));
    const api = await import("../../api");
    expect(api.fetchData).toHaveBeenCalledWith("upstox", "intraday", "trending", "manual");
  });
});