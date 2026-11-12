// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

// These page tests mount the real filter modal (@/ui Autocomplete + Select).
// Under a full-suite run with 8 workers the multi-select interaction can exceed
// the 5s default; the assertions are deterministic, so allow a slower machine.
vi.setConfig({ testTimeout: 20_000 });

// The @/ui Box/Flex/... stubs from src/pages/solidTestStubs.tsx render as
// intrinsic elements; page tests exercise page wiring, not the theme runtime.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const stubbed = await uiLayoutStub(await importOriginal<Record<string, unknown>>());
  // Menu stub: bare pass-throughs with an onSelect-fired button; the
  // suite asserts page wiring, not Menu internals.
  const passthrough = (props: any) => <div>{props.children}</div>;
  const Item = (props: any) => (
    <button
      type="button"
      disabled={props.disabled}
      aria-disabled={props.disabled ? "true" : undefined}
      onClick={() => (props.disabled ? undefined : props.onClick?.(props) ?? props.onSelect?.(props))}
      data-testid={props["data-testid"]}
    >
      {props.children}
    </button>
  );
  const Menu = Object.assign(
    (props: any) => <div data-testid="menu-root">{props.children}</div>,
    {
      Target: passthrough,
      Dropdown: passthrough,
      Item,
      Divider: () => <hr />,
      Label: (props: any) => <span>{props.children}</span>,
    },
  );
  return {
    ...stubbed,
    Menu,
    MenuTarget: passthrough,
    MenuDropdown: passthrough,
    MenuItem: Item,
  };
});

// IndexMembersDrawer pulls its own data path; this suite asserts page
// wiring and filter staging, not the members drawer — render nothing.
vi.mock("@/components/patterns/IndexMembersDrawer", () => ({
  IndexMembersDrawer: () => null,
}));

// @tabler/icons-react ships React memo() components — objects, not functions —
// so Solid's createComponent throws on them. Stub with inline SVGs.
vi.mock("@tabler/icons-react", () => ({
  IconAdjustmentsHorizontal: (props: Record<string, unknown>) => <svg data-testid="icon-adjustments" aria-hidden {...props} />,
  IconDotsVertical: (props: Record<string, unknown>) => <svg data-testid="icon-dots" aria-hidden {...props} />,
}));

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const fetchSymbolChart = vi.fn();
const fetchPatternMatrix = vi.fn();
const fetchPatternHit = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: (...args: unknown[]) => fetchSymbolChart(...args),
  fetchPatternMatrix: (...args: unknown[]) => fetchPatternMatrix(...args),
  fetchPatternHit: (...args: unknown[]) => fetchPatternHit(...args),
}));

const fetchPatternImages = vi.fn();
vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

// Rendered-prop spies for the trendlines-view wiring tests.
const gridTrendlinesViews = vi.hoisted(() => [] as unknown[]);
const fullscreenTrendlinesViews = vi.hoisted(() => [] as unknown[]);
// Records the `overlays` prop per fullscreen render (single-pattern contract:
// the page always passes an empty list so only the active hit is drawn).
const fullscreenOverlays = vi.hoisted(() => [] as unknown[]);

// Faithful stubs: preserve the contract testids the page relies on
// (card buttons incl. expand affordance, fullscreen modal + chart +
// "No chart data") while recording the `trendlinesView` prop.
vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: (props: any) => {
    gridTrendlinesViews.push(props.trendlinesView ?? "both");
    return (
      <div data-testid="patterns-grid" data-trendlines-view={props.trendlinesView ?? "both"}>
        <For each={props.hits as any[]}>
          {(hit: any) => (
            <div>
              <button
                type="button"
                data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
                onClick={() => props.onSelect?.(hit)}
              >
                {hit.symbol} {hit.pattern_name}
              </button>
              <button
                type="button"
                data-testid={`patterns-card-expand-${hit.symbol}-${hit.pattern_id}`}
                aria-label={`Open fullscreen chart for ${hit.symbol} ${hit.pattern_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onExpand?.(hit);
                }}
              >
                expand
              </button>
            </div>
          )}
        </For>
      </div>
    );
  },
}));

// Dense list stub: mirrors the grid contract (row buttons + onSelect) so the
// page tests stay deterministic without mounting the real TanStackTable.
vi.mock("@/components/patterns/PatternListView", () => ({
  PatternListView: (props: any) => (
    <div data-testid="patterns-list">
      <For each={props.hits as any[]}>
        {(hit: any) => (
          <div>
            <button
              type="button"
              data-testid={`patterns-list-row-${hit.symbol}-${hit.pattern_id}`}
              onClick={() => props.onSelect?.(hit)}
            >
              {hit.symbol} {hit.pattern_name}
            </button>
            <span
              data-testid={`patterns-list-tv-${hit.symbol}-wrap`}
              onMouseEnter={() => props.onSymbolPreview?.(hit.symbol)}
              onMouseLeave={() => props.onSymbolPreviewEnd?.(hit.symbol)}
            >
              {hit.symbol}
            </span>
            <button
              type="button"
              data-testid={`patterns-list-chart-${hit.symbol}`}
              onClick={() => props.onSymbolOpen?.(hit.symbol)}
            >
              chart
            </button>
          </div>
        )}
      </For>
    </div>
  ),
}));

vi.mock("@/components/patterns/PatternSymbolMatrix", () => ({
  PatternSymbolMatrix: (props: any) => (
    <div data-testid="patterns-symbol-matrix">
      <span data-testid="matrix-timeframes">{(props.timeframes as string[]).join(",")}</span>
      <For each={props.rows as any[]}>
        {(row: any) => (
          <button
            type="button"
            data-testid={`matrix-row-${row.symbol}`}
            onClick={() => row.best && props.onSelect?.(row.best)}
          >
            {row.symbol}
          </button>
        )}
      </For>
    </div>
  ),
}));

vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: (props: any) => {
    fullscreenTrendlinesViews.push(props.trendlinesView ?? "both");
    fullscreenOverlays.push(props.overlays);
    const docked = () => props.docked ?? false;
    const tfs = () => ((props.timeframes as any[]) ?? []).length > 0 ? (props.timeframes as any[]) : [{ id: props.timeframe, label: props.timeframe }];
    return (
      <Show when={props.opened}>
        <div data-testid={docked() ? "patterns-chart-dock" : "patterns-fullscreen-modal"} data-trendlines-view={props.trendlinesView ?? "both"}>
          <div data-testid="patterns-fullscreen-active-hit">{props.hit?.pattern_name}</div>
          <For each={(props.hits ?? []) as any[]}>
            {(h: any, i: number) => (
              <button
                type="button"
                data-testid={`patterns-fullscreen-list-item-${i()}`}
                onClick={() => props.onSelectHit?.(h)}
              >
                {h.pattern_name}
              </button>
            )}
          </For>
          <Show when={props.onTimeframeChange && props.timeframe != null}>
            <select
              data-testid="patterns-fullscreen-timeframe"
              aria-label="Fullscreen timeframe"
              value={props.timeframe}
              onChange={(e) => props.onTimeframeChange((e.currentTarget as HTMLSelectElement).value)}
            >
              <For each={tfs()}>
                {(tf: any) => (
                  <option value={tf.id}>
                    {tf.label || tf.id}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <Show when={props.loading}>
            <div data-testid="patterns-fullscreen-loading" />
          </Show>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
          <Show when={props.onMaximize}>
            <button type="button" data-testid="patterns-chart-expand" onClick={props.onMaximize}>
              Expand
            </button>
          </Show>
          <Show when={props.onPrev}>
            <button type="button" data-testid="patterns-chart-prev" onClick={props.onPrev}>
              Prev
            </button>
          </Show>
          <Show when={props.onNext}>
            <button type="button" data-testid="patterns-chart-next" onClick={props.onNext}>
              Next
            </button>
          </Show>
          <Show when={props.positionLabel}>
            <div data-testid="patterns-chart-position">{props.positionLabel}</div>
          </Show>
          <div data-testid="patterns-fullscreen-chart" />
          <Show when={((props.candles?.length ?? 0) === 0)}>
            <div>No chart data</div>
          </Show>
        </div>
      </Show>
    );
  },
}));

// Native-select stubs so toolbar wiring is deterministic (the real Select needs popup interaction). Testids + onChange contracts preserved.
vi.mock("@/components/patterns/TimeframeSelect", () => ({
  TimeframeSelect: (props: any) => {
    const selected = () => (Array.isArray(props.value) ? props.value : props.value ? [props.value] : []);
    const source = () =>
      (props.timeframes as any[]).length > 0
        ? (props.timeframes as any[])
        : [{ id: selected()[0] ?? "1D", label: selected()[0] ?? "1D" }];
    return (
      <div data-testid="patterns-timeframe-select">
        <For each={source()}>
          {(tf: any) => (
            <button
              type="button"
              data-testid={`tf-option-${tf.id}`}
              onClick={() => {
                const next = selected().includes(tf.id)
                  ? selected().filter((item: string) => item !== tf.id)
                  : [...selected(), tf.id];
                if (next.length > 0) props.onChange?.(next);
              }}
            >
              {tf.label || tf.id}
            </button>
          )}
        </For>
      </div>
    );
  },
}));

vi.mock("@/components/patterns/LookbackSelect", () => ({
  LookbackSelect: (props: any) => (
    <select
      data-testid="patterns-lookback-select"
      aria-label="Lookback"
      value={props.value == null ? "auto" : String(props.value)}
      onInput={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        props.onChange?.(v === "auto" ? null : Number(v));
      }}
    >
      <option value="auto">Auto</option>
      <option value="250">250</option>
    </select>
  ),
}));

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-26",
    end_date: "2026-09-26",
    start_price: 129.8,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-04-26", price: 129.8 },
        { t: "2026-09-26", price: 112.6 },
      ],
    ],
    notes: "Higher lows into a falling wedge.",
    ...overrides,
  };
}

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

function makeProps(overrides: Partial<PatternsPageProps> = {}): PatternsPageProps {
  return {
    timeframes: [],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [
      { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "…" },
    ],
    timeframe: "1D",
    setTimeframe: vi.fn(),
    selectedTimeframes: ["1D"],
    setSelectedTimeframes: vi.fn(),
    lookbackBars: null,
    setLookbackBars: vi.fn(),
    universe: "nifty500",
    setUniverse: vi.fn(),
    filters: {
      family: [],
      pattern_id: [],
      direction: [],
      status: [],
      quality: null,
      formed_within_bars: null,
      volume_confirmed: null,
      min_rr: null,
      symbol: null,
      symbols: [],
      q: "",
      min_base_days: null,
      max_range_pct: null,
      sort: "confidence",
      trendlines: "both",
    },    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    computeTrendlines: true,
    setComputeTrendlines: vi.fn(),
    customUniverse: "custom",
    selectSymbols: vi.fn(),
    job: null,
    scanning: false,
    queuePosition: null,
    summary: SUMMARY,
    results: [makeHit()],
    total: 1,
    loading: false,
    error: null,
    scan: vi.fn(),
    refresh: vi.fn(),
    forceRefresh: vi.fn(),
    defaultView: "list",
    ...overrides,
  };
}

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

/**
 * Pick an option in a local MultiSelect. The listbox opens on combobox focus,
 * and the option toggles through its checkbox (clicking the bare `li` is inert).
 */

describe("PatternsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridTrendlinesViews.length = 0;
    fullscreenTrendlinesViews.length = 0;
    fullscreenOverlays.length = 0;
    fetchPatternHit.mockResolvedValue(undefined as never);
    fetchPatternImages.mockResolvedValue({
      falling_wedge: "/api/chart-patterns/image/falling_wedge",
    });
    fetchSymbolChart.mockResolvedValue({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [],
      overlays: [
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          trendlines: [[{ t: "2026-06-10", price: 235 }, { t: "2026-09-15", price: 311 }]],
        },
      ],
    });
  });
  afterEach(() => cleanup());

  test("renders all contract regions and testids", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-open-filters")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-view-toggle")).toBeInTheDocument();
    // List is the default dense view; the grid mounts only after toggling.
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-list-row-IRCON-falling_wedge")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("view toggle switches between the dense list and the card grid", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(await screen.findByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("matrix view is the default and renders one row per symbol", async () => {
    fetchPatternMatrix.mockResolvedValue({
      universe: "nifty500",
      timeframes: ["5m", "1D"],
      rows: [
        {
          symbol: "IRCON",
          name: "IRCON International",
          ltp: 110,
          day_change_pct: 1.25,
          timeframes: {
            "1D": {
              direction: "bullish",
              status: "confirmed",
              count: 1,
              confidence: 80,
              patterns: ["Falling Wedge"],
              best_id: 1,
            },
          },
          hits: [makeHit()],
          best: makeHit(),
          hit_count: 1,
        },
      ],
      data_through: "2026-09-30",
    });
    r(<PatternsPage {...makeProps({ defaultView: "matrix" })} />);
    expect(await screen.findByTestId("patterns-symbol-matrix")).toBeInTheDocument();
    expect(await screen.findByTestId("matrix-row-IRCON")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-timeframes")).toHaveTextContent("1D");
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
  });

  test("matrix row click opens the fullscreen chart", async () => {
    fetchPatternMatrix.mockResolvedValue({
      universe: "nifty500",
      timeframes: ["1D"],
      rows: [
        {
          symbol: "IRCON",
          name: null,
          ltp: 110,
          day_change_pct: null,
          timeframes: {},
          hits: [makeHit()],
          best: makeHit(),
          hit_count: 1,
        },
      ],
      data_through: null,
    });
    r(<PatternsPage {...makeProps({ defaultView: "matrix" })} />);
    fireEvent.click(await screen.findByTestId("matrix-row-IRCON"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
  });

  test("docks the chart beside the results and steps with the keyboard", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const first = makeHit({
        id: 11,
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        start_date: "2026-04-26",
      });
      const second = makeHit({
        id: 22,
        symbol: "RELIANCE",
        pattern_id: "rising_wedge",
        pattern_name: "Rising Wedge",
        start_date: "2026-07-01",
      });
      r(<PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

      fireEvent.click(
        screen.getByTestId(/^patterns-list-row-IRCON-falling_wedge/),
      );
      expect(await screen.findByTestId("patterns-chart-dock")).toBeInTheDocument();
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
      expect(screen.getByTestId("patterns-chart-position")).toHaveTextContent("1 / 2");

      fireEvent.click(screen.getByTestId("patterns-chart-next"));
      expect(await screen.findByTestId("patterns-chart-position")).toHaveTextContent("2 / 2");
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent(
        "Rising Wedge",
      );

      // Arrow keys step through the same sequence; the dock stays mounted.
      fireEvent.keyDown(document.body, { key: "ArrowUp" });
      expect(await screen.findByTestId("patterns-chart-position")).toHaveTextContent("1 / 2");
      expect(screen.getByTestId("patterns-chart-dock")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("clicking a list row opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("hovering a symbol previews its chart in the dock before pinning", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const first = makeHit({
        id: 11,
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        start_date: "2026-04-26",
      });
      const second = makeHit({
        id: 22,
        symbol: "RELIANCE",
        pattern_id: "rising_wedge",
        pattern_name: "Rising Wedge",
        start_date: "2026-07-01",
      });
      r(<PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

      fireEvent.mouseEnter(screen.getByTestId(/^patterns-list-tv-IRCON-wrap/));
      expect(
        await screen.findByTestId("patterns-chart-dock", {}, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: true }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("hover does not override a pinned chart", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const first = makeHit({
        id: 11,
        symbol: "IRCON",
        pattern_id: "falling_wedge",
        pattern_name: "Falling Wedge",
        start_date: "2026-04-26",
      });
      const second = makeHit({
        id: 22,
        symbol: "RELIANCE",
        pattern_id: "rising_wedge",
        pattern_name: "Rising Wedge",
        start_date: "2026-07-01",
      });
      r(<PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

      fireEvent.click(screen.getByTestId("patterns-list-chart-IRCON"));
      await waitFor(() => expect(fetchSymbolChart.mock.calls.length).toBeGreaterThanOrEqual(2));
      const before = fetchSymbolChart.mock.calls.length;
      fireEvent.mouseEnter(screen.getByTestId(/^patterns-list-tv-RELIANCE-wrap/));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fetchSymbolChart.mock.calls.length).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("the f shortcut never opens Filters behind an open dialog", async () => {
    r(<PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByTestId("patterns-paste-symbols"));
    expect(await screen.findByTestId("patterns-paste-symbols-input")).toBeInTheDocument();

    // Focus the dialog chrome (not its textarea), then press the page shortcut.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "f" });

    expect(screen.queryByTestId("patterns-filter-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-paste-symbols-input")).toBeInTheDocument();
  });

  test("an empty custom scope cannot launch a scan from the empty state", () => {
    r(
      <PatternsPage
        {...makeProps({
          universe: "custom",
          customUniverse: "custom",
          results: [],
          total: 0,
          loading: false,
        })}
      />,
    );
    expect(screen.getByTestId("patterns-empty-scan")).toBeDisabled();
    expect(screen.getByText(/Custom scope is empty/i)).toBeInTheDocument();
  });

  test("renders symbol filter and results search controls", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-results-search")).toBeInTheDocument();
  });

  test("renders every required stat key", () => {
    r(<PatternsPage {...makeProps()} />);
    for (const key of ["scanned", "patterns", "in_view", "confirmed", "bull_bear", "data_through"]) {
      expect(screen.getByTestId(`patterns-stat-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("patterns-stat-bull_bear")).toHaveTextContent("1 / 0");
  });

  test("shows loading state", () => {
    r(<PatternsPage {...makeProps({ loading: true, results: [], total: 0 })} />);
    expect(screen.getByTestId("patterns-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-empty")).not.toBeInTheDocument();
  });

  test("shows scan progress in the grid while a scan is running", () => {
    r(
      <PatternsPage
        {...makeProps({
          results: [],
          total: 0,
          scanning: true,
          timeframe: "1h",
          job: {
            job_id: "cpj_x",
            universe: "nifty50",
            timeframe: "1h",
            status: "running",
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-progress")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("12 / 50 stocks");
  });

  test("shows empty state with refresh action", async () => {
    const props = makeProps({ results: [], total: 0 });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.refresh).toHaveBeenCalledTimes(1);
  });

  test("empty state offers a scan CTA for the current universe/timeframe", async () => {
    const props = makeProps({ results: [], total: 0, timeframe: "15m", universe: "nifty500" });
    r(<PatternsPage {...props} />);
    const cta = screen.getByTestId("patterns-empty-scan");
    expect(cta).toHaveTextContent("Scan 15m now");
    expect(screen.getByTestId("patterns-empty")).toHaveTextContent("nifty500 · 15m");
    fireEvent.click(cta);
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("clicking a card opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("scan again triggers scan", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-scan-again"));
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("shows the error alert instead of the generic empty copy when error is set", () => {
    r(<PatternsPage {...makeProps({ results: [], total: 0, error: "Scan failed: boom" })} />);
    expect(screen.getByTestId("patterns-error")).toHaveTextContent("Scan failed: boom");
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
  });

  test("keeps the list mounted with a refresh overlay while reloading", () => {
    r(<PatternsPage {...makeProps({ loading: true })} />);
    // Existing results stay visible (no remount churn)…
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    // …with an overlay spinner instead of the full-page loader.
    expect(screen.getByTestId("patterns-refreshing")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-loading")).not.toBeInTheDocument();
  });

  test("TLS/TLR toggle reflects state and calls setComputeTrendlines", async () => {
    const props = makeProps({ computeTrendlines: true });
    r(<PatternsPage {...props} />);
    expect(screen.getByText("TLS/TLR")).toBeInTheDocument();
    const toggle = screen.getByTestId("patterns-compute-trendlines");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(props.setComputeTrendlines).toHaveBeenCalledWith(false);
  });

  test("TLS/TLR toggle renders unchecked when computation is off", () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: false })} />);
    expect(screen.getByTestId("patterns-compute-trendlines")).not.toBeChecked();
  });

  test("stale fetches never overwrite the newer selection", async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    fetchSymbolChart
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    const first = makeHit({ id: 11, symbol: "IRCON", pattern_id: "falling_wedge", pattern_name: "Falling Wedge", start_date: "2026-04-26" });
    const second = makeHit({ id: 22, symbol: "RELIANCE", pattern_id: "rising_wedge", pattern_name: "Rising Wedge", start_date: "2026-07-01" });
    r(<PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    fireEvent.click(screen.getByTestId("patterns-card-RELIANCE-rising_wedge"));
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    // Current request resolves with no candles; the stale one resolves last
    // carrying candles. Without the guard the stale fetch would paint the
    // first hit's candles into the second hit's fullscreen view.
    resolveSecond({ symbol: "RELIANCE", timeframe: "1D", candles: [], overlays: [] });
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge"),
    );
    resolveFirst({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-05-04T18:30:00+00:00", o: 1, h: 1, l: 1, c: 1, v: 1 }],
      overlays: [],
    });
    // Flush the stale promise chain: without the guard it would paint the
    // first hit's candles here and remove "No chart data".
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The newer selection stands: still the second hit, still no chart data.
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge");
    expect(screen.getByText("No chart data")).toBeInTheDocument();
  });
});

describe("PatternsPage toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridTrendlinesViews.length = 0;
    fullscreenTrendlinesViews.length = 0;
    fullscreenOverlays.length = 0;
    fetchPatternImages.mockResolvedValue({});
    fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
  });
  afterEach(() => cleanup());

  test("renders the scan-scope and results-toolbar contract regions", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-scan-scope")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-results-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
  });

  test("toolbar shows timeframe, lookback, filter-results and TLS/TLR controls", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-lookback-select")).toBeInTheDocument();
    // Native input carries the testid (see TextInput htmlInput slot).
    expect(screen.getByTestId("patterns-results-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search results…")).toBeInTheDocument();
    expect(screen.getByText("TLS/TLR")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-compute-trendlines")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
  });

  test("changing the timeframe select calls setSelectedTimeframes", async () => {
    const props = makeProps({
      timeframes: [
        { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
        { id: "1h", label: "1h", minutes: 60, native: true, source_tf: null, max_lookback_days: 365, min_bars: 60 },
      ],
    });
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("tf-option-1h"));
    expect(props.setSelectedTimeframes).toHaveBeenCalledWith(["1D", "1h"]);
  });

  test("shows the index group filter only for the indices universe", () => {
    const indices = r(<PatternsPage {...makeProps({ universe: "indices" })} />);
    expect(screen.getByTestId("patterns-index-group")).toBeInTheDocument();
    indices.unmount();
    r(<PatternsPage {...makeProps({ universe: "nifty500" })} />);
    expect(screen.queryByTestId("patterns-index-group")).not.toBeInTheDocument();
  });

  test("changing the lookback select calls setLookbackBars", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.input(screen.getByTestId("patterns-lookback-select") as HTMLSelectElement, { target: { value: "250" } });
    expect(props.setLookbackBars).toHaveBeenCalledWith(250);
  });

  test("typing in Filter results commits the debounced q filter", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.input(screen.getByTestId("patterns-results-search"), { target: { value: "TCS" } });
    await waitFor(
      () => expect(props.setFilter).toHaveBeenCalledWith("q", "TCS"),
      { timeout: 3000 },
    );
  });

  test("Filters button shows the active-filter count", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, family: ["reversal"], direction: ["bullish"] },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (2)");
  });

  test("Filters button counts the score and breakout floors", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_confidence: 70, min_breakout_score: 60 },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (2)");
  });

  test("results toolbar drops the redundant count label (stats strip owns the count)", () => {
    r(<PatternsPage {...makeProps({ results: [makeHit()], total: 1 })} />);
    const toolbar = screen.getByTestId("patterns-results-toolbar");
    expect(within(toolbar).queryByText("1 patterns")).not.toBeInTheDocument();
    expect(within(toolbar).queryByText("Patterns")).not.toBeInTheDocument();
    // The stats strip still reports the pattern count.
    expect(screen.getByTestId("patterns-stat-patterns")).toHaveTextContent("1");
  });

  test("Filters button counts a non-default 10d avg volume filter", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_avg_volume_10d: 200 },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (1)");
  });

  test("Filters button ignores the default 10d avg volume floor", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_avg_volume_10d: 150 },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
    expect(screen.getByTestId("patterns-open-filters")).not.toHaveTextContent("(");
  });

  test("Filters button shows no count when filters are pristine", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
    expect(screen.getByTestId("patterns-open-filters")).not.toHaveTextContent("(");
  });

  test("Force refresh button calls forceRefresh", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    fireEvent.click(await screen.findByTestId("patterns-force-refresh"));
    expect(props.forceRefresh).toHaveBeenCalledTimes(1);
  });

  test("Force refresh button is disabled while scanning", async () => {
    r(<PatternsPage {...makeProps({ scanning: true })} />);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    // Overflow items are menu items: the menu signals disabled items via aria-disabled
    // (pointer-events:none blocks real clicks, same as the old button).
    expect(await screen.findByTestId("patterns-force-refresh")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("shows the cached chip with age + force re-run when the job was reused", async () => {
    const props = makeProps({
      job: {
        job_id: "cpj_reused",
        universe: "nifty500",
        timeframe: "1D",
        status: "completed" as const,
        total: 500,
        done: 500,
        failed: 0,
        skipped: 0,
        queue_position: null,
        started_at: null,
        finished_at: null,
        data_through: "2026-09-30",
        error: null,
        reused: true,
        reused_from: "cpj_prev",
        reused_age_sec: 720,
        reused_finished_at: null,
      },
      scanning: false,
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent("Cached · 12 min ago");
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("through 2026-09-30");
    // The chip's own Force re-run action re-runs fresh.
    fireEvent.click(screen.getByTestId("patterns-scan-reused-force"));
    expect(props.forceRefresh).toHaveBeenCalledTimes(1);
    // The existing Force refresh action stays available in the overflow menu.
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    expect(await screen.findByTestId("patterns-force-refresh")).toBeInTheDocument();
  });

  test("reused chip tooltip lists the cache layers", () => {
    r(
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_reused",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            reused: true,
            reused_from: "cpj_prev",
            reused_age_sec: 720,
            reused_finished_at: null,
            provenance: {
              scan_reused: true,
              candles_cached: 480,
              candles_fetched: 20,
              prefilter_dropped: 12,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />,
    );
    // The wrapper surfaces a string tooltip title as its aria-label.
    expect(screen.getByLabelText(/Scan reused: yes \(12 min ago\)/)).toHaveAttribute(
      "aria-label",
      "Scan reused: yes (12 min ago) — data unchanged · Candle cache: 480 cached / 20 fetched · Prefilter dropped: 12 · Detector v3 · Data as of 2026-09-30",
    );
  });

  test("shows the fresh chip for a freshly computed completed scan", () => {
    r(
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_fresh",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            provenance: {
              scan_reused: false,
              candles_cached: 0,
              candles_fetched: 500,
              prefilter_dropped: 0,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Fresh");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toHaveTextContent("through 2026-09-30");
    expect(
      screen.getByLabelText("Scan reused: no — freshly computed · Candle cache: 0 cached / 500 fetched · Prefilter dropped: 0 · Detector v3 · Data as of 2026-09-30"),
    ).toBeInTheDocument();
  });

  test("shows the mixed cache share when candles were partly cached", () => {
    r(
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_mixed",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            provenance: {
              scan_reused: false,
              candles_cached: 335,
              candles_fetched: 165,
              prefilter_dropped: null,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />,
    );
    // 335/500 → 67%.
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Cache 67%");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
  });

  test("no cache chip while a scan is active", () => {
    r(
      <PatternsPage
        {...makeProps({
          scanning: true,
          job: {
            job_id: "cpj_run",
            universe: "nifty500",
            timeframe: "1D",
            status: "running" as const,
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />,
    );
    expect(screen.queryByTestId("patterns-scan-status")).not.toBeInTheDocument();
  });

  test("no reused notice for a freshly computed scan", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
  });
});

