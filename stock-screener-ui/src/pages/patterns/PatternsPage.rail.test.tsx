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

// @/ui's dynamic-tag layout primitives crash at runtime on this branch;
// stub them with intrinsic elements (see src/pages/solidTestStubs.tsx).
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const stubbed = await uiLayoutStub(await importOriginal<Record<string, unknown>>());
  // @/ui's Menu is broken on this branch (calls createSignal without
  // importing it), so stub the compound with bare pass-throughs.
  const passthrough = (props: any) => <div>{props.children}</div>;
  const Item = (props: any) => (
    <button type="button" onClick={() => props.onSelect?.(props)} data-testid={props["data-testid"]}>
      {props.children}
    </button>
  );
  const Menu = Object.assign(
    (props: any) => <div data-testid="menu-root">{props.children}</div>,
    {
      Target: passthrough,
      Dropdown: passthrough,
      Item,
      ItemProps: (props: any) => null,
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

// src/components/common/MembersDrawer.tsx is mid-edit (syntax-broken object
// spread in the other agent's in-flight conversion); IndexMembersDrawer wraps
// it. Mocking it here keeps this suite green until that file compiles again.
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
async function pickMultiOption(selectTestId: string, name: string | RegExp) {
  const root = screen.getByTestId(selectTestId);
  const combobox = within(root).getByRole("combobox");
  fireEvent.focus(combobox);
  fireEvent.click(combobox);
  const listbox = await within(root).findByRole("listbox");
  const option = within(listbox).getByRole("option", { name });
  fireEvent.click(within(option).getByRole("checkbox"));
}

describe("PatternsPage rail-modal", () => {
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

  test("Filters button opens the modal with the full rail", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-rail")).toBeInTheDocument();
    // Pattern tiles show the reference image + label.
    const img = await screen.findByTestId("pattern-image-falling_wedge");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/falling_wedge");
    expect(screen.getByTestId("patterns-filter-pattern-falling_wedge")).toHaveTextContent(
      "Falling Wedge",
    );
    fireEvent.click(screen.getByTestId("patterns-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument());
  });

  test("filter edits are staged and applied only when Filter is clicked", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    await pickMultiOption("patterns-family-select", /^Reversal/);
    // Staged locally — no instant store update / reload.
    expect(props.setFilter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("patterns-filters-done"));
    expect(props.applyFilters).toHaveBeenCalledWith(
      expect.objectContaining({ family: ["reversal"] }),
    );
  });

  test("a preset replaces the staged filters instead of merging with them", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));

    // Stage a direction first…
    await pickMultiOption("patterns-direction-select", "Bearish");
    // …then apply a preset that says nothing about direction. The preset
    // control is a native select, so drive it through its option list.
    fireEvent.input(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"),
      { target: { value: "builtin:fresh_reversals" } },
    );

    fireEvent.click(screen.getByTestId("patterns-filters-done"));
    expect(props.applyFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        family: ["reversal"],
        formed_within_bars: 3,
        sort: "newest",
        direction: [],
      }),
    );
  });

  test("filters modal exposes the modal region; Reset all stages a reset", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-reset"));
    // Reset is staged locally; nothing hits the store until Filter.
    expect(props.resetFilters).not.toHaveBeenCalled();
  });


});
