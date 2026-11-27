// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatternHitDTO } from "@/types/chartPatterns";
import type { ChartPatternsState } from "@/state/chartPatterns";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { HOME_PANELS } from "../../../pages/home/homePanels";
import { WINDOW_PANEL_TYPES } from "../panelRegistry";

const ctl = vi.hoisted(() => ({
  state: null as unknown as ChartPatternsState,
  dockOpen: vi.fn(),
  triggerScan: vi.fn(),
}));

vi.mock("@/state/chartPatterns", () => ({
  getChartPatternsState: () => ctl.state,
  subscribe: () => () => {},
  ensureCatalogLoaded: vi.fn(() => Promise.resolve()),
  selectTimeframe: vi.fn(),
  selectUniverse: vi.fn(),
  triggerScan: ctl.triggerScan,
  setTimeframe: vi.fn(),
  setFilter: vi.fn(),
  resetFilters: vi.fn(),
  forceRefresh: vi.fn(),
}));

vi.mock("../../common/symbolDockContext", () => ({
  useSymbolDock: () => ({
    open: ctl.dockOpen,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  }),
}));

// The table has its own suite. A DOM double keeps this test about the panel's
// data wiring and the row-click -> dock contract, not the TanStackTable.
vi.mock("../../patterns/PatternListView", () => ({
  PatternListView: (
    props: Pick<PatternHitDTO, never> & {
      hits: PatternHitDTO[];
      onSelect?: (hit: PatternHitDTO) => void;
    },
  ) => (
    <div data-testid="patterns-list">
      {props.hits.map((hit) => (
        <button
          type="button"
          data-testid={`patterns-row-${hit.symbol}`}
          onClick={() => props.onSelect?.(hit)}
        >
          {hit.symbol} {hit.pattern_name}
        </button>
      ))}
    </div>
  ),
}));

import { PATTERN_RESULTS_PANEL } from "./patternResults";

const HIT = {
  id: 1,
  symbol: "RELIANCE",
  pattern_id: "consolidation",
  pattern_name: "Consolidation",
  confidence: 88.4,
} as PatternHitDTO;

function makeState(overrides: Partial<ChartPatternsState> = {}): ChartPatternsState {
  return {
    timeframes: [
      {
        id: "1D",
        label: "1 day",
        minutes: 1440,
        native: true,
        source_tf: null,
        max_lookback_days: 400,
        min_bars: 20,
      },
      {
        id: "1h",
        label: "1 hour",
        minutes: 60,
        native: true,
        source_tf: null,
        max_lookback_days: 80,
        min_bars: 30,
      },
    ],
    universes: [
      { id: "nifty50", label: "Nifty 50", count: 50 },
      { id: "nifty500", label: "Nifty 500", count: 500 },
    ],
    defaultUniverse: "nifty50",
    patterns: [],
    families: [],
    timeframe: "1D",
    selectedTimeframes: ["1D"],
    universe: "nifty50",
    lookbackBars: null,
    filters: { sort: "confidence" } as ChartPatternsState["filters"],
    job: null,
    scanning: false,
    summary: null,
    results: [],
    total: 0,
    dataThrough: null,
    streaming: false,
    lastScanAsOf: null,
    lastScanFrom: null,
    selectedSymbol: null,
    detail: null,
    detailChart: null,
    loading: false,
    error: null,
    ...overrides,
  };
}

function renderPanel() {
  return renderWithProviders(() =>
    PATTERN_RESULTS_PANEL.mount(() => ({}), { data: () => undefined, commands: {} }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ctl.state = makeState();
});

afterEach(() => cleanup());

describe("patterns.results window panel", () => {
  it("(a) renders a symbol cell from the store results", () => {
    ctl.state = makeState({ results: [HIT], total: 1 });
    renderPanel();

    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-row-RELIANCE")).toHaveTextContent("RELIANCE");
  });

  it("(b) no results renders the explicit empty state", () => {
    renderPanel();

    expect(screen.getByTestId("patterns-results-empty")).toHaveTextContent("No patterns");
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-results-loading")).not.toBeInTheDocument();
  });

  it("(empty-action) the empty state offers an enabled Scan button", () => {
    renderPanel();

    const action = screen.getByTestId("patterns-results-empty-action");
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(ctl.triggerScan).toHaveBeenCalledTimes(1);
  });

  it("(c) a store error renders its message, not a blank box", () => {
    ctl.state = makeState({ error: "scan exploded" });
    renderPanel();

    expect(screen.getByTestId("patterns-results-error")).toHaveTextContent("scan exploded");
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
  });

  it("(d) scanning with no results renders the loading state", () => {
    ctl.state = makeState({ scanning: true });
    renderPanel();

    expect(screen.getByTestId("patterns-results-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-results-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
  });

  it("(e) timeframe and universe selects are populated from the store registries", () => {
    renderPanel();

    const timeframe = screen.getByTestId("patterns-results-timeframe").querySelector("select")!;
    const universe = screen.getByTestId("patterns-results-universe").querySelector("select")!;
    const labels = (el: HTMLSelectElement) => Array.from(el.options).map((o) => o.textContent);

    expect(labels(timeframe)).toContain("1 day");
    expect(labels(timeframe)).toContain("1 hour");
    expect(labels(universe)).toContain("Nifty 50");
    expect(labels(universe)).toContain("Nifty 500");
  });

  it("(f) a row click opens the symbol in the chart dock", () => {
    ctl.state = makeState({ results: [HIT], total: 1 });
    renderPanel();

    fireEvent.click(screen.getByTestId("patterns-row-RELIANCE"));
    expect(ctl.dockOpen).toHaveBeenCalledWith("RELIANCE");
  });

  it("(asof) shows the data-through and as-of label when present", () => {
    ctl.state = makeState({ dataThrough: "2026-09-30", lastScanAsOf: "2026-09-30T14:30" });
    renderPanel();

    const label = screen.getByTestId("patterns-results-asof");
    expect(label).toHaveTextContent("Data through 2026-09-30");
    expect(label).toHaveTextContent("As of 2026-09-30T14:30");
  });

  it("(g) is registered in the window registry and the home picker", () => {
    expect(WINDOW_PANEL_TYPES.has("patterns.results")).toBe(true);
    expect(HOME_PANELS.map((spec) => spec.id)).toContain("patterns.results");
  });
});
