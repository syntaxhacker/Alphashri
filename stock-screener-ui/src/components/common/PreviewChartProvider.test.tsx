// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { PreviewChartProvider, usePreviewChart } from "./PreviewChartProvider";

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
});
