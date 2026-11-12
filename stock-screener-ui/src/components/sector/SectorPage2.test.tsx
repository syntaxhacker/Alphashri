// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SectorPage } from "./SectorPage2";
import type { SectorItem } from "../../types/sector";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { renderWithProviders } from "../../test-utils/renderWithProviders";

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
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Fetching sector performance")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure with Retry button", async () => {
    mockFetchSectorPerformance.mockRejectedValue(new Error("API Error"));
    renderWithProviders(<SectorPage />);
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
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("No sector data available for this market.")).toBeInTheDocument();
    });
  });

  it("renders Top Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Top Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("renders Top Sector card with avg change value", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      const hints = screen.getAllByText(/Avg Change:/);
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });
    const hints = screen.getAllByText(/Avg Change:/);
    expect(hints[0]).toHaveTextContent("Avg Change: +2.50%");
  });

  it("renders Weakest Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Weakest Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("renders Weakest Sector card with avg change value", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      const hints = screen.getAllByText(/Avg Change:/);
      const lastHint = hints[hints.length - 1];
      expect(lastHint).toHaveTextContent("Avg Change: -1.00%");
    });
  });

  it("renders Market Breadth with UP and DOWN badges", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("55 UP")).toBeInTheDocument();
    });
    expect(screen.getByText("70 DOWN")).toBeInTheDocument();
  });

  it("renders page title and description", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    expect(screen.getByText("Sector Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Real-time sector performance and technical strength.")).toBeInTheDocument();
  });

  it("renders market selector segmented control", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    expect(screen.getByTestId("sector-market-selector")).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    expect(screen.getByTestId("sector-refresh-btn")).toBeInTheDocument();
  });

  it("forces a cache-bypassing refresh when Refresh is clicked", async () => {
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);

    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    mockFetchSectorPerformance.mockClear();

    fireEvent.click(screen.getByTestId("sector-refresh-btn"));

    await waitFor(() => {
      expect(mockFetchSectorPerformance).toHaveBeenCalledWith("india", expect.anything(), true);
    });
  });

  it("switches between the dense table view and the visual heatmap view", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithProviders(<SectorPage />);

    await waitFor(() => expect(screen.getByText("Sector Performance")).toBeInTheDocument());
    expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Visual"));
    expect(await screen.findByTestId("sector-heatmap-view")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Table"));
    await waitFor(() => {
      expect(screen.queryByTestId("sector-heatmap-view")).not.toBeInTheDocument();
    });
  });

  it("renders tabs: Live Dashboard, Sector Correlation, Rotation", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    expect(screen.getByText("Live Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sector Correlation")).toBeInTheDocument();
    expect(screen.getByText("Rotation")).toBeInTheDocument();
  });

  it("does not render the legacy Historical Cycles tab", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    expect(screen.queryByText("Historical Cycles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-analysis-frame")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sector-iframe")).not.toBeInTheDocument();
  });

  it("renders RotationTab when ?tab=rotation and does not poll sector data", () => {
    window.history.replaceState({}, "", "/?tab=rotation");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    expect(screen.getByText("RotationTab india")).toBeInTheDocument();
    expect(mockFetchSectorPerformance).not.toHaveBeenCalled();
  });

  it("syncs the active tab to ?tab= while preserving other params", async () => {
    window.history.replaceState({}, "", "/sector?market=america");
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SectorPage />);
    fireEvent.click(screen.getByText("Rotation"));
    await waitFor(() => {
      expect(screen.getByTestId("rotation-tab")).toBeInTheDocument();
    });
    expect(window.location.search).toContain("tab=rotation");
    expect(window.location.search).toContain("market=america");
  });
});
