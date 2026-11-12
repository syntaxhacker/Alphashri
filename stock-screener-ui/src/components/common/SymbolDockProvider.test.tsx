// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, useContext } from "solid-js";
import { Router } from "@solidjs/router";
import { UIProvider } from "@/ui";
import { SymbolDockProvider } from "./SymbolDockProvider";
import { SymbolDockContext } from "./symbolDockContext";

// usePatternFullscreen is still on React; the dock tests exercise the dock
// against a faithful Solid port of the hook's two-phase state machine.
vi.mock("@/hooks/usePatternFullscreen", async () => {
  const { fetchSymbolChart } = await vi.importMock<typeof import("../../api/chartPatterns")>(
    "../../api/chartPatterns",
  );
  const [fullscreen, setFullscreen] = createSignal<Record<string, unknown> | null>(null);
  let token = 0;
  let detectMode = true;

  const staleFields = (chart: { stale?: boolean; as_of?: string | null }) =>
    chart.stale === true
      ? { stale: true, dataAsOf: chart.as_of ?? null }
      : { stale: false, dataAsOf: null };

  const run = (
    symbol: string,
    timeframe: string | undefined,
    pinned: boolean,
    detectPatterns: boolean = true,
  ) => {
    const tf = timeframe ?? "1D";
    const myToken = ++token;
    detectMode = detectPatterns;
    setFullscreen({
      symbol,
      hit: null,
      hits: [],
      timeframe: tf,
      candles: [],
      overlays: [],
      trendLines: [],
      loading: true,
      detectPatterns,
      asOf: null,
      fromDate: null,
      pinned,
      patternsLoading: undefined,
      stale: false,
      dataAsOf: null,
    });
    fetchSymbolChart(symbol, tf, { detectPatterns: false })
        .then((chart: any) => {
          if (myToken !== token) return;
          setFullscreen((prev: any) =>
            prev && prev.symbol === symbol && prev.timeframe === tf
              ? { ...prev, ...staleFields(chart), candles: chart.candles ?? [], trendLines: chart.trend_lines ?? [], loading: false }
              : prev,
          );
          if (!detectMode) return;
          fetchSymbolChart(symbol, tf, { detectPatterns: true })
            .then((chart2: any) => {
              if (myToken !== token) return;
              setFullscreen((prev: any) =>
                prev && prev.symbol === symbol && prev.timeframe === tf
                  ? { ...prev, ...staleFields(chart2), hit: null, hits: [], trendLines: chart2.trend_lines ?? [], patternsLoading: false }
                  : prev,
              );
            })
            .catch(() => {
              if (myToken !== token) return;
              setFullscreen((prev: any) =>
                prev && prev.symbol === symbol && prev.timeframe === tf ? { ...prev, patternsLoading: false } : prev,
              );
            });
        })
        .catch(() => {
          if (myToken !== token) return;
          setFullscreen((prev: any) =>
            prev && prev.symbol === symbol && prev.timeframe === tf ? { ...prev, loading: false } : prev,
          );
        });
  };

  return {
    __resetFullscreen: () => setFullscreen(null),
    usePatternFullscreen: () => ({
      fullscreen,
      openFromSymbol: (symbol: string) => run(symbol, undefined, true, true),
      previewFromSymbol: (symbol: string) => run(symbol, undefined, false, true),
      changeFullscreenTimeframe: () => undefined,
      pinFullscreen: () =>
        setFullscreen((prev: any) => (prev ? { ...prev, pinned: true } : prev)),
      closeFullscreen: () => setFullscreen(null),
      selectFullscreenHit: () => undefined,
    }),
  };
});

vi.mock("../../api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
  fetchPatternHit: vi.fn(),
}));

vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: (props: { symbol: string | null; loading?: boolean }) => (
    <div data-testid="patterns-chart-dock" data-loading={String(Boolean(props.loading))}>
      {props.symbol}
    </div>
  ),
}));

import { __resetFullscreen } from "@/hooks/usePatternFullscreen";
import { fetchSymbolChart } from "../../api/chartPatterns";

const mockedFetchSymbolChart = vi.mocked(fetchSymbolChart);

function candle() {
  return { t: "2026-11-06", o: 118, h: 122, l: 117, c: 120, v: 1000 };
}

const STALE_CHART = {
  candles: [candle()],
  hits: [],
  trend_lines: [],
  cached: true,
  stale: true,
  as_of: "2026-11-06",
} as never;

const FRESH_CHART = {
  candles: [candle()],
  hits: [],
  trend_lines: [],
  cached: false,
  stale: false,
} as never;

function DockHarness() {
  const dock = useContext(SymbolDockContext);
  return (
    <>
      <button type="button" data-testid="open-ircon" onClick={() => dock.open("IRCON")}>
        IRCON
      </button>
      <button type="button" data-testid="open-reliance" onClick={() => dock.open("RELIANCE")}>
        RELIANCE
      </button>
      <button type="button" data-testid="close-dock" onClick={() => dock.close()}>
        close
      </button>
      <button
        type="button"
        data-testid="preview-ircon"
        onMouseEnter={() => dock.preview("IRCON")}
        onMouseLeave={dock.endPreview}
      >
        preview IRCON
      </button>
      <button
        type="button"
        data-testid="preview-reliance"
        onMouseEnter={() => dock.preview("RELIANCE")}
        onMouseLeave={dock.endPreview}
      >
        preview RELIANCE
      </button>
    </>
  );
}

function renderDock() {
  return render(() => (
    <Router root={() => <UIProvider><SymbolDockProvider><DockHarness /></SymbolDockProvider></UIProvider>} />
  ));
}

describe("SymbolDockProvider stale badge", () => {
  beforeEach(() => {
    __resetFullscreen();
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("a stale-first payload shows the Cached badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
        renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));

    const badge = await screen.findByTestId("dock-stale");
    expect(badge).toHaveTextContent("Cached 2026-11-06");
    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"),
    );
  });

  test("a fresh payload hides the badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
        renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));
    expect(await screen.findByTestId("dock-stale")).toBeInTheDocument();

    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    await fireEvent.click(screen.getByTestId("open-reliance"));

    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE"),
    );
    await waitFor(() => expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument());
  });

  test("switching symbol resets the badge before the new frame arrives", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_CHART);
        renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));
    expect(await screen.findByTestId("dock-stale")).toBeInTheDocument();

    // RELIANCE phase 1 hangs: the badge must disappear via the synchronous reset,
    // not because a fresh frame happened to land.
    let resolvePhase1!: (v: unknown) => void;
    mockedFetchSymbolChart.mockReset();
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    mockedFetchSymbolChart.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePhase1 = resolve; }),
    );
    await fireEvent.click(screen.getByTestId("open-reliance"));

    expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument();

    resolvePhase1(FRESH_CHART);
  });

});

describe("preview → endPreview race (A then B)", () => {
  beforeEach(() => {
    __resetFullscreen();
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("moving quickly from A to B keeps B's preview open", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    const previewA = screen.getByTestId("preview-ircon");
    const previewB = screen.getByTestId("preview-reliance");

    const enter = (el: HTMLElement) => fireEvent.mouseEnter(el, { relatedTarget: null });
    const leave = (el: HTMLElement) => fireEvent.mouseLeave(el, { relatedTarget: null });

    // Enter A → 300 ms debounce → A preview opens
    enter(previewA);
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();

    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"));

    // Leave A → close timer scheduled (800 ms); enter B → it must be cancelled
    leave(previewA);
    enter(previewB);

    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE"));

    // Advance past the old close timer → dock still shows B, not closed, not A
    vi.advanceTimersByTime(800);
    await waitFor(() => expect(screen.getByTestId("symbol-dock")).toBeInTheDocument());
    expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("patterns-chart-dock")).not.toHaveTextContent("IRCON");
  });
});
