// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { MARKET_UNIVERSE_DESCRIPTORS } from "@/config/marketUniverses";
import { marketMetricOptions } from "../../market/marketTreemap";
import type { DockPanelContext } from "../../dock/types";
import type { MarketRow, MarketUniverse } from "../../../types/marketScreener";
import { getPanelSpec, WINDOW_PANEL_TYPES } from "../panelRegistry";

const ctl = vi.hoisted(() => ({
  setRows: null as unknown as (rows: MarketRow[]) => void,
  setLoading: null as unknown as (value: boolean) => void,
  setError: null as unknown as (error: Error | null) => void,
  universe: null as unknown as () => string,
  options: null as unknown as Record<string, unknown>,
  fetches: [] as string[],
  errorOnUniverse: null as string | null,
  stale: false,
  ageSec: null as number | null,
  refresh: vi.fn(),
  dockOpen: vi.fn(),
  chart: null as unknown as { handlers: Record<string, (payload: unknown) => void> },
  option: null as any,
}));

vi.mock("../../market/useMarketSnapshotSolid", async () => {
  const { createEffect, createSignal } = await import("solid-js");
  const { buildMarketSnapshotUrl } = await import("../../../api/marketScreener");
  const [rows, setRows] = createSignal<MarketRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  ctl.setRows = setRows;
  ctl.setLoading = setLoading;
  ctl.setError = setError;
  return {
    useMarketSnapshotSolid: (universe: () => string, options: Record<string, unknown>) => {
      ctl.universe = universe;
      ctl.options = options;
      // Mirror the real hook's reactive fetch: a universe switch re-runs with the
      // new accessor value. The URL comes from the production URL builder.
      createEffect(() => {
        const u = universe();
        const enabled = options.enabled as (() => boolean) | undefined;
        if (enabled && !enabled()) return;
        ctl.fetches.push(buildMarketSnapshotUrl({ universe: u as MarketUniverse }));
        if (ctl.errorOnUniverse === u) {
          setRows([]);
          setError(new Error(`snapshot failed for ${u}`));
          setLoading(false);
        }
      });
      return {
        snapshot: () => null,
        rows,
        total: () => rows().length,
        updateMode: () => null,
        asOf: () => null,
        isLoading: loading,
        error,
        refresh: ctl.refresh,
        lastUpdated: () => null,
        stale: () => ctl.stale,
        ageSec: () => ctl.ageSec,
        warming: () => false,
      };
    },
  };
});

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: async () => ({
    init: () => {
      const chart = {
        handlers: {} as Record<string, (payload: unknown) => void>,
        setOption: (option: any) => {
          ctl.option = option;
        },
        on: (event: string, fn: (payload: unknown) => void) => {
          chart.handlers[event] = fn;
        },
        resize: () => {},
        dispose: () => {},
      };
      ctl.chart = chart;
      return chart;
    },
  }),
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

const row = (symbol: string, change: number): MarketRow => ({
  symbol,
  name: symbol,
  sector: "Energy",
  exchange: "NSE",
  close: 100,
  change,
  relativeVolume: 1,
  marketCapCr: 100_000,
  capTier: "large",
  rsi: 55,
  adx: 20,
  sma20: null,
  sma50: null,
  sma200: null,
  perfW: null,
  perf1m: null,
  high52w: null,
  low52w: null,
  pos52w: null,
  peRatio: null,
  pbRatio: null,
  dividendYield: null,
  roe: null,
  fno: false,
  etf: false,
});

const CTX: Accessor<DockPanelContext> = () => ({ market: "india" });

function MountSpec() {
  const spec = getPanelSpec("market.heatmap");
  if (!spec) return <div data-testid="missing-spec" />;
  const data = createMemo(() => spec.data?.(CTX));
  return <>{spec.mount(CTX, { data, commands: spec.commands ?? {} })}</>;
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <MountSpec />
    </UIProvider>
  ));
}

beforeEach(() => {
  ctl.setRows([]);
  ctl.setLoading(false);
  ctl.setError(null);
  ctl.fetches = [];
  ctl.errorOnUniverse = null;
  ctl.stale = false;
  ctl.ageSec = null;
  ctl.refresh.mockClear();
  ctl.dockOpen.mockClear();
  ctl.option = null;
});

afterEach(() => cleanup());

describe("market.heatmap — two-window request count", () => {
  it("same universe: two windows share one snapshot poller", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    render(() => (
      <UIProvider>
        <MountSpec />
        <MountSpec />
      </UIProvider>
    ));

    await waitFor(() =>
      expect(screen.getAllByTestId("market-heatmap-panel")).toHaveLength(2),
    );
    expect(ctl.fetches).toHaveLength(1);
  });

  it("two windows keep independent universe controls", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    render(() => (
      <UIProvider>
        <MountSpec />
        <MountSpec />
      </UIProvider>
    ));

    const selects = screen.getAllByTestId("market-heatmap-universe");
    expect(selects).toHaveLength(2);
    fireEvent.input(selects[0].querySelector("select")!, { target: { value: "nifty50" } });
    await waitFor(() => expect(ctl.fetches.at(-1)).toContain("universe=nifty50"));
  });
});

describe("market.heatmap window panel", () => {
  it("(a) mounts the real market-map-view with rows from the snapshot", async () => {
    ctl.setRows([row("RELIANCE", 1.2), row("TCS", -0.8)]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    expect(screen.getByTestId("market-map-count")).toHaveTextContent("2 stocks");
    // The hook is gated exactly like configReady: fixed universe + one-shot latch.
    expect(ctl.universe()).toBe("all_equity");
    expect(ctl.options.enabled).toBeTypeOf("function");
    expect(ctl.options.deferCacheUntilEnabled).toBe(true);
    expect(WINDOW_PANEL_TYPES.has("market.heatmap")).toBe(true);
  });

  it("(b) loading renders a defined element, never a blank box", () => {
    ctl.setLoading(true);
    renderPanel();

    expect(screen.getByTestId("market-heatmap-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
  });

  it("(c) a fetch failure renders its message", () => {
    ctl.setError(new Error("snapshot exploded"));
    renderPanel();

    expect(screen.getByTestId("market-heatmap-error")).toHaveTextContent("snapshot exploded");
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
  });

  it("(empty) renders a defined empty state", () => {
    renderPanel();

    expect(screen.getByTestId("market-heatmap-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
  });

  it("(empty-action) the empty state offers an enabled Refresh button", () => {
    renderPanel();

    const action = screen.getByTestId("market-heatmap-empty-action");
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(ctl.refresh).toHaveBeenCalledWith(true);
  });

  it("(e) exactly one metric control exists inside the window", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    const panel = screen.getByTestId("market-heatmap-panel");
    expect(screen.getAllByTestId("market-heatmap-metric")).toHaveLength(1);
    expect(screen.queryByTestId("market-heatmap-color-metric")).not.toBeInTheDocument();
    expect(screen.queryByTestId("market-map-metric")).not.toBeInTheDocument();
    // One universe selector + one Size by selector; Colour by is gone by design.
    expect(panel.querySelectorAll("select")).toHaveLength(2);
    expect(panel).toHaveTextContent(/Size by/);
    expect(panel).not.toHaveTextContent(/Colour by/);
  });

  it("(f) clicking a tile opens the symbol dock", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    renderPanel();

    await waitFor(() => expect(ctl.chart?.handlers.click).toBeTypeOf("function"));
    ctl.chart.handlers.click({ name: "RELIANCE" });
    expect(ctl.dockOpen).toHaveBeenCalledWith("RELIANCE");
  });

  const universeSelect = () =>
    screen.getByTestId("market-heatmap-universe").querySelector("select") as HTMLSelectElement;
  const metricSelect = () =>
    screen.getByTestId("market-heatmap-metric").querySelector("select") as HTMLSelectElement;

  it("(ctx-a) the universe dropdown lists all 9 descriptors and a change refetches with the new universe URL", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-heatmap-universe")).toBeInTheDocument());
    const select = universeSelect();
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.label),
    );
    expect(select.value).toBe("all_equity");
    const before = ctl.fetches.length;
    fireEvent.input(select, { target: { value: "nifty50" } });

    await waitFor(() => expect(ctl.fetches.length).toBeGreaterThan(before));
    expect(ctl.universe()).toBe("nifty50");
    expect(ctl.fetches.at(-1)).toContain("/api/market/snapshot?");
    expect(ctl.fetches.at(-1)).toContain("universe=nifty50");
  });

  it("(ctx-b) the count line shows rendered rows and the ETF subset", async () => {
    ctl.setRows([
      row("RELIANCE", 1),
      row("TCS", -1),
      { ...row("GOLDBEE", 0.4), etf: true },
      { ...row("NIFTYBEES", 0.2), etf: true },
    ]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    const count = screen.getByTestId("market-heatmap-count");
    expect(count).toHaveTextContent("4 stocks");
    expect(count).toHaveTextContent("2 ETFs");
    expect(screen.getByTestId("market-heatmap-encoding")).toHaveTextContent("4 of 4");
  });

  it("(ctx-c) the encoding subtitle names the single shared metric and follows a size change", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    const subtitle = screen.getByTestId("market-heatmap-encoding");
    expect(subtitle).toHaveTextContent("Size & Colour = Day Change");
    expect(subtitle).toHaveTextContent("low → high");

    fireEvent.input(metricSelect(), { target: { value: "rsi" } });

    await waitFor(() => expect(subtitle).toHaveTextContent("Size & Colour = RSI"));
  });

  it("(ctx-d) the context bar survives loading, empty and error states", async () => {
    ctl.setError(new Error("snapshot exploded"));
    renderPanel();

    expect(screen.getByTestId("market-heatmap-universe")).toBeInTheDocument();
    expect(screen.getByTestId("market-heatmap-metric")).toBeInTheDocument();
    expect(screen.getByTestId("market-heatmap-error")).toHaveTextContent("snapshot exploded");
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
  });

  it("(ctx-e) refresh re-triggers the snapshot fetch with force", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-heatmap-refresh")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("market-heatmap-refresh"));
    expect(ctl.refresh).toHaveBeenCalledWith(true);
  });

  it("(a) a 500 renders the error state, not the empty state", () => {
    ctl.setError(new Error("Market snapshot failed (HTTP 500)"));
    renderPanel();

    expect(screen.getByTestId("market-heatmap-error")).toBeInTheDocument();
    expect(screen.queryByTestId("market-heatmap-empty")).not.toBeInTheDocument();
  });

  it("(b) a stale snapshot is marked stale with its age instead of looking fresh", () => {
    ctl.setRows([row("RELIANCE", 1)]);
    ctl.stale = true;
    ctl.ageSec = 180;
    renderPanel();

    const marker = screen.getByTestId("market-heatmap-stale");
    expect(marker).toHaveTextContent("Stale data");
    expect(marker).toHaveTextContent("3m old");
  });

  it("(b2) a failed refresh over earlier data shows both the error and the staleness marker", () => {
    ctl.setRows([row("RELIANCE", 1)]);
    ctl.setError(new Error("snapshot exploded"));
    ctl.stale = true;
    ctl.ageSec = 120;
    renderPanel();

    expect(screen.getByTestId("market-heatmap-error")).toHaveTextContent("snapshot exploded");
    expect(screen.getByTestId("market-heatmap-stale")).toHaveTextContent("2m old");
  });

  it("(ctx-f) a universe change that errors keeps the error state, not a blank box", async () => {
    ctl.setRows([row("RELIANCE", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    ctl.errorOnUniverse = "nifty50";
    fireEvent.input(universeSelect(), { target: { value: "nifty50" } });

    await waitFor(() =>
      expect(screen.getByTestId("market-heatmap-error")).toHaveTextContent("snapshot failed for nifty50"),
    );
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
    // The selector stays available so the user can switch back to a good universe.
    expect(universeSelect().value).toBe("nifty50");
  });
});

describe("market.heatmap — one shared metric encoding", () => {
  const sizeSelect = () =>
    screen.getByTestId("market-heatmap-metric").querySelector("select") as HTMLSelectElement;
  const tiles = () => (ctl.option?.series?.[0]?.data ?? []) as Array<Record<string, any>>;
  const variedRows = (): MarketRow[] => [
    { ...row("SMALL", 1), marketCapCr: 10_000, rsi: 20 },
    { ...row("BIG", 2), marketCapCr: 200_000, rsi: 90 },
  ];
  const optionsOf = (select: HTMLSelectElement) =>
    Array.from(select.querySelectorAll("option")).map((o) => {
      const option = o as HTMLOptionElement;
      return { value: option.value, label: option.textContent, disabled: option.disabled };
    });

  it("(d) the Size by options come straight from the shared registry", async () => {
    ctl.setRows(variedRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    const expected = marketMetricOptions("INR").map((option) => ({
      value: option.value,
      label: option.label,
      disabled: false,
    }));
    expect(optionsOf(sizeSelect())).toEqual(expected);
  });

  it("(c) the single control is the only select that can size or colour the map", async () => {
    ctl.setRows(variedRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    expect(screen.getAllByTestId("market-heatmap-metric")).toHaveLength(1);
    expect(screen.queryByTestId("market-heatmap-color-metric")).toBeNull();
    expect(screen.queryByTestId("market-map-metric")).toBeNull();
    expect(screen.getByTestId("market-heatmap-panel").querySelectorAll("select")).toHaveLength(2);
    expect(sizeSelect()).toHaveAccessibleName("Size the heatmap by");
  });

  it("(b) changing the size metric changes the emitted tile areas and the fill follows it", async () => {
    ctl.setRows(variedRows());
    renderPanel();

    await waitFor(() => expect(tiles()).toHaveLength(2));
    const areas = () => tiles().map((d) => `${d.name}:${d.value}`).join(",");
    const beforeAreas = areas();

    fireEvent.input(sizeSelect(), { target: { value: "rsi" } });

    await waitFor(() => expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("RSI"));
    expect(sizeSelect().value).toBe("rsi");
    expect(areas()).not.toBe(beforeAreas);
    // The one selection owns both encodings: the size note and the legend agree.
    expect(screen.getByTestId("market-map-size-note")).toHaveTextContent("RSI");
    expect(tiles().find((d) => d.name === "BIG")!.value).toBe(90);
  });

  it("(a) the default matches the page: Day Change drives both size and colour", async () => {
    ctl.setRows(variedRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    expect(sizeSelect().value).toBe("change_pct");
    expect(screen.getByTestId("market-heatmap-encoding")).toHaveTextContent(
      "Size & Colour = Day Change",
    );
    expect(screen.getByTestId("market-map-color-label")).toHaveTextContent("Day Change");
    expect(screen.getByTestId("market-map-size-note")).toHaveTextContent("Day Change");
  });

  it("(e) the size select keeps its value when a universe switch rebuilds the options", async () => {
    ctl.setRows(variedRows());
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("market-map-view")).toBeInTheDocument());
    fireEvent.input(sizeSelect(), { target: { value: "rsi" } });
    await waitFor(() => expect(sizeSelect().value).toBe("rsi"));

    // A USD universe rebuilds metricOptions(), replacing every <option> node.
    // The native select must stay on RSI, not fall back to option 0 (Day Change)
    // while the panel label still claims RSI — the label/control disagreement.
    const universe = screen.getByTestId("market-heatmap-universe").querySelector("select") as HTMLSelectElement;
    fireEvent.input(universe, { target: { value: "us" } });

    await waitFor(() => expect(ctl.universe()).toBe("us"));
    expect(sizeSelect().value).toBe("rsi");
    expect(sizeSelect().selectedIndex).toBe(2);
  });
});
