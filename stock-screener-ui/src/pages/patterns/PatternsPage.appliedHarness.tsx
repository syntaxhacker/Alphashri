// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import type { Accessor, JSX } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import type { PatternsPageProps } from "./PatternsPage";

vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const stubbed = await uiLayoutStub(await importOriginal<Record<string, unknown>>());
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

export const fetchSymbolChart = vi.fn();
export const fetchPatternMatrix = vi.fn();
export const fetchPatternHit = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: (...args: unknown[]) => fetchSymbolChart(...args),
  fetchPatternMatrix: (...args: unknown[]) => fetchPatternMatrix(...args),
  fetchPatternHit: (...args: unknown[]) => fetchPatternHit(...args),
}));

export const fetchPatternImages = vi.fn();
vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

// The fullscreen hook polls a live quote; without this mock every open leaks a
// real HTTP request to a non-existent API and destabilises the worker.
export const fetchQuotes = vi.fn();
vi.mock("@/api/marketScreener", () => ({
  fetchQuotes: (...args: unknown[]) => fetchQuotes(...args),
}));

const harnessState = vi.hoisted(() => ({
  gridTrendlinesViews: [] as unknown[],
  fullscreenTrendlinesViews: [] as unknown[],
  // Records the `overlays` prop per fullscreen render (single-pattern contract:
  // the page always passes an empty list so only the active hit is drawn).
  fullscreenOverlays: [] as unknown[],
}));

export const getHarnessState = () => harnessState;

// Faithful stubs: preserve the contract testids the page relies on
// (card buttons incl. expand affordance, fullscreen modal + chart +
// "No chart data") while recording the `trendlinesView` prop.
vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: (props: any) => {
    harnessState.gridTrendlinesViews.push(props.trendlinesView ?? "both");
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
    harnessState.fullscreenTrendlinesViews.push(props.trendlinesView ?? "both");
    harnessState.fullscreenOverlays.push(props.overlays);
    const docked = () => props.docked ?? false;
    const tfs = () => ((props.timeframes as any[]) ?? []).length > 0 ? (props.timeframes as any[]) : [{ id: props.timeframe, label: props.timeframe }];
    return (
      <Show when={props.opened}>
        <div data-testid={docked() ? "patterns-chart-dock" : "patterns-fullscreen-modal"} data-trendlines-view={props.trendlinesView ?? "both"}>
          <div data-testid="patterns-fullscreen-active-hit">{props.hit?.pattern_name}</div>
          <For each={(props.hits ?? []) as any[]}>
            {(h: any, i: Accessor<number>) => (
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

export function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
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

export const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

export function makeProps(overrides: Partial<PatternsPageProps> = {}): PatternsPageProps {
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
      from_date: null,
      to_date: null,
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

// The page builds its Suspense tree eagerly; construct it inside the render
// root so Solid owns (and disposes) those computations on cleanup.
export function r(page: () => JSX.Element) {
  return render(() => <UIProvider>{page()}</UIProvider>);
}

export function resetHarness(): void {
  vi.clearAllMocks();
  harnessState.gridTrendlinesViews.length = 0;
  harnessState.fullscreenTrendlinesViews.length = 0;
  harnessState.fullscreenOverlays.length = 0;
  fetchPatternImages.mockResolvedValue({});
  fetchQuotes.mockResolvedValue([]);
  fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
}

export const testHooks = { afterEach, beforeEach, describe, expect, test, vi, cleanup, fireEvent, screen, waitFor, within, createSignal };
