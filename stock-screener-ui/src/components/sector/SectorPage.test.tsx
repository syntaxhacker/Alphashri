// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SectorPage } from "./SectorPage";
import { SECTOR_SECTIONS } from "./SectorSectionNav";
import type { SectorItem } from "../../types/sector";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const { mockFetchSectorPerformance, scrollIntoViewMock } = vi.hoisted(() => ({
  mockFetchSectorPerformance: vi.fn(),
  scrollIntoViewMock: vi.fn(),
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
    expect(name).toHaveAttribute("title", "Technology");
    expect(name).toHaveClass("w-full");
    expect(name).toHaveClass("whitespace-nowrap");
    expect(name.className).not.toMatch(/\btruncate\b/);
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

    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    mockFetchSectorPerformance.mockClear();

    fireEvent.click(screen.getByTestId("sector-refresh-btn"));

    await waitFor(() => {
      expect(mockFetchSectorPerformance).toHaveBeenCalledWith("india", expect.anything(), true);
    });
  });

  it("fetches sector performance once on mount and not on section navigation", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());

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
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    render(() => <SectorPage />);
    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    const scale = screen.getByTestId("sector-move-scale");
    expect(scale).toHaveTextContent("MOVE −3% · 0 · +3%");
    expect(scale.className).not.toMatch(/\bhidden\b|sm:inline/);
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

  it("deep-links a history hash and force-mounts the lazy chunk", () => {
    window.history.replaceState({}, "", "/sector#history");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    render(() => <SectorPage />);

    expect(screen.getByTestId("sector-history-tab")).toBeInTheDocument();
    expect(screen.getByText("SectorHistoryTab india")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("sector-section-history"));
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
    const scrollStyle = screen.getByTestId("sector-table-scroll-style").textContent ?? "";
    expect(scrollStyle).toContain('[data-testid="sector-table-container"] .paper-tanstack-container');
    expect(scrollStyle).toContain("overflow: visible");
    const cue = screen.getByTestId("sector-table-scroll-cue");
    expect(cue).toHaveTextContent("Scroll sideways");
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
