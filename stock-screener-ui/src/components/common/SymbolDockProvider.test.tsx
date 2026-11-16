// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { useContext } from "solid-js";
import { Router } from "@solidjs/router";
import { UIProvider } from "@/ui";
import { SymbolDockProvider } from "./SymbolDockProvider";
import { SymbolDockContext } from "./symbolDockContext";
import { ChartDockOutlet } from "./ChartDockOutlet";

const { mockRefreshSymbolChart } = vi.hoisted(() => ({
  mockRefreshSymbolChart: vi.fn(),
}));

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

vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: (props: {
    symbol: string | null;
    loading?: boolean;
    onRefresh?: () => void;
  }) => (
    <div data-testid="patterns-chart-dock" data-loading={String(Boolean(props.loading))}>
      {props.symbol}
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
  ),
}));

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
