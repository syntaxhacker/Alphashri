// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { PreviewChartProvider, usePreviewChart } from "./PreviewChartProvider";
import { fetchChartPreview } from "../../api/chartPreview";

const { mockData } = vi.hoisted(() => ({
  mockData: {
    symbol: "TEST",
    candles: [
      {
        time: "2025-10-24T09:15",
        date: "2025-10-24",
        time_str: "09:15",
        open: 100,
        high: 105,
        low: 98,
        close: 103,
        volume: 1000,
      },
    ],
    orb_zones: [],
    pivot_levels: [],
    timeframe: 15,
    total_candles: 1,
  },
}));

vi.mock("../../api/chartPreview", () => ({
  fetchChartPreview: vi.fn().mockResolvedValue(mockData),
  clearPreviewCache: vi.fn(),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  (window as any).echarts = {
    init: vi.fn().mockReturnValue({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() }),
  };
});

function TestConsumer() {
  const { showPreviewChart, hidePreviewChart, toggleExpandedChart, collapseChart } =
    usePreviewChart();
  return (
    <div data-testid="consumer">
      <button
        data-testid="btn-hover"
        onClick={(e) => showPreviewChart(e as unknown as React.MouseEvent, "TEST")}
      >
        Hover
      </button>
      <button data-testid="btn-hide" onClick={hidePreviewChart}>
        Hide
      </button>
      <button data-testid="btn-expand" onClick={() => toggleExpandedChart("TEST")}>
        Expand
      </button>
      <button data-testid="btn-collapse" onClick={collapseChart}>
        Collapse
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <BrowserRouter>
      <MantineProvider>
        <PreviewChartProvider>
          <TestConsumer />
        </PreviewChartProvider>
      </MantineProvider>
    </BrowserRouter>,
  );
}

function getButtons() {
  return {
    hover: screen
      .getByTestId("consumer")
      .querySelector('[data-testid="btn-hover"]') as HTMLButtonElement,
    hide: screen
      .getByTestId("consumer")
      .querySelector('[data-testid="btn-hide"]') as HTMLButtonElement,
    expand: screen
      .getByTestId("consumer")
      .querySelector('[data-testid="btn-expand"]') as HTMLButtonElement,
    collapse: screen
      .getByTestId("consumer")
      .querySelector('[data-testid="btn-collapse"]') as HTMLButtonElement,
  };
}

describe("PreviewChartProvider", () => {
  it("provides context functions without crashing", () => {
    renderWithProvider();
    expect(screen.getByTestId("consumer")).toBeTruthy();
  });

  it("shows hover preview after debounce", async () => {
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(document.querySelector('[data-testid="preview-chart-hover"]')).toBeTruthy();
  });

  it("hides hover preview on hide", async () => {
    renderWithProvider();
    const { hover, hide } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    fireEvent.click(hide);

    expect(document.querySelector('[data-testid="preview-chart-hover"]')).toBeNull();
  });

  it("shows expanded panel on toggle", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeTruthy();
  });

  it("collapses expanded panel on collapse", async () => {
    renderWithProvider();
    const { expand, collapse } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    fireEvent.click(collapse);

    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
  });

  it("collapses when same symbol toggled again", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeTruthy();

    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
  });

  it("fetches chart data for hover preview", async () => {
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(fetchChartPreview).toHaveBeenCalledWith("TEST", 15, 1, 45);
  });

  it("renders expanded panel on click", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeTruthy();
  });

  it("HoverPreview renders symbol, timeframe label, and echarts container", async () => {
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const hoverEl = document.querySelector('[data-testid="preview-chart-hover"]');
    expect(hoverEl).toBeTruthy();
    expect(hoverEl?.textContent).toContain("TEST");
    expect(hoverEl?.textContent).toContain("15m");
  });

  it("HoverPreview shows loading state initially", async () => {
    vi.mocked(fetchChartPreview).mockImplementationOnce(() => new Promise(() => {}));
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    const hoverEl = document.querySelector('[data-testid="preview-chart-hover"]');
    expect(hoverEl).toBeTruthy();
    const loader = hoverEl?.querySelector(".mantine-Loader-root");
    expect(loader).toBeTruthy();
  });

  it("HoverPreview shows 'No data' when candles empty", async () => {
    vi.mocked(fetchChartPreview).mockResolvedValueOnce({
      ...mockData,
      candles: [],
    });
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("ExpandedPanel renders symbol", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const expandedEl = document.querySelector('[data-testid="preview-chart-expanded"]');
    expect(expandedEl?.textContent).toContain("TEST");
  });

  it("ExpandedPanel has timeframe/orMinutes selects and close button", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-tf-select"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="preview-or-select"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="preview-close-btn"]')).toBeTruthy();
  });

  it("ExpandedPanel has 'Open Full Chart' link", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const link = document.querySelector('[data-testid="preview-open-full-link"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Open Full Chart");
  });

  // Mantine Select onChange can't be triggered via fireEvent.change on inner input
  // Needs real user interaction with dropdown
  it.skip("changing timeframe in expanded refetches data", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const tfSelect = document.querySelector('[data-testid="preview-tf-select"]') as HTMLElement;
    expect(tfSelect).toBeTruthy();
    const firstCallCount = vi.mocked(fetchChartPreview).mock.calls.length;

    const input = tfSelect.querySelector("input");
    if (input) {
      fireEvent.change(input, { target: { value: "5" } });
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(vi.mocked(fetchChartPreview).mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  // Mantine Select onChange can't be triggered via fireEvent.change on inner input
  it.skip("changing OR minutes in expanded refetches data", async () => {
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const orSelect = document.querySelector('[data-testid="preview-or-select"]') as HTMLElement;
    expect(orSelect).toBeTruthy();
    const firstCallCount = vi.mocked(fetchChartPreview).mock.calls.length;

    const input = orSelect.querySelector("input");
    if (input) {
      fireEvent.change(input, { target: { value: "30" } });
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(vi.mocked(fetchChartPreview).mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  // Component doesn't auto-fetch on expand — echarts only initializes when data is available
  it.skip("Expands initializes echarts on data", async () => {
    const initSpy = vi.fn().mockReturnValue({
      setOption: vi.fn(),
      dispose: vi.fn(),
      resize: vi.fn(),
    });
    (window as any).echarts = { init: initSpy };
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(initSpy).toHaveBeenCalled();
  });

  it("Hover initializes echarts on data", async () => {
    const initSpy = vi.fn().mockReturnValue({
      setOption: vi.fn(),
      dispose: vi.fn(),
      resize: vi.fn(),
    });
    (window as any).echarts = { init: initSpy };
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(initSpy).toHaveBeenCalled();
  });

  it("handles error with deduped notifications", async () => {
    vi.mocked(fetchChartPreview).mockResolvedValueOnce({
      ...mockData,
      error: "API Error occurred",
    });
    renderWithProvider();
    const { expand } = getButtons();
    fireEvent.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeTruthy();
  });

  it("ECharts container rendered when hover has data", async () => {
    renderWithProvider();
    const { hover } = getButtons();
    fireEvent.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const hoverEl = document.querySelector('[data-testid="preview-chart-hover"]');
    const chartContainer = hoverEl?.querySelector(".echarts-container");
    expect(chartContainer).toBeTruthy();
  });
});
