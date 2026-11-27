// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

vi.setConfig({ testTimeout: 60_000 });

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const passthrough = (props: any) => <div>{props.children}</div>;
  const Item = (props: any) => (
    <button
      type="button"
      onClick={() => props.onSelect?.(props)}
      data-testid={props["data-testid"]}
    >
      {props.children}
    </button>
  );
  const Menu = Object.assign((props: any) => <div data-testid="menu-root">{props.children}</div>, {
    Target: passthrough,
    Dropdown: passthrough,
    Item,
    Divider: () => <hr />,
    Label: (props: any) => <span>{props.children}</span>,
  });
  return {
    ...actual,
    Menu,
    MenuTarget: passthrough,
    MenuDropdown: passthrough,
    MenuItem: Item,
  };
});

vi.mock("@/components/patterns/IndexMembersDrawer", () => ({
  IndexMembersDrawer: () => null,
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
  fetchWatch: vi.fn(async () => ({ items: [], updated_at: null })),
  fetchWatchSetups: vi.fn(async () => []),
  fetchMarketStatus: vi.fn(async () => ({ open: false })),
  streamWatch: vi.fn(async () => {}),
  fetchIndexMembers: vi.fn(async () => ({ label: "Index", count: 0, symbols: [] })),
}));

const fetchPatternImages = vi.fn();
vi.mock("@/api/marketScreener", () => ({
  fetchQuotes: vi.fn(async () => []),
}));

vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

// The real thumbnail component is covered by its own suite. Here it sits inside
// a partially mocked UI kit (Box is a plain stub), and 19 live <img> branches
// under that stub balloon the happy-dom worker past its heap limit. Keep the
// image contract (test id + src / placeholder) with a lightweight stand-in.
vi.mock("@/components/patterns/PatternImage", () => ({
  PatternImage: (props: { patternId: string; images?: Record<string, string>; alt?: string }) => {
    const src = () => props.images?.[props.patternId];
    return (
      <Show when={src()} fallback={<span data-testid="pattern-image-placeholder" />}>
        <img
          src={src()}
          alt={props.alt ?? props.patternId}
          data-testid={`pattern-image-${props.patternId}`}
        />
      </Show>
    );
  },
}));

// Records the `overlays` prop per fullscreen render (single-pattern contract:
// the page always passes an empty list so only the active hit is drawn).
const fullscreenOverlays = vi.hoisted(() => [] as unknown[]);

// Faithful stubs: preserve the contract testids the page relies on
// (card buttons incl. expand affordance, fullscreen modal + chart +
// "No chart data").
vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: (props: any) => {
    return (
      <div data-testid="patterns-grid">
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
    fullscreenOverlays.push(props.overlays);
    const docked = () => props.docked ?? false;
    const tfs = () =>
      ((props.timeframes as any[]) ?? []).length > 0
        ? (props.timeframes as any[])
        : [{ id: props.timeframe, label: props.timeframe }];
    return (
      <Show when={props.opened}>
        <div data-testid={docked() ? "patterns-chart-dock" : "patterns-fullscreen-modal"}>
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
              onChange={(e) =>
                props.onTimeframeChange((e.currentTarget as HTMLSelectElement).value)
              }
            >
              <For each={tfs()}>
                {(tf: any) => <option value={tf.id}>{tf.label || tf.id}</option>}
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
          <Show when={(props.candles?.length ?? 0) === 0}>
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
    const selected = () =>
      Array.isArray(props.value) ? props.value : props.value ? [props.value] : [];
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
      {
        pattern_id: "falling_wedge",
        name: "Falling Wedge",
        family: "reversal",
        direction: "bullish",
        description: "…",
      },
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
    },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
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

function r(jsx: () => JSX.Element) {
  return render(() => <UIProvider>{jsx()}</UIProvider>);
}

/**
 * Pick an option in a local MultiSelect. The listbox opens on combobox focus,
 * and the option toggles through its checkbox (clicking the bare `li` is inert).
 * MultiSelect portals its listbox to document.body (it must escape the rail's
 * `overflow-y-auto`), so the query is document-scoped and picks the listbox
 * that owns the option — the presets select exposes same-named options.
 */
async function pickMultiOption(selectTestId: string, name: string | RegExp) {
  const root = screen.getByTestId(selectTestId);
  const combobox = within(root).getByRole("combobox");
  fireEvent.focus(combobox);
  fireEvent.click(combobox);
  const listbox = await waitFor(() => {
    const matches = screen
      .getAllByRole("listbox")
      .filter((box) => within(box).queryByRole("option", { name }));
    if (matches.length === 0) throw new Error(`no listbox with option ${String(name)}`);
    return matches[matches.length - 1];
  });
  const option = within(listbox).getByRole("option", { name });
  fireEvent.click(within(option).getByRole("checkbox"));
}

describe("PatternsPage rail-modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          trendlines: [
            [
              { t: "2026-06-10", price: 235 },
              { t: "2026-09-15", price: 311 },
            ],
          ],
        },
      ],
    });
  });
  afterEach(() => cleanup());

  test("Filters button opens the modal with the full rail", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-rail")).toBeInTheDocument();
    const img = await screen.findByTestId("pattern-image-falling_wedge");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/falling_wedge");
    expect(screen.getByTestId("patterns-filter-pattern-falling_wedge")).toHaveTextContent(
      "Falling Wedge",
    );
    fireEvent.click(screen.getByTestId("patterns-filters-done"));
    await waitFor(() =>
      expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument(),
    );
  });

  test("filter edits are staged and applied only when Filter is clicked", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    await pickMultiOption("patterns-family-select", /^Reversal/);
    expect(props.setFilter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("patterns-filters-done"));
    expect(props.applyFilters).toHaveBeenCalledWith(
      expect.objectContaining({ family: ["reversal"] }),
    );
  });

  test("Cmd/Ctrl+Enter applies the latest staged draft, not the draft captured at open", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    await pickMultiOption("patterns-family-select", /^Reversal/);
    expect(props.applyFilters).not.toHaveBeenCalled();

    // The shortcut reads a ref kept in sync with the draft signal — firing it
    // must apply the just-staged family, not the empty draft from mount.
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    expect(props.applyFilters).toHaveBeenCalledTimes(1);
    expect(props.applyFilters).toHaveBeenCalledWith(
      expect.objectContaining({ family: ["reversal"] }),
    );
  });

  test("a preset replaces the staged filters instead of merging with them", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));

    await pickMultiOption("patterns-direction-select", "Bearish");
    fireEvent.input(
      within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"),
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
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-reset"));
    expect(props.resetFilters).not.toHaveBeenCalled();
  });
});
