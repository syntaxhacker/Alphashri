// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { SectorPage } from "./SectorPage2";
import type { SectorItem } from "../../types/sector";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const { mockFetchSectorPerformance } = vi.hoisted(() => ({
  mockFetchSectorPerformance: vi.fn(),
}));

vi.mock("../../api/sector", () => ({
  fetchSectorPerformance: (...args: any[]) => mockFetchSectorPerformance(...args),
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
  const RealSectorTreemap = actual.SectorTreemap;
  return {
    ...actual,
    SectorTreemap: (props: any) => <div data-testid="sector-treemap">SectorTreemap</div>,
  };
});

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

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("SectorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state during initial fetch", async () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Fetching sector performance")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure with Retry button", async () => {
    mockFetchSectorPerformance.mockRejectedValue(new Error("API Error"));
    renderWithMantine(<SectorPage />);
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
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("No sector data available for this market.")).toBeInTheDocument();
    });
  });

  it("renders Top Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Top Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("renders Top Sector card with avg change value", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      const hints = screen.getAllByText(/Avg Change:/);
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });
    const hints = screen.getAllByText(/Avg Change:/);
    expect(hints[0]).toHaveTextContent("Avg Change: +2.50%");
  });

  it("renders Weakest Sector card with sector name", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("Weakest Sector")).toBeInTheDocument();
    });
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("renders Weakest Sector card with avg change value", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      const hints = screen.getAllByText(/Avg Change:/);
      const lastHint = hints[hints.length - 1];
      expect(lastHint).toHaveTextContent("Avg Change: -1.00%");
    });
  });

  it("renders Market Breadth with UP and DOWN badges", async () => {
    mockFetchSectorPerformance.mockResolvedValue(mockResponse);
    renderWithMantine(<SectorPage />);
    await waitFor(() => {
      expect(screen.getByText("55 UP")).toBeInTheDocument();
    });
    expect(screen.getByText("70 DOWN")).toBeInTheDocument();
  });

  it("renders page title and description", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithMantine(<SectorPage />);
    expect(screen.getByText("Sector Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Real-time sector performance and technical strength.")).toBeInTheDocument();
  });

  it("renders market selector segmented control", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithMantine(<SectorPage />);
    expect(screen.getByTestId("sector-market-selector")).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithMantine(<SectorPage />);
    expect(screen.getByTestId("sector-refresh-btn")).toBeInTheDocument();
  });

  it("renders tabs: Live Dashboard, Sector Correlation, Historical Cycles", () => {
    mockFetchSectorPerformance.mockReturnValue(new Promise(() => {}));
    renderWithMantine(<SectorPage />);
    expect(screen.getByText("Live Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sector Correlation")).toBeInTheDocument();
    expect(screen.getByText("Historical Cycles")).toBeInTheDocument();
  });
});
