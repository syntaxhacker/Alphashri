// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Router } from "@solidjs/router";
import { UIProvider } from "@/ui";
import { PreviewChartProvider, usePreviewChart } from "./PreviewChartProvider";

const { mockData, mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
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
  fetchChartPreview: mockFetch,
  clearPreviewCache: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  mockFetch.mockResolvedValue(mockData);
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
        onClick={(e) => showPreviewChart(e as unknown as MouseEvent, "TEST")}
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
  return render(() => (
    <Router
      root={() => (
        <UIProvider>
          <PreviewChartProvider>
            <TestConsumer />
          </PreviewChartProvider>
        </UIProvider>
      )}
    />
  ));
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
  it("shows hover preview after debounce", async () => {
          renderWithProvider();
    const { hover } = getButtons();
    await fireEvent.click(hover);

    await new Promise((r) => setTimeout(r, 400));

    expect(document.querySelector('[data-testid="preview-chart-hover"]')).toBeInTheDocument();
  });

  it("hides hover preview on hide", async () => {
          renderWithProvider();
    const { hover, hide } = getButtons();
    await fireEvent.click(hover);
    await new Promise((r) => setTimeout(r, 400));

    await fireEvent.click(hide);

    expect(document.querySelector('[data-testid="preview-chart-hover"]')).toBeNull();
  });

  it("shows expanded panel on toggle", async () => {
          renderWithProvider();
    const { expand } = getButtons();
    await fireEvent.click(expand);

    await new Promise((r) => setTimeout(r, 100));

    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeInTheDocument();
  });

  it("collapses expanded panel on collapse", async () => {
          renderWithProvider();
    const { expand, collapse } = getButtons();
    await fireEvent.click(expand);
    await new Promise((r) => setTimeout(r, 100));

    await fireEvent.click(collapse);

    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
  });

  it("collapses when same symbol toggled again", async () => {
          renderWithProvider();
    const { expand } = getButtons();
    await fireEvent.click(expand);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeInTheDocument();

    await fireEvent.click(expand);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
  });

  it("expanded panel fetches its data on open", async () => {
    renderWithProvider();
    await fireEvent.click(getButtons().expand);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded-error"]')).toBeNull();
      expect(document.querySelector('[data-testid="preview-chart-expanded"] .echarts-container')).not.toBeNull();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("expanded panel shows an error with Retry on a transport failure, not 'No data available'", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    renderWithProvider();
    await fireEvent.click(getButtons().expand);

    await vi.waitFor(() => {
      expect(screen.getByText("Couldn't load chart")).toBeInTheDocument();
    });
    expect(screen.queryByText("No data available")).toBeNull();

    await fireEvent.click(screen.getByTestId("preview-chart-retry"));
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"] .echarts-container')).not.toBeNull();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Couldn't load chart")).toBeNull();
  });

  it("expanded panel treats a null (failed transport) response as an error, not empty data", async () => {
    mockFetch.mockResolvedValueOnce(null);
    renderWithProvider();
    await fireEvent.click(getButtons().expand);

    await vi.waitFor(() => {
      expect(screen.getByText("Couldn't load chart")).toBeInTheDocument();
    });
    expect(screen.queryByText("No data available")).toBeNull();
    expect(screen.getByTestId("preview-chart-retry")).toBeInTheDocument();
  });

  it("expanded panel keeps a genuine empty response as 'No data available'", async () => {
    mockFetch.mockResolvedValue({ ...mockData, candles: [], total_candles: 0 });
    renderWithProvider();
    await fireEvent.click(getButtons().expand);

    await vi.waitFor(() => {
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
    expect(screen.queryByText("Couldn't load chart")).toBeNull();
    expect(screen.queryByTestId("preview-chart-retry")).toBeNull();
  });

  it("expanded panel closes on Escape", async () => {
    renderWithProvider();
    await fireEvent.click(getButtons().expand);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
    });
  });

  it("expanded panel focuses its dialog surface when it opens", async () => {
    renderWithProvider();
    await fireEvent.click(getButtons().expand);

    await vi.waitFor(() => {
      const panel = document.querySelector('[data-testid="preview-chart-expanded"]') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("dialog");
      expect(document.activeElement).toBe(panel);
    });
  });

  it("Escape still closes the panel after the timeframe select closes its own popup", async () => {
    // A native <select> never reports aria-expanded, so the panel must still
    // close on the next Escape regardless of where focus sits.
    renderWithProvider();
    await fireEvent.click(getButtons().expand);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"]')).not.toBeNull();
    });

    const select = screen.getByTestId("preview-tf-select").querySelector("select") as HTMLSelectElement;
    select.focus();
    fireEvent.keyDown(select, { key: "Escape" });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
    });
  });

  it("expanded panel closes on a backdrop click", async () => {
    renderWithProvider();
    await fireEvent.click(getButtons().expand);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeInTheDocument();
    });

    const backdrop = document.querySelector('[data-testid="preview-chart-backdrop"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    await fireEvent.click(backdrop);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-expanded"]')).toBeNull();
    });
  });

  it("hover preview reports a transport failure instead of claiming there is no data", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    renderWithProvider();
    await fireEvent.click(getButtons().hover);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-hover-error"]')).not.toBeNull();
    });
    expect(screen.getByText("Couldn't load chart")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="preview-chart-hover-empty"]')).toBeNull();
  });

  it("hover preview treats a null (failed transport) response as an error", async () => {
    mockFetch.mockResolvedValueOnce(null);
    renderWithProvider();
    await fireEvent.click(getButtons().hover);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-hover-error"]')).not.toBeNull();
    });
    expect(screen.getByText("Couldn't load chart")).toBeInTheDocument();
  });

  it("hover preview keeps a genuine empty response as 'No data'", async () => {
    mockFetch.mockResolvedValue({ ...mockData, candles: [], total_candles: 0 });
    renderWithProvider();
    await fireEvent.click(getButtons().hover);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="preview-chart-hover-empty"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-testid="preview-chart-hover-error"]')).toBeNull();
  });
});
