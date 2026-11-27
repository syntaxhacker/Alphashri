// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const mockSetOption = vi.fn();
const mockDispatchAction = vi.fn();
const mockDispose = vi.fn();
const mockChartInstance = {
  setOption: mockSetOption,
  dispatchAction: mockDispatchAction,
  dispose: mockDispose,
  resize: vi.fn(),
  on: vi.fn(),
};

vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => mockChartInstance) })),
}));

vi.mock("../../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../../state/auth";
import { clearPreviewCache } from "../../api/chartPreview";
import { TradeChart } from "./TradeChart";

const mockedFetch = vi.mocked(fetchWithAuth);

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function makeCandles() {
  return [
    { time: "2025-10-24T10:00", date: "2025-10-24", time_str: "10:00", open: 103, high: 106, low: 102, close: 105, volume: 1000 },
    { time: "2025-10-24T10:30", date: "2025-10-24", time_str: "10:30", open: 105, high: 108, low: 104, close: 107, volume: 1200 },
  ];
}

const baseProps = {
  symbol: "TATASTEEL",
  date: "2025-10-24",
  entryPrice: 103,
  exitPrice: 107,
  entryTime: "2025-10-24T10:00",
  exitTime: "2025-10-24T10:30",
  height: 280,
};

function renderChart(overrides: Record<string, unknown> = {}) {
  return render(() => (
    <UIProvider>
      <TradeChart {...baseProps} {...overrides} />
    </UIProvider>
  ));
}

beforeEach(() => {
  setupBrowserMocks();
  vi.clearAllMocks();
  clearPreviewCache();
});

afterEach(() => {
  cleanup();
  clearPreviewCache();
});

describe("TradeChart", () => {
  it("requests the preview endpoint with the symbol in the path and tf/days in the query", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ symbol: "TATASTEEL", candles: makeCandles() }));
    const { findByTestId } = renderChart();

    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());

    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/chart/preview/TATASTEEL");
    expect(url).toContain("tf=");
    expect(url).toContain("days=");
    expect(url).not.toContain("?symbol=");
    expect(url).not.toContain("&symbol=");
    expect(url).not.toContain("date=");
    expect(url).not.toContain("&date=");
    await findByTestId("trade-chart");
  });

  it("renders candles from the preview response and applies entry/exit lines", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ symbol: "TATASTEEL", candles: makeCandles() }));
    renderChart();

    await waitFor(() => expect(mockSetOption).toHaveBeenCalled());

    const [option, replace] = mockSetOption.mock.calls[0];
    expect(replace).toBe(true);
    expect(option.series[0].type).toBe("candlestick");
    expect(option.series[0].data).toEqual([
      [103, 105, 102, 106],
      [105, 107, 104, 108],
    ]);
    expect(option.xAxis.data).toEqual(["10:00", "10:30"]);

    const levels = option.series[0].markLine.data.map((d: any) => d.yAxis);
    expect(levels).toContain(103);
    expect(levels).toContain(107);
    expect(mockDispatchAction).toHaveBeenCalled();
  });

  it("shows the empty state when the response has no candles", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ symbol: "TATASTEEL", candles: [], error: "no data" }));
    const { findByTestId } = renderChart();

    const empty = await findByTestId("trade-chart-empty");
    expect(empty.textContent).toContain("TATASTEEL");
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  it("shows the empty state when the request fails", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const { findByTestId } = renderChart();

    await findByTestId("trade-chart-empty");
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  it("shows the empty state when the request throws", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));
    const { findByTestId } = renderChart();

    await findByTestId("trade-chart-empty");
    expect(mockSetOption).not.toHaveBeenCalled();
  });
});
