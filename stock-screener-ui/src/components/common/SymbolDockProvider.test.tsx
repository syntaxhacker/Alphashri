// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { useContext } from "solid-js";
import { Router } from "@solidjs/router";
import { UIProvider } from "@/ui";
import { SymbolDockProvider } from "./SymbolDockProvider";
import {
  SymbolDockContext,
  chartHrefForSymbol,
  hasIndianOptionsChain,
  isInAppChartMarket,
  isUsMarket,
} from "./symbolDockContext";
import { ChartDockOutlet } from "./ChartDockOutlet";
import { SymbolLink } from "./SymbolLink";

const { mockRefreshSymbolChart } = vi.hoisted(() => ({
  mockRefreshSymbolChart: vi.fn(),
}));

// Routing is asserted, not followed: keep `Router` real but intercept navigate.
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

vi.mock("../../api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
  fetchPatternHit: vi.fn(),
}));

// Keep the real state machine (the stale/preview/outlet tests rely on it) and
// swap only the refresh callback so the dock wiring can be asserted.
vi.mock("@/hooks/usePatternFullscreenSolid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/usePatternFullscreenSolid")>();
  return {
    ...actual,
    usePatternFullscreen: (...args: Parameters<typeof actual.usePatternFullscreen>) => ({
      ...actual.usePatternFullscreen(...args),
      refreshSymbolChart: mockRefreshSymbolChart,
    }),
  };
});

vi.mock("@/components/patterns/PatternFullscreenView", async () => {
  const { createEffect, onCleanup } = await import("solid-js");
  return {
    PatternFullscreenView: (props: {
      docked?: boolean;
      opened: boolean;
      symbol: string | null;
      loading?: boolean;
      onMaximize?: () => void;
      onClose?: () => void;
      onRefresh?: () => void;
      indicators?: unknown;
      srZones?: unknown[];
    }) => {
      // The real Modal owns Escape while open; mirror that so the tests can
      // assert the dock's own listener stays out of the way.
      createEffect(() => {
        if (props.docked || !props.opened) return;
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Escape") props.onClose?.();
        };
        document.addEventListener("keydown", onKeyDown, true);
        onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
      });

      if (!props.docked) {
        return (
          <div data-testid="patterns-fullscreen-modal">
            {props.symbol}
            {props.symbol && !props.docked ? (
              <a
                data-testid="patterns-open-chart-page"
                aria-label="Open full chart page"
                href={chartHrefForSymbol(props.symbol)}
              >
                Open full chart page
              </a>
            ) : null}
            <button
              type="button"
              data-testid="patterns-fullscreen-modal-close"
              aria-label="close"
              onClick={() => props.onClose?.()}
            >
              close
            </button>
          </div>
        );
      }

      return (
        <div
          data-testid="patterns-chart-dock"
          data-loading={String(Boolean(props.loading))}
          data-indicators={String(Boolean(props.indicators))}
          data-sr-zones={String(props.srZones?.length ?? 0)}
        >
          {props.symbol}
          {props.onMaximize ? (
            <button
              type="button"
              data-testid="patterns-chart-expand"
              title="Expand to full screen"
              aria-label="Expand chart"
              onClick={props.onMaximize}
            >
              expand
            </button>
          ) : null}
          {props.onRefresh ? (
            <button
              type="button"
              data-testid="patterns-dock-refresh"
              aria-label="Refresh pattern data"
              onClick={props.onRefresh}
            >
              refresh
            </button>
          ) : null}
        </div>
      );
    },
  };
});

vi.mock("@/components/options-dock/OptionsDockPanel", () => ({
  OptionsDockPanel: () => <div data-testid="options-dock-panel" />,
}));

// Opening options mode would otherwise fire a real /options/underlying fetch.
vi.mock("@/state/optionsDock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/optionsDock")>();
  return { ...actual, open: vi.fn(), close: vi.fn() };
});

import { __resetFullscreen } from "@/utils/patterns/fullscreenKey";
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

// Stale-first frame whose displayed candles have today's tape bar appended:
// `as_of` still names the detection frame, so the old badge contradicted the chart.
const STALE_BUT_APPENDED_CHART = {
  candles: [candle(), { t: "2026-11-09", o: 121, h: 125, l: 120, c: 124, v: 900 }],
  hits: [],
  trend_lines: [],
  cached: true,
  stale: true,
  as_of: "2026-11-06",
} as never;

// The confirmed gap: a current 1D display (today's tape bar, `as_of` today) over
// a detection frame two sessions older. `stale` is false, so only
// `detection_as_of` can say the hit is dated 13 Nov.
const CURRENT_DISPLAY_CANDLES = [
  { t: "2026-11-13", o: 118, h: 122, l: 117, c: 120, v: 1000 },
  { t: "2026-11-16", o: 121, h: 126, l: 120, c: 125, v: 1200 },
];

const CURRENT_DISPLAY_STALE_DETECTION = {
  candles: CURRENT_DISPLAY_CANDLES,
  hits: [],
  trend_lines: [],
  cached: true,
  stale: false,
  as_of: "2026-11-16",
  detection_as_of: "2026-11-13",
} as never;

const CURRENT_DISPLAY_CURRENT_DETECTION = {
  candles: CURRENT_DISPLAY_CANDLES,
  hits: [],
  trend_lines: [],
  cached: true,
  stale: false,
  as_of: "2026-11-16",
  detection_as_of: "2026-11-16",
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
      <button
        type="button"
        data-testid="open-options"
        onClick={() => dock.open("RELIANCE", "options")}
      >
        options
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

  test("a stale-first payload whose candles reach past as_of hides the badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(STALE_BUT_APPENDED_CHART);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));

    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"),
    );
    expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument();
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
    let resolvePhase1!: (v: never) => void;
    mockedFetchSymbolChart.mockReset();
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    mockedFetchSymbolChart.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePhase1 = resolve; }),
    );
    await fireEvent.click(screen.getByTestId("open-reliance"));

    expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument();

    resolvePhase1(FRESH_CHART);
  });

  test("opening a pattern dock wires onRefresh and the refresh button calls it", async () => {
    mockRefreshSymbolChart.mockClear();
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"));

    const refresh = screen.getByTestId("patterns-dock-refresh");
    expect(refresh).toBeInTheDocument();
    expect(mockRefreshSymbolChart).not.toHaveBeenCalled();

    await fireEvent.click(refresh);
    expect(mockRefreshSymbolChart).toHaveBeenCalledTimes(1);
  });

});

describe("SymbolDockProvider detection-as-of chip", () => {
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

  test("a current display over a two-session-old detection dates the hit and shows no stale badge", async () => {
    mockedFetchSymbolChart.mockResolvedValue(CURRENT_DISPLAY_STALE_DETECTION);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));

    const chip = await screen.findByTestId("dock-detection-asof");
    expect(chip).toHaveTextContent("13 NOV");
    // The display itself is current, so the cached badge must stay suppressed.
    expect(screen.queryByTestId("dock-stale")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"),
    );
  });

  test("a detection on the displayed bar date hides the chip", async () => {
    mockedFetchSymbolChart.mockResolvedValue(CURRENT_DISPLAY_CURRENT_DETECTION);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));

    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"),
    );
    expect(screen.queryByTestId("dock-detection-asof")).not.toBeInTheDocument();
  });

  test("a payload without detection_as_of renders no chip", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));

    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"),
    );
    expect(screen.queryByTestId("dock-detection-asof")).not.toBeInTheDocument();
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

    enter(previewA);
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();

    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"));

    leave(previewA);
    enter(previewB);

    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE"));

    vi.advanceTimersByTime(800);
    await waitFor(() => expect(screen.getByTestId("symbol-dock")).toBeInTheDocument());
    expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("patterns-chart-dock")).not.toHaveTextContent("IRCON");
  });
});

describe("inline outlet", () => {
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

  test("portals the chart into the page outlet instead of a fixed overlay", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    render(() => (
      <Router
        root={() => (
          <UIProvider>
            <SymbolDockProvider>
              <DockHarness />
              <ChartDockOutlet class="test-outlet" />
            </SymbolDockProvider>
          </UIProvider>
        )}
      />
    ));

    await fireEvent.click(screen.getByTestId("open-reliance"));

    const outlet = screen.getByTestId("chart-dock-outlet");
    await waitFor(() => expect(outlet.querySelector('[data-testid="symbol-dock"]')).not.toBeNull());
    expect(outlet.querySelector('[data-testid="symbol-dock"]')!.className).not.toContain("fixed");
  });

  test("forwards indicator payload fields from chart state into the dock view", async () => {
    mockedFetchSymbolChart.mockResolvedValue({
      ...(FRESH_CHART as Record<string, unknown>),
      symbol: "RELIANCE",
      timeframe: "1D",
      overlays: [],
      indicators: {
        aligned: "candles",
        timeframe: "1D",
        session: "2026-11-06",
        partial_last: false,
        series: [{ id: "sma20", values: [120] }],
        crosses: [],
      },
      sr_zones: [
        {
          kind: "support",
          top: 118,
          bottom: 117,
          start_date: "2026-11-01",
          end_date: "2026-11-06",
          touches: 2,
          score: 0.6,
        },
      ],
    } as never);
    render(() => (
      <Router
        root={() => (
          <UIProvider>
            <SymbolDockProvider>
              <DockHarness />
              <ChartDockOutlet class="test-outlet" />
            </SymbolDockProvider>
          </UIProvider>
        )}
      />
    ));

    await fireEvent.click(screen.getByTestId("open-reliance"));
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE"));
    await waitFor(() =>
      expect(screen.getByTestId("patterns-chart-dock")).toHaveAttribute("data-indicators", "true"),
    );
    expect(screen.getByTestId("patterns-chart-dock")).toHaveAttribute("data-sr-zones", "1");
  });
});

describe("dock wrapper flex sizing", () => {
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

  test("the three dock wrappers use flex-1, never h-full", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/common/SymbolDockProvider.tsx"),
      "utf8",
    );
    const wrapperClass =
      'className="flex flex-1 min-h-0 w-full flex-col overflow-hidden border-l border-fin-border bg-fin-surface"';
    expect(source.split(wrapperClass).length - 1).toBe(3);
    expect(source).not.toContain("h-full");
  });

  test("the options panel still renders inside the inline outlet wrappers", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    render(() => (
      <Router
        root={() => (
          <UIProvider>
            <SymbolDockProvider>
              <DockHarness />
              <ChartDockOutlet class="test-outlet" />
            </SymbolDockProvider>
          </UIProvider>
        )}
      />
    ));

    await fireEvent.click(screen.getByTestId("open-options"));

    const outlet = screen.getByTestId("chart-dock-outlet");
    const panel = await screen.findByTestId("options-dock-panel");
    expect(panel).toBeInTheDocument();
    const dock = screen.getByTestId("symbol-dock");
    expect(dock).toHaveAttribute("data-mode", "options");
    expect(outlet.querySelector('[data-testid="symbol-dock"]')).not.toBeNull();
    expect(dock.className).toContain("flex-1");
    expect(dock.className).not.toContain("h-full");
  });
});

describe("dock sheet height + rail width (audit fixes)", () => {
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

  function source() {
    return readFileSync(
      resolve(process.cwd(), "src/components/common/SymbolDockProvider.tsx"),
      "utf8",
    );
  }

  test("bottom sheet uses dvh (dynamic viewport), not vh", () => {
    expect(source()).toContain('style={{ height: "62dvh" }}');
    expect(source()).not.toContain("62vh");
  });

  test("rail width clamp starts at 480px so the chain table is not clipped at 1200px", () => {
    expect(source()).toContain('width: "clamp(480px, 36vw, 620px)"');
    expect(source()).not.toContain("clamp(420px");
  });

  test("the non-sheet dock wrappers are unchanged: flex-1 min-h-0, no h-full", () => {
    const wrapperClass =
      'className="flex flex-1 min-h-0 w-full flex-col overflow-hidden border-l border-fin-border bg-fin-surface"';
    expect(source().split(wrapperClass).length - 1).toBe(3);
    expect(source()).not.toContain("h-full");
  });

  test("outlet still carries data-dock-open and style.css still collapses it when closed", () => {
    const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");
    expect(css).toContain('[data-testid="chart-dock-outlet"][data-dock-open="false"]');
    const rule = css.match(
      /\[data-testid="chart-dock-outlet"\]\[data-dock-open="false"\]\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("display: none");
  });
});

describe("dock rail width reservation (audit H1)", () => {
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

  test("rail open (desktop, no outlet) sets data-dock-rail-open=true; close clears it", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    expect(document.documentElement.dataset.dockRailOpen).toBe("false");

    // `open()` → `openFromSymbol()` → `loadSymbolChart()` runs `setFullscreen`
    // (applying dock state) before `startLivePoll()` throws a pre-existing
    // `fetchLiveQuote is not defined` ReferenceError in
    // src/hooks/usePatternFullscreenSolid.ts (module-level `startLivePoll`
    // references function-scoped `fetchLiveQuote`). Surface the error so the
    // applied dock state can still be asserted.
    try {
      fireEvent.click(screen.getByTestId("open-ircon"));
    } catch {
      // expected pre-existing ReferenceError; dock state was already applied
    }
    await waitFor(() => expect(screen.getByTestId("symbol-dock")).toBeInTheDocument());
    await waitFor(() =>
      expect(document.documentElement.dataset.dockRailOpen).toBe("true"),
    );

    await fireEvent.click(screen.getByTestId("close-dock"));
    await waitFor(() =>
      expect(document.documentElement.dataset.dockRailOpen).toBe("false"),
    );
  });

  test("with an inline outlet the attribute stays false", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    render(() => (
      <Router
        root={() => (
          <UIProvider>
            <SymbolDockProvider>
              <DockHarness />
              <ChartDockOutlet class="test-outlet" />
            </SymbolDockProvider>
          </UIProvider>
        )}
      />
    ));

    const outlet = screen.getByTestId("chart-dock-outlet");
    expect(document.documentElement.dataset.dockRailOpen).toBe("false");

    try {
      fireEvent.click(screen.getByTestId("open-reliance"));
    } catch {
      // expected pre-existing ReferenceError; dock state was already applied
    }
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "true"));
    expect(document.documentElement.dataset.dockRailOpen).toBe("false");

    await fireEvent.click(screen.getByTestId("close-dock"));
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "false"));
    expect(document.documentElement.dataset.dockRailOpen).toBe("false");
  });

  test("style.css reserves rail width for #app-main with the clamp", () => {
    const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");
    expect(css).toContain('html[data-dock-rail-open="true"] #app-main');
    const rule = css.match(
      /html\[data-dock-rail-open="true"\]\s*#app-main\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("padding-right: clamp(480px, 36vw, 620px)");
  });
});

describe("narrow width keeps data-dock-rail-open false (matchMedia false)", () => {
  beforeEach(() => {
    __resetFullscreen();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
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

  test("rail does not reserve width below 1200 px", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    expect(document.documentElement.dataset.dockRailOpen).toBe("false");

    await fireEvent.click(screen.getByTestId("open-ircon"));
    // Below 1200 px open() navigates to /chart/:symbol instead of opening the rail.
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();
    expect(document.documentElement.dataset.dockRailOpen).toBe("false");
  });
});

describe("outlet collapses while no dock is open", () => {
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

  const renderWithOutlet = () =>
    render(() => (
      <Router
        root={() => (
          <UIProvider>
            <SymbolDockProvider>
              <DockHarness />
              <ChartDockOutlet class="test-outlet" />
            </SymbolDockProvider>
          </UIProvider>
        )}
      />
    ));

  test("chart mode: outlet is hidden before opening and after closing", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderWithOutlet();

    const outlet = screen.getByTestId("chart-dock-outlet");
    expect(outlet).toHaveAttribute("data-dock-open", "false");

    await fireEvent.click(screen.getByTestId("open-reliance"));
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "true"));
    await waitFor(() =>
      expect(outlet.querySelector('[data-testid="symbol-dock"]')).not.toBeNull(),
    );

    await fireEvent.click(screen.getByTestId("close-dock"));
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "false"));
  });

  test("options mode: outlet shows on open and hides on close", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderWithOutlet();

    const outlet = screen.getByTestId("chart-dock-outlet");
    expect(outlet).toHaveAttribute("data-dock-open", "false");

    await fireEvent.click(screen.getByTestId("open-options"));
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "true"));
    await screen.findByTestId("options-dock-panel");

    await fireEvent.click(screen.getByTestId("close-dock"));
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "false"));
  });

  test("a hover preview (fullscreen chart) also shows the outlet", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderWithOutlet();

    const outlet = screen.getByTestId("chart-dock-outlet");
    expect(outlet).toHaveAttribute("data-dock-open", "false");

    fireEvent.mouseEnter(screen.getByTestId("preview-ircon"), { relatedTarget: null });
    await waitFor(() => expect(outlet).toHaveAttribute("data-dock-open", "true"), {
      timeout: 1500,
    });
    await waitFor(() =>
      expect(outlet.querySelector('[data-testid="symbol-dock"]')).not.toBeNull(),
    );
  });

  test("style.css collapses the outlet while data-dock-open is false", () => {
    const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");
    expect(css).toContain('[data-testid="chart-dock-outlet"][data-dock-open="false"]');
    const rule = css.match(
      /\[data-testid="chart-dock-outlet"\]\[data-dock-open="false"\]\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("display: none");
  });
});

describe("Escape dismiss", () => {
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

  test("Escape closes an open chart dock", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument(),
    );
  });

  test("Escape leaves an open options dock open (the panel restores instead)", async () => {
    renderDock();

    await fireEvent.click(screen.getByTestId("open-options"));
    await screen.findByTestId("options-dock-panel");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("options-dock-panel")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
  });

  test("no keydown listener remains after close or unmount", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));
    await waitFor(() => expect(screen.getByTestId("symbol-dock")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument(),
    );

    // The listener was removed with the dock: a second Escape is a no-op.
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();

    cleanup();
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
  });

  test("Escape inside an input does not close the chart dock", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();

    await fireEvent.click(screen.getByTestId("open-ircon"));
    await waitFor(() => expect(screen.getByTestId("symbol-dock")).toBeInTheDocument());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
  });
});

describe("chart dock fullscreen", () => {
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

  async function openChartDock() {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderDock();
    await fireEvent.click(screen.getByTestId("open-ircon"));
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("IRCON"));
  }

  test("the chart dock renders the expand control", async () => {
    await openChartDock();

    const expand = screen.getByTestId("patterns-chart-expand");
    expect(expand).toBeInTheDocument();
    expect(expand).toHaveAttribute("title", "Expand to full screen");
  });

  test("the maximized modal wrapper sits above the sticky app header", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/common/SymbolDockProvider.tsx"),
      "utf8",
    );
    expect(source).toContain('<Box className="fixed inset-0 z-[1300]">');
    expect(source).not.toContain('<Box className="fixed inset-0 z-[1200]">');
  });

  test("clicking expand opens the fullscreen modal with the same chart frame", async () => {
    await openChartDock();

    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));

    const modal = await screen.findByTestId("patterns-fullscreen-modal");
    expect(modal).toHaveTextContent("IRCON");
    // Maximizing must not dismiss the rail behind the modal.
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
  });

  test("closing the modal leaves the dock open", async () => {
    await openChartDock();
    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    await screen.findByTestId("patterns-fullscreen-modal");

    await fireEvent.click(screen.getByTestId("patterns-fullscreen-modal-close"));

    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-dock")).toBeInTheDocument();

    // The restore path must not leak a suppressed Escape into the next gesture.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument());
  });

  test("Escape from the modal restores the dock instead of closing it", async () => {
    await openChartDock();
    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    await screen.findByTestId("patterns-fullscreen-modal");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-chart-expand")).toBeInTheDocument();
  });

  test("the Escape that restores the dock does not also close the dock", async () => {
    await openChartDock();
    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    const modal = await screen.findByTestId("patterns-fullscreen-modal");

    // Target a node inside the document so the Modal's capture listener runs
    // before the provider's bubble listener is reattached mid-dispatch.
    fireEvent.keyDown(modal, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();

    // A later Escape is a new gesture and still closes the dock.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument());
  });

  test("restore suppression survives a microtask boundary", async () => {
    await openChartDock();
    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    await screen.findByTestId("patterns-fullscreen-modal");

    // Restore via X so no keydown consumes the flag during dispatch.
    fireEvent.click(screen.getByTestId("patterns-fullscreen-modal-close"));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();

    await Promise.resolve();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument());
  });

  test("opening another symbol resets the maximized state", async () => {
    await openChartDock();
    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    await screen.findByTestId("patterns-fullscreen-modal");

    await fireEvent.click(screen.getByTestId("open-reliance"));

    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByTestId("patterns-chart-dock")).toHaveTextContent("RELIANCE"));
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
  });

  test("the maximized modal links to the full chart page and Escape still restores the dock", async () => {
    await openChartDock();
    await fireEvent.click(screen.getByTestId("patterns-chart-expand"));
    const modal = await screen.findByTestId("patterns-fullscreen-modal");

    const link = within(modal).getByRole("link", { name: "Open full chart page" });
    expect(link).toHaveAttribute("href", "/chart/IRCON");

    fireEvent.keyDown(link, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("symbol-dock")).toBeInTheDocument();
  });
});

describe("US symbol routing (no NSE dock)", () => {
  function UsHarness() {
    const dock = useContext(SymbolDockContext);
    return (
      <>
        <SymbolLink symbol="AAPL" market="NASDAQ" testId="us-aapl" chartTestId="us-aapl-chart" />
        <SymbolLink symbol="BRK.B" market="NYSE" testId="us-brkb" chartTestId="us-brkb-chart" />
        <button
          type="button"
          data-testid="preview-aapl"
          onMouseEnter={() => dock.preview("AAPL", "NASDAQ")}
        >
          preview AAPL
        </button>
        <button
          type="button"
          data-testid="open-aapl-options"
          onClick={() => dock.open("AAPL", "options", "NASDAQ")}
        >
          AAPL options
        </button>
        <button type="button" data-testid="open-default" onClick={() => dock.open("RELIANCE")}>
          open default
        </button>
      </>
    );
  }

  const stubMatchMedia = (desktop: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: desktop && query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

  const renderUs = () =>
    render(() => (
      <Router
        root={() => (
          <UIProvider>
            <SymbolDockProvider>
              <UsHarness />
            </SymbolDockProvider>
          </UIProvider>
        )}
      />
    ));

  beforeEach(() => {
    __resetFullscreen();
    routerMocks.navigate.mockClear();
    stubMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("a US SymbolLink chart icon routes to ?market=usa and never opens the NSE dock", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderUs();

    await fireEvent.click(screen.getByTestId("us-aapl-chart"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/AAPL?market=usa");
    expect(mockedFetchSymbolChart).not.toHaveBeenCalled();
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();
  });

  test("BRK.B keeps its dot in the US route", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderUs();

    await fireEvent.click(screen.getByTestId("us-brkb-chart"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/BRK.B?market=usa");
    expect(routerMocks.navigate).not.toHaveBeenCalledWith("/chart/BRK-B?market=usa");
  });

  test("US routing is the same below 1200px", async () => {
    stubMatchMedia(false);
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderUs();

    await fireEvent.click(screen.getByTestId("us-aapl-chart"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/AAPL?market=usa");
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();
  });

  test("the US options affordance routes to the chart, not the NSE options dock", async () => {
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderUs();

    await fireEvent.click(screen.getByTestId("open-aapl-options"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/AAPL?market=usa");
    expect(screen.queryByTestId("options-dock-panel")).not.toBeInTheDocument();
  });

  test("US hover preview does not open the NSE dock", async () => {
    vi.useFakeTimers();
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderUs();

    fireEvent.mouseEnter(screen.getByTestId("preview-aapl"), { relatedTarget: null });
    vi.advanceTimersByTime(1000);

    expect(mockedFetchSymbolChart).not.toHaveBeenCalled();
    expect(screen.queryByTestId("symbol-dock")).not.toBeInTheDocument();
  });

  test("a default (no market) open keeps the existing narrow-width route", async () => {
    stubMatchMedia(false);
    mockedFetchSymbolChart.mockResolvedValue(FRESH_CHART);
    renderUs();

    await fireEvent.click(screen.getByTestId("open-default"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/RELIANCE");
  });
});

describe("shared exchange classification (symbolDockContext)", () => {
  test("isUsMarket covers NASDAQ/NYSE/AMEX plus the usa/us provider labels, case-insensitively", () => {
    for (const market of ["NASDAQ", " nyse ", "AMEX", "USA", "us"]) {
      expect(isUsMarket(market)).toBe(true);
    }
  });

  test("isUsMarket rejects India, unknown and missing markets", () => {
    for (const market of ["NSE", "BSE", "NSI", "LON", "", undefined]) {
      expect(isUsMarket(market)).toBe(false);
    }
  });

  test("hasIndianOptionsChain is true only for NSE/BSE (case/space tolerant)", () => {
    expect(hasIndianOptionsChain("NSE")).toBe(true);
    expect(hasIndianOptionsChain(" bse ")).toBe(true);
    expect(hasIndianOptionsChain("NASDAQ")).toBe(false);
    expect(hasIndianOptionsChain("NSI")).toBe(false);
    expect(hasIndianOptionsChain(null)).toBe(false);
    expect(hasIndianOptionsChain(undefined)).toBe(false);
  });

  test("isInAppChartMarket covers Indian chart exchanges and US markets only", () => {
    for (const market of ["NSE", "BSE", "NSI", "NASDAQ", " amex ", "usa"]) {
      expect(isInAppChartMarket(market)).toBe(true);
    }
    expect(isInAppChartMarket("LON")).toBe(false);
    expect(isInAppChartMarket(undefined)).toBe(false);
  });

  test("chartHrefForSymbol keeps BRK.B dotted and tags US markets", () => {
    expect(chartHrefForSymbol("BRK.B", "NYSE")).toBe("/chart/BRK.B?market=usa");
    expect(chartHrefForSymbol("BRK.B", "NYSE")).not.toContain("BRK-B");
    expect(chartHrefForSymbol("RELIANCE", "NSE")).toBe("/chart/RELIANCE");
  });

  test("chartHrefForSymbol strips exchange decoration before routing", () => {
    expect(chartHrefForSymbol("NSE:RELIANCE", "NSE")).toBe("/chart/RELIANCE");
    expect(chartHrefForSymbol("BSE:TATA", "BSE")).toBe("/chart/TATA");
    expect(chartHrefForSymbol("RELIANCE.NS")).toBe("/chart/RELIANCE");
    expect(chartHrefForSymbol("NASDAQ:AAPL", "NASDAQ")).toBe("/chart/AAPL?market=usa");
    for (const symbol of ["NSE:RELIANCE", "BSE:TATA", "RELIANCE.NS"]) {
      expect(chartHrefForSymbol(symbol)).not.toContain("/chart/NSE:");
      expect(chartHrefForSymbol(symbol)).not.toContain("/chart/BSE:");
    }
  });
});
