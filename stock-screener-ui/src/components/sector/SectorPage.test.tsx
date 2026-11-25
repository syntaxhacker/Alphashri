// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SectorPage } from "./SectorPage";
import type { SectorItem } from "../../types/sector";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const { mockFetchSectorPerformance } = vi.hoisted(() => ({
  mockFetchSectorPerformance: vi.fn(),
}));

vi.mock("../../api/sector", () => ({
  fetchSectorPerformance: (...args: any[]) => mockFetchSectorPerformance(...args),
}));

vi.mock("./RotationTab", () => ({
  RotationTab: ({ market }: { market: string }) => (
    <div data-testid="rotation-tab">RotationTab {market}</div>
  ),
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

vi.mock("./SectorHeatmapView", () => ({
  SectorHeatmapView: () => <div data-testid="sector-heatmap-view">SectorHeatmapView</div>,
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

describe("SectorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
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
  });

  it("shows error state on fetch failure with Retry button", async () => {
    mockFetchSectorPerformance.mockRejectedValue(new Error("API Error"));
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("API Error")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows empty state when response has no sectors", async () => {
    mockFetchSectorPerformance.mockResolvedValue({
      sectors: [],
      top_stock_movers: [],
      last_updated: null,
    });
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("No sector data available for this market.")).toBeInTheDocument();
    });
  });

  it("renders Top Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Top Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("keeps the top sector name whole at 390 — no mid-word ellipsis, full name in the title", async () => {
    mockFetchSectorPerformance.mockResolvedValue({
      ...mockResponse,
      sectors: [{ ...mockSectors[0], sector: "Technology" }, ...mockSectors.slice(1)],
    });
    render(() => <SectorPage />);
    const name = (await screen.findByTestId("sector-top-summary-name")) as HTMLElement;
    expect(name).toHaveTextContent("Technology");
    // Native tooltip carries the full value even if a narrow parent clips it.
    expect(name).toHaveAttribute("title", "Technology");
    // CSS ellipsis would cut a single word into "Techno…"; the name must wrap instead.
    expect(name.style.textOverflow).not.toBe("ellipsis");
    expect(name.style.whiteSpace).not.toBe("nowrap");
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

    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    mockFetchSectorPerformance.mockClear();

    fireEvent.click(screen.getByTestId("sector-refresh-btn"));

    await waitFor(() => {
      expect(mockFetchSectorPerformance).toHaveBeenCalledWith("india", expect.anything(), true);
    });
  });

  it("makes every dashboard side-panel scroll area fill its card", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());

    for (const cardId of ["sector-alerts-card", "sector-interval-movers-card", "sector-top-stocks-card"]) {
      const card = screen.getByTestId(cardId);
      const scroller = card.querySelector<HTMLElement>(".overflow-auto");
      expect(scroller, `${cardId} has no scroll area`).not.toBeNull();
      expect(scroller).toHaveClass("min-h-0");
      expect(scroller).toHaveClass("flex-1");
      // `flex` is not a ScrollArea prop; it must never leak to the DOM as an attribute.
      expect(scroller).not.toHaveAttribute("flex");
    }
  });

  it("switches between the dense table view and the visual heatmap view", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);

    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Visual"));
    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Table"));
    await waitFor(() => {
      expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
    });
  });

  it("renders tabs: Live Dashboard, Sector Correlation, Rotation, History", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.getByText("Live Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sector Correlation")).toBeInTheDocument();
    expect(screen.getByText("Rotation")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("keeps the tab strip scrollable with one-line labels and an overflow cue", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    const strip = screen.getByTestId("sector-tabs-list");
    expect(strip).toHaveClass("overflow-x-auto");
    expect(strip).toHaveClass("flex-nowrap");
    for (const label of ["Live Dashboard", "Sector Correlation", "Rotation", "History"]) {
      const tab = screen.getByText(label).closest('[role="tab"]');
      expect(tab).toHaveClass("whitespace-nowrap");
    }
    const cue = screen.getByTestId("sector-tabs-overflow-cue");
    expect(cue).toHaveTextContent("→");
    expect(cue).toHaveClass("lg:hidden");
  });

  it("reaches and selects off-screen tabs with arrow keys inside the scroll strip", async () => {
    window.history.replaceState({}, "", "/sector");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    const dashboardTab = screen.getByText("Live Dashboard").closest('[role="tab"]')!;
    fireEvent.keyDown(dashboardTab, { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getByText("Sector Correlation").closest('[role="tab"]')).toHaveAttribute("aria-selected", "true");
    });
    expect(window.location.search).toContain("tab=correlation");

    // A second hop reaches Rotation, a third reaches History — the tab clipped at 390.
    const correlationTab = screen.getByText("Sector Correlation").closest('[role="tab"]')!;
    fireEvent.keyDown(correlationTab, { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getByText("Rotation").closest('[role="tab"]')).toHaveAttribute("aria-selected", "true");
    });
    expect(window.location.search).toContain("tab=rotation");

    const rotationTab = screen.getByText("Rotation").closest('[role="tab"]')!;
    fireEvent.keyDown(rotationTab, { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getByText("History").closest('[role="tab"]')).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(window.location.search).toContain("tab=history");
  });

  it("makes the focusable region the sole horizontal scroller with a sideways cue", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    const region = screen.getByTestId("sector-table-container");
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("aria-label", "Sector performance table, scroll sideways for all columns");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-scroll", "horizontal");
    expect(region).toHaveClass("overflow-x-auto");
    expect(region).toHaveClass("overflow-y-auto");
    // The shared table's own scrollport is switched off, so there is no
    // nested overflow:auto competing with the focused region.
    const scrollStyle = screen.getByTestId("sector-table-scroll-style").textContent ?? "";
    expect(scrollStyle).toContain('[data-testid="sector-table-container"] .paper-tanstack-container');
    expect(scrollStyle).toContain('[data-testid="sector-table-container"] .paper-tanstack-scroll');
    expect(scrollStyle).toContain("overflow: visible");
    const cue = screen.getByTestId("sector-table-scroll-cue");
    expect(cue).toHaveTextContent("Scroll sideways");
    expect(cue).toHaveClass("lg:hidden");
  });

  it("scrolls the focused table region itself with arrow keys", async () => {
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

  it("keeps the route root and tab host bounded so #app-main never scrolls", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const root = screen.getByTestId("sector-analysis-view");
    for (const cls of ["h-full", "min-h-0", "flex", "flex-col", "overflow-hidden"]) {
      expect(root).toHaveClass(cls);
    }

    // The page-level `overflow-auto` box is gone: each tab owns its scroll.
    const page = document.getElementById("sector-page") as HTMLElement;
    expect(page).toHaveClass("flex-1");
    expect(page).toHaveClass("min-h-0");
    expect(page).toHaveClass("overflow-hidden");
    expect(page.className).not.toMatch(/\boverflow-auto\b/);

    const host = screen.getByTestId("sector-tab-content");
    expect(host).toHaveClass("flex-1");
    expect(host).toHaveClass("min-h-0");
    expect(host).toHaveClass("flex-col");
    expect(host).toHaveClass("overflow-hidden");
  });

  it("gives the History tab a bounded host instead of a page-level scroller", () => {
    window.history.replaceState({}, "", "/?tab=history");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    const host = screen.getByTestId("sector-tab-content");
    expect(host).toHaveClass("flex-1");
    expect(host).toHaveClass("min-h-0");
    expect(host).toHaveClass("overflow-hidden");
    // The lazy fallback must fill the same bounded area, not define its own page height.
    expect(host).toContainElement(screen.getByTestId("sector-history-tab"));
  });

  it("does not render the legacy Historical Cycles tab", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.queryByText("Historical Cycles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-analysis-frame")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-iframe")).not.toBeInTheDocument();
  });

  it("renders RotationTab when ?tab=rotation and does not poll sector data", () => {
    window.history.replaceState({}, "", "/?tab=rotation");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    expect(screen.getByText("RotationTab india")).toBeInTheDocument();
    expect(mockFetchSectorPerformance).not.toHaveBeenCalled();
  });

  it("renders SectorHistoryTab when ?tab=history and does not poll sector data", () => {
    window.history.replaceState({}, "", "/?tab=history");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    expect(screen.getByTestId("sector-history-tab")).toBeInTheDocument();
    expect(screen.getByText("SectorHistoryTab india")).toBeInTheDocument();
    expect(mockFetchSectorPerformance).not.toHaveBeenCalled();
  });

  it("syncs the active tab to ?tab= while preserving other params", async () => {
    window.history.replaceState({}, "", "/sector?market=america");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);
    fireEvent.click(screen.getByText("Rotation"));
    await waitFor(() => {
      expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    });
    expect(window.location.search).toContain("tab=rotation");
    expect(window.location.search).toContain("market=america");
  });
});
