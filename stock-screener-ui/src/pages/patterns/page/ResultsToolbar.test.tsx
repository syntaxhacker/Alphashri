// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import type { PatternFilters } from "@/types/chartPatterns";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});

vi.mock("@/components/patterns/SymbolFilter", () => ({
  SymbolFilter: () => <div data-testid="symbol-filter" />,
}));
vi.mock("@/components/patterns/TimeframeSelect", () => ({
  TimeframeSelect: () => <div data-testid="timeframe-select" />,
}));
vi.mock("@/components/patterns/LookbackSelect", () => ({
  LookbackSelect: () => <div data-testid="lookback-select" />,
}));
vi.mock("@/components/patterns/ResultsSearch", () => ({
  ResultsSearch: () => <div data-testid="results-search" />,
}));
vi.mock("@/components/patterns/ReplayScanControl", () => ({
  ReplayScanControl: () => <div data-testid="replay-scan-control" />,
}));

import { ResultsToolbar, type ResultsToolbarProps } from "./ResultsToolbar";

function props(): ResultsToolbarProps {
  const noop = vi.fn();
  return {
    filters: () => ({} as PatternFilters),
    setFilter: noop,
    selectSymbols: noop,
    timeframes: () => [],
    timeframe: () => "1D",
    tfSelection: () => ["1D"],
    setTimeframe: noop,
    lookbackBars: () => null,
    setLookbackBars: noop,
    scanReplay: noop,
    replayAsOf: () => null,
    view: () => "matrix",
    changeView: noop,
    universe: () => "nifty500",
    indexGroup: () => "all",
    changeIndexGroup: noop,
    activeFilterCount: () => 0,
    activeFilterGroups: () => [],
    openFilters: noop,
    copyCsv: noop,
    copySymbols: noop,
    resultCount: () => 0,
    rawResultCount: () => 0,
    scanning: () => false,
    emptyCustom: () => false,
    forceRefresh: noop,
    copyMsg: () => null,
    copyFailed: () => false,
    streaming: () => false,
    total: () => 0,
  };
}

describe("ResultsToolbar narrow layout", () => {
  afterEach(() => cleanup());

  test("keeps both control rows on one reachable scroll line", () => {
    render(() => <ResultsToolbar {...props()} />);
    const region = screen.getByTestId("patterns-results-toolbar-scroll-region");
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
    expect(region).toContainElement(screen.getByTestId("patterns-results-toolbar"));
    expect(region).toContainElement(screen.getByTestId("patterns-results-view-toolbar"));
    const line = region.firstElementChild as HTMLElement;
    expect(line.className).toContain("w-max");
    expect(line.className).toContain("flex-nowrap");
  });

  test("shows a narrow-only sideways cue without hiding the controls", () => {
    render(() => <ResultsToolbar {...props()} />);
    const cue = screen.getByTestId("patterns-results-toolbar-scroll-cue");
    expect(cue).toHaveTextContent("Scroll sideways →");
    expect(cue.className).toContain("md:hidden");
    expect(screen.getByTestId("patterns-open-filters")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-view-toggle")).toBeInTheDocument();
  });

  test("wraps every control on a phone with no sideways cue", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      render(() => <ResultsToolbar {...props()} />);
      expect(screen.queryByTestId("patterns-results-toolbar-scroll-region")).toBeNull();
      expect(screen.queryByTestId("patterns-results-toolbar-scroll-cue")).toBeNull();
      expect(screen.getByTestId("patterns-results-toolbar").parentElement?.className).toContain(
        "flex-col",
      );
      for (const id of ["symbol-filter", "timeframe-select", "lookback-select", "patterns-open-filters", "patterns-view-toggle"]) {
        expect(screen.getByTestId(id)).toBeInTheDocument();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
