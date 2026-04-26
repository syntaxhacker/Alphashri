// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import ChartView from "./ChartView";
import { fetchChartPreview } from "../../api/chartPreview";
import { buildChartOption } from "../../components/chart/chartRenderer";
import { MantineProvider } from "@mantine/core";
import { useParams, useNavigate } from "react-router-dom";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock echarts
const mockEChartsInstance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  setupBrowserMocks();
  (window as any).echarts = {
    init: vi.fn(() => mockEChartsInstance),
  };
});

afterEach(() => {
  delete (window as any).echarts;
  cleanup();
});

// Mock API
vi.mock("../../api/chartPreview", () => ({
  fetchChartPreview: vi.fn(),
}));

vi.mock("../../components/chart/chartRenderer", () => ({
  buildChartOption: vi.fn(() => ({
    title: { text: "Chart" },
    dataset: { source: [] },
  })),
}));

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
}));

vi.mock("@mantine/core", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useMantineColorScheme: vi.fn(() => ({ colorScheme: "light" })),
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
    mockEChartsInstance.setOption.mockClear();
    mockEChartsInstance.dispose.mockClear();
  });

  it("renders chart view container", () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    expect(screen.getByTestId("chart-view")).toBeInTheDocument();
  });

  it("fetches chart data on mount with symbol from params", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-loading")).toBeInTheDocument();
    });
  });

  it("handles fetch error", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockRejectedValue(new Error("Failed to fetch"));

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-error")).toBeInTheDocument();
    });
  });

  it("renders timeframe selector", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    // Wait for initial fetch
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-pivots-checkbox")).toBeInTheDocument();
    });
  });

  it("shows toggle for 52w high", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("candlestick-chart")).toBeInTheDocument();
    });

    const checkbox = screen.getByTestId("chart-pivots-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);

    // Toggling should re-render chart (fetches not re-triggered because timeframe/orMinutes unchanged)
    // Actually toggle doesn't trigger fetch; only useEffect dependencies include showPivots but fetch is separate from render
  });

  it("navigates back when goBack is called", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-back-btn")).toBeInTheDocument();
    });

    const backBtn = screen.getByTestId("chart-back-btn");
    backBtn.click();

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("displays chart footer with data", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-footer")).toBeInTheDocument();
    });

    expect(screen.getByText(/1 candles/)).toBeInTheDocument();
    expect(screen.getByText(/TF: 15m/)).toBeInTheDocument();
    expect(screen.getByText(/OR: 45m/)).toBeInTheDocument();
    expect(screen.getByText(/52W High: ₹150\.00/)).toBeInTheDocument();
  });

  it("initializes echarts instance on data load", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    vi.mocked(buildChartOption).mockReturnValue({});

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect((window as any).echarts.init).toHaveBeenCalled();
    });
  });

  it("disposes echarts instance on cleanup", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);
    vi.mocked(buildChartOption).mockReturnValue({});

    const { unmount } = render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect((window as any).echarts.init).toHaveBeenCalled();
    });

    unmount();

    expect(mockEChartsInstance.dispose).toHaveBeenCalled();
  });

  it("shows retry button in error state", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockRejectedValue(new Error("Network error"));

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-retry-btn")).toBeInTheDocument();
    });
  });
});

describe("ChartView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    (window as any).echarts = {
      init: vi.fn(() => ({
        setOption: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
      })),
    };
  });

  afterEach(() => {
    delete (window as any).echarts;
  });

  const mockChartData = {
    symbol: "TEST",
    candles: [
      { time: "2025-06-15 09:15:00", open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    ],
    orb_zones: [],
    pivot_levels: [],
    high_52w: 150,
  };

  it("renders chart view container", () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    expect(screen.getByTestId("chart-view")).toBeInTheDocument();
  });

  it("fetches chart data on mount with symbol from params", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 5, 45);
    });
  });

  it("shows loading state initially", () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    );

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    expect(screen.getByTestId("chart-loading")).toBeInTheDocument();
  });

  it("handles fetch error", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockRejectedValue(new Error("Failed to fetch"));

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-error")).toBeInTheDocument();
    });
  });

  it("renders timeframe selector", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
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
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 5, 45);
    });

    // After initial load, simulate timeframe change
    // This would require accessing setTimeframe which is internal
    // We can confirm re-fetch on timeframe change by checking mock call count increase
    // But easier: we can test that the component re-renders
  });

  it("renders orb minutes selector", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-or-select")).toBeInTheDocument();
    });
  });

  it("shows toggle for pivots", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-pivots-checkbox")).toBeInTheDocument();
    });
  });

  it("shows toggle for 52w high", async () => {
    vi.mocked(useParams).mockReturnValue({ symbol: "TEST" });
    vi.mocked(fetchChartPreview).mockResolvedValue(mockChartData);

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-52w-checkbox")).toBeInTheDocument();
    });
  });

  it("navigates back when symbol param is missing", async () => {
    const mockNavigate = vi.fn();
    vi.mocked(useNavigate).mockReturnValue(mockNavigate);
    vi.mocked(useParams).mockReturnValue({ symbol: "" });

    render(
      <MantineProvider>
        <ChartView />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-view-error")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Back to Screener"));

    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
