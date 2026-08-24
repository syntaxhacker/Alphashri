// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { UIProvider } from "@/ui";
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
      <UIProvider>
        <PreviewChartProvider>
          <TestConsumer />
        </PreviewChartProvider>
      </UIProvider>
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
    expect(screen.getByTestId("consumer")).toBeInTheDocument();
  });

  it("shows hover preview after debounce", async () => {
      const user = userEvent.setup();
    renderWithProvider();
    const { hover } = getButtons();
    await user.click(hover);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(document.querySelector('[data-testid="preview-chart-hover"]')).toBeInTheDocument();
  });

  it("hides hover preview on hide", async () => {
      const user = userEvent.setup();
    renderWithProvider();
    const { hover, hide } = getButtons();
    await user.click(hover);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    await user.click(hide);

    expect(document.querySelector('[data-testid="preview-chart-hover"]')).toBeNull();
  });

  it("shows expanded panel on toggle", async () => {
      const user = userEvent.setup();
    renderWithProvider();
    const { expand } = getButtons();
    await user.click(expand);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeInTheDocument();
  });

  it("collapses expanded panel on collapse", async () => {
      const user = userEvent.setup();
    renderWithProvider();
    const { expand, collapse } = getButtons();
    await user.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    await user.click(collapse);

    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
  });

  it("collapses when same symbol toggled again", async () => {
      const user = userEvent.setup();
    renderWithProvider();
    const { expand } = getButtons();
    await user.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeInTheDocument();

    await user.click(expand);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
  });
});
