// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SectorPage } from "./SectorPage";
import { SECTOR_SECTIONS } from "./SectorSectionNav";
import type { SectorItem } from "../../types/sector";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { SymbolDockContext } from "../common/symbolDockContext";

const { mockFetchSectorPerformance, scrollIntoViewMock, dockOpen } = vi.hoisted(() => ({
  mockFetchSectorPerformance: vi.fn(),
  scrollIntoViewMock: vi.fn(),
  dockOpen: vi.fn(),
}));

vi.mock("../../api/sector", () => ({
  fetchSectorPerformance: (...args: any[]) => mockFetchSectorPerformance(...args),
}));

vi.mock("./RotationTab", () => ({
  RotationTab: ({ market }: { market: string }) => (
    <div data-testid="rotation-tab">RotationTab {market}</div>
  ),
}));

vi.mock("./SectorCorrelationTab", () => ({
  SectorCorrelationTab: () => <div data-testid="sector-correlation-tab">SectorCorrelationTab</div>,
}));

vi.mock("./history/SectorHistoryTab", () => ({
  SectorHistoryTab: ({ market }: { market: string }) => (
    <div data-testid="sector-history-tab">SectorHistoryTab {market}</div>
  ),
}));

vi.mock("./SectorTable", () => ({
  SectorTable: () => <div data-testid="sector-table">SectorTable</div>,
  getMovementBarValue: vi.fn(),
  getStrengthInfo: vi.fn(),
}));

vi.mock("./IntervalMoversTable", () => ({
  IntervalMoversTable: () => <div data-testid="interval-movers-table">IntervalMoversTable</div>,
}));

vi.mock("./SectorHelpers", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

// The real view paints to a canvas; this DOM double exposes one tile whose
// activation mirrors the component's keyboard proxy so page wiring is testable.
vi.mock("./SectorHeatmapView", () => ({
  SectorHeatmapView: (props: { onSymbolClick?: (symbol: string) => void }) => (
    <div data-testid="sector-heatmap-view">
      <button
        type="button"
        data-testid="sector-heatmap-tile"
        onClick={() => props.onSymbolClick?.("RELIANCE")}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.onSymbolClick?.("RELIANCE");
        }}
      >
        Open RELIANCE chart
      </button>
    </div>
  ),
}));

const mockSectors: SectorItem[] = [
  { sector: "IT", avg_change: 2.5, stock_count: 50, advances: 30, declines: 20, avg_rsi: 55, avg_adx: 26, top_movers: "TCS, INFY" },
  { sector: "Pharma", avg_change: -0.5, stock_count: 35, advances: 10, declines: 25, avg_rsi: 50, avg_adx: 20, top_movers: "SUNPHARMA" },
  { sector: "Banking", avg_change: -1.0, stock_count: 40, advances: 15, declines: 25, avg_rsi: 45, avg_adx: 12, top_movers: "HDFC" },
];

const mockResponse = {
  sectors: mockSectors,
  top_stock_movers: [],
  last_updated: new Date().toISOString(),
};

function renderWithDock() {
  return render(() => (
    <SymbolDockContext.Provider
      value={{
        open: dockOpen,
        preview: vi.fn(),
        endPreview: vi.fn(),
        close: vi.fn(),
        pinned: false,
        setOutlet: vi.fn(),
      }}
    >
      <SectorPage />
    </SymbolDockContext.Provider>
  ));
}

class IntersectionObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
}

describe("SectorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dockOpen.mockClear();
    setupBrowserMocks();
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: IntersectionObserverStub,
    });
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: IntersectionObserverStub,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    window.history.replaceState({}, "", "/");
  });

  it("shows loading state during initial fetch", async () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Fetching sector performance")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sector-overview-loading")).toHaveAttribute("role", "status");
  });

  it("shows error state on fetch failure with Retry button", async () => {
    mockFetchSectorPerformance.mockRejectedValue(new Error("API Error"));
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("API Error")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByTestId("sector-overview-error")).toHaveAttribute("role", "alert");
  });

  it("shows empty state when response has no sectors", async () => {
    mockFetchSectorPerformance.mockResolvedValue({
      sectors: [],
      top_stock_movers: [],
      last_updated: null,
    });
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(
        screen.getByText("No sector data available for this market. Try another market or refresh."),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("sector-overview-empty")).toHaveAttribute("role", "status");
  });

  it("renders Top Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Top Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("keeps the top sector name whole at 390 and shows the matching change", async () => {
    mockFetchSectorPerformance.mockResolvedValue({
      ...mockResponse,
      sectors: [{ ...mockSectors[0], sector: "Technology", avg_change: 4.05 }, ...mockSectors.slice(1)],
    });
    render(() => <SectorPage />);
    const name = (await screen.findByTestId("sector-top-summary-name")) as HTMLElement;
    expect(name).toHaveTextContent("Technology");
    expect(name).toHaveAttribute("title", "Technology");
    expect(name.className).not.toMatch(/\btruncate\b|\bhidden\b/);

    // Both ends of the strip expose the same fields; the top change used to be
    // hidden below sm while the weakest change stayed visible.
    expect(screen.getByTestId("sector-top-summary-change")).toHaveTextContent(
      "Avg Change: +4.05%",
    );
    expect(screen.getByTestId("sector-bottom-summary-change")).toHaveTextContent(
      "Avg Change: -1.00%",
    );
    expect(screen.getByTestId("sector-top-summary-change").className).not.toMatch(/\bhidden\b/);
  });

  it("renders Top Sector card with avg change value", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => {
      const hints = screen.getAllByText(/Avg Change:/);
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });
    const hints = screen.getAllByText(/Avg Change:/);
    expect(hints[0]).toHaveTextContent("Avg Change: +2.50%");
  });

  it("renders Weakest Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Weakest Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("renders Weakest Sector card with avg change value", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => {
      const hints = screen.getAllByText(/Avg Change:/);
      const lastHint = hints[hints.length - 1];
      expect(lastHint).toHaveTextContent("Avg Change: -1.00%");
    });
  });

  it("renders Market Breadth with UP and DOWN badges", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("55 UP")).toBeInTheDocument();
    });
    expect(screen.getByText("70 DOWN")).toBeInTheDocument();
  });

  it("keeps all three summary groups readable without clipping at 390", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    const strip = await screen.findByTestId("sector-summary-strip");
    expect(strip).toHaveClass("flex-wrap");
    expect(strip.className).not.toMatch(/\boverflow-hidden\b/);
    for (const label of ["Top Sector", "Market Breadth", "Weakest Sector"]) {
      expect(within(strip).getByText(label)).toBeVisible();
      expect(within(strip).getByText(label).className).not.toMatch(/\bhidden\b/);
    }
    const bar = screen.getByTestId("sector-context-bar");
    expect(bar.className).not.toMatch(/\boverflow-hidden\b/);
  });

  it("keeps Refresh in the header without a fixed-height clip", async () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    const header = screen.getByTestId("sector-header");
    expect(header.className).not.toMatch(/\boverflow-hidden\b/);
    expect(within(header).getByTestId("sector-refresh-btn")).toHaveClass("shrink-0");
  });

  it("renders page title and description", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.getByText("Sector Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Real-time sector performance and technical strength.")).toBeInTheDocument();
  });

  it("renders market selector segmented control", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.getByTestId("sector-market-selector")).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.getByTestId("sector-refresh-btn")).toBeInTheDocument();
  });

  it("forces a cache-bypassing refresh when Refresh is clicked", async () => {
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    await waitFor(() => expect(screen.getByTestId("sector-heatmap-view")).toBeInTheDocument());
    mockFetchSectorPerformance.mockClear();

    fireEvent.click(screen.getByTestId("sector-refresh-btn"));

    await waitFor(() => {
      expect(mockFetchSectorPerformance).toHaveBeenCalledWith("india", expect.anything(), true);
    });
  });

  it("fetches sector performance once on mount and not on section navigation", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByTestId("sector-heatmap-view")).toBeInTheDocument());
    expect(mockFetchSectorPerformance).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("sector-nav-rotation"));
    await waitFor(() => expect(screen.getByTestId("rotation-tab")).toBeInTheDocument());
    expect(mockFetchSectorPerformance).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight request when the market selector changes", async () => {
    const signals: AbortSignal[] = [];
    mockFetchSectorPerformance.mockImplementation((_market: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    render(() => <SectorPage />);
    await waitFor(() => expect(signals).toHaveLength(1));

    const selector = screen.getByTestId("sector-market-selector");
    fireEvent.click(within(selector).getByRole("button", { name: "US" }));

    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(mockFetchSectorPerformance.mock.calls.map((call) => call[0])).toEqual(["india", "america"]);
  });

  it("collapses sparse side-panel bodies instead of leaving large blank cards", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByTestId("sector-alerts-card")).toBeInTheDocument());

    for (const cardId of ["sector-alerts-card", "sector-interval-movers-card", "sector-top-stocks-card"]) {
      const card = screen.getByTestId(cardId);
      expect(card.className).not.toMatch(/\bh-full\b/);
      const scroller = card.querySelector<HTMLElement>(".overflow-auto");
      expect(scroller, `${cardId} has no scroll area`).not.toBeNull();
      expect(scroller).toHaveClass("min-h-0");
      expect(scroller!.className).toMatch(/max-h-\[/);
      expect(scroller).not.toHaveAttribute("flex");
    }
  });

  it("shows the MOVE scale so the bars have a readable range", async () => {
    window.history.replaceState({}, "", "/sector?dash=table");
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    const scale = screen.getByTestId("sector-move-scale");
    expect(scale).toHaveTextContent("MOVE −3% · 0 · +3%");
    expect(scale.className).not.toMatch(/\bhidden\b|sm:inline/);
  });

  it("switches from the default visual overview to the dense table and back", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-container")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Table"));
    expect(await screen.findByTestId("sector-table-container")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Visual"));
    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-container")).not.toBeInTheDocument();
  });

  it("defaults to the visual overview with no performance table", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-container")).not.toBeInTheDocument();
    expect(screen.queryByText("Sector Performance")).not.toBeInTheDocument();
  });

  it("renders the dense performance table for ?dash=table and no heatmap", async () => {
    window.history.replaceState({}, "", "/sector?dash=table");
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    expect(await screen.findByTestId("sector-table-container")).toBeInTheDocument();
    expect(screen.getByTestId("sector-table")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
  });

  it("keeps the visual overview for old ?dash=visual links", async () => {
    window.history.replaceState({}, "", "/sector?dash=visual");
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-container")).not.toBeInTheDocument();
  });

  it("writes dash=table for Table and removes it for Visual, persisting through a remount", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await screen.findByTestId("sector-heatmap-view");
    expect(new URLSearchParams(window.location.search).get("dash")).toBeNull();

    fireEvent.click(screen.getByText("Table"));
    await screen.findByTestId("sector-table-container");
    expect(new URLSearchParams(window.location.search).get("dash")).toBe("table");

    fireEvent.click(screen.getByText("Visual"));
    await screen.findByTestId("sector-heatmap-view");
    expect(new URLSearchParams(window.location.search).get("dash")).toBeNull();
    expect(window.location.search).not.toContain("dash=");

    cleanup();
    render(() => <SectorPage />);
    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-container")).not.toBeInTheDocument();
  });

  it("restores table mode from ?dash=table after a refresh", async () => {
    window.history.replaceState({}, "", "/sector?dash=table");
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await screen.findByTestId("sector-table-container");

    cleanup();
    render(() => <SectorPage />);
    expect(await screen.findByTestId("sector-table-container")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
  });

  it("puts the heatmap first and splits alerts/movers and top stocks into the visual grid", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    const layout = await screen.findByTestId("sector-visual-layout");
    const panel = screen.getByTestId("sector-heatmap-panel");
    expect(layout.firstElementChild).toBe(panel);
    expect(within(panel).getByTestId("sector-heatmap-context")).toBeInTheDocument();

    const grid = screen.getByTestId("sector-visual-grid");
    expect(within(grid).getByTestId("sector-alerts-card")).toBeInTheDocument();
    expect(within(grid).getByTestId("sector-interval-movers-card")).toBeInTheDocument();
    expect(within(grid).getByTestId("sector-top-stocks-card")).toBeInTheDocument();
    expect(screen.getByTestId("sector-summary-strip")).toBeInTheDocument();
    expect(screen.queryByTestId("sector-table-container")).not.toBeInTheDocument();
    expect(screen.queryByText("Sector Performance")).not.toBeInTheDocument();
  });

  it("stacks the visual overview in one column at 390 with no fixed page width", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    const grid = await screen.findByTestId("sector-visual-grid");
    expect(grid).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(grid).toHaveClass("lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]");

    const layout = screen.getByTestId("sector-visual-layout");
    const page = screen.getByTestId("sector-analysis-view");
    for (const node of [grid, layout, page]) {
      expect(node.className).not.toMatch(/(^|\s)(w|min-w|max-w)-\[\d+px\]/);
      expect((node as HTMLElement).style.width).toBe("");
    }
  });

  it("opens the app-wide dock from a visual heatmap tile by click and Enter", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithDock();
    const tile = await screen.findByTestId("sector-heatmap-tile");

    fireEvent.click(tile);
    expect(dockOpen).toHaveBeenCalledWith("RELIANCE", "chart", "india");

    fireEvent.keyDown(tile, { key: "Enter" });
    expect(dockOpen).toHaveBeenCalledTimes(2);
    expect(dockOpen).toHaveBeenLastCalledWith("RELIANCE", "chart", "india");

    fireEvent.keyDown(tile, { key: " " });
    expect(dockOpen).toHaveBeenCalledTimes(3);
    expect(dockOpen).toHaveBeenLastCalledWith("RELIANCE", "chart", "india");
  });

  it("renders Top Gainers as dock buttons, not raw /chart anchors", async () => {
    mockFetchSectorPerformance.mockResolvedValue({
      ...mockResponse,
      top_stock_movers: [{ symbol: "RELIANCE", change: 1.2 }],
    });
    renderWithDock();
    const button = await screen.findByTestId("sector-top-stock-RELIANCE");
    expect(button.tagName).toBe("BUTTON");
    expect(document.querySelector('a[href="/chart/RELIANCE"]')).toBeNull();

    fireEvent.click(button);
    expect(dockOpen).toHaveBeenCalledWith("RELIANCE", "chart", "india");
  });

  it("stacks four sections in order with no tab bar", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Live Dashboard")).not.toBeInTheDocument();
    const sections = Array.from(document.querySelectorAll("[data-section]")).map((node) =>
      node.getAttribute("data-section"),
    );
    expect(sections).toEqual(SECTOR_SECTIONS.map((section) => section.id));
    for (const section of SECTOR_SECTIONS) {
      const wrapper = screen.getByTestId(`sector-section-${section.id}`);
      expect(wrapper).toHaveAttribute("tabindex", "-1");
      expect(wrapper).toHaveAttribute("aria-label", section.label);
    }
  });

  it("renders a single horizontally scrolling anchor rail under the toolbar", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const nav = screen.getByRole("navigation", { name: "Sector sections" });
    expect(nav).toHaveAttribute("data-testid", "sector-section-nav");
    expect(nav).toHaveClass("overflow-x-auto");
    expect(nav).toHaveClass("flex-nowrap");
    expect(nav).toHaveClass("sticky");
    for (const section of SECTOR_SECTIONS) {
      const link = screen.getByTestId(`sector-nav-${section.id}`);
      expect(link).toHaveAttribute("href", `#${section.id}`);
      expect(link).toHaveTextContent(section.label);
      expect(link.tagName).toBe("A");
    }
  });

  it("force-mounts the anchor target, scrolls, writes the hash and focuses the section", async () => {
    window.history.replaceState({}, "", "/sector?market=america");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    expect(screen.queryByTestId("rotation-tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("sector-section-rotation-skeleton")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sector-nav-rotation"));

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    expect(window.location.hash).toBe("#rotation");
    expect(window.location.search).toContain("market=america");
    expect(window.location.search).not.toContain("tab=");
    expect(document.activeElement).toBe(screen.getByTestId("sector-section-rotation"));
  });

  it("falls back to scrolling the nested page when scrollIntoView is a no-op", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const root = screen.getByTestId("sector-tab-content") as HTMLElement & { scrollTo: () => void };
    const target = screen.getByTestId("sector-section-rotation");
    const scrollTo = vi.fn();
    root.scrollTo = scrollTo;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);

    fireEvent.click(screen.getByTestId("sector-nav-rotation"));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 152, behavior: "auto" });
  });

  it("mounts the remaining sections after the first user scroll", async () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    expect(screen.queryByTestId("rotation-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-correlation-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-history-tab")).not.toBeInTheDocument();

    fireEvent.scroll(screen.getByTestId("sector-tab-content"));

    expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    expect(screen.getByTestId("sector-correlation-tab")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("sector-history-tab")).toBeInTheDocument());
  });

  it("maps a legacy ?tab=rotation link to #rotation and removes the query param", () => {
    window.history.replaceState({}, "", "/sector?tab=rotation&market=america");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    expect(window.location.hash).toBe("#rotation");
    expect(window.location.search).toContain("market=america");
    expect(window.location.search).not.toContain("tab=");
    expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    expect(screen.getByTestId("sector-nav-rotation")).toHaveAttribute("aria-current", "location");
  });

  it("maps legacy dashboard and unknown tab values to #overview", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    window.history.replaceState({}, "", "/?tab=dashboard");
    render(() => <SectorPage />);
    expect(window.location.hash).toBe("#overview");
    expect(window.location.search).not.toContain("tab=");
    cleanup();

    window.history.replaceState({}, "", "/?tab=nonsense");
    render(() => <SectorPage />);
    expect(window.location.hash).toBe("#overview");
    expect(window.location.search).not.toContain("tab=");
    expect(screen.getByTestId("sector-nav-overview")).toHaveAttribute("aria-current", "location");
  });

  it("deep-links a history hash, mounts the lazy chunk and scrolls it into view", async () => {
    window.history.replaceState({}, "", "/sector#history");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const target = screen.getByTestId("sector-section-history");

    expect(await screen.findByTestId("sector-history-tab")).toBeInTheDocument();
    expect(screen.getByText("SectorHistoryTab india")).toBeInTheDocument();
    expect(document.activeElement).toBe(target);
    expect(screen.getByTestId("sector-nav-history")).toHaveAttribute(
      "aria-current",
      "location",
    );
    // The section is actually scrolled, not merely focused in the DOM.
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
  });

  it("settles Correlation after a lazy Rotation expands above it", async () => {
    window.history.replaceState({}, "", "/sector#history");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const layout = { scrollTop: 0, rotationHeight: 700 };
    const root = screen.getByTestId("sector-tab-content") as HTMLElement;
    const overview = screen.getByTestId("sector-section-overview");
    const rotation = screen.getByTestId("sector-section-rotation");
    const correlation = screen.getByTestId("sector-section-correlation");
    const history = screen.getByTestId("sector-section-history");
    const mobile = { width: 390, height: 844, x: 0, y: 0 } as DOMRect;
    const rect = (top: number): DOMRect =>
      ({ ...mobile, top, bottom: top + 1000, left: 0, right: 390 }) as DOMRect;

    root.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      layout.scrollTop = Math.max(0, top ?? 0);
    }) as unknown as typeof root.scrollTo;
    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      get: () => layout.scrollTop,
      set: (value: number) => {
        layout.scrollTop = value;
      },
    });
    const restores = [
      vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => rect(0)),
      vi.spyOn(overview, "getBoundingClientRect").mockImplementation(() => rect(-layout.scrollTop)),
      vi.spyOn(rotation, "getBoundingClientRect").mockImplementation(() => rect(700 - layout.scrollTop)),
      vi.spyOn(correlation, "getBoundingClientRect").mockImplementation(() =>
        rect(700 + layout.rotationHeight - layout.scrollTop),
      ),
      vi.spyOn(history, "getBoundingClientRect").mockImplementation(() =>
        rect(700 + layout.rotationHeight + 1000 - layout.scrollTop),
      ),
    ];

    try {
      // Let the initial History settle reach the sticky offset.
      await waitFor(() => {
        const top = history.getBoundingClientRect().top - root.getBoundingClientRect().top;
        expect(Math.round(top)).toBe(48);
      });

      fireEvent.click(screen.getByTestId("sector-nav-correlation"));
      // The mocked RotationTab lazy body expands after the click, moving the
      // Correlation target down by 1,700px.
      layout.rotationHeight = 2400;

      await waitFor(
        () => {
          const top = correlation.getBoundingClientRect().top - root.getBoundingClientRect().top;
          expect(Math.round(top)).toBe(48);
        },
        { timeout: 3000 },
      );
      expect(screen.getByTestId("sector-nav-correlation")).toHaveAttribute(
        "aria-current",
        "location",
      );
      expect(document.activeElement).toBe(correlation);
    } finally {
      for (const restore of restores) restore.mockRestore();
    }
  });

  it("makes the focusable region the sole horizontal scroller with a sideways cue", async () => {
    window.history.replaceState({}, "", "/sector?dash=table");
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    const region = screen.getByTestId("sector-table-container");
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("aria-label", "Sector performance table, scroll sideways for all columns");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-scroll", "horizontal");
    expect(region).toHaveClass("overflow-x-auto");
    const scrollStyle = screen.getByTestId("sector-table-scroll-style").textContent ?? "";
    expect(scrollStyle).toContain('[data-testid="sector-table-container"] .paper-tanstack-container');
    expect(scrollStyle).toContain("overflow: visible");
    const cue = screen.getByTestId("sector-table-scroll-cue");
    expect(cue).toHaveTextContent("Scroll sideways");
  });

  it("scrolls the focused table region itself with arrow keys", async () => {
    window.history.replaceState({}, "", "/sector?dash=table");
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    const region = screen.getByTestId("sector-table-container") as HTMLElement;
    region.scrollLeft = 10;
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(region.scrollLeft).toBe(90);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(region.scrollLeft).toBe(10);
  });

  it("scrolling the page instead of #app-main, with no nested vertical clip", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const root = screen.getByTestId("sector-analysis-view");
    for (const cls of ["h-full", "min-h-0", "flex", "flex-col", "overflow-hidden"]) {
      expect(root).toHaveClass(cls);
    }
    const page = screen.getByTestId("sector-tab-content");
    expect(page).toHaveClass("flex-1");
    expect(page).toHaveClass("min-h-0");
    expect(page).toHaveClass("overflow-y-auto");
    expect(page).toHaveClass("overflow-x-hidden");
    expect(page.className).not.toMatch(/\boverflow-hidden\b/);
  });

  it("does not render the legacy Historical Cycles tab", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.queryByText("Historical Cycles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-analysis-frame")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-iframe")).not.toBeInTheDocument();
  });
});
