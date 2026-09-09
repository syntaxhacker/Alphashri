// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import ChartView from "./ChartView";
import { fetchChartPreview } from "../../api/chartPreview";
import { UIProvider } from "@/ui";
import { useParams, useNavigate } from "react-router-dom";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock lightweight-charts (TradingViewChart)
const mockRemove = vi.fn();
const mockChartApi = {
  addSeries: () => ({
    setData: vi.fn(),
    createPriceLine: vi.fn(),
    removePriceLine: vi.fn(),
    priceToCoordinate: () => 100,
    coordinateToPrice: () => 100,
    priceScale: () => ({ applyOptions: vi.fn() }),
  }),
  timeScale: () => ({
    setVisibleRange: vi.fn(),
    fitContent: vi.fn(),
    timeToCoordinate: () => 100,
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
  }),
  applyOptions: vi.fn(),
  remove: mockRemove,
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
};

vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CandlestickSeries: {},
  HistogramSeries: {},
  LineSeries: {},
  createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
  createChart: vi.fn(() => mockChartApi),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setupBrowserMocks();
});

afterEach(() => {
  cleanup();
});

// Mock API
vi.mock("../../api/chartPreview", () => ({
  fetchChartPreview: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
}));

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useColorScheme: vi.fn(() => ({ colorScheme: "light" })),
  };
});

describe("ChartView", () => {
  const mockChartData = {
    symbol: "TEST",
    candles: [
      { time: "2025-06-15 09:15:00", open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    ],
    orb_zones: [],
    pivot_levels: [],
    high_52w: 150,
  };

  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.mocked(useNavigate).mockReturnValue(mockNavigate);
    mockRemove.mockClear();
  });

  it("renders chart view container", () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    expect(screen.getByTestId("chart-view")).toBeInTheDocument();
  });

  it("fetches chart data on mount with symbol from params", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 5, 45);
    });
  });

  it("shows loading state initially", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    );
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-loading")).toBeInTheDocument();
    });
  });

  it("handles fetch error", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockRejectedValue(new Error("Failed to fetch"));
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-error")).toBeInTheDocument();
    });
  });

  it("renders timeframe selector", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-timeframe-select")).toBeInTheDocument();
    });
  });

  it("changes timeframe when selector changes", async () => {
    const user = userEvent.setup();
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 5, 45);
    });
    const select = screen.getByTestId("chart-timeframe-select");
    await user.selectOptions(select, "5");
    expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 5, 5, 45);
  });

  it("renders OR minutes selector", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-or-select")).toBeInTheDocument();
    });
  });

  it("changes OR minutes when selector changes", async () => {
    const user = userEvent.setup();
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 5, 45);
    });
    const select = screen.getByTestId("chart-or-select");
    await user.selectOptions(select, "30");
    expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 5, 30);
  });

  it("shows toggle for pivots", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-pivots-checkbox")).toBeInTheDocument();
    });
  });

  it("shows toggle for 52w high", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-52w-checkbox")).toBeInTheDocument();
    });
  });

  it("toggles pivots checkbox", async () => {
    const user = userEvent.setup();
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("candlestick-chart")).toBeInTheDocument();
    });
    const checkbox = screen.getByTestId("chart-pivots-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("navigates back when goBack is called", async () => {
    const user = userEvent.setup();
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-back-btn")).toBeInTheDocument();
    });
    const backBtn = screen.getByTestId("chart-back-btn");
    await user.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("displays chart footer with data", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-footer")).toBeInTheDocument();
    });
    expect(screen.getByText(/1 candles/)).toBeInTheDocument();
    expect(screen.getByText(/TF: 15m/)).toBeInTheDocument();
    expect(screen.getByText(/OR: 45m/)).toBeInTheDocument();
    expect(screen.getByText(/52W High: ₹150\.00/)).toBeInTheDocument();
  });

  it("renders tradingview chart on data load", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    });
  });

  it("removes chart instance on cleanup", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    const { unmount } = render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    });
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });

  it("shows retry button in error state", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockRejectedValue(new Error("Network error"));
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-retry-btn")).toBeInTheDocument();
    });
  });

  it("navigates back when symbol param is missing", async () => {
      const user = userEvent.setup();
    const mockNavigate = vi.fn();
    vi.mocked(useNavigate).mockReturnValue(mockNavigate);
    vi.mocked(useParams).mockReturnValue({ symbol: "" });
    render(
      <UIProvider>
        <ChartView />
      </UIProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chart-view-error")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Back to Screener"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
